// Palettes adapted from T3 Code, MIT. See public/licenses/t3-code/NOTICE.
import palettes from "./built-in-themes.json";
import type { VsCodeTheme } from "./vscode-theme";

const pairs = palettes.map((palette) => ({
  id: palette.id,
  name: palette.name,
  themes: (["light", "dark"] as const).map(
    (appearance): VsCodeTheme => ({
      id: `builtin:${palette.id}:${appearance}`,
      name: palette.name,
      appearance,
      colors: palette[appearance],
    }),
  ),
}));
const all = pairs.flatMap((pair) => pair.themes);

export const BuiltInThemes = { pairs, all } as const;
