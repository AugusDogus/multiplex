#include "app_state.h"
#include "config.h"
#include "gateway_client.h"
#include "media_player.h"

#include <kos.h>

#include <malloc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

KOS_INIT_FLAGS(INIT_DEFAULT | INIT_NET);

enum {
  FRAME_WIDTH = 640,
  FRAME_HEIGHT = 480,
  TEXTURE_WIDTH = 1024,
  TEXTURE_HEIGHT = 512,
  TEXTURE_BYTES = TEXTURE_WIDTH * TEXTURE_HEIGHT * 2,
};

#define COLOR_BACKGROUND UINT16_C(0x0841)
#define COLOR_SURFACE UINT16_C(0x18e3)
#define COLOR_BORDER UINT16_C(0x39e7)
#define COLOR_TEXT UINT16_C(0xffff)
#define COLOR_MUTED UINT16_C(0x94b2)
#define COLOR_ACCENT UINT16_C(0xf945)
#define COLOR_ACCENT_DARK UINT16_C(0xa8c4)

static uint16_t *canvas;
static pvr_ptr_t texture;
static pvr_poly_hdr_t texture_header;
static DreamcastAppState app;

static void fill_rect(int x, int y, int width, int height, uint16_t color) {
  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > FRAME_WIDTH) {
    width = FRAME_WIDTH - x;
  }
  if (y + height > FRAME_HEIGHT) {
    height = FRAME_HEIGHT - y;
  }
  if (width <= 0 || height <= 0) {
    return;
  }

  for (int row = 0; row < height; ++row) {
    uint16_t *pixel = canvas + (size_t)(y + row) * TEXTURE_WIDTH + x;
    for (int column = 0; column < width; ++column) {
      pixel[column] = color;
    }
  }
}

static void stroke_rect(int x, int y, int width, int height, int stroke,
                        uint16_t color) {
  fill_rect(x, y, width, stroke, color);
  fill_rect(x, y + height - stroke, width, stroke, color);
  fill_rect(x, y, stroke, height, color);
  fill_rect(x + width - stroke, y, stroke, height, color);
}

static void draw_text(int x, int y, uint16_t color, const char *text) {
  if (text == NULL || x < 0 || y < 0 || x >= FRAME_WIDTH ||
      y + BFONT_HEIGHT > FRAME_HEIGHT) {
    return;
  }
  bfont_draw_str_ex(canvas + (size_t)y * TEXTURE_WIDTH + x, TEXTURE_WIDTH,
                    color, COLOR_BACKGROUND, 16, false, text);
}

static void draw_bounded_text(int x, int y, uint16_t color, const char *text,
                              size_t maximum) {
  char bounded[DREAMCAST_GATEWAY_TITLE_CAPACITY];
  if (maximum >= sizeof(bounded)) {
    maximum = sizeof(bounded) - 1u;
  }
  snprintf(bounded, maximum + 1u, "%s", text == NULL ? "" : text);
  draw_text(x, y, color, bounded);
}

static void draw_header(const char *page_title) {
  draw_text(24, 20, COLOR_TEXT, "MULTIPLEX");
  if (page_title != NULL) {
    draw_text(260, 20, COLOR_MUTED, page_title);
  }
  fill_rect(20, 54, 600, 2, COLOR_BORDER);
}

static void draw_pairing(void) {
  draw_header(NULL);
  draw_text(100, 148, COLOR_TEXT, "Connect to your Multiplex console gateway");
  draw_text(92, 190, COLOR_MUTED,
            "The gateway provides your Plex catalog and media.");
  fill_rect(176, 240, 288, 64, COLOR_ACCENT_DARK);
  stroke_rect(176, 240, 288, 64, 3, COLOR_ACCENT);
  draw_text(218, 260, COLOR_TEXT, "LOAD PLEX CATALOG");
  draw_text(164, 356, COLOR_MUTED, "Press A to connect");
}

static void draw_status(const char *title, const char *message) {
  draw_header(title);
  draw_bounded_text(92, 190, COLOR_TEXT, message, 46);
  draw_text(92, 232, COLOR_MUTED,
            "Network and transcode work may take a moment.");
}

static uint16_t item_color(uint32_t rating_key) {
  const uint16_t red = (uint16_t)((rating_key * 3u) & 0x1fu);
  const uint16_t green = (uint16_t)((rating_key * 5u) & 0x3fu);
  const uint16_t blue = (uint16_t)((rating_key * 7u) & 0x1fu);
  return (uint16_t)((red << 11u) | (green << 5u) | blue);
}

