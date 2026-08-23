import { expect, test } from "bun:test";

import { getItemDetailsWarmKey } from "./hooks";

test("fresh detail credential warms keep a stable key", () => {
  const initialKey = getItemDetailsWarmKey("server-1:100", true, true, 1_000);
  const updatedKey = getItemDetailsWarmKey("server-1:100", true, true, 2_000);

  expect(initialKey).toBe("details:server-1:100:credentials");
  expect(updatedKey).toBe(initialKey);
});

test("stale detail warms remain keyed by the fetched timestamp", () => {
  expect(getItemDetailsWarmKey("server-1:100", true, false, null)).toBe(
    "details:server-1:100:missing",
  );
  expect(getItemDetailsWarmKey("server-1:100", true, false, 1_000)).toBe(
    "details:server-1:100:1000",
  );
});

test("details do not get a warm key when no warm is needed", () => {
  expect(getItemDetailsWarmKey("server-1:100", false, true, 1_000)).toBeNull();
});
