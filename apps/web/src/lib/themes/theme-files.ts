import { VsCodeTheme, type ThemeResult } from "./vscode-theme";

async function read(
  files: readonly File[],
): Promise<ThemeResult<VsCodeTheme[]>> {
  if (files.length > 40) {
    return { ok: false, error: "Import up to 40 theme files at a time." };
  }
  const themes: VsCodeTheme[] = [];
  for (const file of files) {
    if (file.size > VsCodeTheme.maxBytes) {
      return {
        ok: false,
        error: `${file.name} is larger than 1 MB. Choose a smaller theme file.`,
      };
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      return {
        ok: false,
        error: `${file.name} could not be read. Select the file again. Your saved themes are unchanged.`,
      };
    }
    const result = VsCodeTheme.parse(text, file.name);
    if (!result.ok)
      return { ok: false, error: `${file.name}: ${result.error}` };
    themes.push(result.value);
  }
  return { ok: true, value: themes };
}

export const ThemeFiles = { read } as const;