static void draw_home(void) {
  draw_header(app.catalog.server_name);
  draw_text(24, 82, COLOR_TEXT, "PLEX HOME");

  for (uint16_t index = 0; index < app.catalog.item_count; ++index) {
    const DreamcastGatewayItem *item = &app.catalog.items[index];
    const int x = 38 + (int)index * 151;
    const int y = 120;
    fill_rect(x, y, 112, 168, item_color(item->rating_key));
    fill_rect(x + 10, y + 12, 92, 4, COLOR_TEXT);
    fill_rect(x + 10, y + 24, 64, 3, COLOR_MUTED);
    fill_rect(x + 10, y + 142, 92, 12, COLOR_SURFACE);
    if (index == app.selected_item) {
      stroke_rect(x - 5, y - 5, 122, 178, 4, COLOR_ACCENT);
    }
    draw_bounded_text(x, 306,
                      index == app.selected_item ? COLOR_TEXT : COLOR_MUTED,
                      item->title, 15);
    draw_bounded_text(x, 334, COLOR_MUTED, item->subtitle, 15);
  }

  draw_text(24, 424, COLOR_MUTED,
            "D-PAD  Navigate    A  Details    B  Disconnect");
}

static void draw_details(void) {
  const DreamcastGatewayItem *item = dreamcast_app_selected_item(&app);
  draw_header("DETAILS");
  if (item == NULL) {
    draw_text(24, 100, COLOR_TEXT, "Selected item unavailable");
    return;
  }

  fill_rect(44, 92, 154, 231, item_color(item->rating_key));
  stroke_rect(44, 92, 154, 231, 2, COLOR_BORDER);
  draw_bounded_text(236, 108, COLOR_TEXT, item->title, 31);
  draw_bounded_text(236, 146, COLOR_MUTED, item->subtitle, 31);
  draw_text(236, 194, COLOR_MUTED, "Dreamcast MPEG-1 playback");
  fill_rect(236, 250, 144, 56, COLOR_ACCENT_DARK);
  stroke_rect(236, 250, 144, 56, 3, COLOR_ACCENT);
  draw_text(278, 268, COLOR_TEXT, "PLAY");
  draw_bounded_text(236, 330, COLOR_TEXT, app.message, 31);
  draw_text(24, 424, COLOR_MUTED, "A  Play    B  Back");
}

static void draw_error(void) {
  draw_header("CONNECTION ERROR");
  draw_bounded_text(72, 170, COLOR_TEXT, app.message, 52);
  draw_text(72, 220, COLOR_MUTED,
            "Check the gateway URL, server, and network adapter.");
  draw_text(72, 278, COLOR_MUTED, "A  Retry    B  Back");
}

static void render_app(void) {
  memset(canvas, 0, TEXTURE_BYTES);
  fill_rect(0, 0, FRAME_WIDTH, FRAME_HEIGHT, COLOR_BACKGROUND);
  switch (app.screen) {
  case DREAMCAST_APP_SCREEN_PAIRING:
    draw_pairing();
    break;
  case DREAMCAST_APP_SCREEN_CONNECTING:
    draw_status("CONNECTING", app.message);
    break;
  case DREAMCAST_APP_SCREEN_HOME:
    draw_home();
    break;
  case DREAMCAST_APP_SCREEN_DETAILS:
    draw_details();
    break;
  case DREAMCAST_APP_SCREEN_PREPARING_PLAYBACK:
    draw_status("PLAYBACK", app.message);
    break;
  case DREAMCAST_APP_SCREEN_ERROR:
    draw_error();
    break;
  }
  pvr_txr_load(canvas, texture, TEXTURE_BYTES);
}

static int initialize_pvr(void) {
  const pvr_init_params_t parameters = {
      {PVR_BINSIZE_16, PVR_BINSIZE_0, PVR_BINSIZE_0, PVR_BINSIZE_0,
       PVR_BINSIZE_0},
      256 * 1024,
      0,
      0,
      0,
      0,
      0,
  };
  if (pvr_init(&parameters) < 0) {
    return 0;
  }

  canvas = memalign(32, TEXTURE_BYTES);
  texture = pvr_mem_malloc(TEXTURE_BYTES);
  if (canvas == NULL || texture == NULL) {
    free(canvas);
    canvas = NULL;
    if (texture != NULL) {
      pvr_mem_free(texture);
      texture = NULL;
    }
    pvr_shutdown();
    return 0;
  }

  pvr_poly_cxt_t context;
  pvr_poly_cxt_txr(&context, PVR_LIST_OP_POLY,
                   PVR_TXRFMT_RGB565 | PVR_TXRFMT_NONTWIDDLED, TEXTURE_WIDTH,
                   TEXTURE_HEIGHT, texture, PVR_FILTER_NONE);
  pvr_poly_compile(&texture_header, &context);
  pvr_set_bg_color(0.0f, 0.0f, 0.0f);
  bfont_set_encoding(BFONT_CODE_ISO8859_1);
  return 1;
}

