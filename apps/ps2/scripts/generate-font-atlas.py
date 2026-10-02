#!/usr/bin/env python3

import struct
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


def read_glyph_ids(font_path: Path) -> list[int]:
    data = font_path.read_bytes()
    table_count = struct.unpack_from(">H", data, 4)[0]
    cmap_offset = next(
        offset
        for index in range(table_count)
        for tag, _, offset, _ in [
            struct.unpack_from(">4sIII", data, 12 + index * 16)
        ]
        if tag == b"cmap"
    )
    cmap_count = struct.unpack_from(">H", data, cmap_offset + 2)[0]
    subtables: list[tuple[int, int]] = []
    for index in range(cmap_count):
        platform, encoding, relative = struct.unpack_from(
            ">HHI", data, cmap_offset + 4 + index * 8
        )
        offset = cmap_offset + relative
        format_number = struct.unpack_from(">H", data, offset)[0]
        if platform == 0 or (platform == 3 and encoding in (1, 10)):
            preference = 2 if format_number == 12 else 1 if format_number == 4 else 0
            if preference:
                subtables.append((preference, offset))
    if not subtables:
        raise RuntimeError("font does not contain a supported Unicode cmap")
    _, subtable = max(subtables)
    format_number = struct.unpack_from(">H", data, subtable)[0]

    def glyph_id(codepoint: int) -> int:
        if format_number == 12:
            group_count = struct.unpack_from(">I", data, subtable + 12)[0]
            for group_index in range(group_count):
                start, end, first = struct.unpack_from(
                    ">III", data, subtable + 16 + group_index * 12
                )
                if start <= codepoint <= end:
                    return first + codepoint - start
            return 0
        segment_count = struct.unpack_from(">H", data, subtable + 6)[0] // 2
        end_codes = subtable + 14
        start_codes = end_codes + segment_count * 2 + 2
        deltas = start_codes + segment_count * 2
        range_offsets = deltas + segment_count * 2
        for segment_index in range(segment_count):
            end = struct.unpack_from(">H", data, end_codes + segment_index * 2)[0]
            if codepoint > end:
                continue
            start = struct.unpack_from(">H", data, start_codes + segment_index * 2)[0]
            if codepoint < start:
                return 0
            delta = struct.unpack_from(">h", data, deltas + segment_index * 2)[0]
            range_location = range_offsets + segment_index * 2
            relative = struct.unpack_from(">H", data, range_location)[0]
            if relative == 0:
                return (codepoint + delta) & 0xFFFF
            mapped = struct.unpack_from(
                ">H", data, range_location + relative + (codepoint - start) * 2
            )[0]
            return ((mapped + delta) & 0xFFFF) if mapped else 0
        return 0

    return [glyph_id(codepoint) for codepoint in range(32, 127)]


def render(font_path: Path) -> tuple[bytes, list[list[tuple[int, ...]]]]:
    atlas = Image.new("L", (ATLAS_WIDTH, ATLAS_HEIGHT), 0)
    all_metrics: list[list[tuple[int, ...]]] = []
    for size_index, size in enumerate(SIZES):
        font = ImageFont.truetype(str(font_path), size=size)
        metrics: list[tuple[int, ...]] = []
        for character_index in range(CHARACTER_COUNT):
            character = chr(FIRST_CHARACTER + character_index)
            x0, y0, x1, y1 = font.getbbox(character, anchor="ls")
            width = max(0, x1 - x0)
            height = max(0, y1 - y0)
            cell_x = (character_index % COLUMNS) * CELL_SIZE
            cell_y = (
                size_index * SECTION_HEIGHT
                + (character_index // COLUMNS) * CELL_SIZE
            )
            if width and height:
                glyph = Image.new("L", (width, height), 0)
                ImageDraw.Draw(glyph).text(
                    (-x0, -y0), character, font=font, fill=255, anchor="ls"
                )
                atlas.paste(glyph, (cell_x + PADDING, cell_y + PADDING))
            metrics.append(
                (
                    cell_x + PADDING,
                    cell_y + PADDING,
                    width,
                    height,
                    x0,
                    y0,
                    round(font.getlength(character) * 64),
                )
            )
        all_metrics.append(metrics)
    return atlas.tobytes(), all_metrics


def write_header(
    output: Path,
    atlas: bytes,
    metrics: list[list[tuple[int, ...]]],
    glyph_ids: list[int],
) -> None:
    lines = [
        "#ifndef MULTIPLEX_PS2_GEIST_ATLAS_H",
        "#define MULTIPLEX_PS2_GEIST_ATLAS_H",
        "",
        "#include <stdint.h>",
        "",
        f"#define GEIST_ATLAS_WIDTH {ATLAS_WIDTH}",
        f"#define GEIST_ATLAS_HEIGHT {ATLAS_HEIGHT}",
        f"#define GEIST_FIRST_CHARACTER {FIRST_CHARACTER}",
        f"#define GEIST_CHARACTER_COUNT {CHARACTER_COUNT}",
        f"#define GEIST_SIZE_COUNT {len(SIZES)}",
        "",
        "typedef struct {",
        "  uint16_t u, v, width, height;",
        "  int16_t bearing_x, bearing_y;",
        "  uint16_t advance_64;",
        "} GeistGlyphMetric;",
        "",
        "static const uint16_t geist_sizes[GEIST_SIZE_COUNT] = {"
        + ", ".join(map(str, SIZES))
        + "};",
        "static const uint16_t geist_glyph_ids[GEIST_CHARACTER_COUNT] = {",
    ]
    for offset in range(0, len(glyph_ids), 16):
        lines.append("  " + ", ".join(map(str, glyph_ids[offset : offset + 16])) + ",")
    lines.extend(
        [
            "};",
            "static const GeistGlyphMetric",
            "    geist_metrics[GEIST_SIZE_COUNT][GEIST_CHARACTER_COUNT] = {",
        ]
    )
    for size_metrics in metrics:
        lines.append("  {")
        lines.extend("    {" + ", ".join(map(str, metric)) + "}," for metric in size_metrics)
        lines.append("  },")
    lines.extend(
        [
            "};",
            f"static uint8_t geist_atlas[{len(atlas)}] __attribute__((aligned(128))) = {{",
        ]
    )
    for offset in range(0, len(atlas), 32):
        lines.append("  " + ", ".join(f"0x{byte:02x}" for byte in atlas[offset : offset + 32]) + ",")
    lines.extend(["};", "", "#endif", ""])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate-font-atlas.py FONT_TTF OUTPUT_HEADER")
    font_path = Path(sys.argv[1])
    atlas, metrics = render(font_path)
    write_header(Path(sys.argv[2]), atlas, metrics, read_glyph_ids(font_path))


if __name__ == "__main__":
    main()
