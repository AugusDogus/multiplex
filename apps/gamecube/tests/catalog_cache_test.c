#include "catalog_cache.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void set_text(char *destination, uint16_t *length, const char *value) {
  *length = (uint16_t)strlen(value);
  memcpy(destination, value, *length);
}

int main(void) {
  MultiplexGatewayCatalog source = {0};
  source.version = 3;
  source.row_count = 1;
  source.total_item_count = 2;
  source.library_count = 1;
  set_text(source.server_name, &source.server_name_length, "Augie's Haus");
  set_text(source.rows[0].title, &source.rows[0].title_length,
           "Continue Watching");
  source.rows[0].item_count = 2;
  source.items[0].rating_key = 416284;
  source.items[0].duration_ms = 1442000;
  source.items[0].view_offset_ms = 217000;
  source.items[0].progress_percent = 15;
  set_text(source.items[0].title, &source.items[0].title_length,
           "Cowboy Bebop");
  set_text(source.items[0].subtitle, &source.items[0].subtitle_length,
           "Ballad of Fallen Angels");
  source.items[1].rating_key = 380571;
  set_text(source.items[1].title, &source.items[1].title_length, "Fresh");
  set_text(source.items[1].subtitle, &source.items[1].subtitle_length, "2022");
  source.libraries[0].section_id = 4;
  source.libraries[0].media_type = 1;
  set_text(source.libraries[0].title, &source.libraries[0].title_length,
           "Movies");

  uint8_t encoded[MULTIPLEX_CATALOG_CACHE_SIZE];
  assert(multiplex_catalog_cache_encode(encoded, &source));
  MultiplexGatewayCatalog decoded;
  assert(multiplex_catalog_cache_decode(encoded, &decoded));
  assert(decoded.version == 3);
  assert(decoded.row_count == 1);
  assert(decoded.total_item_count == 2);
  assert(decoded.library_count == 1);
  assert(decoded.items[0].rating_key == 416284);
  assert(decoded.items[0].view_offset_ms == 217000);
  assert(strcmp(decoded.items[0].title, "Cowboy Bebop") == 0);
  assert(strcmp(decoded.items[0].subtitle, "Ballad of Fallen Angels") == 0);
  assert(decoded.items[0].artwork_path[0] == '\0');
  assert(decoded.libraries[0].section_id == 4);
  assert(strcmp(decoded.libraries[0].title, "Movies") == 0);

  encoded[17] ^= 0x80;
  assert(!multiplex_catalog_cache_decode(encoded, &decoded));

  puts("GameCube catalog cache tests passed.");
  return 0;
}
