import { expect, test, type Page, type TestInfo } from "@playwright/test";

interface PlayerSnapshot {
  readonly title: string;
  readonly state: string;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly errorCode: number | null;
}

async function readPlayers(page: Page): Promise<readonly PlayerSnapshot[]> {
  return await page.locator(".player-card").evaluateAll((cards) =>
    cards.map((card) => {
      const video = card.querySelector("video");
      if (!(video instanceof HTMLVideoElement)) {
        throw new Error("Player card has no video element.");
      }
      let offsetSeconds = 0;
      try {
        offsetSeconds = Number(new URL(video.currentSrc).searchParams.get("offset") ?? 0);
      } catch {
        offsetSeconds = 0;
      }
      return {
        title: card.querySelector(".viewer-title")?.textContent ?? "",
        state: card.querySelector(".viewer-state")?.textContent ?? "",
        positionSeconds: offsetSeconds + video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        errorCode: video.error?.code ?? null,
      };
    }),
  );
}

function synchronized(
  players: readonly PlayerSnapshot[],
  predicate: (player: PlayerSnapshot) => boolean,
): boolean {
  const host = players[0];
  const guest = players[1];
  return Boolean(
    host &&
    guest &&
    predicate(host) &&
    predicate(guest) &&
    Math.abs(host.positionSeconds - guest.positionSeconds) <= 2,
  );
}

async function attachProtocolTimeline(page: Page, testInfo: TestInfo): Promise<void> {
  const text = (await page.locator("#timeline").textContent()) ?? "";
  await testInfo.attach("protocol-timeline", {
    body: Buffer.from(text),
    contentType: "text/plain",
  });
}

test("two real Plex viewers stay synchronized through the full lifecycle", async ({
  page,
}, testInfo) => {
  test.setTimeout(7 * 60_000);
  const mediaResponses: Array<{
    readonly status: number;
    readonly pathname: string;
    readonly contentType: string;
  }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes("/video/:/transcode/")) return;
    mediaResponses.push({
      status: response.status(),
      pathname: url.pathname,
      contentType: response.headers()["content-type"] ?? "",
    });
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".player-card")).toHaveCount(2, {
      timeout: 120_000,
    });

    await expect
      .poll(
        async () => {
          const players = await readPlayers(page);
          if (players.some((player) => player.errorCode !== null)) {
            throw new Error(
              `Plex stream failed before readiness. players=${JSON.stringify(players)} responses=${JSON.stringify(mediaResponses)}`,
            );
          }
          return synchronized(
            players,
            (player) => player.errorCode === null && player.readyState >= 3,
          );
        },
        { timeout: 120_000, message: "both real Plex streams become ready" },
      )
      .toBe(true);

    const beforePlay = await readPlayers(page);
    await page.getByRole("button", { name: "Play both" }).click();
    await expect
      .poll(
        async () => {
          const current = await readPlayers(page);
          return synchronized(
            current,
            (player) =>
              !player.paused &&
              player.errorCode === null &&
              player.positionSeconds > (beforePlay[0]?.positionSeconds ?? 0) + 0.5,
          );
        },
        { timeout: 60_000, message: "both viewers advance" },
      )
      .toBe(true);

    await page.getByRole("button", { name: "Pause host" }).click();
    await expect
      .poll(async () => synchronized(await readPlayers(page), (player) => player.paused), {
        timeout: 15_000,
        message: "host pause reaches the guest",
      })
      .toBe(true);

    await page.getByRole("button", { name: "Play host" }).click();
    await expect
      .poll(async () => synchronized(await readPlayers(page), (player) => !player.paused), {
        timeout: 15_000,
        message: "host resume reaches the guest",
      })
      .toBe(true);

    await page.getByRole("button", { name: "Seek host to 50%" }).click();
    await expect
      .poll(
        async () =>
          synchronized(
            await readPlayers(page),
            (player) =>
              player.errorCode === null && player.positionSeconds > player.durationSeconds * 0.45,
          ),
        { timeout: 90_000, message: "host seek reaches the guest" },
      )
      .toBe(true);

    await page.getByRole("button", { name: "Disconnect guest" }).click();
    await expect(page.getByRole("button", { name: "Reconnect guest" })).toBeVisible();
    await page.getByRole("button", { name: "Pause host" }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "Reconnect guest" }).click();
    await expect
      .poll(async () => synchronized(await readPlayers(page), (player) => player.paused), {
        timeout: 30_000,
        message: "reconnected guest catches host state",
      })
      .toBe(true);

    await page.getByRole("button", { name: "Play host" }).click();
    await expect
      .poll(async () => synchronized(await readPlayers(page), (player) => !player.paused), {
        timeout: 15_000,
        message: "reconnected guest resumes with host",
      })
      .toBe(true);

    await page.getByRole("button", { name: "Seek host near end" }).click();
    await expect
      .poll(
        async () =>
          synchronized(
            await readPlayers(page),
            (player) =>
              player.errorCode === null && player.positionSeconds > player.durationSeconds * 0.8,
          ),
        { timeout: 90_000, message: "near-end seek reaches both viewers" },
      )
      .toBe(true);

    for (let index = 0; index < 20; index += 1) {
      const players = await readPlayers(page);
      expect(
        players.every(
          (player) =>
            player.errorCode === null && player.positionSeconds > player.durationSeconds * 0.5,
        ),
        `near-end playback must not reset at sample ${index}`,
      ).toBe(true);
      await page.waitForTimeout(100);
    }

    const priorTitle = (await readPlayers(page))[0]?.title ?? "";
    await page.locator("#next-episode").click();
    await expect
      .poll(
        async () => {
          const players = await readPlayers(page);
          return synchronized(
            players,
            (player) =>
              player.title !== priorTitle && player.errorCode === null && player.readyState >= 3,
          );
        },
        { timeout: 120_000, message: "both viewers enter the next episode" },
      )
      .toBe(true);
  } finally {
    await attachProtocolTimeline(page, testInfo);
  }
});
