#include "gateway_protocol.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void put_be16(uint8_t *bytes, uint16_t value) {
  bytes[0] = (uint8_t)(value >> 8u);
  bytes[1] = (uint8_t)value;
}

static void put_be32(uint8_t *bytes, uint32_t value) {
  bytes[0] = (uint8_t)(value >> 24u);
  bytes[1] = (uint8_t)(value >> 16u);
  bytes[2] = (uint8_t)(value >> 8u);
  bytes[3] = (uint8_t)value;
}

static size_t append_item(uint8_t *bytes, size_t cursor, uint32_t rating_key,
                          const char *title, const char *subtitle) {
  const uint16_t title_length = (uint16_t)strlen(title);
  const uint16_t subtitle_length = (uint16_t)strlen(subtitle);
  put_be32(bytes + cursor, rating_key);
  put_be32(bytes + cursor + 4, 7200000);
  put_be32(bytes + cursor + 8, 120000);
  put_be16(bytes + cursor + 12, 0);
  bytes[cursor + 14] = 2;
  bytes[cursor + 15] = 0;
  put_be16(bytes + cursor + 16, title_length);
  put_be16(bytes + cursor + 18, subtitle_length);
  cursor += 20;
  memcpy(bytes + cursor, title, title_length);
  cursor += title_length;
  memcpy(bytes + cursor, subtitle, subtitle_length);
  return cursor + subtitle_length;
}

static void test_catalog(void) {
  uint8_t bytes[256] = {0};
  memcpy(bytes, "MPXG", 4);
  put_be16(bytes + 4, 3);
  put_be16(bytes + 6, 1);
  put_be16(bytes + 8, 4);
  put_be16(bytes + 10, 1);
  memcpy(bytes + 12, "Plex", 4);
  size_t cursor = 16;
  put_be16(bytes + cursor, 8);
  put_be16(bytes + cursor + 2, 2);
  cursor += 4;
  memcpy(bytes + cursor, "Continue", 8);
  cursor += 8;
  cursor = append_item(bytes, cursor, 41, "Alien", "1979");
  cursor = append_item(bytes, cursor, 42, "Arrival", "2016");
  put_be16(bytes + cursor, 7);
  bytes[cursor + 2] = 1;
  put_be16(bytes + cursor + 4, 6);
  cursor += 6;
  memcpy(bytes + cursor, "Movies", 6);
  cursor += 6;

  DreamcastGatewayCatalog catalog;
  assert(dreamcast_gateway_parse_catalog(bytes, cursor, &catalog));
  assert(strcmp(catalog.server_name, "Plex") == 0);
  assert(catalog.item_count == 2);
  assert(catalog.items[0].rating_key == 41);
  assert(strcmp(catalog.items[0].title, "Alien") == 0);
  assert(strcmp(catalog.items[1].subtitle, "2016") == 0);
  assert(!dreamcast_gateway_parse_catalog(bytes, cursor - 1u, &catalog));
}

static void test_playback(void) {
  static const char path[] = "/v4/media/41/0.mpg";
  uint8_t bytes[128] = {0};
  memcpy(bytes, "MPXP", 4);
  put_be16(bytes + 4, 2);
  put_be16(bytes + 6, 1);
  put_be32(bytes + 8, 41);
  put_be32(bytes + 12, 7200000);
  put_be32(bytes + 16, 0);
  put_be32(bytes + 20, 8000);
  put_be32(bytes + 24, 912345);
  put_be16(bytes + 60, sizeof(path) - 1u);
  memcpy(bytes + 62, path, sizeof(path) - 1u);

  DreamcastGatewayPlayback playback;
  const size_t size = 62u + sizeof(path) - 1u;
  assert(dreamcast_gateway_parse_playback(
      bytes, size, "http://192.168.1.5:8080", &playback));
  assert(playback.rating_key == 41);
  assert(playback.container_bytes == 912345);
  assert(strcmp(playback.media_url,
                "http://192.168.1.5:8080/v4/media/41/0.mpg") == 0);
  assert(!dreamcast_gateway_parse_playback(
      bytes, size - 1u, "http://192.168.1.5:8080", &playback));
}

int main(void) {
  test_catalog();
  test_playback();
  puts("Dreamcast gateway protocol tests passed.");
  return 0;
}
