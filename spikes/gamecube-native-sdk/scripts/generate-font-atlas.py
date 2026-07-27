#!/usr/bin/env python3
"""Rasterize Native SDK's bundled Geist face into a GX I8 glyph atlas."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SIZES = (13, 14, 20, 24)
FIRST_CHARACTER = 32
CHARACTER_COUNT = 95
CELL_SIZE = 32
COLUMNS = 16
ROWS = 6
ATLAS_WIDTH = COLUMNS * CELL_SIZE
SECTION_HEIGHT = ROWS * CELL_SIZE
ATLAS_HEIGHT = SECTION_HEIGHT * len(SIZES)
PADDING = 2


def gx_i8_tiles(image: Image.Image) -> bytes:
    pixels = image.load()
    output = bytearray()
    for tile_y in range(0, ATLAS_HEIGHT, 4):
        for tile_x in range(0, ATLAS_WIDTH, 8):
            for y in range(4):
                for x in range(8):
                    output.append(pixels[tile_x + x, tile_y + y])
    return bytes(output)


def render(font_path: Path) -> tuple[bytes, list[list[tuple[int, ...]]]]:
    atlas = Image.new("L", (ATLAS_WIDTH, ATLAS_HEIGHT), 0)
    metrics: list[list[tuple[int, ...]]] = []

    for size_index, size in enumerate(SIZES):
        font = ImageFont.truetype(str(font_path), size=size)
        size_metrics: list[tuple[int, ...]] = []
        for character_index in range(CHARACTER_COUNT):
            character = chr(FIRST_CHARACTER + character_index)
            bbox = font.getbbox(character, anchor="ls")
            x0, y0, x1, y1 = bbox
            width = max(0, x1 - x0)
            height = max(0, y1 - y0)
            cell_x = (character_index % COLUMNS) * CELL_SIZE
            cell_y = (
                size_index * SECTION_HEIGHT
                + (character_index // COLUMNS) * CELL_SIZE
            )

            if width and height:
                if width + PADDING * 2 > CELL_SIZE or height + PADDING * 2 > CELL_SIZE:
                    raise RuntimeError(
                        f"{character!r} at {size}px does not fit the {CELL_SIZE}px cell"
                    )
                glyph = Image.new("L", (width, height), 0)
                draw = ImageDraw.Draw(glyph)
                draw.text((-x0, -y0), character, font=font, fill=255, anchor="ls")
                atlas.paste(glyph, (cell_x + PADDING, cell_y + PADDING))

            advance_64 = round(font.getlength(character) * 64)
            size_metrics.append(
                (
                    cell_x + PADDING,
                    cell_y + PADDING,
                    width,
                    height,
                    x0,
                    y0,
                    advance_64,
                )
            )
        metrics.append(size_metrics)

    return gx_i8_tiles(atlas), metrics


def write_header(
    output_path: Path, atlas_bytes: bytes, metrics: list[list[tuple[int, ...]]]
) -> None:
    lines = [
        "#ifndef MULTIPLEX_GEIST_ATLAS_H",
        "#define MULTIPLEX_GEIST_ATLAS_H",
        "",
        "#include <gccore.h>",
        "",
        f"#define GEIST_ATLAS_WIDTH {ATLAS_WIDTH}",
        f"#define GEIST_ATLAS_HEIGHT {ATLAS_HEIGHT}",
        f"#define GEIST_FIRST_CHARACTER {FIRST_CHARACTER}",
        f"#define GEIST_CHARACTER_COUNT {CHARACTER_COUNT}",
        f"#define GEIST_SIZE_COUNT {len(SIZES)}",
        "",
        "typedef struct {",
        "  u16 u;",
        "  u16 v;",
        "  u16 width;",
        "  u16 height;",
        "  s16 bearing_x;",
        "  s16 bearing_y;",
        "  u16 advance_64;",
        "} GeistGlyphMetric;",
        "",
        "static const u16 geist_sizes[GEIST_SIZE_COUNT] = {"
        + ", ".join(str(size) for size in SIZES)
        + "};",
        "",
        "static const GeistGlyphMetric",
        "    geist_metrics[GEIST_SIZE_COUNT][GEIST_CHARACTER_COUNT] = {",
    ]

    for size_metrics in metrics:
        lines.append("  {")
        for metric in size_metrics:
            lines.append(
                "    {"
                + ", ".join(str(value) for value in metric)
                + "},"
            )
        lines.append("  },")
    lines.extend(
        [
            "};",
            "",
            f"static u8 geist_atlas[{len(atlas_bytes)}] __attribute__((aligned(32))) = {{",
        ]
    )
    for offset in range(0, len(atlas_bytes), 24):
        chunk = atlas_bytes[offset : offset + 24]
        lines.append("  " + ", ".join(f"0x{value:02x}" for value in chunk) + ",")
    lines.extend(["};", "", "#endif", ""])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate-font-atlas.py FONT_TTF OUTPUT_HEADER", file=sys.stderr)
        return 2
    font_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    atlas_bytes, metrics = render(font_path)
    write_header(output_path, atlas_bytes, metrics)
    print(
        f"Generated {ATLAS_WIDTH}x{ATLAS_HEIGHT} Geist GX atlas at {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
