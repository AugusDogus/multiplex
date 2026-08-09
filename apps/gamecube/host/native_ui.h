#ifndef MULTIPLEX_NATIVE_UI_H
#define MULTIPLEX_NATIVE_UI_H

#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_NATIVE_ABI_VERSION UINT32_C(1)

enum {
  MULTIPLEX_GX_FILL_RECT = 1,
  MULTIPLEX_GX_FILL_ROUNDED_RECT = 2,
  MULTIPLEX_GX_STROKE_RECT = 3,
  MULTIPLEX_GX_LINE = 4,
  MULTIPLEX_GX_TEXT = 5,
  MULTIPLEX_GX_SHADOW = 6,
  MULTIPLEX_GX_GLYPH = 7,
  MULTIPLEX_GX_PATH_LINE = 8,
  MULTIPLEX_GX_FILL_TRIANGLE = 9,
};

enum {
  MULTIPLEX_SCREEN_PAIRING = 0,
  MULTIPLEX_SCREEN_HOME = 1,
  MULTIPLEX_SCREEN_LIBRARIES = 2,
  MULTIPLEX_SCREEN_BROWSE = 3,
  MULTIPLEX_SCREEN_SEARCH = 4,
  MULTIPLEX_SCREEN_SEARCH_RESULTS = 5,
  MULTIPLEX_SCREEN_WATCH_TOGETHER_INVITE = 6,
  MULTIPLEX_SCREEN_WATCH_TOGETHER = 7,
  MULTIPLEX_SCREEN_WATCH_TOGETHER_ROOM = 8,
  MULTIPLEX_SCREEN_DETAILS = 9,
  MULTIPLEX_SCREEN_PLAYER = 10,
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
  uint32_t visible;
  float x;
  float y;
  float width;
  float height;
} MultiplexPlayerControlsSurface;

typedef struct {
  uint32_t visible;
  float x;
  float y;
  float width;
  float height;
} MultiplexModalSurface;

typedef struct {
  uint32_t image_id;
  uint32_t focused;
  float x;
  float y;
  float width;
  float height;
  float radius;
  float card_x;
  float card_y;
  float card_width;
  float card_height;
  uint32_t has_clip;
  float clip_x;
  float clip_y;
  float clip_width;
  float clip_height;
} MultiplexPosterSurface;

#define MULTIPLEX_NATIVE_ABI_ALIGN_UP(value, alignment)                        \
  (((value) + (alignment) - 1u) / (alignment) * (alignment))
#define MULTIPLEX_NATIVE_ABI_MAX2(first, second)                               \
  ((first) > (second) ? (first) : (second))
#define MULTIPLEX_NATIVE_ABI_GX_COMMAND_ALIGNMENT                              \
  MULTIPLEX_NATIVE_ABI_MAX2(_Alignof(const uint8_t *), _Alignof(float))

_Static_assert(sizeof(uint32_t) == 4, "native ABI requires 32-bit uint32_t");
_Static_assert(sizeof(float) == 4, "native ABI requires 32-bit float");
_Static_assert(MULTIPLEX_NATIVE_ABI_VERSION == UINT32_C(1),
               "native ABI version changed");

_Static_assert(MULTIPLEX_GX_FILL_RECT == 1,
               "GX fill rectangle command changed");
_Static_assert(MULTIPLEX_GX_FILL_ROUNDED_RECT == 2,
               "GX rounded rectangle command changed");
_Static_assert(MULTIPLEX_GX_STROKE_RECT == 3,
               "GX stroke rectangle command changed");
_Static_assert(MULTIPLEX_GX_LINE == 4, "GX line command changed");
_Static_assert(MULTIPLEX_GX_TEXT == 5, "GX text command changed");
_Static_assert(MULTIPLEX_GX_SHADOW == 6, "GX shadow command changed");
_Static_assert(MULTIPLEX_GX_GLYPH == 7, "GX glyph command changed");
_Static_assert(MULTIPLEX_GX_PATH_LINE == 8, "GX path line command changed");
_Static_assert(MULTIPLEX_GX_FILL_TRIANGLE == 9,
               "GX fill triangle command changed");

