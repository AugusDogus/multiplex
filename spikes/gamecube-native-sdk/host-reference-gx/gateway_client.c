#include "gateway_client.h"

#include "http_client.h"

#include <gccore.h>
#include <stdio.h>
#include <string.h>

#define CATALOG_HEADER_BYTES 12u
#define CATALOG_ITEM_HEADER_BYTES 16u
#define CATALOG_MAX_BYTES 1024u
#define GATEWAY_URL_CAPACITY 768u

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static uint32_t read_be32(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24u) | ((uint32_t)bytes[1] << 16u) |
         ((uint32_t)bytes[2] << 8u) | bytes[3];
}

static bool parse_catalog(const uint8_t *bytes, size_t size,
                          MultiplexGatewayCatalog *catalog) {
  if (size < CATALOG_HEADER_BYTES || memcmp(bytes, "MPXG", 4) != 0) {
    return false;
  }
  const uint16_t version = read_be16(bytes + 4);
  const uint16_t item_count = read_be16(bytes + 6);
  const uint16_t server_length = read_be16(bytes + 8);
  if (version != 1 || item_count > MULTIPLEX_GATEWAY_MAX_ITEMS ||
      server_length >= MULTIPLEX_GATEWAY_SERVER_CAPACITY ||
      CATALOG_HEADER_BYTES + server_length > size) {
    return false;
  }

  memset(catalog, 0, sizeof(*catalog));
  catalog->version = version;
  catalog->item_count = item_count;
  catalog->server_name_length = server_length;
  memcpy(catalog->server_name, bytes + CATALOG_HEADER_BYTES, server_length);

  size_t cursor = CATALOG_HEADER_BYTES + server_length;
  for (uint16_t index = 0; index < item_count; ++index) {
    if (cursor + CATALOG_ITEM_HEADER_BYTES > size) {
      return false;
    }
    MultiplexGatewayItem *item = &catalog->items[index];
    item->rating_key = read_be32(bytes + cursor);
    item->duration_ms = read_be32(bytes + cursor + 4);
    item->view_offset_ms = read_be32(bytes + cursor + 8);
    item->title_length = read_be16(bytes + cursor + 12);
    cursor += CATALOG_ITEM_HEADER_BYTES;
    if (item->title_length >= MULTIPLEX_GATEWAY_TITLE_CAPACITY ||
        cursor + item->title_length > size) {
      return false;
    }
    memcpy(item->title, bytes + cursor, item->title_length);
    cursor += item->title_length;
  }
  return cursor == size;
}

bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog) {
  if (base_url == NULL || base_url[0] == '\0' || catalog == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  static const char path[] = "/v1/catalog.bin";
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url), "%s%s%s", base_url,
                               has_slash ? "" : "/", path + 1);
  if (written < 0 || (size_t)written >= sizeof(url)) {
    SYS_Report("REFERENCE GX: gateway catalog URL is too long\n");
    return false;
  }

  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    SYS_Report("REFERENCE GX: gateway catalog HTTP open failed\n");
    return false;
  }
  const size_t size = http_client_size(client);
  uint8_t bytes[CATALOG_MAX_BYTES];
  const bool loaded = size > 0 && size <= sizeof(bytes) &&
                      http_client_read_at(client, 0, bytes, size) &&
                      parse_catalog(bytes, size, catalog);
  http_client_destroy(client);
  if (!loaded) {
    SYS_Report("REFERENCE GX: invalid gateway catalog bytes=%u\n",
               (unsigned)size);
    return false;
  }
  SYS_Report(
      "REFERENCE GX: gateway-catalog version=%u server=%s items=%u first=%s\n",
      catalog->version, catalog->server_name, catalog->item_count,
      catalog->item_count == 0 ? "" : catalog->items[0].title);
  return true;
}
