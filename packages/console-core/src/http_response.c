#include "http_response.h"

#include <limits.h>
#include <string.h>

#define HTTP_RESPONSE_BODY_CHUNK_SIZE (4u * 1024u)
#define HTTP_RESPONSE_LINE_LIMIT 128u

static bool equal_name(const char *bytes, size_t size, const char *name) {
  const size_t name_size = strlen(name);
  if (size != name_size) {
    return false;
  }
  for (size_t index = 0; index < size; ++index) {
    char left = bytes[index];
    char right = name[index];
    if (left >= 'A' && left <= 'Z') {
      left = (char)(left - 'A' + 'a');
    }
    if (right >= 'A' && right <= 'Z') {
      right = (char)(right - 'A' + 'a');
    }
    if (left != right) {
      return false;
    }
  }
  return true;
}

static bool parse_status(const char *line, size_t size, unsigned *status) {
  static const char prefix[] = "HTTP/";
  if (size < sizeof(prefix) + 6u ||
      memcmp(line, prefix, sizeof(prefix) - 1u) != 0) {
    return false;
  }
  size_t cursor = sizeof(prefix) - 1u;
  const size_t major_start = cursor;
  while (cursor < size && line[cursor] >= '0' && line[cursor] <= '9') {
    ++cursor;
  }
  if (cursor == major_start || cursor == size || line[cursor++] != '.') {
    return false;
  }
  const size_t minor_start = cursor;
  while (cursor < size && line[cursor] >= '0' && line[cursor] <= '9') {
    ++cursor;
  }
  if (cursor == minor_start || cursor >= size || line[cursor++] != ' ' ||
      cursor + 3u > size) {
    return false;
  }
  unsigned value = 0;
  for (size_t index = 0; index < 3u; ++index) {
    const char digit = line[cursor + index];
    if (digit < '0' || digit > '9') {
      return false;
    }
    value = value * 10u + (unsigned)(digit - '0');
  }
  if (cursor + 3u < size && line[cursor + 3u] != ' ') {
    return false;
  }
  *status = value;
  return value >= 100u && value <= 599u;
}

static bool parse_decimal(const char *value, size_t size, size_t *result) {
  size_t cursor = 0;
  while (cursor < size && (value[cursor] == ' ' || value[cursor] == '\t')) {
    ++cursor;
  }
  const size_t start = cursor;
  size_t parsed = 0;
  while (cursor < size && value[cursor] >= '0' && value[cursor] <= '9') {
    const unsigned digit = (unsigned)(value[cursor] - '0');
    if (parsed > (SIZE_MAX - digit) / 10u) {
      return false;
    }
    parsed = parsed * 10u + digit;
    ++cursor;
  }
  if (cursor == start) {
    return false;
  }
  while (cursor < size && (value[cursor] == ' ' || value[cursor] == '\t')) {
    ++cursor;
  }
  if (cursor != size) {
    return false;
  }
  *result = parsed;
  return true;
}

bool http_response_parse_headers(const char *bytes, size_t size,
                                 HttpResponseHead *out) {
  if (bytes == NULL || out == NULL || size < 4u ||
      memcmp(bytes + size - 4u, "\r\n\r\n", 4u) != 0) {
    return false;
  }
  size_t line_end = 0;
  while (line_end + 1u < size &&
         !(bytes[line_end] == '\r' && bytes[line_end + 1u] == '\n')) {
    ++line_end;
  }
  if (line_end + 1u >= size) {
    return false;
  }
  HttpResponseHead parsed = {0};
  if (!parse_status(bytes, line_end, &parsed.status)) {
    return false;
  }
  bool has_length = false;
  bool has_transfer_encoding = false;
  size_t content_length = 0;
  size_t cursor = line_end + 2u;
  for (;;) {
    size_t end = cursor;
    while (end + 1u < size &&
           !(bytes[end] == '\r' && bytes[end + 1u] == '\n')) {
      ++end;
    }
    if (end + 1u >= size) {
      return false;
    }
    if (end == cursor) {
      if (end + 2u != size) {
        return false;
      }
      break;
    }
    const char *separator = memchr(bytes + cursor, ':', end - cursor);
    if (separator == NULL || separator == bytes + cursor) {
      return false;
    }
    const size_t name_size = (size_t)(separator - (bytes + cursor));
    for (size_t index = 0; index < name_size; ++index) {
      const unsigned char character = (unsigned char)bytes[cursor + index];
      if (character <= ' ' || character == ':') {
        return false;
      }
    }
    const char *value = separator + 1;
    const size_t value_size = (size_t)(bytes + end - value);
    if (equal_name(bytes + cursor, name_size, "Content-Length")) {
      size_t parsed_length = 0;
      if (!parse_decimal(value, value_size, &parsed_length) ||
          (has_length && parsed_length != content_length)) {
        return false;
      }
      content_length = parsed_length;
      has_length = true;
    } else if (equal_name(bytes + cursor, name_size, "Transfer-Encoding")) {
      size_t value_start = 0;
      while (value_start < value_size &&
             (value[value_start] == ' ' || value[value_start] == '\t')) {
        ++value_start;
      }
      size_t value_end = value_size;
      while (value_end > value_start &&
             (value[value_end - 1u] == ' ' || value[value_end - 1u] == '\t')) {
        --value_end;
      }
      if (has_transfer_encoding ||
          !equal_name(value + value_start, value_end - value_start,
                      "chunked")) {
        return false;
      }
      has_transfer_encoding = true;
    }
    cursor = end + 2u;
  }
  if (has_transfer_encoding && has_length) {
    return false;
  }
  parsed.framing = has_transfer_encoding ? HTTP_RESPONSE_FRAMING_CHUNKED
                   : has_length          ? HTTP_RESPONSE_FRAMING_CONTENT_LENGTH
                                         : HTTP_RESPONSE_FRAMING_UNTIL_CLOSE;
  parsed.content_length = content_length;
  *out = parsed;
  return true;
}