_Static_assert(MULTIPLEX_SCREEN_PAIRING == 0, "pairing screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_HOME == 1, "home screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_LIBRARIES == 2, "libraries screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_BROWSE == 3, "browse screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_SEARCH == 4, "search screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_SEARCH_RESULTS == 5,
               "search results screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_WATCH_TOGETHER_INVITE == 6,
               "Watch Together invite screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_WATCH_TOGETHER == 7,
               "Watch Together screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_WATCH_TOGETHER_ROOM == 8,
               "Watch Together room screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_DETAILS == 9, "details screen ID changed");
_Static_assert(MULTIPLEX_SCREEN_PLAYER == 10, "player screen ID changed");

#define MULTIPLEX_NATIVE_ASSERT_OFFSET(type, field, expected)                  \
  _Static_assert(offsetof(type, field) == (expected),                          \
                 #type "." #field " offset changed")

_Static_assert(_Alignof(MultiplexGxCommand) ==
                   MULTIPLEX_NATIVE_ABI_GX_COMMAND_ALIGNMENT,
               "MultiplexGxCommand alignment changed");
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, kind, 0u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, x, 4u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, y, 8u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, width, 12u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, height, 16u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, x2, 20u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, y2, 24u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, radius, 28u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, stroke_width, 32u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, color_rgba, 36u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, has_clip, 40u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, clip_x, 44u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, clip_y, 48u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, clip_width, 52u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexGxCommand, clip_height, 56u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(
    MultiplexGxCommand, text_ptr,
    MULTIPLEX_NATIVE_ABI_ALIGN_UP(60u, _Alignof(const uint8_t *)));
MULTIPLEX_NATIVE_ASSERT_OFFSET(
    MultiplexGxCommand, text_len,
    MULTIPLEX_NATIVE_ABI_ALIGN_UP(60u, _Alignof(const uint8_t *)) +
        sizeof(const uint8_t *));
MULTIPLEX_NATIVE_ASSERT_OFFSET(
    MultiplexGxCommand, glyph_id,
    MULTIPLEX_NATIVE_ABI_ALIGN_UP(60u, _Alignof(const uint8_t *)) +
        sizeof(const uint8_t *) + sizeof(uint32_t));
MULTIPLEX_NATIVE_ASSERT_OFFSET(
    MultiplexGxCommand, font_size,
    MULTIPLEX_NATIVE_ABI_ALIGN_UP(60u, _Alignof(const uint8_t *)) +
        sizeof(const uint8_t *) + 2u * sizeof(uint32_t));
_Static_assert(
    sizeof(MultiplexGxCommand) ==
        MULTIPLEX_NATIVE_ABI_ALIGN_UP(
            MULTIPLEX_NATIVE_ABI_ALIGN_UP(60u, _Alignof(const uint8_t *)) +
                sizeof(const uint8_t *) + 3u * sizeof(uint32_t),
            MULTIPLEX_NATIVE_ABI_GX_COMMAND_ALIGNMENT),
    "MultiplexGxCommand size changed");

_Static_assert(_Alignof(MultiplexVideoSurface) == _Alignof(float),
               "MultiplexVideoSurface alignment changed");
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, visible, 0u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, playing, 4u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, x, 8u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, y, 12u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, width, 16u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexVideoSurface, height, 20u);
_Static_assert(sizeof(MultiplexVideoSurface) == 24u,
               "MultiplexVideoSurface size changed");

_Static_assert(_Alignof(MultiplexPlayerControlsSurface) == _Alignof(float),
               "MultiplexPlayerControlsSurface alignment changed");
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPlayerControlsSurface, visible, 0u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPlayerControlsSurface, x, 4u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPlayerControlsSurface, y, 8u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPlayerControlsSurface, width, 12u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPlayerControlsSurface, height, 16u);
_Static_assert(sizeof(MultiplexPlayerControlsSurface) == 20u,
               "MultiplexPlayerControlsSurface size changed");

