#ifndef MULTIPLEX_HTTP_RESPONSE_H
#define MULTIPLEX_HTTP_RESPONSE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
  HTTP_RESPONSE_FRAMING_CONTENT_LENGTH,
  HTTP_RESPONSE_FRAMING_CHUNKED,
  HTTP_RESPONSE_FRAMING_UNTIL_CLOSE,
} HttpResponseFramingKind;

typedef struct {
  unsigned status;
  HttpResponseFramingKind framing;
  size_t content_length;
} HttpResponseHead;

typedef enum {
  HTTP_RESPONSE_READ_DATA,
  HTTP_RESPONSE_READ_END,
  HTTP_RESPONSE_READ_FAILURE,
  HTTP_RESPONSE_READ_CANCELLED,
} HttpResponseReadResult;

typedef enum {
  HTTP_RESPONSE_BODY_COMPLETE,
  HTTP_RESPONSE_BODY_MALFORMED,
  HTTP_RESPONSE_BODY_PREMATURE_END,
  HTTP_RESPONSE_BODY_WRITE_REJECTED,
  HTTP_RESPONSE_BODY_CANCELLED,
  HTTP_RESPONSE_BODY_READ_FAILURE,
} HttpResponseBodyStatus;

typedef struct {
  HttpResponseBodyStatus status;
  size_t bytes_delivered;
} HttpResponseBodyResult;

typedef HttpResponseReadResult (*HttpResponseRead)(void *context,
                                                   uint8_t *destination,
                                                   size_t capacity,
                                                   size_t *size);
typedef bool (*HttpResponseBodyWrite)(void *context, const uint8_t *bytes,
                                      size_t size);
typedef bool (*HttpResponseCancelled)(void *context);
typedef void (*HttpResponseYield)(void *context);

typedef struct {
  HttpResponseRead read;
  void *read_context;
  HttpResponseBodyWrite write;
  void *write_context;
  HttpResponseCancelled cancelled;
  void *cancel_context;
  HttpResponseYield yield;
  void *yield_context;
} HttpResponseBodyIo;

bool http_response_parse_headers(const char *bytes, size_t size,
                                 HttpResponseHead *out);
HttpResponseBodyResult http_response_stream_body(const HttpResponseHead *head,
                                                 const HttpResponseBodyIo *io);

#endif
