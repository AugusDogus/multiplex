#include "plex_catalog.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_parses_home_rows(void) {
  static const char hubs[] =
      "{\"MediaContainer\":{\"Hub\":["
      "{\"hubIdentifier\":\"home.continue\",\"title\":\"Continue Watching\","
      "\"Metadata\":[{\"ratingKey\":\"10\",\"type\":\"episode\","
      "\"title\":\"Pilot\",\"grandparentTitle\":\"A Show\","
      "\"parentIndex\":1,\"index\":2,\"duration\":1000,"
      "\"viewOffset\":250,\"grandparentThumb\":\"/show/poster\"}]},"
      "{\"hubIdentifier\":\"home.ondeck\",\"title\":\"On Deck\","
      "\"Metadata\":[{\"ratingKey\":\"11\",\"type\":\"movie\","
      "\"title\":\"Skipped\",\"year\":2020,\"duration\":1000}]},"
      "{\"hubIdentifier\":\"home.movies.recent\","
      "\"title\":\"Recently Added Movies\",\"Metadata\":["
      "{\"ratingKey\":\"12\",\"type\":\"movie\","
      "\"title\":\"A Movie\",\"year\":2026,\"duration\":2000}]},"
      "{\"hubIdentifier\":\"home.television.recent\","
      "\"title\":\"Recently Added TV\",\"Metadata\":["
      "{\"ratingKey\":\"13\",\"type\":\"episode\",\"title\":\"Finale\","
      "\"grandparentTitle\":\"Another Show\",\"parentIndex\":3,\"index\":8,"
      "\"duration\":4000}]}"
      "]}}";
  MultiplexGatewayCatalog catalog = {0};

  assert(multiplex_plex_catalog_parse_hubs(hubs, strlen(hubs), &catalog));
  assert(catalog.version == 3);
  assert(catalog.row_count == 3);
  assert(catalog.total_item_count == 3);
  assert(strcmp(catalog.rows[0].title, "Continue Watching") == 0);
  assert(strcmp(catalog.items[0].title, "A Show") == 0);
  assert(strcmp(catalog.items[0].subtitle, "Pilot - S01 E02") == 0);
  assert(strcmp(catalog.items[0].artwork_path, "/show/poster") == 0);
  assert(catalog.items[0].progress_percent == 25);
  assert(strcmp(catalog.rows[1].title, "Recently Added Movies") == 0);
  assert(strcmp(catalog.items[1].subtitle, "2026") == 0);
  assert(strcmp(catalog.rows[2].title, "Recently Added TV") == 0);
}

static void test_parses_libraries(void) {
  static const char libraries[] =
      "{\"MediaContainer\":{\"Directory\":["
      "{\"key\":\"1\",\"title\":\"Movies\",\"type\":\"movie\"},"
      "{\"key\":\"4\",\"title\":\"Anime\",\"type\":\"show\"},"
      "{\"key\":\"8\",\"title\":\"Audiobooks\",\"type\":\"artist\"}"
      "]}}";
  MultiplexGatewayCatalog catalog = {0};

  assert(multiplex_plex_catalog_parse_libraries(
      libraries, strlen(libraries), &catalog));
  assert(catalog.library_count == 3);
  assert(catalog.libraries[0].section_id == 1);
  assert(catalog.libraries[0].media_type == 1);
  assert(strcmp(catalog.libraries[1].title, "Anime") == 0);
  assert(catalog.libraries[1].media_type == 2);
  assert(catalog.libraries[2].media_type == 3);
}

int main(void) {
  test_parses_home_rows();
  test_parses_libraries();
  puts("GameCube direct Plex catalog tests passed.");
  return 0;
}