_Static_assert(_Alignof(MultiplexModalSurface) == _Alignof(float),
               "MultiplexModalSurface alignment changed");
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexModalSurface, visible, 0u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexModalSurface, x, 4u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexModalSurface, y, 8u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexModalSurface, width, 12u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexModalSurface, height, 16u);
_Static_assert(sizeof(MultiplexModalSurface) == 20u,
               "MultiplexModalSurface size changed");

_Static_assert(_Alignof(MultiplexPosterSurface) == _Alignof(float),
               "MultiplexPosterSurface alignment changed");
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, image_id, 0u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, focused, 4u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, x, 8u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, y, 12u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, width, 16u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, height, 20u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, radius, 24u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, card_x, 28u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, card_y, 32u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, card_width, 36u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, card_height, 40u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, has_clip, 44u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, clip_x, 48u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, clip_y, 52u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, clip_width, 56u);
MULTIPLEX_NATIVE_ASSERT_OFFSET(MultiplexPosterSurface, clip_height, 60u);
_Static_assert(sizeof(MultiplexPosterSurface) == 64u,
               "MultiplexPosterSurface size changed");

#undef MULTIPLEX_NATIVE_ASSERT_OFFSET
#undef MULTIPLEX_NATIVE_ABI_GX_COMMAND_ALIGNMENT
#undef MULTIPLEX_NATIVE_ABI_MAX2
#undef MULTIPLEX_NATIVE_ABI_ALIGN_UP

uint32_t multiplex_native_abi_version(void);
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
uint32_t
multiplex_native_app_watch_together_invitees_begin(uint32_t available,
                                                   uint32_t invitee_count);
uint32_t multiplex_native_app_watch_together_invitee(uint32_t index,
                                                     uint32_t user_id,
                                                     const uint8_t *name,
                                                     uint32_t name_length);
uint32_t multiplex_native_app_watch_together_invitees_commit(void);
uint32_t multiplex_native_app_watch_together_create_request(
    uint32_t *rating_key, uint32_t *invitee_user_id, uint8_t *title,
    uint32_t title_capacity);
uint32_t multiplex_native_app_watch_together_create_fail(void);
uint32_t multiplex_native_app_watch_together_join_request(void);
uint32_t multiplex_native_app_watch_together_join_commit(uint32_t connected);
uint32_t
multiplex_native_app_watch_together_presence(uint32_t connected,
                                             uint32_t participant_count);
uint32_t multiplex_native_app_watch_together_leave_request(void);
uint32_t multiplex_native_app_watch_together_leave_commit(void);
uint32_t multiplex_native_app_watch_together_reconnect_request(void);
uint32_t multiplex_native_app_watch_together_reconnect_commit(void);
uint32_t multiplex_native_app_watch_together_host(uint32_t host);
uint32_t multiplex_native_app_watch_together_disband_request(void);
uint32_t multiplex_native_app_watch_together_disband_commit(uint32_t deleted);
uint32_t multiplex_native_app_watch_together_playback(
    uint32_t room_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, uint32_t duration_ms, uint32_t offset_ms);
uint32_t multiplex_native_app_playback_state(void);
uint32_t multiplex_native_app_playback_set_paused(uint32_t paused);
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
uint32_t multiplex_native_app_browse_fail(void);
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
uint32_t multiplex_native_app_search_fail(void);
uint32_t multiplex_native_app_details_request(void);
uint32_t multiplex_native_app_details_children_request(uint32_t *rating_key,
                                                       uint32_t *start);
uint32_t multiplex_native_app_details_children_begin(uint32_t rating_key,
                                                     uint32_t start,
                                                     uint32_t total,
                                                     uint32_t item_count);
uint32_t multiplex_native_app_details_child(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent);
uint32_t multiplex_native_app_details_children_commit(void);
uint32_t multiplex_native_app_details_commit(
    const uint8_t *title, uint32_t title_length, const uint8_t *secondary,
    uint32_t secondary_length, const uint8_t *hierarchy,
    uint32_t hierarchy_length, const uint8_t *media_type,
    uint32_t media_type_length, const uint8_t *library, uint32_t library_length,
    const uint8_t *content_rating, uint32_t content_rating_length,
    const uint8_t *facts, uint32_t facts_length, const uint8_t *summary,
    uint32_t summary_length, const uint8_t *genres, uint32_t genres_length,
    const uint8_t *directors, uint32_t directors_length, uint32_t playable);
