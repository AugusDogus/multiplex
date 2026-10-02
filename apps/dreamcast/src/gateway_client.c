#include "gateway_client.h"

#include "http_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  CATALOG_CAPACITY = 16384,
  PLAYBACK_CAPACITY = 1024,
  MAX_MEDIA_BYTES = 4 * 1024 * 1024,
  MEDIA_RANGE_BYTES = 4 * 1024,
  URL_CAPACITY = DREAMCAST_GATEWAY_MEDIA_URL_CAPACITY,
};

typedef struct {
  FILE *file;
  size_t written;
} FileWriter;

static void set_error(char *error, size_t capacity, const char *message) {
  if (error != NULL && capacity > 0) {
    snprintf(error, capacity, "%s", message);
  }
}

static bool build_url(char *destination, size_t capacity, const char *base_url,
                      const char *path) {
  if (base_url == NULL || base_url[0] == '\0' || path == NULL) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  const int written = snprintf(destination, capacity, "%s%s%s", base_url,
                               base_url[base_size - 1u] == '/' ? "" : "/",
                               path[0] == '/' ? path + 1 : path);
  return written > 0 && (size_t)written < capacity;
}

bool dreamcast_gateway_load_catalog(const char *base_url,
                                    DreamcastGatewayCatalog *catalog,
                                    char *error, size_t error_capacity) {
  char url[URL_CAPACITY];
  if (catalog == NULL ||
      !build_url(url, sizeof(url), base_url, "/v3/catalog.bin")) {
    set_error(error, error_capacity, "Set DREAMCAST_GATEWAY_URL and rebuild");
    return false;
  }
  uint8_t *bytes = malloc(CATALOG_CAPACITY);
  if (bytes == NULL) {
    set_error(error, error_capacity, "Not enough memory for the catalog");
    return false;
  }
  size_t size = 0;
  DreamcastHttpResponse response;
  const bool loaded =
      dreamcast_http_get_buffer(url, bytes, CATALOG_CAPACITY, &size, &response);
  const bool parsed = loaded && response.status == 200 &&
                      dreamcast_gateway_parse_catalog(bytes, size, catalog);
  free(bytes);
  if (!parsed) {
    set_error(error, error_capacity,
              loaded ? "Gateway returned an invalid catalog"
                     : "Could not reach the Multiplex gateway");
  }
  return parsed;
}

bool dreamcast_gateway_load_playback(const char *base_url, uint32_t rating_key,
                                     uint32_t offset_ms,
                                     DreamcastGatewayPlayback *playback,
                                     char *error, size_t error_capacity) {
  char path[96];
  const int path_size = snprintf(
      path, sizeof(path), "/v4/playback.bin?ratingKey=%lu&offsetMs=%lu",
      (unsigned long)rating_key, (unsigned long)offset_ms);
  char url[URL_CAPACITY];
  if (playback == NULL || path_size <= 0 || (size_t)path_size >= sizeof(path) ||
      !build_url(url, sizeof(url), base_url, path)) {
    set_error(error, error_capacity, "Playback request URL is invalid");
    return false;
  }
  uint8_t bytes[PLAYBACK_CAPACITY];
  size_t size = 0;
  DreamcastHttpResponse response;
  const bool loaded =
      dreamcast_http_get_buffer(url, bytes, sizeof(bytes), &size, &response);
  const bool parsed =
      loaded && response.status == 200 &&
      dreamcast_gateway_parse_playback(bytes, size, base_url, playback) &&
      playback->rating_key == rating_key &&
      playback->segment_start_ms == offset_ms;
  if (!parsed) {
    set_error(error, error_capacity,
              loaded ? "Gateway could not prepare this item"
                     : "Playback manifest request failed");
  }
  return parsed;
}

static bool write_file(void *context, const uint8_t *bytes, size_t size) {
  FileWriter *writer = context;
  if (fwrite(bytes, 1, size, writer->file) != size) {
    return false;
  }
  writer->written += size;
  return true;
}

bool dreamcast_gateway_download_media(const DreamcastGatewayPlayback *playback,
                                      const char *path, char *error,
                                      size_t error_capacity) {
  if (playback == NULL || path == NULL || playback->container_bytes == 0 ||
      playback->container_bytes > MAX_MEDIA_BYTES) {
    set_error(error, error_capacity, "Playback segment exceeds Dreamcast RAM");
    return false;
  }
  FILE *file = fopen(path, "wb");
  if (file == NULL) {
    set_error(error, error_capacity, "Could not open the RAM playback file");
    return false;
  }
  FileWriter writer = {.file = file, .written = 0};
  const bool loaded = dreamcast_http_get_ranges(
      playback->media_url, playback->container_bytes, MEDIA_RANGE_BYTES,
      write_file, &writer);
  const bool closed = fclose(file) == 0;
  const bool valid =
      loaded && closed && writer.written == playback->container_bytes;
  if (!valid) {
    (void)remove(path);
    set_error(error, error_capacity, "MPEG-1 segment download failed");
  }
  return valid;
}

static bool discard_body(void *context, const uint8_t *bytes, size_t size) {
  (void)context;
  (void)bytes;
  (void)size;
  return true;
}

bool dreamcast_gateway_report_timeline(const char *base_url,
                                       uint32_t rating_key,
                                       uint32_t position_ms,
                                       uint32_t duration_ms,
                                       const char *state) {
  char path[192];
  const int path_size = snprintf(
      path, sizeof(path),
      "/v4/timeline?ratingKey=%lu&positionMs=%lu&durationMs=%lu&state=%s",
      (unsigned long)rating_key, (unsigned long)position_ms,
      (unsigned long)duration_ms, state == NULL ? "stopped" : state);
  char url[URL_CAPACITY];
  if (path_size <= 0 || (size_t)path_size >= sizeof(path) ||
      !build_url(url, sizeof(url), base_url, path)) {
    return false;
  }
  DreamcastHttpResponse response;
  return dreamcast_http_get(url, discard_body, NULL, &response) &&
         response.status == 200;
}
