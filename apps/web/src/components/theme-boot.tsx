import { themeColorKeys, themeChromeKeys } from "~/lib/themes/vscode-theme";
import { BuiltInThemes } from "~/lib/themes/built-in-themes";
import {
  themeStorageKey,
  themeStyleId,
  t3ChatSurfaceCss,
} from "~/lib/themes/theme-preferences";

// Runs before the page is painted. Only known variables with hex colors may
// become CSS; imported names and source text never become markup or script.
export const themeBootScript = `(() => {
  const style = document.getElementById(${JSON.stringify(themeStyleId)});
  if (!style) return;
  style.textContent = '';
  try {
    const saved = JSON.parse(localStorage.getItem(${JSON.stringify(themeStorageKey)}) || 'null');
    if (!saved || saved.version !== 1 || !Array.isArray(saved.themes) || saved.themes.length > 100) return;
    const keys = ${JSON.stringify(themeColorKeys)};
    const chromeKeys = ${JSON.stringify(themeChromeKeys)};
    const validChrome = colors => chromeKeys.every(k => colors[k] === undefined || (typeof colors[k] === 'string' && /^#[\\da-f]{6}$/i.test(colors[k])));
    const themes = [...${JSON.stringify(BuiltInThemes.all)}, ...saved.themes];
    const valid = t => t && typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 200 &&
      typeof t.name === 'string' && t.name.trim().length > 0 && t.name.trim().length <= 80 &&
      (t.appearance === 'light' || t.appearance === 'dark') && t.colors &&
      keys.every(k => typeof t.colors[k] === 'string' && /^#[\\da-f]{6}$/i.test(t.colors[k])) && validChrome(t.colors);
    if (!saved.themes.every(valid) || new Set(themes.map(t => t.id)).size !== themes.length) return;
    if (['light', 'dark'].some(mode => saved[mode] !== null && !themes.some(t => t.id === saved[mode] && t.appearance === mode))) return;
    let css = '';
    for (const mode of ['light', 'dark']) {
      if (typeof saved[mode] !== 'string') continue;
      const theme = themes.find(t => t && t.id === saved[mode] && t.appearance === mode);
      if (!theme || !theme.colors || !keys.every(k => typeof theme.colors[k] === 'string' && /^#[\\da-f]{6}$/i.test(theme.colors[k]))) continue;
      if (!validChrome(theme.colors)) continue;
      css += ':root.' + mode + '{' + [...keys, ...chromeKeys].filter(k => theme.colors[k] !== undefined).map(k => '--' + k + ':' + theme.colors[k] + ';').join('') + (theme.id === 'builtin:t3-chat:' + mode ? ${JSON.stringify(t3ChatSurfaceCss)} : '') + '}';
    }
    style.textContent = css;
  } catch { /* The settings page reports unreadable storage after hydration. */ }
})();`;

export function ThemeBoot() {
  return (
    <>
      <style
        id={themeStyleId}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
    </>
  );
}
