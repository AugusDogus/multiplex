const port = Number.parseInt(
  process.env.MULTIPLEX_XBOX_FIXTURE_PORT ?? "39001",
  10,
);

const json = (value: unknown, status = 200): Response =>
  Response.json(value, {
    status,
    headers: { Connection: "close", "Cache-Control": "no-store" },
  });

Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ready");
    if (url.pathname === "/api/auth/device/code") {
      return json({
        device_code: "fixture-device",
        user_code: "XBOX",
        verification_uri: `http://10.0.2.2:${port}/link`,
        interval: 1,
      });
    }
    if (url.pathname === "/api/auth/device/token") {
      return json({ access_token: "fixture-session", expires_in: 3600 });
    }
    if (url.pathname === "/api/auth/get-session") {
      return json({ user: { plexAuthToken: "fixture-plex" } });
    }
    if (url.pathname === "/api/console/plex/servers") {
      return json({
        apiVersion: 1,
        status: "ready",
        servers: [{ id: "fixture-server", name: "Fixture Plex" }],
      });
    }
    if (url.pathname === "/api/console/plex/home") {
      console.log("catalog served");
      return json({
        apiVersion: 1,
        status: "ready",
        server: { id: "fixture-server", name: "Fixture Plex" },
        rows: [
          {
            title: "Continue Watching",
            items: [
              {
                ratingKey: 42,
                mediaType: "movie",
                title: "Xbox Fixture Movie",
                subtitle: "2026",
                durationMs: 7_200_000,
                viewOffsetMs: 1_800_000,
                artworkPath: null,
              },
            ],
          },
        ],
      });
    }
    return json({ status: "not-found" }, 404);
  },
});

console.log(`fixture ready on ${port}`);
