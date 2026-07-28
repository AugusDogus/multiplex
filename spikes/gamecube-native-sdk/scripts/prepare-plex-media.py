#!/usr/bin/env python3

"""Fetch one real Plex library item and encode a bounded GameCube test clip."""

import argparse
import json
import os
import pathlib
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def plex_url(base_url: str, path: str, token: str) -> str:
    url = urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    if token:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}X-Plex-Token={urllib.parse.quote(token)}"
    return url


def fetch_xml(base_url: str, path: str, token: str) -> ET.Element:
    request = urllib.request.Request(
        plex_url(base_url, path, token),
        headers={"Accept": "application/xml", "X-Plex-Product": "Multiplex GameCube"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return ET.fromstring(response.read())


def select_video(root: ET.Element, rating_key: str | None) -> ET.Element:
    if rating_key:
        for video in root.iter("Video"):
            if video.get("ratingKey") == rating_key:
                return video
        raise RuntimeError(f"Plex metadata {rating_key} did not contain a playable video")

    for video in root.iter("Video"):
        if video.find("./Media/Part") is not None:
            return video
    raise RuntimeError("Plex recently-added response did not contain a playable video")


def packet_metadata(media_path: pathlib.Path) -> dict[str, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_packets",
            "-show_format",
            "-show_entries",
            "packet=codec_type,pts,size",
            "-of",
            "json",
            str(media_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    result_data = json.loads(result.stdout)
    packets = result_data["packets"]
    output: dict[str, int] = {}
    for codec_type in ("video", "audio"):
        selected = [packet for packet in packets if packet.get("codec_type") == codec_type]
        pts = next((int(packet["pts"]) for packet in selected if "pts" in packet), None)
        if not selected or pts is None:
            raise RuntimeError(f"Encoded clip has no timestamped {codec_type} packets")
        output[f"{codec_type}_bytes"] = sum(int(packet["size"]) for packet in selected)
        output[f"{codec_type}_packets"] = len(selected)
        output[f"{codec_type}_pts90k"] = pts
    output["container_bytes"] = media_path.stat().st_size
    output["segment_duration_ms"] = round(float(result_data["format"]["duration"]) * 1000)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--offset", type=float, default=60.0)
    parser.add_argument("--duration", type=float, default=120.0)
    parser.add_argument("--rating-key")
    arguments = parser.parse_args()

    token = os.environ.get("PLEX_TOKEN", "")
    if arguments.rating_key:
        root = fetch_xml(
            arguments.base_url,
            f"/library/metadata/{urllib.parse.quote(arguments.rating_key)}",
            token,
        )
    else:
        root = fetch_xml(
            arguments.base_url,
            "/library/recentlyAdded?X-Plex-Container-Size=50",
            token,
        )
    video = select_video(root, arguments.rating_key)
    part = video.find("./Media/Part")
    if part is None or not part.get("key"):
        raise RuntimeError("Selected Plex item has no media part")

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    source_url = plex_url(arguments.base_url, part.get("key", ""), token)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "fatal"]
    if token:
        command.extend(["-headers", f"X-Plex-Token: {token}\r\n"])
    command.extend(
        [
            "-ss",
            str(arguments.offset),
            "-i",
            source_url,
            "-t",
            str(arguments.duration),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-vf",
            "scale=720:480:force_original_aspect_ratio=decrease,"
            "pad=720:480:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30000/1001",
            "-c:v",
            "mpeg2video",
            "-pix_fmt",
            "yuv420p",
            "-b:v",
            "900k",
            "-maxrate",
            "1200k",
            "-bufsize",
            "1835008",
            "-g",
            "15",
            "-bf",
            "2",
            "-c:a",
            "mp2",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-muxpreload",
            "0.5",
            "-muxdelay",
            "0.7",
            "-f",
            "mpeg",
            str(arguments.output),
            "-y",
        ]
    )
    subprocess.run(command, check=True)

    metadata: dict[str, str | int] = packet_metadata(arguments.output)
    metadata["title"] = video.get("title", "Untitled Plex item")
    metadata["rating_key"] = video.get("ratingKey", "")
    metadata["media_duration_ms"] = int(video.get("duration", "0") or 0)
    metadata["segment_start_ms"] = round(arguments.offset * 1000)
    print(json.dumps(metadata))


if __name__ == "__main__":
    main()
