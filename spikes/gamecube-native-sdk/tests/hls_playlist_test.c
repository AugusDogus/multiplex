#include "hls_playlist.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_parses_plex_master(void) {
  static const char playlist[] =
      "#EXTM3U\r\n"
      "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1840000,"
      "RESOLUTION=718x306,FRAME-RATE=23.976000\r\n"
      "session/87a399da-ad41-40bc-8008-f6c1415a3e63/base/index.m3u8\r\n";
  HlsVariant variant;
  assert(hls_playlist_parse_master(playlist, strlen(playlist), &variant));
  assert(variant.bandwidth == 1840000);
  assert(variant.width == 718);
  assert(variant.height == 306);
  assert(variant.frame_rate_millihertz == 23976);
  assert(strcmp(variant.uri,
                "session/87a399da-ad41-40bc-8008-f6c1415a3e63/base/"
                "index.m3u8") == 0);
}

static void test_parses_growing_media_playlist(void) {
  static const char playlist[] =
      "#EXTM3U\n"
      "#EXT-X-VERSION:3\n"
      "#EXT-X-TARGETDURATION:5\n"
      "#EXT-X-MEDIA-SEQUENCE:12\n"
      "#EXTINF:4.004,\n"
      "00012.ts\n"
      "#EXTINF:4.171,\n"
      "00013.ts\n";
  HlsMediaPlaylist media;
  assert(hls_playlist_parse_media(playlist, strlen(playlist), &media));
  assert(media.target_duration_seconds == 5);
  assert(media.media_sequence == 12);
  assert(media.segment_count == 2);
  assert(!media.end_list);
  assert(media.segments[0].sequence == 12);
  assert(media.segments[0].duration_ms == 4004);
  assert(strcmp(media.segments[0].uri, "00012.ts") == 0);
  assert(media.segments[1].sequence == 13);
  assert(media.segments[1].duration_ms == 4171);
}

static void test_windows_long_vod_playlist_at_resume_offset(void) {
  char playlist[8192];
  size_t size = (size_t)snprintf(
      playlist, sizeof(playlist),
      "#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:0\n");
  for (unsigned index = 0; index < 100; ++index) {
    const int written =
        snprintf(playlist + size, sizeof(playlist) - size,
                 "#EXTINF:8, nodesc\n%05u.ts\n", index);
    assert(written > 0);
    size += (size_t)written;
    assert(size < sizeof(playlist));
  }
  const int end_written =
      snprintf(playlist + size, sizeof(playlist) - size, "#EXT-X-ENDLIST\n");
  assert(end_written > 0);
  size += (size_t)end_written;

  HlsMediaPlaylist media;
  assert(hls_playlist_parse_media_window(playlist, size, 0, 537000, &media));
  assert(media.segment_count == HLS_MAX_SEGMENTS);
  assert(media.segments[0].sequence == 67);
  assert(strcmp(media.segments[0].uri, "00067.ts") == 0);
  assert(media.segments[HLS_MAX_SEGMENTS - 1].sequence == 98);
  assert(media.end_list);

  assert(hls_playlist_parse_media_window(playlist, size, 99, 0, &media));
  assert(media.segment_count == 1);
  assert(media.segments[0].sequence == 99);
}

static void test_resolves_plex_urls(void) {
  static const char master[] =
      "http://192.168.86.245:32400/video/:/transcode/universal/"
      "start.m3u8?path=%2Flibrary%2Fmetadata%2F416286";
  char url[1024];
  assert(hls_playlist_resolve_url(
      master,
      "session/87a399da-ad41-40bc-8008-f6c1415a3e63/base/index.m3u8",
      url, sizeof(url)));
  assert(strcmp(
             url,
             "http://192.168.86.245:32400/video/:/transcode/universal/"
             "session/87a399da-ad41-40bc-8008-f6c1415a3e63/base/"
             "index.m3u8") == 0);

  char segment[1024];
  assert(hls_playlist_resolve_url(url, "00000.ts", segment,
                                  sizeof(segment)));
  assert(strcmp(
             segment,
             "http://192.168.86.245:32400/video/:/transcode/universal/"
             "session/87a399da-ad41-40bc-8008-f6c1415a3e63/base/"
             "00000.ts") == 0);
  assert(hls_playlist_resolve_url(url, "/identity", segment,
                                  sizeof(segment)));
  assert(strcmp(segment, "http://192.168.86.245:32400/identity") == 0);
  assert(!hls_playlist_resolve_url(url, "../secret", segment,
                                   sizeof(segment)));
}

int main(void) {
  test_parses_plex_master();
  test_parses_growing_media_playlist();
  test_windows_long_vod_playlist_at_resume_offset();
  test_resolves_plex_urls();
  puts("GameCube HLS playlist tests passed.");
  return 0;
}
