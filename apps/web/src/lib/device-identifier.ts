"use client";

const WATCH_TOGETHER_DEVICE_ID_KEY = "multiplex-watch-together-device-id";

export function getWatchTogetherDeviceIdentifier(): string {
  const stored = window.localStorage.getItem(WATCH_TOGETHER_DEVICE_ID_KEY);
  if (stored) {
    return stored;
  }

  const deviceIdentifier = `multiplex-${crypto.randomUUID()}`;
  window.localStorage.setItem(WATCH_TOGETHER_DEVICE_ID_KEY, deviceIdentifier);
  return deviceIdentifier;
}
