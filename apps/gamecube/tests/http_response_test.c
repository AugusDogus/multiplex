#include "http_response.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  const uint8_t *bytes;
  size_t size;
  size_t offset;
  size_t max_read;
  size_t written_size;
  size_t writes[8];
  size_t write_count;
  size_t yields;
  bool accept_writes;
  bool reject_writes;
  size_t reject_after;
  bool cancelled;
  bool read_failure;
  bool malformed_size;
} Fixture;

static HttpResponseReadResult read_fixture(void *context, uint8_t *destination,
                                           size_t capacity, size_t *size) {
  Fixture *fixture = context;
  if (fixture->cancelled) {
    return HTTP_RESPONSE_READ_CANCELLED;
  }
  if (fixture->read_failure) {
    return HTTP_RESPONSE_READ_FAILURE;
  }
  if (fixture->offset == fixture->size) {
    return HTTP_RESPONSE_READ_END;
  }
  size_t copied = fixture->size - fixture->offset;
  if (copied > capacity) {
    copied = capacity;
  }
  if (fixture->max_read != 0 && copied > fixture->max_read) {
    copied = fixture->max_read;
  }
  memcpy(destination, fixture->bytes + fixture->offset, copied);
  fixture->offset += copied;
  *size = fixture->malformed_size ? capacity + 1u : copied;
  return HTTP_RESPONSE_READ_DATA;
}

static bool write_fixture(void *context, const uint8_t *bytes, size_t size) {
  Fixture *fixture = context;
  (void)bytes;
  if (!fixture->accept_writes || fixture->reject_writes ||
      (fixture->reject_after != 0 &&
       fixture->written_size >= fixture->reject_after)) {
    return false;
  }
  if (fixture->write_count <
      sizeof(fixture->writes) / sizeof(fixture->writes[0])) {
    fixture->writes[fixture->write_count++] = size;
  }
  fixture->written_size += size;
  return true;
}

static bool cancel_fixture(void *context) {
  return ((Fixture *)context)->cancelled;
}

static void yield_fixture(void *context) { ((Fixture *)context)->yields += 1u; }

static HttpResponseBodyResult stream(const char *headers, const uint8_t *body,
                                     size_t body_size, Fixture *fixture) {
  HttpResponseHead head = {0};
  const size_t header_size = strlen(headers);
  assert(http_response_parse_headers(headers, header_size, &head));
  fixture->bytes = body;
  fixture->size = body_size;
  if (!fixture->reject_writes) {
    fixture->accept_writes = true;
  }
  const HttpResponseBodyIo io = {
      .read = read_fixture,
      .read_context = fixture,
      .write = write_fixture,
      .write_context = fixture,
      .cancelled = cancel_fixture,
      .cancel_context = fixture,
      .yield = yield_fixture,
      .yield_context = fixture,
  };
  return http_response_stream_body(&head, &io);
}

static void test_header_parser(void) {
  static const char headers[] = "HTTP/1.1 201 Created\r\nContent-Length: 7\r\n"
                                "content-length: 7\r\n\r\n";
  HttpResponseHead head = {.status = 999u,
                           .framing = HTTP_RESPONSE_FRAMING_CHUNKED,
                           .content_length = 33u};
  assert(http_response_parse_headers(headers, sizeof(headers) - 1u, &head));
  assert(head.status == 201u);
  assert(head.framing == HTTP_RESPONSE_FRAMING_CONTENT_LENGTH);
  assert(head.content_length == 7u);

  const HttpResponseHead saved = head;
  static const char malformed[] =
      "HTTP/1.1 200 OK\r\nContent-Length: x\r\n\r\n";
  assert(
      !http_response_parse_headers(malformed, sizeof(malformed) - 1u, &head));
  assert(memcmp(&head, &saved, sizeof(head)) == 0);
  static const char extra[] = "HTTP/1.1 200 OK\r\n\r\nextra";
  assert(!http_response_parse_headers(extra, sizeof(extra) - 1u, &head));
  static const char incomplete[] = "HTTP/1.1 200 OK\r\n";
  assert(
      !http_response_parse_headers(incomplete, sizeof(incomplete) - 1u, &head));
  static const char conflicting[] =
      "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n";
  assert(!http_response_parse_headers(conflicting, sizeof(conflicting) - 1u,
                                      &head));
  static const char unknown_encoding[] =
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip\r\n\r\n";
  assert(!http_response_parse_headers(unknown_encoding,
                                      sizeof(unknown_encoding) - 1u, &head));
  static const char conflict[] = "HTTP/1.1 200 OK\r\nContent-Length: 1\r\n"
                                 "Transfer-Encoding: chunked\r\n\r\n";
  assert(!http_response_parse_headers(conflict, sizeof(conflict) - 1u, &head));
  static const char overflow[] =
      "HTTP/1.1 200 OK\r\nContent-Length: 18446744073709551616\r\n\r\n";
  assert(!http_response_parse_headers(overflow, sizeof(overflow) - 1u, &head));

  static const char chunked[] =
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: ChUnKeD\r\n\r\n";
  assert(http_response_parse_headers(chunked, sizeof(chunked) - 1u, &head));
  assert(head.framing == HTTP_RESPONSE_FRAMING_CHUNKED);
  static const char close[] = "HTTP/1.1 200 OK\r\nX-Test: yes\r\n\r\n";
  assert(http_response_parse_headers(close, sizeof(close) - 1u, &head));
  assert(head.framing == HTTP_RESPONSE_FRAMING_UNTIL_CLOSE);
}