static bool cancelled(const HttpResponseBodyIo *io) {
  return io->cancelled != NULL && io->cancelled(io->cancel_context);
}

static HttpResponseBodyResult result(HttpResponseBodyStatus status,
                                     size_t delivered) {
  return (HttpResponseBodyResult){.status = status,
                                  .bytes_delivered = delivered};
}

static HttpResponseBodyStatus read_some(const HttpResponseBodyIo *io,
                                        uint8_t *bytes, size_t capacity,
                                        size_t *size) {
  if (cancelled(io)) {
    return HTTP_RESPONSE_BODY_CANCELLED;
  }
  *size = 0;
  const HttpResponseReadResult read_result =
      io->read(io->read_context, bytes, capacity, size);
  if (read_result == HTTP_RESPONSE_READ_CANCELLED || cancelled(io)) {
    return HTTP_RESPONSE_BODY_CANCELLED;
  }
  if (read_result == HTTP_RESPONSE_READ_FAILURE) {
    return HTTP_RESPONSE_BODY_READ_FAILURE;
  }
  if (read_result == HTTP_RESPONSE_READ_END) {
    return HTTP_RESPONSE_BODY_PREMATURE_END;
  }
  if (read_result != HTTP_RESPONSE_READ_DATA || *size == 0 ||
      *size > capacity) {
    return HTTP_RESPONSE_BODY_MALFORMED;
  }
  return HTTP_RESPONSE_BODY_COMPLETE;
}

static HttpResponseBodyStatus read_exact(const HttpResponseBodyIo *io,
                                         uint8_t *bytes, size_t size) {
  size_t offset = 0;
  while (offset < size) {
    size_t received = 0;
    const HttpResponseBodyStatus status =
        read_some(io, bytes + offset, size - offset, &received);
    if (status != HTTP_RESPONSE_BODY_COMPLETE) {
      return status;
    }
    offset += received;
  }
  return HTTP_RESPONSE_BODY_COMPLETE;
}

static HttpResponseBodyStatus write_body(const HttpResponseBodyIo *io,
                                         const uint8_t *bytes, size_t size) {
  if (size != 0 && !io->write(io->write_context, bytes, size)) {
    return HTTP_RESPONSE_BODY_WRITE_REJECTED;
  }
  return HTTP_RESPONSE_BODY_COMPLETE;
}

static void yield_after_write(const HttpResponseBodyIo *io) {
  if (io->yield != NULL) {
    io->yield(io->yield_context);
  }
}

static HttpResponseBodyStatus read_line(const HttpResponseBodyIo *io,
                                        char *line, size_t capacity,
                                        size_t *size) {
  size_t used = 0;
  for (;;) {
    if (used == capacity) {
      return HTTP_RESPONSE_BODY_MALFORMED;
    }
    uint8_t byte = 0;
    const HttpResponseBodyStatus status = read_exact(io, &byte, 1u);
    if (status != HTTP_RESPONSE_BODY_COMPLETE) {
      return status;
    }
    if (byte == '\n') {
      if (used == 0 || line[used - 1u] != '\r') {
        return HTTP_RESPONSE_BODY_MALFORMED;
      }
      *size = used - 1u;
      return HTTP_RESPONSE_BODY_COMPLETE;
    }
    line[used++] = (char)byte;
  }
}

static bool parse_chunk_size(const char *line, size_t size,
                             size_t *chunk_size) {
  size_t cursor = 0;
  size_t parsed = 0;
  bool digit_seen = false;
  while (cursor < size && line[cursor] != ';') {
    unsigned digit = 0;
    const char character = line[cursor++];
    if (character >= '0' && character <= '9') {
      digit = (unsigned)(character - '0');
    } else if (character >= 'a' && character <= 'f') {
      digit = (unsigned)(character - 'a') + 10u;
    } else if (character >= 'A' && character <= 'F') {
      digit = (unsigned)(character - 'A') + 10u;
    } else {
      return false;
    }
    if (parsed > (SIZE_MAX - digit) / 16u) {
      return false;
    }
    parsed = parsed * 16u + digit;
    digit_seen = true;
  }
  if (!digit_seen) {
    return false;
  }
  *chunk_size = parsed;
  return true;
}

