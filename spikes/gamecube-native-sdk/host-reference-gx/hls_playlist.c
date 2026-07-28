/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Bounded parser for the small subset of HLS emitted by Plex's universal
 * transcoder. It performs no allocation and does not retain playlist input.
 */

#include "hls_playlist.h"

#include <ctype.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  const char *begin;
  const char *end;
} TextSpan;

static bool next_line(const char **cursor, const char *end, TextSpan *line) {
  if (*cursor >= end) {
    return false;
  }
  const char *begin = *cursor;
  const char *finish = begin;
  while (finish < end && *finish != '\n') {
    ++finish;
  }
  const char *line_end = finish;
  if (line_end > begin && line_end[-1] == '\r') {
    --line_end;
  }
  *cursor = finish < end ? finish + 1 : end;
  line->begin = begin;
  line->end = line_end;
  return true;
}

static bool span_equals(TextSpan span, const char *text) {
  const size_t size = (size_t)(span.end - span.begin);
  return strlen(text) == size && memcmp(span.begin, text, size) == 0;
}

static bool span_starts_with(TextSpan span, const char *prefix) {
  const size_t size = strlen(prefix);
  return (size_t)(span.end - span.begin) >= size &&
         memcmp(span.begin, prefix, size) == 0;
}

static bool copy_span(TextSpan span, char *destination, size_t capacity) {
  const size_t size = (size_t)(span.end - span.begin);
  if (size == 0 || size >= capacity) {
    return false;
  }
  memcpy(destination, span.begin, size);
  destination[size] = '\0';
  return true;
}

static bool parse_unsigned(TextSpan span, uint32_t *value) {
  if (span.begin == span.end) {
    return false;
  }
  uint32_t parsed = 0;
  for (const char *cursor = span.begin; cursor < span.end; ++cursor) {
    if (*cursor < '0' || *cursor > '9') {
      return false;
    }
    const uint32_t digit = (uint32_t)(*cursor - '0');
    if (parsed > (UINT32_MAX - digit) / 10u) {
      return false;
    }
    parsed = parsed * 10u + digit;
  }
  *value = parsed;
  return true;
}

static bool find_attribute(TextSpan attributes, const char *name,
                           TextSpan *value) {
  const size_t name_size = strlen(name);
  const char *cursor = attributes.begin;
  while (cursor < attributes.end) {
    while (cursor < attributes.end &&
           (*cursor == ',' || isspace((unsigned char)*cursor))) {
      ++cursor;
    }
    const char *key = cursor;
    while (cursor < attributes.end && *cursor != '=' && *cursor != ',') {
      ++cursor;
    }
    if (cursor >= attributes.end || *cursor != '=') {
      return false;
    }
    const char *key_end = cursor++;
    const bool quoted = cursor < attributes.end && *cursor == '"';
    if (quoted) {
      ++cursor;
    }
    const char *begin = cursor;
    while (cursor < attributes.end &&
           (quoted ? *cursor != '"' : *cursor != ',')) {
      ++cursor;
    }
    const char *end = cursor;
    if (quoted && cursor < attributes.end) {
      ++cursor;
    }
    if ((size_t)(key_end - key) == name_size &&
        memcmp(key, name, name_size) == 0) {
      value->begin = begin;
      value->end = end;
      return true;
    }
    while (cursor < attributes.end && *cursor != ',') {
      ++cursor;
    }
  }
  return false;
}

static bool parse_decimal_milli(TextSpan span, uint32_t *value) {
  uint32_t whole = 0;
  uint32_t fraction = 0;
  unsigned fraction_digits = 0;
  bool decimal = false;
  bool saw_digit = false;
  for (const char *cursor = span.begin; cursor < span.end; ++cursor) {
    if (*cursor == '.' && !decimal) {
      decimal = true;
      continue;
    }
    if (*cursor < '0' || *cursor > '9') {
      return false;
    }
    saw_digit = true;
    const uint32_t digit = (uint32_t)(*cursor - '0');
    if (!decimal) {
      if (whole > (UINT32_MAX / 1000u - digit) / 10u) {
        return false;
      }
      whole = whole * 10u + digit;
    } else if (fraction_digits < 3u) {
      fraction = fraction * 10u + digit;
      ++fraction_digits;
    }
  }
  if (!saw_digit) {
    return false;
  }
  while (fraction_digits < 3u) {
    fraction *= 10u;
    ++fraction_digits;
  }
  *value = whole * 1000u + fraction;
  return true;
}

static bool parse_resolution(TextSpan span, unsigned *width,
                             unsigned *height) {
  const char *separator = memchr(span.begin, 'x',
                                (size_t)(span.end - span.begin));
  if (separator == NULL) {
    return false;
  }
  uint32_t parsed_width = 0;
  uint32_t parsed_height = 0;
  if (!parse_unsigned((TextSpan){span.begin, separator}, &parsed_width) ||
      !parse_unsigned((TextSpan){separator + 1, span.end}, &parsed_height) ||
      parsed_width == 0 || parsed_height == 0 ||
      parsed_width > UINT_MAX || parsed_height > UINT_MAX) {
    return false;
  }
  *width = (unsigned)parsed_width;
  *height = (unsigned)parsed_height;
  return true;
}

