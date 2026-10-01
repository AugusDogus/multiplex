import { unzipSync } from "fflate";
import { parse, type ParseError } from "jsonc-parser";
import { z } from "zod";
import { VsCodeTheme, type ThemeResult } from "./vscode-theme";

export const maxExtensionBytes = 20 * 1024 * 1024;
const maxJsonBytes = 1024 * 1024;
const themeFileSchema = z.object({
  include: z.string().max(1024).optional(),
  colors: z.record(z.string()).optional(),
});
const manifestSchema = z.object({
  contributes: z.object({
    themes: z
      .array(
        z.object({
          label: z.string().max(200).optional(),
          path: z.string().max(1024),
          uiTheme: z.enum(["vs", "vs-dark", "hc-black", "hc-light"]),
        }),
      )
      .min(1)
      .max(40),
  }),
});

function json<T>(source: Uint8Array, schema: z.ZodType<T>): ThemeResult<T> {
  const errors: ParseError[] = [];
  const value: unknown = parse(
    new TextDecoder().decode(source).replace(/^\uFEFF/, ""),
    errors,
    { allowTrailingComma: true },
  );
  const result = schema.safeParse(value);
  if (errors.length || !result.success)
    return {
      ok: false,
      error:
        "A theme file has invalid JSON or an unsupported format. No themes were installed. Try another extension.",
    };
  return { ok: true, value: result.data };
}

// Resolve archive paths in memory. Never fetch an include or execute extension code.
function resolvePath(
  path: string,
  from = "extension/package.json",
): ThemeResult<string> {
  if (path.length > 1024 || /[\0:\\]/.test(path) || path.startsWith("/"))
    return {
      ok: false,
      error:
        "The theme contains an invalid file path. Choose another extension.",
    };
  const segments = from.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (segments.length <= 1)
        return {
          ok: false,
          error:
            "A theme include points outside its extension. Choose another extension.",
        };
      segments.pop();
    } else segments.push(part);
  }
  return { ok: true, value: segments.join("/") };
}

function extract(bytes: Uint8Array): ThemeResult<Map<string, Uint8Array>> {
  if (bytes.byteLength > maxExtensionBytes)
    return {
      ok: false,
      error:
        "This extension is larger than 20 MB. Choose a smaller theme extension.",
    };
  let entries = 0;
  let expanded = 0;
  let oversized = false;
  // Boundary: fflate throws for corrupt archives. Report a stable import result.
  try {
    const files = unzipSync(bytes, {
      filter: (entry) => {
        entries += 1;
        if (entries > 2000) oversized = true;
        if (
          !entry.name.startsWith("extension/") ||
          !/\.jsonc?$/i.test(entry.name)
        )
          return false;
        expanded += entry.originalSize;
        if (entry.originalSize > maxJsonBytes || expanded > 8 * maxJsonBytes)
          oversized = true;
        return !oversized;
      },
    });
    if (oversized)
      return {
        ok: false,
        error:
          "The extension exceeds the theme import limits. Choose a smaller extension. Existing themes are unchanged.",
      };
    return { ok: true, value: new Map(Object.entries(files)) };
  } catch {
    return {
      ok: false,
      error:
        "The extension archive could not be read. Try another extension. Existing themes are unchanged.",
    };
  }
}

function resolveColors(
  files: Map<string, Uint8Array>,
  path: string,
  chain: string[] = [],
): ThemeResult<NonNullable<z.infer<typeof themeFileSchema>["colors"]>> {
  if (chain.includes(path) || chain.length >= 8)
    return {
      ok: false,
      error:
        "The theme has circular or excessively nested includes. Choose another extension.",
    };
  const source = files.get(path);
  if (!source)
    return {
      ok: false,
      error: `The extension is missing ${path}. Choose another extension.`,
    };
  const theme = json(source, themeFileSchema);
  if (!theme.ok) return theme;
  if (!theme.value.include)
    return { ok: true, value: theme.value.colors ?? {} };
  const parent = resolvePath(theme.value.include, path);
  if (!parent.ok) return parent;
  const inherited = resolveColors(files, parent.value, [...chain, path]);
  if (!inherited.ok) return inherited;
  return { ok: true, value: { ...inherited.value, ...theme.value.colors } };
}

function read(bytes: Uint8Array): ThemeResult<VsCodeTheme[]> {
  const extracted = extract(bytes);
  if (!extracted.ok) return extracted;
  const files = extracted.value;
  const manifestBytes = files.get("extension/package.json");
  if (!manifestBytes)
    return {
      ok: false,
      error:
        "The extension is missing its manifest. Choose another theme extension.",
    };
  const manifest = json(manifestBytes, manifestSchema);
  if (!manifest.ok) return manifest;
  const themes: VsCodeTheme[] = [];
  for (const contribution of manifest.value.contributes.themes) {
    const path = resolvePath(contribution.path);
    if (!path.ok) return path;
    const colors = resolveColors(files, path.value);
    if (!colors.ok) return colors;
    const result = VsCodeTheme.fromObject(
      {
        name: contribution.label,
        type:
          contribution.uiTheme === "vs"
            ? "light"
            : contribution.uiTheme === "vs-dark"
              ? "dark"
              : contribution.uiTheme,
        colors: colors.value,
      },
      path.value.split("/").at(-1),
    );
    if (!result.ok) return result;
    themes.push(result.value);
  }
  return { ok: true, value: themes };
}

export const ThemeExtension = { read } as const;