static HttpResponseBodyResult
stream_content_length(const HttpResponseHead *head,
                      const HttpResponseBodyIo *io) {
  uint8_t bytes[HTTP_RESPONSE_BODY_CHUNK_SIZE];
  size_t delivered = 0;
  while (delivered < head->content_length) {
    const size_t remaining = head->content_length - delivered;
    const size_t part = remaining < sizeof(bytes) ? remaining : sizeof(bytes);
    const HttpResponseBodyStatus read_status = read_exact(io, bytes, part);
    if (read_status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(read_status, delivered);
    }
    const HttpResponseBodyStatus write_status = write_body(io, bytes, part);
    if (write_status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(write_status, delivered);
    }
    delivered += part;
    yield_after_write(io);
  }
  return result(HTTP_RESPONSE_BODY_COMPLETE, delivered);
}

static HttpResponseBodyResult stream_chunked(const HttpResponseBodyIo *io) {
  uint8_t bytes[HTTP_RESPONSE_BODY_CHUNK_SIZE];
  char line[HTTP_RESPONSE_LINE_LIMIT];
  size_t delivered = 0;
  for (;;) {
    size_t line_size = 0;
    HttpResponseBodyStatus status =
        read_line(io, line, sizeof(line), &line_size);
    if (status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(status, delivered);
    }
    size_t chunk_size = 0;
    if (!parse_chunk_size(line, line_size, &chunk_size) ||
        chunk_size > SIZE_MAX - delivered) {
      return result(HTTP_RESPONSE_BODY_MALFORMED, delivered);
    }
    if (chunk_size == 0) {
      do {
        status = read_line(io, line, sizeof(line), &line_size);
        if (status != HTTP_RESPONSE_BODY_COMPLETE) {
          return result(status, delivered);
        }
      } while (line_size != 0);
      return result(HTTP_RESPONSE_BODY_COMPLETE, delivered);
    }
    size_t remaining = chunk_size;
    while (remaining != 0) {
      const size_t part = remaining < sizeof(bytes) ? remaining : sizeof(bytes);
      status = read_exact(io, bytes, part);
      if (status != HTTP_RESPONSE_BODY_COMPLETE) {
        return result(status, delivered);
      }
      status = write_body(io, bytes, part);
      if (status != HTTP_RESPONSE_BODY_COMPLETE) {
        return result(status, delivered);
      }
      delivered += part;
      remaining -= part;
      yield_after_write(io);
    }
    uint8_t terminator[2];
    status = read_exact(io, terminator, sizeof(terminator));
    if (status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(status, delivered);
    }
    if (terminator[0] != '\r' || terminator[1] != '\n') {
      return result(HTTP_RESPONSE_BODY_MALFORMED, delivered);
    }
  }
}

static HttpResponseBodyResult stream_until_close(const HttpResponseBodyIo *io) {
  uint8_t bytes[HTTP_RESPONSE_BODY_CHUNK_SIZE];
  size_t delivered = 0;
  for (;;) {
    size_t received = 0;
    const HttpResponseBodyStatus status =
        read_some(io, bytes, sizeof(bytes), &received);
    if (status == HTTP_RESPONSE_BODY_PREMATURE_END) {
      return result(HTTP_RESPONSE_BODY_COMPLETE, delivered);
    }
    if (status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(status, delivered);
    }
    if (received > SIZE_MAX - delivered) {
      return result(HTTP_RESPONSE_BODY_MALFORMED, delivered);
    }
    const HttpResponseBodyStatus write_status = write_body(io, bytes, received);
    if (write_status != HTTP_RESPONSE_BODY_COMPLETE) {
      return result(write_status, delivered);
    }
    delivered += received;
    yield_after_write(io);
  }
}

HttpResponseBodyResult http_response_stream_body(const HttpResponseHead *head,
                                                 const HttpResponseBodyIo *io) {
  if (head == NULL || io == NULL || io->read == NULL || io->write == NULL) {
    return result(HTTP_RESPONSE_BODY_MALFORMED, 0);
  }
  if (cancelled(io)) {
    return result(HTTP_RESPONSE_BODY_CANCELLED, 0);
  }
  switch (head->framing) {
  case HTTP_RESPONSE_FRAMING_CONTENT_LENGTH:
    return stream_content_length(head, io);
  case HTTP_RESPONSE_FRAMING_CHUNKED:
    return stream_chunked(io);
  case HTTP_RESPONSE_FRAMING_UNTIL_CLOSE:
    return stream_until_close(io);
  }
  return result(HTTP_RESPONSE_BODY_MALFORMED, 0);
}
