/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Plex universal-transcoder HLS control plane. Segment transport remains a
 * separate boundary so playlists can be refreshed without retaining video.
 */

#include "plex_hls.h"

#include "http_client.h"

#include <gccore.h>
#include <ogc/lwp_watchdog.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PLEX_HLS_MASTER_CAPACITY 2048u
#define PLEX_HLS_MEDIA_PLAYLIST_CAPACITY (16u * 1024u)
#define PLEX_HLS_PROFILE \
  "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&" \
  "container=mpegts&videoCodec=h264&audioCodec=aac&replace=true)"

static uint64_t fnv1a64(const char *value) {
  uint64_t hash = UINT64_C(14695981039346656037);
  while (*value != '\0') {
    hash ^= (uint8_t)*value++;
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static bool make_session_id(const MultiplexAuthCredentials *credentials,
                            char *destination, size_t capacity) {
  const uint64_t clock = gettime();
  const uint64_t identity = fnv1a64(credentials->plex_client_id);
  const uint32_t first = (uint32_t)(clock ^ (identity >> 32u));
  const uint16_t second = (uint16_t)(clock >> 32u);
  const uint16_t third =
      (uint16_t)(((identity >> 48u) & 0x0fffu) | 0x4000u);
  const uint16_t fourth =
      (uint16_t)(((identity >> 16u) & 0x3fffu) | 0x8000u);
  const uint64_t fifth = (clock ^ identity) & UINT64_C(0xffffffffffff);
  const int size = snprintf(destination, capacity,
                            "%08x-%04x-%04x-%04x-%04x%08x", first, second,
                            third, fourth, (unsigned)(fifth >> 32u),
                            (unsigned)fifth);
  return size == 36 && (size_t)size < capacity;
}

static bool server_url(const MultiplexAuthCredentials *credentials,
                       const char *path, char *destination, size_t capacity) {
  const size_t base_size = strlen(credentials->plex_server_url);
  const int size = snprintf(
      destination, capacity, "%s%s%s", credentials->plex_server_url,
      base_size != 0 && credentials->plex_server_url[base_size - 1u] == '/'
          ? ""
          : "/",
      path);
  return size > 0 && (size_t)size < capacity;
}

static size_t control_headers(const MultiplexAuthCredentials *credentials,
                              const MultiplexPlexHlsSession *session,
                              bool include_profile,
                              HttpRequestHeader *headers) {
  size_t count = 0;
  headers[count++] = (HttpRequestHeader){
      .name = "X-Plex-Token",
      .value = credentials->plex_server_token,
  };
  /*
   * PMS selects its built-in base capability profile before applying the
   * extra target. Chrome/Linux is the broad, version-stable HLS base profile;
   * product and device name still identify this client as Multiplex.
   */
  headers[count++] =
      (HttpRequestHeader){.name = "X-Plex-Platform", .value = "Chrome"};
  headers[count++] =
      (HttpRequestHeader){.name = "X-Plex-Product", .value = "Multiplex"};
  headers[count++] =
      (HttpRequestHeader){.name = "X-Plex-Version", .value = "0.1.0"};
  headers[count++] = (HttpRequestHeader){
      .name = "X-Plex-Client-Identifier",
      .value = session->session_id,
  };
  headers[count++] = (HttpRequestHeader){
      .name = "X-Plex-Session-Identifier",
      .value = session->session_id,
  };
  headers[count++] =
      (HttpRequestHeader){.name = "X-Plex-Device", .value = "Linux"};
  headers[count++] = (HttpRequestHeader){
      .name = "X-Plex-Device-Name",
      .value = "Multiplex GameCube",
  };
  if (include_profile) {
    headers[count++] = (HttpRequestHeader){
        .name = "X-Plex-Client-Profile-Extra",
        .value = PLEX_HLS_PROFILE,
    };
  }
  return count;
}

bool multiplex_plex_hls_start(const MultiplexAuthCredentials *credentials,
                              uint32_t rating_key, uint32_t offset_ms,
                              MultiplexPlexHlsSession *session) {
  if (credentials == NULL || session == NULL || rating_key == 0 ||
      credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0') {
    return false;
  }
  memset(session, 0, sizeof(*session));
  if (!make_session_id(credentials, session->session_id,
                       sizeof(session->session_id))) {
    return false;
  }

  char offset_query[32] = {0};
  if (offset_ms != 0) {
    const int offset_size = snprintf(offset_query, sizeof(offset_query),
                                     "&offset=%u", offset_ms / 1000u);
    if (offset_size <= 0 || (size_t)offset_size >= sizeof(offset_query)) {
      return false;
    }
  }
  char path[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  const int path_size = snprintf(
      path, sizeof(path),
      "video/:/transcode/universal/start.m3u8?"
      "path=%%2Flibrary%%2Fmetadata%%2F%u&mediaIndex=0&partIndex=0&"
      "protocol=hls&fastSeek=1&directPlay=0&directStream=0&"
      "directStreamAudio=0&videoQuality=100&videoResolution=720x480&"
      "maxVideoBitrate=2500&subtitles=none&location=lan&hasMDE=1&"
      "session=%s%s",
      rating_key, session->session_id, offset_query);
  if (path_size <= 0 || (size_t)path_size >= sizeof(path) ||
      !server_url(credentials, path, session->master_url,
                  sizeof(session->master_url))) {
    return false;
  }

  char master[PLEX_HLS_MASTER_CAPACITY];
  HttpRequestHeader headers[9];
  const size_t header_count =
      control_headers(credentials, session, true, headers);
  HttpJsonResponse response;
  if (!http_client_request_with_headers(
          "GET", session->master_url, headers, header_count, NULL, master,
          sizeof(master), &response) ||
      response.status != 200 ||
      !hls_playlist_parse_master(master, response.body_size,
                                 &session->variant) ||
      !hls_playlist_resolve_url(session->master_url, session->variant.uri,
                                session->variant_url,
                                sizeof(session->variant_url))) {
    SYS_Report("REFERENCE GX: Plex HLS start failed rating-key=%u\n",
               rating_key);
    return false;
  }
  session->started = true;
  SYS_Report(
      "REFERENCE GX: Plex HLS session=%s variant=%ux%u bandwidth=%u "
      "frame-rate=%u.%03u\n",
      session->session_id, session->variant.width, session->variant.height,
      session->variant.bandwidth,
      session->variant.frame_rate_millihertz / 1000u,
      session->variant.frame_rate_millihertz % 1000u);
  return true;
}

bool multiplex_plex_hls_refresh(
    const MultiplexAuthCredentials *credentials,
    MultiplexPlexHlsSession *session, HlsMediaPlaylist *playlist) {
  if (credentials == NULL || session == NULL || playlist == NULL ||
      !session->started) {
    return false;
  }
  char *response_body = malloc(PLEX_HLS_MEDIA_PLAYLIST_CAPACITY);
  if (response_body == NULL) {
    return false;
  }
  HttpRequestHeader headers[8];
  const size_t header_count =
      control_headers(credentials, session, false, headers);
  HttpJsonResponse response;
  const bool loaded =
      http_client_request_with_headers(
          "GET", session->variant_url, headers, header_count, NULL,
          response_body, PLEX_HLS_MEDIA_PLAYLIST_CAPACITY, &response) &&
      response.status == 200 &&
      hls_playlist_parse_media(response_body, response.body_size, playlist);
  free(response_body);
  if (loaded && session->next_sequence < playlist->media_sequence) {
    session->next_sequence = playlist->media_sequence;
  }
  return loaded;
}

void multiplex_plex_hls_stop(const MultiplexAuthCredentials *credentials,
                             MultiplexPlexHlsSession *session) {
  if (credentials == NULL || session == NULL || !session->started) {
    return;
  }
  char path[256];
  const int path_size = snprintf(
      path, sizeof(path),
      "video/:/transcode/universal/stop?session=%s", session->session_id);
  char url[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  if (path_size > 0 && (size_t)path_size < sizeof(path) &&
      server_url(credentials, path, url, sizeof(url))) {
    char response_body[128];
    HttpRequestHeader headers[8];
    const size_t header_count =
        control_headers(credentials, session, false, headers);
    HttpJsonResponse response;
    /*
     * The stop response may have an empty body. The request helper can report
     * false for that framing, but the complete GET has already reached PMS.
     */
    (void)http_client_request_with_headers(
        "GET", url, headers, header_count, NULL, response_body,
        sizeof(response_body), &response);
  }
  SYS_Report("REFERENCE GX: Plex HLS stopped session=%s\n",
             session->session_id);
  memset(session, 0, sizeof(*session));
}
