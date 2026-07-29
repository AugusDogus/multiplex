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
#include <time.h>
#include <unistd.h>

#define PLEX_HLS_SEGMENT_ATTEMPTS 4u

typedef struct {
  HttpBodyWrite write;
  void *context;
  size_t skip;
  size_t forwarded;
  bool write_failed;
} ResumingSegmentWrite;

static bool write_resumed_segment(void *context, const uint8_t *bytes,
                                  size_t size) {
  ResumingSegmentWrite *resume = context;
  if (resume->skip != 0) {
    const size_t skipped = resume->skip < size ? resume->skip : size;
    resume->skip -= skipped;
    bytes += skipped;
    size -= skipped;
  }
  if (size == 0) {
    return true;
  }
  if (!resume->write(resume->context, bytes, size)) {
    resume->write_failed = true;
    return false;
  }
  resume->forwarded += size;
  return true;
}

#define PLEX_HLS_MASTER_CAPACITY 2048u
#define PLEX_HLS_DECISION_CAPACITY (16u * 1024u)
#define PLEX_HLS_MEDIA_PLAYLIST_CAPACITY (16u * 1024u)
#define PLEX_HLS_START_ATTEMPTS 4u
#define PLEX_HLS_START_RETRY_US 1000000u
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
  const uint64_t wall_clock = (uint64_t)time(NULL);
  const uint64_t identity = fnv1a64(credentials->plex_client_id);
  const uint32_t first =
      (uint32_t)(clock ^ (identity >> 32u) ^ wall_clock);
  const uint16_t second = (uint16_t)((clock >> 32u) ^ (wall_clock >> 32u));
  const uint16_t third =
      (uint16_t)(((identity >> 48u) & 0x0fffu) | 0x4000u);
  const uint16_t fourth =
      (uint16_t)(((identity >> 16u) & 0x3fffu) | 0x8000u);
  const uint64_t fifth =
      (clock ^ identity ^ wall_clock * UINT64_C(0x9e3779b97f4a7c15)) &
      UINT64_C(0xffffffffffff);
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
      .value = credentials->plex_client_id,
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

static bool configure_hls_session(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    uint32_t offset_ms, const char *requested_session_id,
    MultiplexPlexHlsSession *session) {
  memset(session, 0, sizeof(*session));
  if (requested_session_id != NULL && requested_session_id[0] != '\0') {
    const size_t session_id_size = strlen(requested_session_id);
    if (session_id_size + 1u > sizeof(session->session_id)) {
      return false;
    }
    memcpy(session->session_id, requested_session_id, session_id_size + 1u);
  } else if (!make_session_id(credentials, session->session_id,
                              sizeof(session->session_id))) {
    return false;
  }
  session->start_offset_ms = offset_ms;
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
      "maxVideoBitrate=350&subtitles=none&location=lan&hasMDE=1&"
      "session=%s%s",
      rating_key, session->session_id, offset_query);
  return path_size > 0 && (size_t)path_size < sizeof(path) &&
         server_url(credentials, path, session->master_url,
                    sizeof(session->master_url));
}

