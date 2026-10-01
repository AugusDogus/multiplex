type Color = { r: number; g: number; b: number; a: number };

function parse(value: string | undefined): Color | null {
  if (value === undefined) return null;
  const hex = value.trim().replace(/^#/, "");
  if (!/^(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
  const expanded = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

function hex(color: Color): string {
  return `#${[color.r, color.g, color.b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: Color): number {
  const linear = (c: number) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linear(color.r) +
    0.7152 * linear(color.g) +
    0.0722 * linear(color.b)
  );
}

function flatten(color: Color, base: Color): Color {
  return {
    r: color.r * color.a + base.r * (1 - color.a),
    g: color.g * color.a + base.g * (1 - color.a),
    b: color.b * color.a + base.b * (1 - color.a),
    a: 1,
  };
}

function readable(surface: Color, candidate: Color): Color {
  const a = luminance(surface);
  const b = luminance(candidate);
  if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5)
    return candidate;
  const channel = a < 0.179 ? 255 : 0;
  return { r: channel, g: channel, b: channel, a: 1 };
}

export const ThemeColor = { parse, hex, luminance, flatten, readable } as const;
