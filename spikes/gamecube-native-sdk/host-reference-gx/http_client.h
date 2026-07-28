#ifndef MULTIPLEX_HTTP_CLIENT_H
#define MULTIPLEX_HTTP_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint8_t *data;
  size_t size;
} HttpDownload;

bool http_client_download(const char *url, HttpDownload *download);
void http_client_download_destroy(HttpDownload *download);

#endif
