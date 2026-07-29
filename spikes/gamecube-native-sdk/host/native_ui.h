#ifndef MULTIPLEX_NATIVE_UI_H
#define MULTIPLEX_NATIVE_UI_H

#include <stdint.h>

enum {
  MULTIPLEX_GX_FILL_RECT = 1,
  MULTIPLEX_GX_FILL_ROUNDED_RECT = 2,
  MULTIPLEX_GX_STROKE_RECT = 3,
  MULTIPLEX_GX_LINE = 4,
  MULTIPLEX_GX_TEXT = 5,
  MULTIPLEX_GX_SHADOW = 6,
  MULTIPLEX_GX_GLYPH = 7,
};

typedef struct {
  uint32_t kind;
  float x;
  float y;
  float width;
  float height;
  float x2;
  float y2;
  float radius;
  float stroke_width;
  uint32_t color_rgba;
  uint32_t has_clip;
  float clip_x;
  float clip_y;
  float clip_width;
  float clip_height;
  const uint8_t *text_ptr;
  uint32_t text_len;
  uint32_t glyph_id;
  float font_size;
} MultiplexGxCommand;

typedef struct {
  uint32_t visible;
  uint32_t playing;
  float x;
  float y;
  float width;
  float height;
} MultiplexVideoSurface;

typedef struct {
  uint32_t image_id;
  float x;
  float y;
  float width;
  float height;
} MultiplexPosterSurface;

void multiplex_native_app_init(void);
uint32_t multiplex_native_app_pairing_status(uint32_t status,
                                             const uint8_t *code,
                                             uint32_t code_length,
                                             const uint8_t *link_url,
                                             uint32_t link_url_length);
uint32_t multiplex_native_app_catalog_begin(const uint8_t *server_name,
                                            uint32_t server_name_length,
                                            uint32_t row_count,
                                            uint32_t library_count);
uint32_t multiplex_native_app_catalog_library(uint32_t index,
                                              uint32_t section_id,
                                              uint32_t media_type,
                                              const uint8_t *title,
                                              uint32_t title_length);
uint32_t multiplex_native_app_catalog_row(uint32_t row_index,
                                          const uint8_t *title,
                                          uint32_t title_length,
                                          uint32_t item_count);
uint32_t multiplex_native_app_catalog_item(
    uint32_t row_index, uint32_t item_index, uint32_t rating_key,
    const uint8_t *title, uint32_t title_length, const uint8_t *subtitle,
    uint32_t subtitle_length, uint32_t artwork_slot, uint32_t duration_ms,
    uint32_t view_offset_ms, uint32_t progress_percent);
uint32_t multiplex_native_app_catalog_commit(void);
uint32_t multiplex_native_app_watch_together_begin(uint32_t available,
                                                   uint32_t room_count);
uint32_t multiplex_native_app_watch_together_room(uint32_t index,
                                                  const uint8_t *title,
                                                  uint32_t title_length,
                                                  uint32_t participant_count);
uint32_t multiplex_native_app_watch_together_commit(void);
uint32_t multiplex_native_app_watch_together_create_request(
    uint32_t *rating_key, uint8_t *title, uint32_t title_capacity);
uint32_t multiplex_native_app_watch_together_create_fail(void);
uint32_t multiplex_native_app_watch_together_join_request(void);
uint32_t multiplex_native_app_watch_together_join_commit(uint32_t connected);
uint32_t multiplex_native_app_watch_together_playback(uint32_t rating_key,
                                                       uint32_t duration_ms,
                                                       uint32_t offset_ms);
uint32_t multiplex_native_app_playback_state(void);
uint32_t multiplex_native_app_browse_request(uint32_t *section_id,
                                             uint32_t *start);
uint32_t multiplex_native_app_browse_begin(uint32_t section_id,
                                           const uint8_t *title,
                                           uint32_t title_length,
                                           uint32_t start, uint32_t total,
                                           uint32_t item_count);
uint32_t multiplex_native_app_browse_item(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent);
uint32_t multiplex_native_app_browse_commit(void);
uint32_t multiplex_native_app_search_request(uint8_t *query, uint32_t capacity);
uint32_t multiplex_native_app_search_begin(const uint8_t *query,
                                           uint32_t query_length,
                                           uint32_t item_count);
uint32_t multiplex_native_app_search_item(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent);
uint32_t multiplex_native_app_search_commit(void);
uint32_t multiplex_native_app_details_request(void);
uint32_t multiplex_native_app_details_commit(
    const uint8_t *title, uint32_t title_length, const uint8_t *secondary,
    uint32_t secondary_length, const uint8_t *media_type,
    uint32_t media_type_length, const uint8_t *library, uint32_t library_length,
    const uint8_t *content_rating, uint32_t content_rating_length,
    const uint8_t *facts, uint32_t facts_length, const uint8_t *summary,
    uint32_t summary_length, const uint8_t *genres, uint32_t genres_length,
    const uint8_t *directors, uint32_t directors_length, uint32_t playable);
uint32_t multiplex_native_app_details_fail(void);
uint32_t multiplex_native_app_playback_request(void);
uint32_t multiplex_native_app_playback_offset_request(void);
uint32_t multiplex_native_app_playback_commit(void);
uint32_t multiplex_native_app_playback_fail(void);
uint32_t multiplex_native_app_playback_position(uint32_t position_ms);
uint32_t multiplex_native_app_playback_continue(uint32_t position_ms);
uint32_t multiplex_native_app_playback_complete(void);
uint32_t multiplex_native_app_input(uint32_t action);
uint32_t multiplex_native_video_surface(MultiplexVideoSurface *output);
uint32_t multiplex_native_poster_surfaces(MultiplexPosterSurface *output,
                                          uint32_t capacity);
uint32_t multiplex_native_app_render(MultiplexGxCommand *output,
                                     uint32_t capacity);
uint32_t multiplex_native_reference_pixel_bytes(void);
uint32_t multiplex_native_reference_render_stage(void);
uint32_t multiplex_native_reference_memo_hits(void);
uint32_t multiplex_native_reference_memo_misses(void);
uint32_t multiplex_native_reference_memo_bytes(void);
uint32_t multiplex_native_reference_memo_peak_bytes(void);
uint32_t multiplex_native_app_init_and_render_reference(
    uint8_t *pixels, uint32_t pixels_capacity, uint8_t *scratch,
    uint32_t scratch_capacity);
uint32_t multiplex_native_app_render_reference(uint8_t *pixels,
                                               uint32_t pixels_capacity,
                                               uint8_t *scratch,
                                               uint32_t scratch_capacity);

#endif