bool hls_playlist_parse_master(const char *text, size_t size,
                               HlsVariant *variant) {
  if (text == NULL || size == 0 || variant == NULL) {
    return false;
  }
  memset(variant, 0, sizeof(*variant));
  const char *cursor = text;
  const char *end = text + size;
  TextSpan line;
  if (!next_line(&cursor, end, &line) || !span_equals(line, "#EXTM3U")) {
    return false;
  }

  while (next_line(&cursor, end, &line)) {
    static const char tag[] = "#EXT-X-STREAM-INF:";
    if (!span_starts_with(line, tag)) {
      continue;
    }
    TextSpan attributes = {line.begin + sizeof(tag) - 1u, line.end};
    TextSpan bandwidth;
    TextSpan resolution;
    if (!find_attribute(attributes, "BANDWIDTH", &bandwidth) ||
        !parse_unsigned(bandwidth, &variant->bandwidth) ||
        !find_attribute(attributes, "RESOLUTION", &resolution) ||
        !parse_resolution(resolution, &variant->width, &variant->height)) {
      return false;
    }
    TextSpan frame_rate;
    if (find_attribute(attributes, "FRAME-RATE", &frame_rate) &&
        !parse_decimal_milli(frame_rate, &variant->frame_rate_millihertz)) {
      return false;
    }
    do {
      if (!next_line(&cursor, end, &line)) {
        return false;
      }
    } while (line.begin == line.end || *line.begin == '#');
    return copy_span(line, variant->uri, sizeof(variant->uri));
  }
  return false;
}

bool hls_playlist_parse_media(const char *text, size_t size,
                              HlsMediaPlaylist *playlist) {
  if (text == NULL || size == 0 || playlist == NULL) {
    return false;
  }
  memset(playlist, 0, sizeof(*playlist));
  const char *cursor = text;
  const char *end = text + size;
  TextSpan line;
  if (!next_line(&cursor, end, &line) || !span_equals(line, "#EXTM3U")) {
    return false;
  }
  uint32_t pending_duration = 0;
  bool has_pending_duration = false;

  while (next_line(&cursor, end, &line)) {
    static const char media_sequence_tag[] = "#EXT-X-MEDIA-SEQUENCE:";
    static const char target_duration_tag[] = "#EXT-X-TARGETDURATION:";
    static const char duration_tag[] = "#EXTINF:";
    if (span_starts_with(line, media_sequence_tag)) {
      TextSpan value = {line.begin + sizeof(media_sequence_tag) - 1u,
                        line.end};
      if (!parse_unsigned(value, &playlist->media_sequence)) {
        return false;
      }
    } else if (span_starts_with(line, target_duration_tag)) {
      TextSpan value = {line.begin + sizeof(target_duration_tag) - 1u,
                        line.end};
      if (!parse_unsigned(value, &playlist->target_duration_seconds)) {
        return false;
      }
    } else if (span_starts_with(line, duration_tag)) {
      TextSpan value = {line.begin + sizeof(duration_tag) - 1u, line.end};
      const char *comma =
          memchr(value.begin, ',', (size_t)(value.end - value.begin));
      if (comma != NULL) {
        value.end = comma;
      }
      if (!parse_decimal_milli(value, &pending_duration)) {
        return false;
      }
      has_pending_duration = true;
    } else if (span_equals(line, "#EXT-X-ENDLIST")) {
      playlist->end_list = true;
    } else if (line.begin != line.end && *line.begin != '#') {
      if (!has_pending_duration ||
          playlist->segment_count >= HLS_MAX_SEGMENTS) {
        return false;
      }
      HlsSegment *segment = &playlist->segments[playlist->segment_count];
      if (!copy_span(line, segment->uri, sizeof(segment->uri))) {
        return false;
      }
      segment->duration_ms = pending_duration;
      segment->sequence =
          playlist->media_sequence + (uint32_t)playlist->segment_count;
      ++playlist->segment_count;
      has_pending_duration = false;
    }
  }
  return playlist->segment_count != 0 && !has_pending_duration &&
         playlist->target_duration_seconds != 0;
}

bool hls_playlist_resolve_url(const char *base_url, const char *uri,
                              char *destination, size_t capacity) {
  static const char scheme[] = "http://";
  if (base_url == NULL || uri == NULL || destination == NULL ||
      capacity == 0 || strncmp(base_url, scheme, sizeof(scheme) - 1u) != 0 ||
      uri[0] == '\0' || strstr(uri, "..") != NULL ||
      strchr(uri, '\r') != NULL || strchr(uri, '\n') != NULL) {
    return false;
  }
  if (strncmp(uri, scheme, sizeof(scheme) - 1u) == 0) {
    const size_t size = strlen(uri);
    if (size >= capacity) {
      return false;
    }
    memcpy(destination, uri, size + 1u);
    return true;
  }

  const char *authority = base_url + sizeof(scheme) - 1u;
  const char *path = strchr(authority, '/');
  const char *prefix_end = NULL;
  if (uri[0] == '/') {
    prefix_end = path == NULL ? base_url + strlen(base_url) : path;
  } else {
    const char *query = strchr(base_url, '?');
    const char *url_end = query == NULL ? base_url + strlen(base_url) : query;
    const char *slash = url_end;
    while (slash > authority && slash[-1] != '/') {
      --slash;
    }
    if (slash <= authority) {
      return false;
    }
    prefix_end = slash;
  }
  const size_t prefix_size = (size_t)(prefix_end - base_url);
  const size_t uri_size = strlen(uri);
  if (prefix_size + uri_size >= capacity) {
    return false;
  }
  memcpy(destination, base_url, prefix_size);
  memcpy(destination + prefix_size, uri, uri_size + 1u);
  return true;
}
