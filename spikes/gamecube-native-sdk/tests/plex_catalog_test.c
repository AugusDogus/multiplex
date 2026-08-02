#include "plex_catalog.h"

#include "http_client.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static unsigned request_count;
static unsigned response_status = 200;
static char requested_method[8];
static char requested_url[512];
static char requested_token[64];

bool http_client_request_with_headers(const char *method, const char *url,
                                      const HttpRequestHeader *headers,
                                      size_t header_count, const char *body,
                                      char *destination, size_t capacity,
                                      HttpJsonResponse *response) {
  (void)body;
  ++request_count;
  snprintf(requested_method, sizeof(requested_method), "%s", method);
  snprintf(requested_url, sizeof(requested_url), "%s", url);
  requested_token[0] = '\0';
  for (size_t index = 0; index < header_count; ++index) {
    if (strcmp(headers[index].name, "X-Plex-Token") == 0) {
      snprintf(requested_token, sizeof(requested_token), "%s",
               headers[index].value);
    }
  }
  if (capacity > 0) {
    destination[0] = '\0';
  }
  response->status = response_status;
  response->body_size = 0;
  return true;
}

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

static void test_parses_browse_page(void) {
  static const char browse[] =
      "{\"MediaContainer\":{\"size\":2,\"totalSize\":17,\"Metadata\":["
      "{\"ratingKey\":\"22\",\"type\":\"movie\",\"title\":\"Newest Movie\","
      "\"year\":2026,\"duration\":7200000,\"viewOffset\":1800000,"
      "\"thumb\":\"/library/metadata/22/thumb/1\"},"
      "{\"ratingKey\":\"23\",\"type\":\"show\",\"title\":\"A Series\","
      "\"year\":2024,\"duration\":0,"
      "\"thumb\":\"/library/metadata/23/thumb/1\"}]}}";
  const MultiplexGatewayLibrary library = {
      .section_id = 3,
      .media_type = 1,
      .title = "Movies",
      .title_length = 6,
  };
  MultiplexGatewayBrowsePage page = {0};

  assert(multiplex_plex_catalog_parse_browse(
      browse, strlen(browse), &library, 4, &page));
  assert(page.version == 1);
  assert(page.section_id == 3);
  assert(page.start == 4);
  assert(page.total_size == 17);
  assert(page.item_count == 2);
  assert(strcmp(page.title, "Movies") == 0);
  assert(strcmp(page.items[0].title, "Newest Movie") == 0);
  assert(strcmp(page.items[0].subtitle, "2026") == 0);
  assert(page.items[0].progress_percent == 25);
  assert(page.items[1].artwork_slot == 1);
}

static void test_parses_item_details(void) {
  static const char json[] =
      "{\"MediaContainer\":{\"Metadata\":[{"
      "\"ratingKey\":\"44\",\"type\":\"movie\",\"title\":\"A Film\","
      "\"tagline\":\"The useful tagline\",\"librarySectionTitle\":\"Movies\","
      "\"contentRating\":\"PG-13\",\"summary\":\"A concise summary.\","
      "\"duration\":7260000,\"viewOffset\":60000,\"year\":2025,"
      "\"rating\":8.65,\"Genre\":[{\"tag\":\"Drama\"},{\"tag\":\"Mystery\"}],"
      "\"Director\":[{\"tag\":\"A. Director\"}],"
      "\"Media\":[{\"videoResolution\":\"1080\",\"Part\":[{\"Stream\":["
      "{\"id\":10,\"streamType\":1,\"codec\":\"h264\"},"
      "{\"id\":20,\"streamType\":3,\"index\":2,\"codec\":\"srt\","
      "\"displayTitle\":\"English (SRT)\",\"selected\":true},"
      "{\"id\":21,\"streamType\":3,\"codec\":\"pgs\","
      "\"language\":\"Japanese\"}]}]}]}]"
      "}]}}";
  MultiplexGatewayDetails details = {0};

  assert(multiplex_plex_catalog_parse_details(
      json, strlen(json), &details));
  assert(details.version == 1);
  assert(details.rating_key == 44);
  assert(strcmp(details.title, "A Film") == 0);
  assert(strcmp(details.secondary, "The useful tagline") == 0);
  assert(strcmp(details.media_type, "Movie") == 0);
  assert(strcmp(details.library, "Movies") == 0);
  assert(strcmp(details.content_rating, "PG-13") == 0);
  assert(strcmp(details.summary, "A concise summary.") == 0);
  assert(strcmp(details.genres, "Drama, Mystery") == 0);
  assert(strcmp(details.directors, "A. Director") == 0);
  assert(details.year == 2025);
  assert(details.rating_tenths == 87);
  assert((details.flags & 1u) != 0);
  assert(details.subtitle_stream_count == 2);
  assert(details.subtitle_streams[0].id == 20);
  assert(details.subtitle_streams[0].has_index);
  assert(details.subtitle_streams[0].index == 2);
  assert(details.subtitle_streams[0].selected);
  assert(strcmp(details.subtitle_streams[0].label, "English (SRT)") == 0);
  assert(strcmp(details.subtitle_streams[0].codec, "srt") == 0);
  assert(details.subtitle_streams[1].id == 21);
  assert(!details.subtitle_streams[1].has_index);
  assert(!details.subtitle_streams[1].selected);
  assert(strcmp(details.subtitle_streams[1].label, "Japanese") == 0);
  assert(strcmp(details.subtitle_streams[1].codec, "pgs") == 0);
}