uint32_t multiplex_native_app_details_fail(void);
uint32_t multiplex_native_app_subtitles(uint32_t count, uint32_t selected,
                                        const uint8_t *labels,
                                        uint32_t label_stride,
                                        const uint8_t *label_lengths);
uint32_t multiplex_native_app_subtitle_selection(void);
uint32_t multiplex_native_app_mark_watched_request(void);
uint32_t multiplex_native_app_mark_watched_commit(uint32_t succeeded);
uint32_t multiplex_native_app_toast(const uint8_t *message,
                                    uint32_t message_length);
uint32_t multiplex_native_app_toast_dismiss(void);
uint32_t multiplex_native_app_player_settings_open(void);
uint32_t multiplex_native_app_boot_diagnostics(const uint8_t *diagnostics,
                                               uint32_t diagnostics_length);
uint32_t multiplex_native_app_stats_for_nerds_enabled(void);
int32_t multiplex_native_app_playback_navigation_request(void);
uint32_t multiplex_native_app_playback_navigation_clear(void);
uint32_t multiplex_native_app_playback_navigate(
    uint32_t rating_key, const uint8_t *title, uint32_t title_length,
    const uint8_t *secondary, uint32_t secondary_length,
    const uint8_t *hierarchy, uint32_t hierarchy_length, uint32_t duration_ms);
uint32_t multiplex_native_app_playback_request(void);
uint32_t multiplex_native_app_playback_offset_request(void);
uint32_t multiplex_native_app_playback_commit(void);
uint32_t multiplex_native_app_playback_advance(uint32_t rating_key,
                                               const uint8_t *title,
                                               uint32_t title_length,
                                               uint32_t duration_ms);
uint32_t multiplex_native_app_playback_fail(void);
uint32_t multiplex_native_app_playback_position(uint32_t position_ms);
uint32_t multiplex_native_app_playback_continue(uint32_t position_ms);
uint32_t multiplex_native_app_playback_complete(void);
uint32_t multiplex_native_app_layout_audit(uint32_t *first_rule,
                                           uint32_t *first_node);
uint32_t multiplex_native_app_poster_inset_audit(void);
uint32_t multiplex_native_app_input(uint32_t action);
uint32_t multiplex_native_app_home_view_state(void);
uint32_t multiplex_native_app_browse_view_start(void);
uint32_t multiplex_native_app_screen(void);
uint32_t multiplex_native_video_surface(MultiplexVideoSurface *output);
uint32_t multiplex_native_player_controls_surface(
    MultiplexPlayerControlsSurface *output);
uint32_t multiplex_native_modal_surface(MultiplexModalSurface *output);
uint32_t multiplex_native_poster_surfaces(MultiplexPosterSurface *output,
                                          uint32_t capacity);
void multiplex_native_reference_text_overlay(uint32_t enabled);
uint32_t multiplex_native_app_render(MultiplexGxCommand *output,
                                     uint32_t capacity);
uint32_t multiplex_native_reference_pixel_bytes(void);
uint32_t multiplex_native_reference_render_stage(void);
uint32_t multiplex_native_reference_dirty_bounds(float *x, float *y,
                                                 float *width, float *height,
                                                 uint32_t *full_repaint);
uint32_t multiplex_native_reference_memo_hits(void);
uint32_t multiplex_native_reference_memo_misses(void);
uint32_t multiplex_native_reference_memo_bytes(void);
uint32_t multiplex_native_reference_memo_peak_bytes(void);
uint32_t multiplex_native_reference_memo_clear(void);
uint32_t multiplex_native_app_init_and_render_reference(
    uint8_t *pixels, uint32_t pixels_capacity, uint8_t *scratch,
    uint32_t scratch_capacity);
uint32_t multiplex_native_app_render_reference(uint8_t *pixels,
                                               uint32_t pixels_capacity,
                                               uint8_t *scratch,
                                               uint32_t scratch_capacity);

#endif