static void present_frame(void) {
  const float right_u = (float)FRAME_WIDTH / (float)TEXTURE_WIDTH;
  const float bottom_v = (float)FRAME_HEIGHT / (float)TEXTURE_HEIGHT;
  pvr_vertex_t vertex;

  pvr_wait_ready();
  pvr_scene_begin();
  pvr_list_begin(PVR_LIST_OP_POLY);
  pvr_prim(&texture_header, sizeof(texture_header));

  vertex.flags = PVR_CMD_VERTEX;
  vertex.x = 0.0f;
  vertex.y = (float)FRAME_HEIGHT;
  vertex.z = 1.0f;
  vertex.u = 0.0f;
  vertex.v = bottom_v;
  vertex.argb = 0xffffffffu;
  vertex.oargb = 0;
  pvr_prim(&vertex, sizeof(vertex));

  vertex.y = 0.0f;
  vertex.v = 0.0f;
  pvr_prim(&vertex, sizeof(vertex));

  vertex.x = (float)FRAME_WIDTH;
  vertex.y = (float)FRAME_HEIGHT;
  vertex.u = right_u;
  vertex.v = bottom_v;
  pvr_prim(&vertex, sizeof(vertex));

  vertex.flags = PVR_CMD_VERTEX_EOL;
  vertex.y = 0.0f;
  vertex.v = 0.0f;
  pvr_prim(&vertex, sizeof(vertex));

  pvr_list_finish();
  pvr_scene_finish();
}

static void log_state(const char *action) {
  const DreamcastGatewayItem *item = dreamcast_app_selected_item(&app);
  dbglog(DBG_INFO,
         "MULTIPLEX DREAMCAST: input action=%s screen=%u focus=%u "
         "rating_key=%lu\n",
         action, (unsigned)app.screen, (unsigned)app.selected_item,
         item == NULL ? 0ul : (unsigned long)item->rating_key);
}

static void load_catalog(void) {
  DreamcastGatewayCatalog catalog;
  char error[DREAMCAST_GATEWAY_MESSAGE_CAPACITY];
  if (dreamcast_gateway_load_catalog(DREAMCAST_GATEWAY_URL, &catalog, error,
                                     sizeof(error)) &&
      dreamcast_app_receive_catalog(&app, &catalog)) {
    dbglog(DBG_INFO,
           "MULTIPLEX DREAMCAST: catalog loaded server=%s items=%u first=%lu\n",
           catalog.server_name, (unsigned)catalog.item_count,
           (unsigned long)catalog.items[0].rating_key);
    return;
  }
  dreamcast_app_receive_error(&app, error);
  dbglog(DBG_ERROR, "MULTIPLEX DREAMCAST: catalog failed error=%s\n", error);
}