static void test_parses_episode_hierarchy(void) {
  static const char json[] =
      "{\"MediaContainer\":{\"Metadata\":[{"
      "\"ratingKey\":\"380571\",\"type\":\"episode\","
      "\"title\":\"Ballad of Fallen Angels\",\"parentIndex\":1,\"index\":5,"
      "\"parentRatingKey\":\"380566\","
      "\"grandparentRatingKey\":\"380565\",\"duration\":1441719,"
      "\"Media\":[{\"videoResolution\":\"1080\"}]"
      "}]}}";
  MultiplexGatewayDetails details = {0};

  assert(multiplex_plex_catalog_parse_details(json, strlen(json), &details));
  assert(strcmp(details.media_type, "Episode") == 0);
  assert(details.rating_key == 380571);
  assert(details.parent_rating_key == 380566);
  assert(details.grandparent_rating_key == 380565);
  assert(details.parent_index == 1);
  assert(details.index == 5);
}

static void test_parses_item_children(void) {
  static const char json[] =
      "{\"MediaContainer\":{\"size\":2,\"totalSize\":9,\"Metadata\":["
      "{\"ratingKey\":\"71\",\"type\":\"season\",\"title\":\"Season 1\","
      "\"thumb\":\"/library/metadata/71/thumb/1\"},"
      "{\"ratingKey\":\"72\",\"type\":\"episode\",\"title\":\"Pilot\","
      "\"parentIndex\":1,\"index\":1,\"duration\":3600000,"
      "\"viewOffset\":900000,\"thumb\":\"/library/metadata/72/thumb/1\"}"
      "]}}";
  MultiplexGatewayChildrenPage page = {0};

  assert(multiplex_plex_catalog_parse_children(json, strlen(json), 4, &page));
  assert(page.version == 1);
  assert(page.start == 4);
  assert(page.total_size == 9);
  assert(page.item_count == 2);
  assert(page.items[0].rating_key == 71);
  assert(strcmp(page.items[0].title, "Season 1") == 0);
  assert(strcmp(page.items[0].subtitle, "Season") == 0);
  assert(strcmp(page.items[1].title, "Pilot") == 0);
  assert(strcmp(page.items[1].subtitle, "S01 E01") == 0);
  assert(page.items[1].progress_percent == 25);
}

static void test_parses_search_results(void) {
  static const char json[] =
      "{\"MediaContainer\":{\"size\":3,\"SearchResult\":["
      "{\"score\":99.0,\"Metadata\":{\"ratingKey\":\"51\",\"type\":\"movie\","
      "\"title\":\"Cube\",\"year\":1997,\"duration\":5400000,"
      "\"thumb\":\"/library/metadata/51/thumb/1\"}},"
      "{\"score\":80.0,\"Directory\":{\"type\":\"person\",\"tag\":\"Someone\"}},"
      "{\"score\":70.0,\"Metadata\":{\"ratingKey\":\"52\",\"type\":\"show\","
      "\"title\":\"Cubed\",\"year\":2026,"
      "\"thumb\":\"/library/metadata/52/thumb/1\"}}]}}";
  MultiplexGatewaySearchPage page = {0};

  assert(multiplex_plex_catalog_parse_search(
      json, strlen(json), "CUBE", 4, &page));
  assert(page.version == 1);
  assert(strcmp(page.query, "CUBE") == 0);
  assert(page.item_count == 2);
  assert(strcmp(page.items[0].title, "Cube") == 0);
  assert(strcmp(page.items[0].subtitle, "1997") == 0);
  assert(page.items[1].rating_key == 52);
  assert(page.items[1].artwork_slot == 1);
}

static void test_marks_item_watched(void) {
  MultiplexAuthCredentials credentials = {0};
  snprintf(credentials.plex_server_url,
           sizeof(credentials.plex_server_url), "http://plex.local/");
  snprintf(credentials.plex_server_token,
           sizeof(credentials.plex_server_token), "server-token");
  snprintf(credentials.plex_client_id, sizeof(credentials.plex_client_id),
           "gamecube-client");
  request_count = 0;
  response_status = 200;

  assert(multiplex_plex_mark_watched(&credentials, 44));
  assert(request_count == 1);
  assert(strcmp(requested_method, "GET") == 0);
  assert(strcmp(requested_url,
                "http://plex.local/:/scrobble?key=44&identifier="
                "com.plexapp.plugins.library") == 0);
  assert(strcmp(requested_token, "server-token") == 0);

  response_status = 500;
  assert(!multiplex_plex_mark_watched(&credentials, 44));
  assert(!multiplex_plex_mark_watched(&credentials, 0));
  assert(request_count == 2);
}

int main(void) {
  test_parses_home_rows();
  test_parses_libraries();
  test_parses_browse_page();
  test_parses_item_details();
  test_parses_episode_hierarchy();
  test_parses_item_children();
  test_parses_search_results();
  test_marks_item_watched();
  puts("GameCube direct Plex catalog tests passed.");
  return 0;
}