static bool request_transcode_decision(
    const MultiplexAuthCredentials *credentials,
    const MultiplexPlexHlsSession *session) {
  static const char marker[] = "start.m3u8?";
  const char *start = strstr(session->master_url, marker);
  if (start == NULL) {
    return false;
  }
  char decision_url[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  const size_t prefix_size = (size_t)(start - session->master_url);
  const int url_size =
      snprintf(decision_url, sizeof(decision_url), "%.*sdecision?%s",
               (int)prefix_size, session->master_url,
               start + sizeof(marker) - 1u);
  if (url_size <= 0 || (size_t)url_size >= sizeof(decision_url)) {
    return false;
  }

  char decision[PLEX_HLS_DECISION_CAPACITY];
  HttpRequestHeader headers[9];
  const size_t header_count =
      control_headers(credentials, session, true, headers);
  HttpJsonResponse response;
  memset(&response, 0, sizeof(response));
  const bool decided =
      http_client_request_with_headers(
          "GET", decision_url, headers, header_count, NULL, decision,
          sizeof(decision), &response) &&
      response.status == 200;
  SYS_Report("REFERENCE GX: Plex HLS decision status=%u bytes=%u\n",
             response.status, (unsigned)response.body_size);
  return decided;
}

bool multiplex_plex_hls_start(const MultiplexAuthCredentials *credentials,
                              uint32_t rating_key, uint32_t offset_ms,
                              const char *session_id,
                              MultiplexPlexHlsSession *session) {
  if (credentials == NULL || session == NULL || rating_key == 0 ||
      credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0') {
    return false;
  }
  if (!configure_hls_session(credentials, rating_key, offset_ms, session_id,
                             session)) {
    return false;
  }
  char established_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  memcpy(established_session_id, session->session_id,
         sizeof(established_session_id));

  char master[PLEX_HLS_MASTER_CAPACITY];
  HttpJsonResponse response;
  bool requested = false;
  const unsigned start_modes = offset_ms == 0 ? 1u : 2u;
  for (unsigned mode = 0; mode < start_modes && !requested; ++mode) {
    if (mode != 0) {
      SYS_Report(
          "REFERENCE GX: Plex HLS resume rejected; retrying from beginning\n");
      if (!configure_hls_session(credentials, rating_key, 0,
                                 established_session_id, session)) {
        return false;
      }
    }
    if (!request_transcode_decision(credentials, session)) {
      return false;
    }
    HttpRequestHeader headers[9];
    const size_t header_count =
        control_headers(credentials, session, true, headers);
    for (unsigned attempt = 1; attempt <= PLEX_HLS_START_ATTEMPTS;
         ++attempt) {
      memset(master, 0, sizeof(master));
      memset(&response, 0, sizeof(response));
      requested = http_client_request_with_headers(
                      "GET", session->master_url, headers, header_count, NULL,
                      master, sizeof(master), &response) &&
                  response.status == 200;
      if (requested) {
        break;
      }
      SYS_Report(
          "REFERENCE GX: Plex HLS start retry attempt=%u/%u status=%u\n",
          attempt, PLEX_HLS_START_ATTEMPTS, response.status);
      if (attempt < PLEX_HLS_START_ATTEMPTS) {
        usleep(PLEX_HLS_START_RETRY_US);
      }
    }
    if (requested) {
      break;
    }
  }
  if (!requested ||
      !hls_playlist_parse_master(master, response.body_size,
                                 &session->variant) ||
      !hls_playlist_resolve_url(session->master_url, session->variant.uri,
                                session->variant_url,
                                sizeof(session->variant_url))) {
    SYS_Report(
        "REFERENCE GX: Plex HLS start failed rating-key=%u status=%u body=%.*s\n",
        rating_key, response.status, (int)response.body_size, master);
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
  memset(&response, 0, sizeof(response));
  const bool requested = http_client_request_with_headers(
      "GET", session->variant_url, headers, header_count, NULL, response_body,
      PLEX_HLS_MEDIA_PLAYLIST_CAPACITY, &response);
  const bool parsed =
      requested && response.status == 200 &&
      hls_playlist_parse_media_window(
          response_body, response.body_size, session->next_sequence,
          session->next_sequence == 0 ? session->start_offset_ms : 0,
          playlist);
  if (!parsed) {
    SYS_Report(
        "REFERENCE GX: Plex HLS playlist failed request=%u status=%u "
        "bytes=%u\n",
        requested ? 1u : 0u, response.status, (unsigned)response.body_size);
  } else {
    SYS_Report(
        "REFERENCE GX: Plex HLS playlist segments=%u first=%u next=%u "
        "offset=%u\n",
        (unsigned)playlist->segment_count, playlist->segments[0].sequence,
        session->next_sequence, session->start_offset_ms);
  }
  free(response_body);
  if (parsed && session->next_sequence < playlist->media_sequence) {
    session->next_sequence = playlist->media_sequence;
  }
  return parsed;
}

bool multiplex_plex_hls_stream_segment(
    const MultiplexAuthCredentials *credentials,
    const MultiplexPlexHlsSession *session, const HlsSegment *segment,
    HttpBodyWrite write, void *write_context, size_t *body_size) {
  if (credentials == NULL || session == NULL || segment == NULL ||
      write == NULL || body_size == NULL || !session->started) {
    return false;
  }
  char url[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  if (!hls_playlist_resolve_url(session->variant_url, segment->uri, url,
                                sizeof(url))) {
    return false;
  }
  HttpRequestHeader headers[8];
  const size_t header_count =
      control_headers(credentials, session, false, headers);
  size_t delivered = 0;
  HttpJsonResponse response = {0};
  for (unsigned attempt = 1; attempt <= PLEX_HLS_SEGMENT_ATTEMPTS; ++attempt) {
    const size_t resumed_at = delivered;
    ResumingSegmentWrite resume = {
        .write = write,
        .context = write_context,
        .skip = resumed_at,
    };
    response = (HttpJsonResponse){0};
    const bool streamed = http_client_stream_get_with_headers(
        url, headers, header_count, write_resumed_segment, &resume, &response);
    delivered += resume.forwarded;
    if (streamed && response.status == 200 && response.body_size != 0 &&
        resume.skip == 0 && delivered == response.body_size) {
      *body_size = delivered;
      SYS_Report(
          "REFERENCE GX: Plex HLS segment sequence=%u duration=%u bytes=%u "
          "attempts=%u\n",
          segment->sequence, segment->duration_ms, (unsigned)*body_size,
          attempt);
      return true;
    }
    if (resume.write_failed ||
        (response.status != 0 && response.status != 200)) {
      break;
    }
    if (attempt != PLEX_HLS_SEGMENT_ATTEMPTS) {
      SYS_Report(
          "REFERENCE GX: Plex HLS segment retry sequence=%u offset=%u "
          "attempt=%u/%u\n",
          segment->sequence, (unsigned)delivered, attempt + 1u,
          PLEX_HLS_SEGMENT_ATTEMPTS);
      usleep(100000);
    }
  }
  SYS_Report(
      "REFERENCE GX: Plex HLS segment failed sequence=%u status=%u "
      "bytes=%u\n",
      segment->sequence, response.status, (unsigned)delivered);
  return false;
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