static void test_body_outcomes(void) {
  static const uint8_t body[] = "hello";
  Fixture fixture = {0};
  HttpResponseBodyResult result =
      stream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n", body,
             sizeof(body) - 1u, &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_COMPLETE);
  assert(result.bytes_delivered == 5u);
  assert(fixture.yields == 1u);

  fixture = (Fixture){0};
  result = stream("HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n", body,
                  sizeof(body) - 1u, &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_PREMATURE_END);
  assert(result.bytes_delivered == 0u);

  fixture = (Fixture){.read_failure = true};
  result = stream("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n", body, 1u,
                  &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_READ_FAILURE);

  fixture = (Fixture){.malformed_size = true};
  result = stream("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n", body, 1u,
                  &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_MALFORMED);

  fixture = (Fixture){.cancelled = true};
  result = stream("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n", body, 1u,
                  &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_CANCELLED);

  fixture = (Fixture){.reject_writes = true};
  result = stream("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n", body, 1u,
                  &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_WRITE_REJECTED);
  assert(result.bytes_delivered == 0u);

  fixture = (Fixture){0};
  result = stream("HTTP/1.1 200 OK\r\nX-Test: close\r\n\r\n", body,
                  sizeof(body) - 1u, &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_COMPLETE);
  assert(result.bytes_delivered == sizeof(body) - 1u);
}

static void test_chunked_body(void) {
  static const uint8_t body[] = "2;foo=bar\r\nok\r\nA\r\n0123456789\r\n"
                                "0\r\nTrailer: yes\r\n\r\n";
  Fixture fixture = {0};
  const HttpResponseBodyResult result =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", body,
             sizeof(body) - 1u, &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_COMPLETE);
  assert(result.bytes_delivered == 12u);
  assert(fixture.write_count == 2u);
  assert(fixture.writes[0] == 2u && fixture.writes[1] == 10u);

  static const uint8_t malformed[] = "2\r\nok\n0\r\n\r\n";
  fixture = (Fixture){0};
  const HttpResponseBodyResult bad =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", malformed,
             sizeof(malformed) - 1u, &fixture);
  assert(bad.status == HTTP_RESPONSE_BODY_MALFORMED);
  assert(bad.bytes_delivered == 2u);

  static const uint8_t rejected[] = "1\r\na\r\n1\r\nb\r\n0\r\n\r\n";
  fixture = (Fixture){.reject_after = 1u};
  const HttpResponseBodyResult rejected_result =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", rejected,
             sizeof(rejected) - 1u, &fixture);
  assert(rejected_result.status == HTTP_RESPONSE_BODY_WRITE_REJECTED);
  assert(rejected_result.bytes_delivered == 1u);

  static const uint8_t bad_terminator[] = "1\r\na\r\n0\r\n\n";
  fixture = (Fixture){0};
  const HttpResponseBodyResult bad_terminator_result =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n",
             bad_terminator, sizeof(bad_terminator) - 1u, &fixture);
  assert(bad_terminator_result.status == HTTP_RESPONSE_BODY_MALFORMED);

  uint8_t long_line[140] = {0};
  memset(long_line, 'x', 129u);
  memcpy(long_line + 129u, "\r\n0\r\n\r\n", 8u);
  fixture = (Fixture){0};
  const HttpResponseBodyResult long_line_result =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", long_line,
             129u + 8u, &fixture);
  assert(long_line_result.status == HTTP_RESPONSE_BODY_MALFORMED);
}

static void test_large_chunk_yields_each_piece(void) {
  static uint8_t body[8193u + 15u];
  memcpy(body, "2001\r\n", 6u);
  memset(body + 6u, 'x', 8193u);
  memcpy(body + 6u + 8193u, "\r\n0\r\n\r\n", 8u);
  Fixture fixture = {0};
  const HttpResponseBodyResult result =
      stream("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", body,
             6u + 8193u + 8u, &fixture);
  assert(result.status == HTTP_RESPONSE_BODY_COMPLETE);
  assert(result.bytes_delivered == 8193u);
  assert(fixture.write_count == 3u);
  assert(fixture.writes[0] == 4096u && fixture.writes[1] == 4096u &&
         fixture.writes[2] == 1u);
  assert(fixture.yields == 3u);
}

int main(void) {
  test_header_parser();
  test_body_outcomes();
  test_chunked_body();
  test_large_chunk_yields_each_piece();
  puts("GameCube HTTP response tests passed.");
  return 0;
}