static void play_selected_item(void) {
  const DreamcastGatewayItem *item = dreamcast_app_selected_item(&app);
  if (item == NULL) {
    dreamcast_app_finish_playback(&app, "Selected item unavailable");
    return;
  }
  const uint32_t rating_key = item->rating_key;
  const uint32_t duration_ms = item->duration_ms;
  uint32_t offset_ms = item->view_offset_ms;
  char error[DREAMCAST_GATEWAY_MESSAGE_CAPACITY];
  DreamcastMediaResult media_result = DREAMCAST_MEDIA_FINISHED;

  do {
    DreamcastGatewayPlayback playback;
    if (!dreamcast_gateway_load_playback(DREAMCAST_GATEWAY_URL, rating_key,
                                         offset_ms, &playback, error,
                                         sizeof(error)) ||
        !dreamcast_gateway_download_media(&playback, "/ram/multiplex.mpg",
                                          error, sizeof(error))) {
      dreamcast_app_finish_playback(&app, error);
      dbglog(DBG_ERROR, "MULTIPLEX DREAMCAST: playback failed error=%s\n",
             error);
      return;
    }
    dbglog(DBG_INFO,
           "MULTIPLEX DREAMCAST: playback segment rating_key=%lu offset=%lu "
           "duration=%lu bytes=%lu\n",
           (unsigned long)rating_key, (unsigned long)playback.segment_start_ms,
           (unsigned long)playback.segment_duration_ms,
           (unsigned long)playback.container_bytes);
    (void)dreamcast_gateway_report_timeline(
        DREAMCAST_GATEWAY_URL, rating_key, playback.segment_start_ms,
        playback.media_duration_ms, "playing");
    media_result = dreamcast_media_play_file("/ram/multiplex.mpg");
    (void)remove("/ram/multiplex.mpg");
    const uint64_t next_offset =
        (uint64_t)playback.segment_start_ms + playback.segment_duration_ms;
    offset_ms = next_offset > UINT32_MAX ? UINT32_MAX : (uint32_t)next_offset;
    (void)dreamcast_gateway_report_timeline(
        DREAMCAST_GATEWAY_URL, rating_key, offset_ms,
        playback.media_duration_ms, "stopped");
    if (media_result != DREAMCAST_MEDIA_FINISHED ||
        next_offset >= playback.media_duration_ms) {
      break;
    }
  } while (offset_ms < duration_ms);

  if (media_result == DREAMCAST_MEDIA_FAILED) {
    dreamcast_app_finish_playback(&app, "Dreamcast MPEG decoder failed");
  } else if (media_result == DREAMCAST_MEDIA_CANCELLED) {
    dreamcast_app_finish_playback(&app, "Playback stopped");
  } else {
    dreamcast_app_finish_playback(&app, "Playback finished");
  }
  dbglog(DBG_INFO, "MULTIPLEX DREAMCAST: playback result=%u\n",
         (unsigned)media_result);
}

static void handle_action(DreamcastAppAction action, const char *name) {
  const DreamcastAppEvent event = dreamcast_app_dispatch(&app, action);
  if (event == DREAMCAST_APP_EVENT_NONE) {
    return;
  }
  log_state(name);
  render_app();
  present_frame();
  if (event == DREAMCAST_APP_EVENT_CONNECT_REQUEST) {
    load_catalog();
  } else if (event == DREAMCAST_APP_EVENT_PLAY_REQUEST) {
    play_selected_item();
  }
  render_app();
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  dbgio_dev_select("scif");
  dbgio_enable();
  if (!initialize_pvr()) {
    dbglog(DBG_ERROR, "MULTIPLEX DREAMCAST: PVR initialization failed\n");
    return 1;
  }

  dreamcast_app_init(&app);
  render_app();
  dbglog(
      DBG_INFO,
      "MULTIPLEX DREAMCAST: app ready screen=pairing gateway=%s network=%s\n",
      DREAMCAST_GATEWAY_URL,
      net_default_dev == NULL ? "unavailable" : net_default_dev->name);

  uint32_t previous_buttons = 0;
  unsigned frames = 0;
  int running = 1;
  while (running) {
    maple_device_t *controller = maple_enum_type(0, MAPLE_FUNC_CONTROLLER);
    const cont_state_t *state =
        controller == NULL ? NULL : maple_dev_status(controller);
    const uint32_t buttons = state == NULL ? 0 : state->buttons;
    const uint32_t pressed = buttons & ~previous_buttons;
    previous_buttons = buttons;

    if ((pressed & (CONT_DPAD_LEFT | CONT_DPAD_UP)) != 0) {
      handle_action(DREAMCAST_APP_ACTION_PREVIOUS, "previous");
    }
    if ((pressed & (CONT_DPAD_RIGHT | CONT_DPAD_DOWN)) != 0) {
      handle_action(DREAMCAST_APP_ACTION_NEXT, "next");
    }
    if ((pressed & CONT_A) != 0) {
      handle_action(DREAMCAST_APP_ACTION_ACTIVATE, "activate");
    }
    if ((pressed & CONT_B) != 0) {
      handle_action(DREAMCAST_APP_ACTION_BACK, "back");
    }
    if ((pressed & CONT_START) != 0) {
      running = 0;
    }

    present_frame();
    ++frames;
    if (frames % 120u == 0) {
      pvr_stats_t stats;
      pvr_get_stats(&stats);
      dbglog(DBG_INFO, "MULTIPLEX DREAMCAST: frames=%u fps=%.1f screen=%u\n",
             frames, (double)stats.frame_rate, (unsigned)app.screen);
    }
  }

  pvr_mem_free(texture);
  free(canvas);
  pvr_shutdown();
  return 0;
}
