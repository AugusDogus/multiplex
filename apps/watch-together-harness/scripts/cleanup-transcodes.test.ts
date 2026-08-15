import { describe, expect, test } from "bun:test";

import { transcodeSessionKeys } from "./cleanup-transcodes";

describe("transcodeSessionKeys", () => {
  test("extracts every session regardless of XML attribute order", () => {
    expect(
      transcodeSessionKeys(
        '<MediaContainer><TranscodeSession key="first" progress="10"/><TranscodeSession progress="20" key="second"></TranscodeSession></MediaContainer>',
      ),
    ).toEqual(["first", "second"]);
  });
});
