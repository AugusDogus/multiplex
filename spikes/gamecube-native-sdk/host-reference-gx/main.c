#include "audio_dma.h"
#include "catalog_cache.h"
#include "device_auth.h"
#include "gateway_client.h"
#include "geist_atlas.h"
#include "gui_navigation.h"
#include "http_client.h"
#include "media-source.h"
#include "memory_card_auth.h"
#include "mpeg_ps_demux.h"
#include "multiplex-dvd-demo-program.h"
#include "native_ui.h"
#include "plex_bootstrap.h"
#include "plex_catalog.h"
#include "plex_hls.h"
#include "plex_hls_demux.h"
#include "poster_jpeg.h"
#include "reference_frame.h"
#include "syncplay_probe.h"
#include "trpc_client.h"
#include "video_decoder.h"
#include "yuv420_gx.h"

#include <gccore.h>
#include <malloc.h>
#include <math.h>
#include <ogc/cond.h>
#include <ogc/consol.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/mutex.h>
#if defined(HW_RVL)
#include <wiiuse/wpad.h>
#endif
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FIFO_SIZE (256 * 1024)
#define LOGICAL_WIDTH 640
#define LOGICAL_HEIGHT 480
#define TILE_WIDTH 160
#define TILE_HEIGHT 120
#define TILE_COLUMNS (LOGICAL_WIDTH / TILE_WIDTH)
#define TILE_ROWS (LOGICAL_HEIGHT / TILE_HEIGHT)
#define TILE_COUNT (TILE_COLUMNS * TILE_ROWS)
#define TILE_BYTES (TILE_WIDTH * TILE_HEIGHT * 4)
#define APP_STACK_SIZE (512 * 1024)
#define VIDEO_DECODER_STACK_SIZE (256 * 1024)
#define MEDIA_PREFETCH_STACK_SIZE (256 * 1024)
#define TIMELINE_REPORT_STACK_SIZE (128 * 1024)
#define POSTER_LOADER_STACK_SIZE (256 * 1024)
#define POSTER_LOADER_LANE_COUNT 4u
#define HLS_SESSION_PREFETCH_STACK_SIZE (128 * 1024)
#define DIRECT_DETAILS_LOADER_STACK_SIZE (256 * 1024)
#define DIRECT_BROWSE_LOADER_STACK_SIZE (256 * 1024)
#define DIRECT_SEARCH_LOADER_STACK_SIZE (256 * 1024)
#define STARTUP_DATA_LOADER_STACK_SIZE (256 * 1024)
#define CATALOG_LOADER_STACK_SIZE (256 * 1024)
#define CATALOG_CACHE_SAVER_STACK_SIZE (128 * 1024)
#define REFERENCE_RENDERER_STACK_SIZE (512 * 1024)
#define NETWORK_WARMUP_STACK_SIZE (64 * 1024)
#define TIMELINE_REPORT_INTERVAL_MS 10000u
#define PAIRING_POLL_INTERVAL_FRAMES 60u
#define MEDIA_STARTUP_STALL_TIMEOUT_US 5000000u
#define MEDIA_STARTUP_RESTART_LIMIT 2u
#define VIDEO_WIDTH 720
#define VIDEO_HEIGHT 480
#define VIDEO_PROFILE_FRAMES 60
#define AUDIO_SAMPLE_RATE 48000
#define MPEG_PTS_RATE 90000
#define VIDEO_RATE_NUMERATOR 30000
#define VIDEO_RATE_DENOMINATOR 1001
#define VIDEO_PREBUFFER_BYTES (64u * 1024u)
/*
 * Keep this below half of the 64 KiB compressed-audio queue. MPEG-PS packets
 * are interleaved, so waiting for exactly 32 KiB can leave the producer
 * blocked on a full video queue with audio only a few bytes short.
 */
#define AUDIO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_VIDEO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_AUDIO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_READINESS_TIMEOUT_MS 60000u
#define WATCH_TOGETHER_AUTO_START_DELAY_MS 1200u
#define WATCH_TOGETHER_RECONNECT_DELAY_MS 1000u
#define CATALOG_RETRY_INITIAL_DELAY_MS 1000u
#define CATALOG_RETRY_MAX_DELAY_MS 8000u
#define STARTUP_DATA_IDLE_DELAY_MS 2000u
#define DETAILS_PREFETCH_IDLE_DELAY_MS 250u
#define SEGMENT_PREFETCH_MARGIN_MS 8000u
#define SEGMENT_HANDOFF_MARGIN_MS 64u
#define DIRECT_PLAYBACK_END_MARGIN_MS 64u
#define PLAYER_CONTROLS_IDLE_MS 4000u
#define PLAYER_CONTROLS_FADE_MS 180u
#define UI_ENTRY_FRAMES 6u
#define POSTER_FOCUS_FRAMES 1u
#define HOME_MOTION_FRAMES 9u
#define HOME_CONTENT_TOP 64.0f
#define HOME_ACTIVE_CARD_TOP 84.0f
#define HOME_ACTIVE_SHELF_BOTTOM 232.0f
#define HOME_CARD_STRIDE 80.0f
#define HOME_SHELF_STRIDE 168.0f
#define HOME_CAROUSEL_LEFT 20.0f
#define HOME_CAROUSEL_RIGHT 620.0f
#define BROWSE_GRID_TOP 118.0f
#define BROWSE_ROW_STRIDE 155.0f
#define MULTIPLEX_SCREEN_HOME 1u
#define MULTIPLEX_SCREEN_BROWSE 3u
#define MULTIPLEX_SCREEN_SEARCH_RESULTS 5u
#define MULTIPLEX_SCREEN_DETAILS 9u
#define MULTIPLEX_SCREEN_PLAYER 10u
#define MULTIPLEX_PAIRING_CONNECTING 4u
#define POSTER_JPEG_CAPACITY (256u * 1024u)
#define PLEX_POSTER_JPEG_CAPACITY (32u * 1024u)
#define HOME_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS
#define BROWSE_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS
#define POSTER_TEXTURE_COUNT (HOME_POSTER_COUNT + BROWSE_POSTER_COUNT)
#define POSTER_SURFACE_CAPACITY 24u
#define UI_COMMAND_CAPACITY 1024u
#define UI_TEXT_COMMAND_CAPACITY 96u
#define UI_SHAPE_COMMAND_CAPACITY 896u
#define UI_TEXT_CAPACITY 4096u

typedef enum {
  APP_EXIT_OK = 0,
  APP_EXIT_VIDEO_INIT = 10,
  APP_EXIT_JPEG_INIT = 11,
  APP_EXIT_BUFFER_INIT = 12,
  APP_EXIT_UI_BIND = 20,
  APP_EXIT_UI_RENDER = 21,
  APP_EXIT_BACKGROUND_BIND = 22,
  APP_EXIT_MEDIA_PRODUCER = 30,
  APP_EXIT_MEDIA_RECOVERY = 31,
  APP_EXIT_PLAYBACK_CONTINUATION = 32,
} AppExitCode;

typedef struct {
  MultiplexGxCommand text_commands[UI_TEXT_COMMAND_CAPACITY];
  MultiplexGxCommand shape_commands[UI_SHAPE_COMMAND_CAPACITY];
  uint32_t text_sequences[UI_TEXT_COMMAND_CAPACITY];
  uint32_t shape_sequences[UI_SHAPE_COMMAND_CAPACITY];
  uint8_t text[UI_TEXT_CAPACITY];
  uint32_t text_command_count;
  uint32_t shape_command_count;
  uint32_t text_length;
} NativeUiPacket;

typedef enum {
  HOME_MOTION_NONE = 0,
  HOME_MOTION_HORIZONTAL = 1,
  HOME_MOTION_VERTICAL = 2,
} HomeMotionKind;

typedef struct {
  uint32_t render_us;
  uint32_t upload_us;
  uint32_t commands;
  uint32_t passes;
  uint32_t signature;
  uint32_t memo_hits;
  uint32_t memo_misses;
  uint32_t text_us;
} FrameProfile;

typedef struct {
  lwp_t thread;
  void *stack;
  MultiplexReferenceFrameRender render;
  MultiplexReferenceFrameStatus status;
  NativeUiPacket ui_packet;
  uint32_t render_us;
  uint32_t text_us;
  bool audit;
  volatile bool complete;
} ReferenceFrameRenderer;

typedef struct {
  lwp_t thread;
  void *stack;
  bool ready;
  volatile bool complete;
} NetworkWarmup;

static GXRModeObj *video_mode;
static void *framebuffers[2];
static unsigned framebuffer_index;
static void *gx_fifo;
static MultiplexReferenceFrame reference_frame;
static uint8_t *texture_pixels_allocation;
static uint8_t *texture_pixels;
static GXTexObj textures[TILE_COUNT];
static bool reference_tile_active[TILE_COUNT];
static GXTexObj font_texture;
static GXTexObj poster_textures[POSTER_TEXTURE_COUNT];
static uint8_t *poster_texture_pixels;
static uint16_t poster_texture_count;
static uint32_t poster_texture_rating_keys[POSTER_TEXTURE_COUNT];
static MultiplexVideoSurface video_surface;
static MultiplexPlayerControlsSurface player_controls_surface;
static MultiplexModalSurface modal_surface;
static MultiplexPosterSurface poster_surfaces[POSTER_SURFACE_CAPACITY];
static uint32_t poster_surface_count;
static float focused_poster_x = -1.0f;
static float focused_poster_y = -1.0f;
static uint8_t poster_focus_frame = POSTER_FOCUS_FRAMES;
static MultiplexGatewayDetails direct_details_cache;
static bool direct_details_cache_valid;
static uint32_t presented_screen = UINT32_MAX;
static bool asynchronous_reference_enabled;
static bool asynchronous_reference_requested;
static ReferenceFrameRenderer reference_renderer;
static bool network_activity_visible;
static bool blocking_activity_visible;
static uint32_t network_activity_frame;
static uint32_t screen_transition_frame;
static uint8_t ui_entry_frame = UI_ENTRY_FRAMES;
static bool native_frame_dirty = true;
static uint8_t ui_frame_alpha = 255;
static bool player_controls_overlay_visible = true;
static bool player_startup_backdrop_visible;
static MultiplexGuiNavigation gui_navigation;
static FrameProfile profile;
static NativeUiPacket presented_ui_packet;
static NativeUiPacket home_motion_previous_packet;
static MultiplexPosterSurface
    home_motion_previous_surfaces[POSTER_SURFACE_CAPACITY];
static uint32_t home_motion_previous_surface_count;
static HomeMotionKind home_motion_kind;
static int8_t home_motion_direction;
static uint8_t home_motion_frame = HOME_MOTION_FRAMES;
static int8_t browse_motion_pending_direction;
static bool ui_draw_clip_active;
static float ui_draw_clip_left;
static float ui_draw_clip_top;
static float ui_draw_clip_right;
static float ui_draw_clip_bottom;
static float ui_draw_translation_x;
static float ui_draw_translation_y;
static uint32_t presentation_frames;
static uint32_t presentation_started;
static uint32_t profile_stage_started;
static uint32_t profile_stage_current;
static uint32_t profile_stage_us[7];
static bool controller_status_reported;
static uint32_t video_frame_count;
static uint32_t video_frame_started;
static uint64_t video_audio_start_samples;
static uint32_t video_audio_start_completions;
static bool video_audio_clock_started;
static int64_t video_pts_offset_samples;
static uint32_t video_decode_total_us;
static uint32_t video_decode_max_us;
static uint32_t video_codec_total_us;
static uint32_t video_codec_max_us;
static uint32_t video_upload_total_us;
static uint32_t video_upload_max_us;
static uint32_t diagnostic_decoder_fps_tenths;
static uint32_t diagnostic_codec_average_us;
static uint32_t diagnostic_codec_max_us;
static uint32_t diagnostic_upload_average_us;
static uint32_t diagnostic_presentation_fps_tenths;
static uint32_t diagnostic_network_kib_per_second;
static uint32_t diagnostic_network_last_bytes;
static uint32_t diagnostic_network_started;
static VideoDecoder *video_decoder;
static lwp_t video_decoder_thread = LWP_THREAD_NULL;
static void *video_decoder_stack;
static mutex_t video_decoder_mutex;
static cond_t video_decoder_condition;
static bool video_decoder_sync_ready;
static bool video_decode_requested;
static bool video_decode_running;
static bool video_decode_ready;
static bool video_decode_failed;
static bool video_decoder_stopping;
static uint32_t video_decode_ready_us;
static uint32_t video_codec_ready_us;
static uint32_t video_upload_ready_us;
static uint32_t video_decode_request_count;
static uint32_t video_decode_completion_count;
static bool video_texture_ready;
static bool video_was_playing;
static unsigned video_content_width;
static unsigned video_content_height;
static uint32_t video_rate_millihertz =
    (VIDEO_RATE_NUMERATOR * 1000u) / VIDEO_RATE_DENOMINATOR;
static AudioDma *audio_output;
static MpegPsDemux *media_demux;
static PlexHlsDemux *direct_hls_demux;
static char direct_hls_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
static uint32_t direct_subtitle_indices[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS];
static uint8_t direct_subtitle_count;
static bool direct_subtitle_override_pending;
static bool direct_subtitle_override_burn;
static uint32_t direct_subtitle_override_index;
static bool direct_playback_start_offset_pending =
    MULTIPLEX_PLAYBACK_START_OFFSET_MS != 0;

typedef struct {
  const char *gateway_url;
  uint32_t rating_key;
  uint32_t offset_ms;
  MultiplexGatewayPlaybackManifest manifest;
  HttpClient *client;
  MpegPsDemux *demux;
  lwp_t thread;
  void *stack;
  volatile bool ready;
  volatile bool failed;
} StagedMediaSession;

typedef struct {
  const char *gateway_url;
  const MultiplexAuthCredentials *plex_credentials;
  char plex_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  const char *state;
  lwp_t thread;
  void *stack;
  volatile bool complete;
  volatile bool succeeded;
  uint32_t last_rating_key;
  uint32_t last_position_ms;
  const char *last_state;
} TimelineReporter;

typedef struct {
  uint32_t rating_key;
  uint32_t segment_start_ms;
  uint32_t started_tick;
  uint32_t last_video_bytes;
  uint32_t last_audio_bytes;
  unsigned restart_count;
  bool timing;
  bool playback_started;
} MediaStartupWatchdog;

typedef struct DirectPosterLoader DirectPosterLoader;

typedef struct {
  DirectPosterLoader *loader;
  uint16_t lane;
} DirectPosterWorker;

struct DirectPosterLoader {
  const MultiplexAuthCredentials *credentials;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  uint16_t texture_slots[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  lwp_t threads[POSTER_LOADER_LANE_COUNT];
  void *stacks[POSTER_LOADER_LANE_COUNT];
  uint8_t *decoded_pixels[POSTER_LOADER_LANE_COUNT];
  DirectPosterWorker workers[POSTER_LOADER_LANE_COUNT];
  volatile bool item_ready[POSTER_LOADER_LANE_COUNT];
  volatile bool item_decoded[POSTER_LOADER_LANE_COUNT];
  volatile bool complete[POSTER_LOADER_LANE_COUNT];
  volatile bool stopping;
  bool pending;
  volatile uint16_t item_index[POSTER_LOADER_LANE_COUNT];
  volatile uint16_t decoded_count[POSTER_LOADER_LANE_COUNT];
  uint16_t lane_count;
  uint16_t item_count;
  uint16_t requested_count;
  uint16_t cache_hits;
  uint16_t texture_offset;
  uint32_t started_tick;
  bool first_ready_reported;
};

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexPlexHlsSession session;
  HlsMediaPlaylist playlist;
  lwp_t thread;
  void *stack;
  uint32_t rating_key;
  uint32_t offset_ms;
  uint32_t subtitle_stream_index;
  uint32_t started_tick;
  bool burn_subtitles;
  bool started;
  volatile bool complete;
  volatile bool ready;
} DirectHlsSessionPrefetch;

static DirectHlsSessionPrefetch direct_hls_prefetch;

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexGatewayDetails details;
  lwp_t thread;
  void *stack;
  uint32_t rating_key;
  volatile bool complete;
  bool started;
  bool ready;
  bool foreground;
} DirectDetailsLoader;

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexGatewayLibrary library;
  MultiplexGatewayBrowsePage page;
  lwp_t thread;
  void *stack;
  uint32_t started_tick;
  uint16_t start;
  volatile bool complete;
  bool started;
  bool ready;
} DirectBrowseLoader;

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexGatewaySearchPage page;
  lwp_t thread;
  void *stack;
  uint32_t started_tick;
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
  uint16_t query_length;
  volatile bool complete;
  bool started;
  bool ready;
} DirectSearchLoader;

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexTrpcRoomList rooms;
  MultiplexTrpcInviteeList invitees;
  uint32_t user_id;
  lwp_t thread;
  void *stack;
  volatile bool complete;
  bool started;
  bool applied;
  bool user_available;
  bool rooms_available;
  bool invitees_available;
} StartupDataLoader;

typedef struct {
  const MultiplexAuthCredentials *credentials;
  MultiplexGatewayCatalog *catalog;
  lwp_t thread;
  void *stack;
  volatile bool complete;
  bool started;
  bool available;
} CatalogLoader;

typedef struct {
  MultiplexMemoryCardLocation location;
  uint8_t bytes[MULTIPLEX_CATALOG_CACHE_SIZE];
  lwp_t thread;
  void *stack;
  volatile bool complete;
  bool started;
  MultiplexMemoryCardResult result;
} CatalogCacheSaver;

typedef enum {
  CATALOG_LOADER_IDLE = 0,
  CATALOG_LOADER_LOADING,
  CATALOG_LOADER_READY,
  CATALOG_LOADER_FAILED,
} CatalogLoaderStatus;

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size);
static void discard_staged_media_session(StagedMediaSession *staged);
static bool
load_direct_item_children(const MultiplexAuthCredentials *credentials);

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

static uint32_t navigation_action(MultiplexGuiNavigationDirection direction) {
  switch (direction) {
  case MULTIPLEX_GUI_NAVIGATION_LEFT:
    return 0;
  case MULTIPLEX_GUI_NAVIGATION_RIGHT:
    return 1;
  case MULTIPLEX_GUI_NAVIGATION_UP:
    return 8;
  case MULTIPLEX_GUI_NAVIGATION_DOWN:
    return 9;
  case MULTIPLEX_GUI_NAVIGATION_NONE:
    return UINT32_MAX;
  }
  return UINT32_MAX;
}

#if defined(HW_RVL)
static uint32_t wii_buttons_as_gamecube(uint32_t buttons) {
  uint32_t mapped = 0;
  if ((buttons & (WPAD_BUTTON_LEFT | WPAD_CLASSIC_BUTTON_LEFT)) != 0) {
    mapped |= PAD_BUTTON_LEFT;
  }
  if ((buttons & (WPAD_BUTTON_RIGHT | WPAD_CLASSIC_BUTTON_RIGHT)) != 0) {
    mapped |= PAD_BUTTON_RIGHT;
  }
  if ((buttons & (WPAD_BUTTON_UP | WPAD_CLASSIC_BUTTON_UP)) != 0) {
    mapped |= PAD_BUTTON_UP;
  }
  if ((buttons & (WPAD_BUTTON_DOWN | WPAD_CLASSIC_BUTTON_DOWN)) != 0) {
    mapped |= PAD_BUTTON_DOWN;
  }
  if ((buttons & (WPAD_BUTTON_A | WPAD_CLASSIC_BUTTON_A)) != 0) {
    mapped |= PAD_BUTTON_A;
  }
  if ((buttons & (WPAD_BUTTON_B | WPAD_CLASSIC_BUTTON_B)) != 0) {
    mapped |= PAD_BUTTON_B;
  }
  if ((buttons & (WPAD_BUTTON_2 | WPAD_CLASSIC_BUTTON_X)) != 0) {
    mapped |= PAD_BUTTON_X;
  }
  if ((buttons & (WPAD_BUTTON_1 | WPAD_CLASSIC_BUTTON_Y)) != 0) {
    mapped |= PAD_BUTTON_Y;
  }
  if ((buttons & (WPAD_BUTTON_MINUS | WPAD_CLASSIC_BUTTON_ZR)) != 0) {
    mapped |= PAD_TRIGGER_Z;
  }
  if ((buttons & (WPAD_BUTTON_HOME | WPAD_CLASSIC_BUTTON_FULL_L)) != 0) {
    mapped |= PAD_TRIGGER_L;
  }
  if ((buttons & (WPAD_BUTTON_PLUS | WPAD_CLASSIC_BUTTON_FULL_R)) != 0) {
    mapped |= PAD_TRIGGER_R;
  }
  if ((buttons & WPAD_CLASSIC_BUTTON_PLUS) != 0) {
    mapped |= PAD_BUTTON_START;
  }
  return mapped;
}
#endif

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  SYS_Report("REFERENCE GX: input action=%u focus=%u count=%u message=%u\n",
             action, focus, count, message);
}

void *multiplex_native_cache_alloc(uint32_t len, uint32_t alignment) {
  if (len == 0 || alignment == 0 || (alignment & (alignment - 1u)) != 0) {
    return NULL;
  }
  if (alignment < sizeof(void *)) {
    alignment = sizeof(void *);
  }
  const uint32_t overhead = alignment - 1u + sizeof(void *);
  if (len > UINT32_MAX - overhead) {
    return NULL;
  }
  uint8_t *allocation = malloc(len + overhead);
  if (allocation == NULL) {
    return NULL;
  }
  const uintptr_t aligned =
      ((uintptr_t)allocation + sizeof(void *) + alignment - 1u) &
      ~(uintptr_t)(alignment - 1u);
  ((void **)aligned)[-1] = allocation;
  return (void *)aligned;
}

void multiplex_native_cache_free(void *memory) {
  if (memory != NULL) {
    free(((void **)memory)[-1]);
  }
}

void multiplex_native_profile_mark(uint32_t stage) {
  const uint32_t now = gettick();
  if (profile_stage_current >= 1 && profile_stage_current <= 6) {
    profile_stage_us[profile_stage_current] +=
        (uint32_t)ticks_to_microsecs(now - profile_stage_started);
  }
  profile_stage_current = stage == 7 ? 0 : stage;
  profile_stage_started = now;
}

static bool allocate_buffers(void) {
  const MultiplexReferenceFrameStatus frame_status =
      multiplex_reference_frame_initialize(
          &reference_frame, LOGICAL_WIDTH * LOGICAL_HEIGHT * 4u);
  if (frame_status != MULTIPLEX_REFERENCE_FRAME_OK) {
    SYS_Report("REFERENCE GX: Native frame initialization failed: %s\n",
               multiplex_reference_frame_status_name(frame_status));
    return false;
  }

  texture_pixels_allocation = malloc(TILE_COUNT * TILE_BYTES + 31u);
  if (texture_pixels_allocation == NULL) {
    SYS_Report("REFERENCE GX: buffer allocation failed\n");
    return false;
  }

  texture_pixels = (uint8_t *)(((uintptr_t)texture_pixels_allocation + 31u) &
                               ~(uintptr_t)31u);
  memset(texture_pixels, 0, TILE_COUNT * TILE_BYTES);
  return true;
}

static void profile_decoded_frame(uint32_t decode_us, uint32_t codec_us,
                                  uint32_t upload_us) {
  video_decode_total_us += decode_us;
  if (decode_us > video_decode_max_us) {
    video_decode_max_us = decode_us;
  }
  video_codec_total_us += codec_us;
  if (codec_us > video_codec_max_us) {
    video_codec_max_us = codec_us;
  }
  video_upload_total_us += upload_us;
  if (upload_us > video_upload_max_us) {
    video_upload_max_us = upload_us;
  }
  if (video_frame_count == 0) {
    video_frame_started = gettick();
  }
  video_frame_count += 1;
  if (video_frame_count == VIDEO_PROFILE_FRAMES) {
    const uint32_t measured_us = elapsed_us(video_frame_started);
    const uint32_t fps_tenths =
        measured_us == 0
            ? 0
            : (uint32_t)(((VIDEO_PROFILE_FRAMES - 1u) * 10000000ull) /
                         measured_us);
    diagnostic_decoder_fps_tenths = fps_tenths;
    diagnostic_codec_average_us =
        video_codec_total_us / VIDEO_PROFILE_FRAMES;
    diagnostic_codec_max_us = video_codec_max_us;
    diagnostic_upload_average_us =
        video_upload_total_us / VIDEO_PROFILE_FRAMES;
    SYS_Report("REFERENCE GX: decoder=%u frames/%uus (%u.%u fps) "
               "bytes=%llu work=%u avg/%u max us codec=%u/%u upload=%u/%u\n",
               VIDEO_PROFILE_FRAMES, measured_us, fps_tenths / 10,
               fps_tenths % 10, video_decoder_stream_offset(video_decoder),
               video_decode_total_us / VIDEO_PROFILE_FRAMES,
               video_decode_max_us, video_codec_total_us / VIDEO_PROFILE_FRAMES,
               video_codec_max_us, video_upload_total_us / VIDEO_PROFILE_FRAMES,
               video_upload_max_us);
    video_frame_count = 0;
    video_decode_total_us = 0;
    video_decode_max_us = 0;
    video_codec_total_us = 0;
    video_codec_max_us = 0;
    video_upload_total_us = 0;
    video_upload_max_us = 0;
  }
}

static void *run_video_decoder(void *unused) {
  (void)unused;

  LWP_MutexLock(video_decoder_mutex);
  while (!video_decoder_stopping) {
    while (!video_decode_requested && !video_decoder_stopping) {
      LWP_CondWait(video_decoder_condition, video_decoder_mutex);
    }
    if (video_decoder_stopping) {
      break;
    }

    video_decode_requested = false;
    LWP_MutexUnlock(video_decoder_mutex);

    const uint32_t decode_started = gettick();
    VideoFrame frame;
    const bool frame_decoded = video_decoder_next_frame(video_decoder, &frame);
    const uint32_t codec_us = elapsed_us(decode_started);
    const uint32_t upload_started = gettick();
    const bool decoded = frame_decoded && yuv420_gx_upload_back(&frame);
    const uint32_t upload_us = elapsed_us(upload_started);
    const uint32_t decode_us = elapsed_us(decode_started);

    LWP_MutexLock(video_decoder_mutex);
    video_decode_running = false;
    if (video_decoder_stopping) {
      continue;
    }
    if (decoded) {
      video_decode_ready = true;
      video_decode_ready_us = decode_us;
      video_codec_ready_us = codec_us;
      video_upload_ready_us = upload_us;
      video_decode_completion_count += 1;
    } else {
      video_decode_failed = true;
    }
  }
  LWP_MutexUnlock(video_decoder_mutex);
  return NULL;
}

static void stop_video_decoder(void);

static void request_video_decoder_stop(void) {
  if (video_decoder_thread == LWP_THREAD_NULL || !video_decoder_sync_ready) {
    return;
  }
  LWP_MutexLock(video_decoder_mutex);
  video_decoder_stopping = true;
  LWP_CondSignal(video_decoder_condition);
  LWP_MutexUnlock(video_decoder_mutex);
}

static bool start_video_decoder(VideoCodec codec, void *reader_context,
                                MediaRead read, unsigned width, unsigned height,
                                uint32_t rate_millihertz, size_t stream_size) {
  if (width == 0 || height == 0 || width > 1024 || height > 1024 ||
      rate_millihertz == 0) {
    return false;
  }
  video_decode_requested = false;
  video_decode_running = false;
  video_decode_ready = false;
  video_decode_failed = false;
  video_decoder_stopping = false;
  video_decode_ready_us = 0;
  video_codec_ready_us = 0;
  video_upload_ready_us = 0;
  video_decode_request_count = 0;
  video_decode_completion_count = 0;
  video_texture_ready = false;
  video_audio_clock_started = false;
  video_was_playing = false;
  video_frame_count = 0;
  video_decode_total_us = 0;
  video_decode_max_us = 0;
  video_codec_total_us = 0;
  video_codec_max_us = 0;
  video_upload_total_us = 0;
  video_upload_max_us = 0;
  video_rate_millihertz = rate_millihertz;
  video_content_width = width;
  video_content_height = height;
  video_decoder = video_decoder_create(codec, reader_context, read);
  if (video_decoder == NULL) {
    SYS_Report("REFERENCE GX: MPEG-2 decoder initialization failed\n");
    return false;
  }
  const unsigned texture_width = (width + 15u) & ~15u;
  const unsigned texture_height = (height + 7u) & ~7u;
  if (!yuv420_gx_initialize(texture_width, texture_height)) {
    SYS_Report("REFERENCE GX: YUV texture allocation failed\n");
    video_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  if (LWP_MutexInit(&video_decoder_mutex, false) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: mutex init\n");
    yuv420_gx_destroy();
    video_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  if (LWP_CondInit(&video_decoder_condition) != 0) {
    LWP_MutexDestroy(video_decoder_mutex);
    SYS_Report("REFERENCE GX: decoder failure: condition init\n");
    yuv420_gx_destroy();
    video_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  video_decoder_sync_ready = true;
  video_decoder_stack = malloc(VIDEO_DECODER_STACK_SIZE);
  if (video_decoder_stack == NULL) {
    SYS_Report("REFERENCE GX: decoder failure: stack allocation\n");
    stop_video_decoder();
    return false;
  }
  if (LWP_CreateThread(&video_decoder_thread, run_video_decoder, NULL,
                       video_decoder_stack, VIDEO_DECODER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: thread creation\n");
    stop_video_decoder();
    return false;
  }
  SYS_Report(
      "REFERENCE GX: decoder=ffmpeg-mplayer-ce codec=%s input=%ux%u "
      "texture=%ux%u pixel-format=yuv420p rate=%u.%03u fps size=%u bytes\n",
      video_codec_name(codec), width, height, texture_width, texture_height,
      rate_millihertz / 1000u, rate_millihertz % 1000u, (unsigned)stream_size);
  return true;
}

static void stop_video_decoder(void) {
  if (video_decoder_thread != LWP_THREAD_NULL) {
    request_video_decoder_stop();
    LWP_JoinThread(video_decoder_thread, NULL);
    video_decoder_thread = LWP_THREAD_NULL;
  }
  free(video_decoder_stack);
  video_decoder_stack = NULL;
  if (video_decoder_sync_ready) {
    LWP_CondDestroy(video_decoder_condition);
    LWP_MutexDestroy(video_decoder_mutex);
    video_decoder_sync_ready = false;
  }
  yuv420_gx_destroy();
  video_decoder_destroy(video_decoder);
  video_decoder = NULL;
  video_texture_ready = false;
  video_content_width = 0;
  video_content_height = 0;
}

static void convert_reference_to_rgba8_tile_rect(
    unsigned first_tile_x, unsigned first_tile_y, unsigned tile_column_count,
    unsigned tile_row_count, uint8_t alpha_scale) {
  const unsigned last_tile_x = first_tile_x + tile_column_count;
  const unsigned last_tile_y = first_tile_y + tile_row_count;
  for (unsigned tile_y = first_tile_y; tile_y < last_tile_y; ++tile_y) {
    for (unsigned tile_x = first_tile_x; tile_x < last_tile_x; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      uint8_t *tile = texture_pixels + tile_index * TILE_BYTES;

      for (unsigned block_y = 0; block_y < TILE_HEIGHT / 4; ++block_y) {
        for (unsigned block_x = 0; block_x < TILE_WIDTH / 4; ++block_x) {
          uint8_t *block = tile + (block_y * (TILE_WIDTH / 4) + block_x) * 64;
          for (unsigned inner_y = 0; inner_y < 4; ++inner_y) {
            for (unsigned inner_x = 0; inner_x < 4; ++inner_x) {
              const unsigned source_x =
                  tile_x * TILE_WIDTH + block_x * 4 + inner_x;
              const unsigned source_y =
                  tile_y * TILE_HEIGHT + block_y * 4 + inner_y;
              const uint8_t *source =
                  reference_frame.pixels +
                  (source_y * LOGICAL_WIDTH + source_x) * 4;
              const unsigned plane_offset = (inner_y * 4 + inner_x) * 2;

              block[plane_offset] =
                  (uint8_t)(((uint16_t)source[3] * alpha_scale) / 255u);
              block[plane_offset + 1] = source[0];
              block[32 + plane_offset] = source[1];
              block[32 + plane_offset + 1] = source[2];
            }
          }
        }
      }
    }
    DCFlushRange(texture_pixels +
                     (tile_y * TILE_COLUMNS + first_tile_x) * TILE_BYTES,
                 tile_column_count * TILE_BYTES);
  }
}

static void convert_reference_to_rgba8_tile_rows(unsigned first_tile_y,
                                                 unsigned tile_row_count,
                                                 uint8_t alpha_scale) {
  convert_reference_to_rgba8_tile_rect(0, first_tile_y, TILE_COLUMNS,
                                       tile_row_count, alpha_scale);
}

static bool reference_tile_has_visible_pixels(unsigned tile_x,
                                              unsigned tile_y) {
  const unsigned first_x = tile_x * TILE_WIDTH;
  const unsigned first_y = tile_y * TILE_HEIGHT;
  const unsigned last_x = first_x + TILE_WIDTH;
  const unsigned last_y = first_y + TILE_HEIGHT;
  for (unsigned source_y = first_y; source_y < last_y; ++source_y) {
    const uint8_t *source =
        reference_frame.pixels +
        (source_y * LOGICAL_WIDTH + first_x) * 4u + 3u;
    for (unsigned source_x = first_x; source_x < last_x; ++source_x) {
      if (*source != 0) {
        return true;
      }
      source += 4;
    }
  }
  return false;
}

static void clear_reference_texture_tile(unsigned tile_index) {
  uint8_t *tile = texture_pixels + tile_index * TILE_BYTES;
  memset(tile, 0, TILE_BYTES);
  DCFlushRange(tile, TILE_BYTES);
}

static void convert_reference_tile_region(unsigned first_tile_x,
                                          unsigned first_tile_y,
                                          unsigned tile_column_count,
                                          unsigned tile_row_count) {
  const unsigned last_tile_x = first_tile_x + tile_column_count;
  const unsigned last_tile_y = first_tile_y + tile_row_count;
  for (unsigned tile_y = first_tile_y; tile_y < last_tile_y; ++tile_y) {
    unsigned run_start = 0;
    bool run_active = false;
    for (unsigned tile_x = first_tile_x; tile_x <= last_tile_x; ++tile_x) {
      const bool tile_exists = tile_x < last_tile_x;
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      const bool visible =
          tile_exists && reference_tile_has_visible_pixels(tile_x, tile_y);
      if (visible && !run_active) {
        run_start = tile_x;
        run_active = true;
      }
      if (!visible && run_active) {
        convert_reference_to_rgba8_tile_rect(
            run_start, tile_y, tile_x - run_start, 1, 255);
        run_active = false;
      }
      if (!tile_exists) {
        continue;
      }
      if (!visible && reference_tile_active[tile_index]) {
        clear_reference_texture_tile(tile_index);
      }
      reference_tile_active[tile_index] = visible;
    }
  }
}

static void convert_reference_damage(const MultiplexReferenceFrameRender *render) {
  if (render->full_repaint != 0) {
    convert_reference_tile_region(0, 0, TILE_COLUMNS, TILE_ROWS);
    GX_InvalidateTexAll();
    return;
  }
  if (render->dirty == 0) {
    return;
  }

  float left = render->dirty_x;
  float right = render->dirty_x + render->dirty_width;
  float top = render->dirty_y;
  float bottom = render->dirty_y + render->dirty_height;
  if (left < 0.0f) {
    left = 0.0f;
  }
  if (right > LOGICAL_WIDTH) {
    right = LOGICAL_WIDTH;
  }
  if (top < 0.0f) {
    top = 0.0f;
  }
  if (bottom > LOGICAL_HEIGHT) {
    bottom = LOGICAL_HEIGHT;
  }
  if (right <= left || bottom <= top) {
    return;
  }
  const unsigned first_tile_x = (unsigned)left / TILE_WIDTH;
  const unsigned first_tile_y = (unsigned)top / TILE_HEIGHT;
  unsigned right_pixel = (unsigned)right;
  if (right > (float)right_pixel) {
    ++right_pixel;
  }
  unsigned bottom_pixel = (unsigned)bottom;
  if (bottom > (float)bottom_pixel) {
    ++bottom_pixel;
  }
  unsigned last_tile_x =
      (right_pixel + TILE_WIDTH - 1u) / TILE_WIDTH;
  unsigned last_tile_y =
      (bottom_pixel + TILE_HEIGHT - 1u) / TILE_HEIGHT;
  if (last_tile_x > TILE_COLUMNS) {
    last_tile_x = TILE_COLUMNS;
  }
  if (last_tile_y > TILE_ROWS) {
    last_tile_y = TILE_ROWS;
  }
  convert_reference_tile_region(
      first_tile_x, first_tile_y, last_tile_x - first_tile_x,
      last_tile_y - first_tile_y);
  GX_InvalidateTexAll();
}

static void set_player_controls_texture_alpha(uint8_t alpha) {
  convert_reference_to_rgba8_tile_rows(TILE_ROWS - 2u, 2, alpha);
  GX_InvalidateTexAll();
}

static void capture_reference_surfaces(void) {
  const uint32_t previous_screen = presented_screen;
  memset(&video_surface, 0, sizeof(video_surface));
  multiplex_native_video_surface(&video_surface);
  memset(&player_controls_surface, 0, sizeof(player_controls_surface));
  multiplex_native_player_controls_surface(&player_controls_surface);
  memset(&modal_surface, 0, sizeof(modal_surface));
  multiplex_native_modal_surface(&modal_surface);
  memset(poster_surfaces, 0, sizeof(poster_surfaces));
  poster_surface_count = multiplex_native_poster_surfaces(
      poster_surfaces, POSTER_SURFACE_CAPACITY);
  presented_screen = multiplex_native_app_screen();
  float next_focused_x = -1.0f;
  float next_focused_y = -1.0f;
  for (uint32_t index = 0; index < poster_surface_count; ++index) {
    if (poster_surfaces[index].focused != 0) {
      next_focused_x = poster_surfaces[index].card_x;
      next_focused_y = poster_surfaces[index].card_y;
      break;
    }
  }
  if (next_focused_x != focused_poster_x || next_focused_y != focused_poster_y) {
    focused_poster_x = next_focused_x;
    focused_poster_y = next_focused_y;
    poster_focus_frame = 0;
  }
  if (presented_screen != previous_screen &&
      presented_screen != MULTIPLEX_SCREEN_PLAYER) {
    ui_entry_frame = 0;
  } else if (presented_screen == MULTIPLEX_SCREEN_PLAYER) {
    ui_entry_frame = UI_ENTRY_FRAMES;
  }
}

static uint32_t copy_atlas_text(uint8_t *destination, uint32_t capacity,
                                const uint8_t *source, uint32_t length) {
  uint32_t input = 0;
  uint32_t output = 0;
  while (input < length && output < capacity) {
    const uint8_t byte = source[input];
    if (byte < 0x80u) {
      destination[output++] = byte;
      ++input;
      continue;
    }
    if (input + 2u < length && byte == 0xe2u &&
        source[input + 1u] == 0x80u) {
      const uint8_t punctuation = source[input + 2u];
      if (punctuation == 0xa6u) {
        if (capacity - output < 3u) break;
        destination[output++] = '.';
        destination[output++] = '.';
        destination[output++] = '.';
      } else if (punctuation == 0x98u || punctuation == 0x99u) {
        destination[output++] = '\'';
      } else if (punctuation == 0x9cu || punctuation == 0x9du) {
        destination[output++] = '"';
      } else if (punctuation == 0x93u || punctuation == 0x94u) {
        destination[output++] = '-';
      } else if (punctuation == 0xa2u) {
        destination[output++] = '*';
      } else {
        destination[output++] = '?';
      }
      input += 3u;
      continue;
    }
    destination[output++] = '?';
    ++input;
    while (input < length && (source[input] & 0xc0u) == 0x80u) ++input;
  }
  return output;
}

static bool command_intersects_rect(const MultiplexGxCommand *command,
                                    float rect_x, float rect_y,
                                    float rect_width, float rect_height) {
  float left = command->x;
  float top = command->y;
  float right = left + command->width;
  float bottom = top + command->height;
  if (command->kind == MULTIPLEX_GX_LINE) {
    left = fminf(command->x, command->x2);
    top = fminf(command->y, command->y2);
    right = fmaxf(command->x, command->x2);
    bottom = fmaxf(command->y, command->y2);
  }
  if (command->kind == MULTIPLEX_GX_PATH_LINE) {
    left = fminf(command->x, command->x2) - command->stroke_width;
    top = fminf(command->y, command->y2) - command->stroke_width;
    right = fmaxf(command->x, command->x2) + command->stroke_width;
    bottom = fmaxf(command->y, command->y2) + command->stroke_width;
  }
  if (command->kind == MULTIPLEX_GX_FILL_TRIANGLE) {
    left = fminf(command->x, fminf(command->x2, command->width));
    top = fminf(command->y, fminf(command->y2, command->height));
    right = fmaxf(command->x, fmaxf(command->x2, command->width));
    bottom = fmaxf(command->y, fmaxf(command->y2, command->height));
  }
  return right >= rect_x && left <= rect_x + rect_width &&
         bottom >= rect_y && top <= rect_y + rect_height;
}

static bool screen_uses_native_shapes(uint32_t screen) {
  return screen != MULTIPLEX_SCREEN_PLAYER;
}

static void capture_native_ui_packet(NativeUiPacket *packet) {
  MultiplexGxCommand commands[UI_COMMAND_CAPACITY];
  memset(packet, 0, sizeof(*packet));
  const uint32_t command_count =
      multiplex_native_app_render(commands, UI_COMMAND_CAPACITY);
  const uint32_t screen = multiplex_native_app_screen();
  MultiplexPlayerControlsSurface controls;
  memset(&controls, 0, sizeof(controls));
  MultiplexModalSurface modal;
  memset(&modal, 0, sizeof(modal));
  if (screen == MULTIPLEX_SCREEN_PLAYER) {
    multiplex_native_player_controls_surface(&controls);
    multiplex_native_modal_surface(&modal);
  }
  for (uint32_t index = 0; index < command_count; ++index) {
    const MultiplexGxCommand *command = &commands[index];
    const bool capture_shape =
        screen_uses_native_shapes(screen) ||
        (screen == MULTIPLEX_SCREEN_PLAYER && controls.visible != 0 &&
         command_intersects_rect(command, controls.x, controls.y,
                                 controls.width, controls.height)) ||
        (screen == MULTIPLEX_SCREEN_PLAYER && modal.visible != 0 &&
         command_intersects_rect(command, modal.x, modal.y, modal.width,
                                 modal.height));
    if (capture_shape && command->kind != MULTIPLEX_GX_TEXT &&
        command->kind != MULTIPLEX_GX_GLYPH &&
        command->kind != MULTIPLEX_GX_SHADOW &&
        packet->shape_command_count < UI_SHAPE_COMMAND_CAPACITY) {
      packet->shape_sequences[packet->shape_command_count] = index;
      packet->shape_commands[packet->shape_command_count++] = *command;
    }
    if ((command->kind != MULTIPLEX_GX_TEXT &&
         command->kind != MULTIPLEX_GX_GLYPH) ||
        packet->text_command_count >= UI_TEXT_COMMAND_CAPACITY) {
      continue;
    }
    MultiplexGxCommand copy = *command;
    if (copy.kind == MULTIPLEX_GX_TEXT) {
      if (copy.text_ptr == NULL || copy.text_len == 0) {
        continue;
      }
      uint8_t *destination = packet->text + packet->text_length;
      copy.text_len = copy_atlas_text(
          destination, UI_TEXT_CAPACITY - packet->text_length,
          copy.text_ptr, copy.text_len);
      if (copy.text_len == 0) {
        continue;
      }
      copy.text_ptr = destination;
      packet->text_length += copy.text_len;
    }
    packet->text_sequences[packet->text_command_count] = index;
    packet->text_commands[packet->text_command_count++] = copy;
  }
}

static void copy_native_ui_packet(NativeUiPacket *destination,
                                  const NativeUiPacket *packet) {
  memset(destination, 0, sizeof(*destination));
  memcpy(destination->text, packet->text, packet->text_length);
  memcpy(destination->shape_commands, packet->shape_commands,
         packet->shape_command_count * sizeof(MultiplexGxCommand));
  memcpy(destination->text_sequences, packet->text_sequences,
         packet->text_command_count * sizeof(uint32_t));
  memcpy(destination->shape_sequences, packet->shape_sequences,
         packet->shape_command_count * sizeof(uint32_t));
  destination->text_length = packet->text_length;
  destination->text_command_count = packet->text_command_count;
  destination->shape_command_count = packet->shape_command_count;
  for (uint32_t index = 0; index < packet->text_command_count; ++index) {
    destination->text_commands[index] = packet->text_commands[index];
    if (packet->text_commands[index].kind != MULTIPLEX_GX_TEXT) {
      continue;
    }
    const size_t offset =
        (size_t)(packet->text_commands[index].text_ptr - packet->text);
    destination->text_commands[index].text_ptr = destination->text + offset;
  }
}

static void present_native_ui_packet(const NativeUiPacket *packet) {
  copy_native_ui_packet(&presented_ui_packet, packet);
}

static void begin_home_motion(uint32_t before, uint32_t after) {
  if (before == UINT32_MAX || after == UINT32_MAX || before == after) return;
  const uint16_t before_row = (uint16_t)(before >> 16u);
  const uint16_t after_row = (uint16_t)(after >> 16u);
  const uint16_t before_carousel = (uint16_t)before;
  const uint16_t after_carousel = (uint16_t)after;
  if (before_row == after_row && before_carousel == after_carousel) return;

  copy_native_ui_packet(&home_motion_previous_packet, &presented_ui_packet);
  memcpy(home_motion_previous_surfaces, poster_surfaces,
         poster_surface_count * sizeof(MultiplexPosterSurface));
  home_motion_previous_surface_count = poster_surface_count;
  if (before_row != after_row) {
    home_motion_kind = HOME_MOTION_VERTICAL;
    home_motion_direction = after_row > before_row ? 1 : -1;
  } else {
    home_motion_kind = HOME_MOTION_HORIZONTAL;
    home_motion_direction = after_carousel > before_carousel ? 1 : -1;
  }
  home_motion_frame = 0;
  SYS_Report("REFERENCE GX: home motion kind=%u direction=%d from=%08x to=%08x\n",
             (unsigned)home_motion_kind, (int)home_motion_direction, before,
             after);
}

static void queue_browse_motion(uint32_t before, uint32_t after) {
  if (before == UINT32_MAX || before == after) return;
  browse_motion_pending_direction = after > before ? 1 : -1;
}

static void activate_pending_browse_motion(void) {
  if (browse_motion_pending_direction == 0 ||
      presented_screen != MULTIPLEX_SCREEN_BROWSE) {
    return;
  }
  home_motion_kind = HOME_MOTION_VERTICAL;
  home_motion_direction = browse_motion_pending_direction;
  home_motion_frame = 0;
  browse_motion_pending_direction = 0;
  SYS_Report("REFERENCE GX: browse motion direction=%d\n",
             (int)home_motion_direction);
}

static bool commit_reference_frame(
    const MultiplexReferenceFrameRender *render, uint32_t render_us,
    bool audit) {
  profile.commands = render->commands;
  profile.passes = 1;
  profile.signature = render->signature;
  profile.render_us = render_us;
  profile.memo_hits = render->memo_hits;
  profile.memo_misses = render->memo_misses;
  capture_reference_surfaces();
  if (video_surface.visible != 0) {
    SYS_Report(
        "REFERENCE GX: video-surface x=%d y=%d width=%d height=%d playing=%u\n",
        (int)video_surface.x, (int)video_surface.y,
        (int)video_surface.width, (int)video_surface.height,
        video_surface.playing);
  }
  const uint32_t upload_started = gettick();
  convert_reference_damage(render);
  profile.upload_us = elapsed_us(upload_started);
  native_frame_dirty = false;
  if (audit) {
    uint32_t first_layout_rule = 0;
    uint32_t first_layout_node = 0;
    const uint32_t layout_findings = multiplex_native_app_layout_audit(
        &first_layout_rule, &first_layout_node);
    SYS_Report("REFERENCE GX: layout-audit findings=%u first-rule=%u "
               "first-node=%u\n",
               layout_findings, first_layout_rule, first_layout_node);
    SYS_Report("REFERENCE GX: poster-inset-audit findings=%u\n",
               multiplex_native_app_poster_inset_audit());
  }
  SYS_Report("REFERENCE GX: commands=%u passes=%u signature=%08x render=%uus "
             "conversion=%uus text=%uus stages=%u/%u/%u/%u/%u/%uus memo=%u/%u "
             "cache=%u/%uKiB\n",
             profile.commands, profile.passes, profile.signature,
             profile.render_us, profile.upload_us, profile.text_us,
             profile_stage_us[1],
             profile_stage_us[2], profile_stage_us[3], profile_stage_us[4],
             profile_stage_us[5], profile_stage_us[6], profile.memo_hits,
             profile.memo_misses,
             multiplex_native_reference_memo_bytes() / 1024u,
             multiplex_native_reference_memo_peak_bytes() / 1024u);
  return true;
}

static bool refresh_reference_frame(bool initialize) {
  const uint32_t render_started = gettick();
  memset(profile_stage_us, 0, sizeof(profile_stage_us));
  profile_stage_current = 0;
  MultiplexReferenceFrameRender render;
  const MultiplexReferenceFrameStatus frame_status =
      multiplex_reference_frame_render_with_options(&reference_frame,
                                                    initialize, &render, 0);
  if (frame_status != MULTIPLEX_REFERENCE_FRAME_OK) {
    SYS_Report("REFERENCE GX: Native frame render failed: %s at stage %08x\n",
               multiplex_reference_frame_status_name(frame_status),
               multiplex_native_reference_render_stage());
    return false;
  }
  const uint32_t reference_render_us = elapsed_us(render_started);
  NativeUiPacket ui_packet;
  const uint32_t text_started = gettick();
  capture_native_ui_packet(&ui_packet);
  profile.text_us = elapsed_us(text_started);
  const bool audit = initialize || presented_screen != multiplex_native_app_screen();
  if (!commit_reference_frame(&render, reference_render_us, audit)) {
    return false;
  }
  present_native_ui_packet(&ui_packet);
  activate_pending_browse_motion();
  return true;
}

static void *run_network_warmup(void *context) {
  NetworkWarmup *warmup = context;
  warmup->ready = http_client_initialize_network();
  __sync_synchronize();
  warmup->complete = true;
  return NULL;
}

static bool launch_network_warmup(NetworkWarmup *warmup) {
  memset(warmup, 0, sizeof(*warmup));
  warmup->thread = LWP_THREAD_NULL;
  warmup->stack = malloc(NETWORK_WARMUP_STACK_SIZE);
  if (warmup->stack == NULL) {
    return false;
  }
  if (LWP_CreateThread(&warmup->thread, run_network_warmup, warmup,
                       warmup->stack, NETWORK_WARMUP_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(warmup->stack);
    warmup->stack = NULL;
    warmup->thread = LWP_THREAD_NULL;
    return false;
  }
  return true;
}

static bool finish_network_warmup(NetworkWarmup *warmup) {
  if (warmup->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(warmup->thread, NULL);
    warmup->thread = LWP_THREAD_NULL;
  }
  free(warmup->stack);
  warmup->stack = NULL;
  return warmup->ready;
}

static void *run_reference_renderer(void *context) {
  ReferenceFrameRenderer *renderer = context;
  const uint32_t started = gettick();
  renderer->status = multiplex_reference_frame_render_with_options(
      &reference_frame, false, &renderer->render, 0);
  renderer->render_us = elapsed_us(started);
  if (renderer->status == MULTIPLEX_REFERENCE_FRAME_OK) {
    const uint32_t text_started = gettick();
    capture_native_ui_packet(&renderer->ui_packet);
    renderer->text_us = elapsed_us(text_started);
  }
  __sync_synchronize();
  renderer->complete = true;
  return NULL;
}

static bool launch_reference_renderer(void) {
  if (reference_renderer.thread != LWP_THREAD_NULL) {
    return true;
  }
  memset(&reference_renderer, 0, sizeof(reference_renderer));
  reference_renderer.audit =
      presented_screen != multiplex_native_app_screen();
  reference_renderer.thread = LWP_THREAD_NULL;
  reference_renderer.stack = malloc(REFERENCE_RENDERER_STACK_SIZE);
  if (reference_renderer.stack == NULL) {
    return false;
  }
  memset(profile_stage_us, 0, sizeof(profile_stage_us));
  profile_stage_current = 0;
  if (LWP_CreateThread(&reference_renderer.thread, run_reference_renderer,
                       &reference_renderer, reference_renderer.stack,
                       REFERENCE_RENDERER_STACK_SIZE,
                       LWP_PRIO_NORMAL - 16u) != 0) {
    free(reference_renderer.stack);
    reference_renderer.stack = NULL;
    reference_renderer.thread = LWP_THREAD_NULL;
    return false;
  }
  SYS_Report("REFERENCE GX: screen transition render started from=%u to=%u\n",
             presented_screen, multiplex_native_app_screen());
  screen_transition_frame = 0;
  return true;
}

static bool poll_reference_renderer(void) {
  if (reference_renderer.thread == LWP_THREAD_NULL ||
      !reference_renderer.complete) {
    return true;
  }
  __sync_synchronize();
  LWP_JoinThread(reference_renderer.thread, NULL);
  reference_renderer.thread = LWP_THREAD_NULL;
  free(reference_renderer.stack);
  reference_renderer.stack = NULL;
  if (reference_renderer.status != MULTIPLEX_REFERENCE_FRAME_OK) {
    SYS_Report("REFERENCE GX: screen transition render failed: %s at stage "
               "%08x\n",
               multiplex_reference_frame_status_name(reference_renderer.status),
               multiplex_native_reference_render_stage());
    native_frame_dirty = false;
    return false;
  }
  const uint32_t previous_screen = presented_screen;
  profile.text_us = reference_renderer.text_us;
  if (!commit_reference_frame(&reference_renderer.render,
                              reference_renderer.render_us,
                              reference_renderer.audit)) {
    return false;
  }
  present_native_ui_packet(&reference_renderer.ui_packet);
  activate_pending_browse_motion();
  SYS_Report("REFERENCE GX: screen transition ready from=%u to=%u us=%u\n",
             previous_screen, presented_screen,
             reference_renderer.render_us);
  return true;
}

static void stop_reference_renderer(void) {
  if (reference_renderer.thread != LWP_THREAD_NULL) {
    LWP_JoinThread(reference_renderer.thread, NULL);
    reference_renderer.thread = LWP_THREAD_NULL;
  }
  free(reference_renderer.stack);
  reference_renderer.stack = NULL;
}

static GXRModeObj *select_video_mode(void) {
  GXRModeObj *preferred = VIDEO_GetPreferredMode(NULL);
  if (!VIDEO_HaveComponentCable()) {
    return preferred;
  }

  switch (preferred->viTVMode >> 2) {
  case VI_PAL:
    return &TVPal576ProgScale;
  case VI_EURGB60:
    return &TVEurgb60Hz480Prog;
  default:
    return &TVNtsc480Prog;
  }
}

static void configure_ui_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX, GX_LIGHTNULL,
                 GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(1);
  GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX2x4, GX_TG_TEX0, GX_IDENTITY);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORD0, GX_TEXMAP0, GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_REPLACE);
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
}

static bool initialize_video_and_gx(void) {
  VIDEO_Init();
  const uint32_t pad_initialized = PAD_Init();
#if defined(HW_RVL)
  const int32_t wpad_initialized = WPAD_Init();
  SYS_Report("REFERENCE GX: controller init=%u wii-remote=%d\n",
             pad_initialized, wpad_initialized);
#else
  SYS_Report("REFERENCE GX: controller init=%u\n", pad_initialized);
#endif
  video_mode = select_video_mode();
  if (video_mode == NULL) {
    SYS_Report("REFERENCE GX: no compatible video mode\n");
    return false;
  }
  const uint32_t framebuffer_bytes = VIDEO_GetFrameBufferSize(video_mode);
  for (unsigned index = 0; index < 2; ++index) {
    void *framebuffer = SYS_AllocateFramebuffer(video_mode);
    if (framebuffer == NULL) {
      SYS_Report("REFERENCE GX: framebuffer %u allocation failed\n", index);
      return false;
    }
    framebuffers[index] = MEM_K0_TO_K1(framebuffer);
    memset(framebuffers[index], 0, framebuffer_bytes);
  }
  framebuffer_index = 1;

  SYS_Report("REFERENCE GX: video mode=%08x progressive=%u component=%u "
             "fb=%ux%u efb=%u xfb=%u vi=%ux%u xfb_mode=%u fields=%u aa=%u\n",
             video_mode->viTVMode, (video_mode->viTVMode & 3) == VI_PROGRESSIVE,
             VIDEO_HaveComponentCable(), video_mode->fbWidth,
             video_mode->xfbHeight, video_mode->efbHeight,
             video_mode->xfbHeight, video_mode->viWidth, video_mode->viHeight,
             video_mode->xfbMode, video_mode->field_rendering, video_mode->aa);

  VIDEO_Configure(video_mode);
  VIDEO_SetNextFramebuffer(framebuffers[0]);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  if ((video_mode->viTVMode & VI_NON_INTERLACE) != 0) {
    VIDEO_WaitVSync();
  }

  gx_fifo = memalign(32, FIFO_SIZE);
  if (gx_fifo == NULL) {
    SYS_Report("REFERENCE GX: %u-byte GX FIFO allocation failed\n", FIFO_SIZE);
    return false;
  }
  memset(gx_fifo, 0, FIFO_SIZE);
  GX_Init(gx_fifo, FIFO_SIZE);
  GX_SetCopyClear((GXColor){10, 10, 12, 255}, 0x00ffffff);
  GX_SetViewport(0, 0, video_mode->fbWidth, video_mode->efbHeight, 0, 1);
  const float y_scale =
      GX_GetYScaleFactor(video_mode->efbHeight, video_mode->xfbHeight);
  const uint16_t xfb_height = GX_SetDispCopyYScale(y_scale);
  GX_SetDispCopySrc(0, 0, video_mode->fbWidth, video_mode->efbHeight);
  GX_SetDispCopyDst(video_mode->fbWidth, xfb_height);
  GX_SetCopyFilter(video_mode->aa, video_mode->sample_pattern, GX_TRUE,
                   video_mode->vfilter);
  GX_SetFieldMode(video_mode->field_rendering,
                  ((video_mode->viHeight == 2 * video_mode->xfbHeight)
                       ? GX_ENABLE
                       : GX_DISABLE));
  GX_SetPixelFmt(video_mode->aa ? GX_PF_RGB565_Z16 : GX_PF_RGB8_Z24,
                 GX_ZC_LINEAR);
  GX_SetCullMode(GX_CULL_NONE);
  GX_SetZMode(GX_FALSE, GX_ALWAYS, GX_FALSE);
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
  GX_SetAlphaUpdate(GX_TRUE);
  GX_SetColorUpdate(GX_TRUE);

  configure_ui_pipeline();

  Mtx identity;
  guMtxIdentity(identity);
  GX_LoadPosMtxImm(identity, GX_PNMTX0);
  GX_SetCurrentMtx(GX_PNMTX0);
  Mtx44 projection;
  guOrtho(projection, 0.0f, (float)(LOGICAL_HEIGHT - 1), 0.0f,
          (float)(LOGICAL_WIDTH - 1), 0.0f, 1.0f);
  GX_LoadProjectionMtx(projection, GX_ORTHOGRAPHIC);
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
  GX_CopyDisp(framebuffers[0], GX_TRUE);
  GX_DrawDone();
  return true;
}

static void initialize_textures(void) {
  for (unsigned index = 0; index < TILE_COUNT; ++index) {
    GX_InitTexObj(&textures[index], texture_pixels + index * TILE_BYTES,
                  TILE_WIDTH, TILE_HEIGHT, GX_TF_RGBA8, GX_CLAMP, GX_CLAMP,
                  GX_FALSE);
    GX_InitTexObjLOD(&textures[index], GX_NEAR, GX_NEAR, 0, 0, 0, GX_FALSE,
                     GX_FALSE, GX_ANISO_1);
  }
  DCFlushRange(geist_atlas, sizeof(geist_atlas));
  GX_InitTexObj(&font_texture, geist_atlas, GEIST_ATLAS_WIDTH,
                GEIST_ATLAS_HEIGHT, GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&font_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0, GX_FALSE,
                   GX_FALSE, GX_ANISO_1);
}

static bool initialize_poster_textures(const char *gateway_url,
                                       uint16_t item_count) {
  if (gateway_url == NULL || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS) {
    return false;
  }
  const size_t home_bytes =
      (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  const size_t total_bytes =
      (size_t)POSTER_TEXTURE_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  poster_texture_pixels = multiplex_native_cache_alloc(total_bytes, 32);
  size_t encoded_size = 0;
  if (encoded == NULL || poster_texture_pixels == NULL ||
      !multiplex_gateway_load_artwork(gateway_url, encoded,
                                      POSTER_JPEG_CAPACITY, &encoded_size) ||
      !poster_jpeg_decode_columns(
          encoded, encoded_size, item_count,
          MULTIPLEX_GATEWAY_MAX_HOME_ITEMS, poster_texture_pixels,
          home_bytes)) {
    free(encoded);
    multiplex_native_cache_free(poster_texture_pixels);
    poster_texture_pixels = NULL;
    return false;
  }

  for (uint16_t item = 0; item < item_count; ++item) {
    uint8_t *destination = poster_texture_pixels +
                           (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    GX_InitTexObj(&poster_textures[item], destination,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&poster_textures[item], GX_LINEAR, GX_LINEAR, 0, 0, 0,
                     GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  free(encoded);
  DCFlushRange(poster_texture_pixels, home_bytes);
  poster_texture_count = POSTER_TEXTURE_COUNT;
  SYS_Report("REFERENCE GX: poster-textures count=%u size=%ux%u\n", item_count,
             MULTIPLEX_GATEWAY_ARTWORK_WIDTH, MULTIPLEX_GATEWAY_ARTWORK_HEIGHT);
  return true;
}

static void fill_poster_fallback(uint8_t *pixels, uint32_t rating_key) {
  const unsigned variation = rating_key & 3u;
  const unsigned tile_columns = MULTIPLEX_GATEWAY_ARTWORK_WIDTH / 4u;
  for (unsigned tile_y = 0; tile_y < MULTIPLEX_GATEWAY_ARTWORK_HEIGHT;
       tile_y += 4u) {
    for (unsigned tile_x = 0; tile_x < MULTIPLEX_GATEWAY_ARTWORK_WIDTH;
         tile_x += 4u) {
      uint8_t *tile =
          pixels + ((size_t)(tile_y / 4u) * tile_columns + tile_x / 4u) * 32u;
      for (unsigned row = 0; row < 4u; ++row) {
        const unsigned y = tile_y + row;
        const uint8_t luma = (uint8_t)(
            13u + variation +
            (MULTIPLEX_GATEWAY_ARTWORK_HEIGHT - y) * 10u /
                MULTIPLEX_GATEWAY_ARTWORK_HEIGHT);
        const uint16_t color =
            (uint16_t)(((uint16_t)(luma & 0xf8u) << 8u) |
                       ((uint16_t)(luma & 0xfcu) << 3u) | (luma >> 3u));
        for (unsigned column = 0; column < 4u; ++column) {
          const size_t offset = (row * 4u + column) * 2u;
          tile[offset] = (uint8_t)(color >> 8u);
          tile[offset + 1u] = (uint8_t)color;
        }
      }
    }
  }
}

static void *run_direct_poster_loader(void *context) {
  DirectPosterWorker *worker = context;
  DirectPosterLoader *loader = worker->loader;
  const uint16_t lane = worker->lane;
  uint8_t *encoded = calloc(1, PLEX_POSTER_JPEG_CAPACITY + 64u);
  if (encoded == NULL) {
    loader->complete[lane] = true;
    return NULL;
  }
  for (uint16_t index = lane; index < loader->item_count;
       index += loader->lane_count) {
    while (loader->item_ready[lane] && !loader->stopping) {
      LWP_YieldThread();
    }
    if (loader->stopping) {
      break;
    }
    const MultiplexGatewayItem *item = &loader->items[index];
    size_t encoded_size = 0;
    const bool decoded =
        item->artwork_path[0] != '\0' &&
        multiplex_plex_load_artwork(loader->credentials, item->artwork_path,
                                    encoded, PLEX_POSTER_JPEG_CAPACITY,
                                    &encoded_size) &&
        poster_jpeg_decode_single(encoded, encoded_size,
                                  loader->decoded_pixels[lane],
                                  MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
    if (decoded) {
      ++loader->decoded_count[lane];
    }
    loader->item_index[lane] = index;
    loader->item_decoded[lane] = decoded;
    __sync_synchronize();
    loader->item_ready[lane] = true;
  }
  free(encoded);
  __sync_synchronize();
  loader->complete[lane] = true;
  return NULL;
}

static bool direct_poster_loader_running(const DirectPosterLoader *loader) {
  if (loader == NULL) {
    return false;
  }
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    if (loader->threads[lane] != LWP_THREAD_NULL) {
      return true;
    }
  }
  return false;
}

static void release_direct_poster_workers(DirectPosterLoader *loader) {
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    if (loader->threads[lane] != LWP_THREAD_NULL) {
      /*
       * libogc2 wakes a joinable thread to finish destroying its context.
       * A lower-priority worker does not preempt the app after that wake, so
       * LWP_JoinThread can return while the worker still uses its stack. Raise
       * it only for teardown so the context is gone before the stack is freed
       * or reused by the next poster window.
       */
      LWP_SetThreadPriority(loader->threads[lane], LWP_PRIO_NORMAL + 1u);
      LWP_JoinThread(loader->threads[lane], NULL);
      loader->threads[lane] = LWP_THREAD_NULL;
    }
    free(loader->decoded_pixels[lane]);
    loader->decoded_pixels[lane] = NULL;
    free(loader->stacks[lane]);
    loader->stacks[lane] = NULL;
  }
  loader->lane_count = 0;
}

static bool launch_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL || !loader->pending ||
      direct_poster_loader_running(loader)) {
    return false;
  }
  loader->stopping = false;
  loader->started_tick = gettick();
  loader->lane_count =
      loader->item_count < POSTER_LOADER_LANE_COUNT
          ? loader->item_count
          : POSTER_LOADER_LANE_COUNT;
  for (uint16_t lane = 0; lane < loader->lane_count; ++lane) {
    loader->complete[lane] = false;
    loader->item_ready[lane] = false;
    loader->decoded_count[lane] = 0;
    loader->decoded_pixels[lane] =
        memalign(32, MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
    loader->stacks[lane] = malloc(POSTER_LOADER_STACK_SIZE);
    loader->workers[lane].loader = loader;
    loader->workers[lane].lane = lane;
    if (loader->decoded_pixels[lane] == NULL || loader->stacks[lane] == NULL ||
        LWP_CreateThread(&loader->threads[lane], run_direct_poster_loader,
                         &loader->workers[lane], loader->stacks[lane],
                         POSTER_LOADER_STACK_SIZE, LWP_PRIO_NORMAL / 2) != 0) {
      loader->stopping = true;
      release_direct_poster_workers(loader);
      loader->pending = false;
      return false;
    }
  }
  loader->pending = false;
  SYS_Report(
      "REFERENCE GX: direct Plex poster loader started items=%u cached=%u "
      "requested=%u offset=%u lanes=%u\n",
      loader->item_count, loader->cache_hits, loader->requested_count,
      loader->texture_offset, loader->lane_count);
  return true;
}

static bool queue_direct_poster_loader(
    DirectPosterLoader *loader, const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayItem *items, uint16_t item_count,
    uint16_t texture_offset, bool launch_now) {
  if (loader == NULL || credentials == NULL || items == NULL ||
      direct_poster_loader_running(loader) || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS ||
      texture_offset > POSTER_TEXTURE_COUNT ||
      item_count > POSTER_TEXTURE_COUNT - texture_offset) {
    return false;
  }
  memset(loader, 0, sizeof(*loader));
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    loader->threads[lane] = LWP_THREAD_NULL;
  }
  if (poster_texture_pixels == NULL) {
    const size_t total_bytes =
        (size_t)POSTER_TEXTURE_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    poster_texture_pixels = multiplex_native_cache_alloc(total_bytes, 32);
    if (poster_texture_pixels == NULL) {
      return false;
    }
    memset(poster_texture_pixels, 0, total_bytes);
    DCFlushRange(poster_texture_pixels, total_bytes);
  }
  const uint16_t target_end = texture_offset + item_count;
  const size_t window_bytes =
      (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  uint8_t *window_snapshot = NULL;
  uint32_t *window_rating_keys = NULL;
  if (poster_texture_count > texture_offset) {
    window_snapshot = malloc(window_bytes);
    window_rating_keys = malloc((size_t)item_count * sizeof(uint32_t));
    if (window_snapshot != NULL && window_rating_keys != NULL) {
      memcpy(window_snapshot,
             poster_texture_pixels +
                 (size_t)texture_offset * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES,
             window_bytes);
      memcpy(window_rating_keys, poster_texture_rating_keys + texture_offset,
             (size_t)item_count * sizeof(uint32_t));
    } else {
      free(window_snapshot);
      free(window_rating_keys);
      window_snapshot = NULL;
      window_rating_keys = NULL;
    }
  }
  uint16_t download_count = 0;
  for (uint16_t index = 0; index < item_count; ++index) {
    const uint16_t target_slot = texture_offset + index;
    uint8_t *pixels =
        poster_texture_pixels +
        (size_t)target_slot * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    uint16_t cached_slot = UINT16_MAX;
    uint16_t snapshot_slot = UINT16_MAX;
    for (uint16_t slot = 0; slot < poster_texture_count; ++slot) {
      const bool stable_source = slot < texture_offset || slot >= target_end ||
                                 slot == target_slot;
      if (stable_source &&
          poster_texture_rating_keys[slot] == items[index].rating_key) {
        cached_slot = slot;
        break;
      }
    }
    if (cached_slot == UINT16_MAX && window_rating_keys != NULL) {
      for (uint16_t slot = 0; slot < item_count; ++slot) {
        if (window_rating_keys[slot] == items[index].rating_key) {
          snapshot_slot = slot;
          break;
        }
      }
    }
    if (cached_slot != UINT16_MAX) {
      if (cached_slot != target_slot) {
        memcpy(pixels,
               poster_texture_pixels +
                   (size_t)cached_slot * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES,
               MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
      }
      poster_texture_rating_keys[target_slot] = items[index].rating_key;
      ++loader->cache_hits;
    } else if (snapshot_slot != UINT16_MAX) {
      memcpy(pixels,
             window_snapshot +
                 (size_t)snapshot_slot * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES,
             MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
      poster_texture_rating_keys[target_slot] = items[index].rating_key;
      ++loader->cache_hits;
    } else {
      fill_poster_fallback(pixels, items[index].rating_key);
      poster_texture_rating_keys[target_slot] = 0;
      loader->items[download_count] = items[index];
      loader->texture_slots[download_count] = target_slot;
      ++download_count;
    }
    GX_InitTexObj(&poster_textures[target_slot], pixels,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&poster_textures[target_slot], GX_LINEAR, GX_LINEAR, 0, 0,
                     0, GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  DCFlushRange(poster_texture_pixels + (size_t)texture_offset *
                                           MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES,
               (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  const uint16_t texture_count = texture_offset + item_count;
  if (texture_count > poster_texture_count) {
    poster_texture_count = texture_count;
  }
  loader->credentials = credentials;
  loader->item_count = download_count;
  loader->requested_count = item_count;
  loader->texture_offset = texture_offset;
  loader->pending = download_count != 0;
  free(window_snapshot);
  free(window_rating_keys);
  if (download_count == 0) {
    SYS_Report("REFERENCE GX: direct Plex posters reused=%u/%u\n",
               loader->cache_hits, loader->requested_count);
    return true;
  }
  return !launch_now || launch_direct_poster_loader(loader);
}

static void poll_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL || !direct_poster_loader_running(loader)) {
    return;
  }
  bool all_complete = true;
  bool texture_changed = false;
  for (uint16_t lane = 0; lane < loader->lane_count; ++lane) {
    if (loader->item_ready[lane]) {
      __sync_synchronize();
      if (loader->item_decoded[lane]) {
        const uint16_t item_index = loader->item_index[lane];
        const uint16_t texture_slot = loader->texture_slots[item_index];
        uint8_t *pixels = poster_texture_pixels +
                          (size_t)texture_slot *
                              MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
        memcpy(pixels, loader->decoded_pixels[lane],
               MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
        poster_texture_rating_keys[texture_slot] =
            loader->items[item_index].rating_key;
        DCFlushRange(pixels, MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
        texture_changed = true;
        if (!loader->first_ready_reported) {
          loader->first_ready_reported = true;
          SYS_Report(
              "REFERENCE GX: direct Plex poster first-ready requested=%u "
              "us=%u\n",
              loader->requested_count, elapsed_us(loader->started_tick));
        }
      }
      __sync_synchronize();
      loader->item_ready[lane] = false;
    }
    all_complete = all_complete && loader->complete[lane] &&
                   !loader->item_ready[lane];
  }
  if (texture_changed) {
    GX_InvalidateTexAll();
  }
  if (!all_complete) {
    return;
  }
  uint16_t decoded_count = 0;
  for (uint16_t lane = 0; lane < loader->lane_count; ++lane) {
    decoded_count += loader->decoded_count[lane];
  }
  release_direct_poster_workers(loader);
  SYS_Report(
      "REFERENCE GX: direct Plex posters decoded=%u downloaded=%u cached=%u "
      "requested=%u us=%u\n",
      decoded_count, loader->item_count, loader->cache_hits,
      loader->requested_count, elapsed_us(loader->started_tick));
}

static void stop_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL) {
    return;
  }
  loader->stopping = true;
  loader->pending = false;
  release_direct_poster_workers(loader);
}

static void suspend_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL ||
      (!loader->pending && !direct_poster_loader_running(loader))) {
    return;
  }
  loader->stopping = true;
  release_direct_poster_workers(loader);
  uint16_t remaining = 0;
  for (uint16_t index = 0; index < loader->item_count; ++index) {
    const uint16_t texture_slot = loader->texture_slots[index];
    if (texture_slot < poster_texture_count &&
        poster_texture_rating_keys[texture_slot] ==
            loader->items[index].rating_key) {
      continue;
    }
    if (remaining != index) {
      loader->items[remaining] = loader->items[index];
      loader->texture_slots[remaining] = texture_slot;
    }
    remaining += 1u;
  }
  loader->item_count = remaining;
  loader->cache_hits = loader->requested_count - remaining;
  loader->pending = remaining != 0;
  loader->stopping = false;
  loader->first_ready_reported = false;
  SYS_Report("REFERENCE GX: direct Plex poster loader suspended "
             "remaining=%u requested=%u\n",
             remaining, loader->requested_count);
}

static bool bind_browse_page(const MultiplexGatewayBrowsePage *page) {
  if (multiplex_native_app_browse_begin(
          page->section_id, (const uint8_t *)page->title, page->title_length,
          page->start, page->total_size, page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_browse_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  if (multiplex_native_app_browse_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: browse-page ready section=%u start=%u items=%u\n",
             page->section_id, page->start, page->item_count);
  return true;
}

static bool load_browse_page(const char *gateway_url) {
  uint32_t requested_section = 0;
  uint32_t requested_start = 0;
  if (multiplex_native_app_browse_request(&requested_section,
                                          &requested_start) == 0) {
    return true;
  }
  if (requested_section > UINT16_MAX || requested_start > UINT16_MAX) {
    return false;
  }
  const uint32_t previous_start = multiplex_native_app_browse_view_start();

  MultiplexGatewayBrowsePage page;
  if (!multiplex_gateway_load_browse(gateway_url, (uint16_t)requested_section,
                                     (uint16_t)requested_start, &page)) {
    return false;
  }
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  size_t encoded_size = 0;
  uint8_t *browse_pixels =
      poster_texture_pixels +
      (size_t)HOME_POSTER_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  const size_t browse_bytes =
      (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (encoded == NULL || poster_texture_pixels == NULL ||
      !multiplex_gateway_load_browse_artwork(
          gateway_url, page.section_id, page.start, encoded,
          POSTER_JPEG_CAPACITY, &encoded_size) ||
      !poster_jpeg_decode_columns(
          encoded, encoded_size, page.item_count,
          MULTIPLEX_GATEWAY_BROWSE_COLUMNS, browse_pixels, browse_bytes)) {
    free(encoded);
    return false;
  }
  free(encoded);
  for (uint16_t item = 0; item < page.item_count; ++item) {
    uint8_t *pixels =
        browse_pixels + (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    GX_InitTexObj(&poster_textures[HOME_POSTER_COUNT + item], pixels,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&poster_textures[HOME_POSTER_COUNT + item], GX_LINEAR,
                     GX_LINEAR, 0, 0, 0, GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  DCFlushRange(browse_pixels, browse_bytes);

  const bool bound = bind_browse_page(&page);
  if (bound) queue_browse_motion(previous_start, page.start);
  return bound;
}

static void *run_direct_browse_loader(void *context) {
  DirectBrowseLoader *loader = context;
  loader->ready = multiplex_plex_load_browse(
      loader->credentials, &loader->library, loader->start, &loader->page);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool launch_direct_browse_loader(
    DirectBrowseLoader *loader,
    const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayLibrary *library, uint16_t start) {
  if (loader == NULL || credentials == NULL || library == NULL ||
      library->section_id == 0 || loader->started) {
    return false;
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->credentials = credentials;
  loader->library = *library;
  loader->start = start;
  loader->thread = LWP_THREAD_NULL;
  loader->stack = malloc(DIRECT_BROWSE_LOADER_STACK_SIZE);
  if (loader->stack == NULL ||
      LWP_CreateThread(&loader->thread, run_direct_browse_loader, loader,
                       loader->stack, DIRECT_BROWSE_LOADER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(loader->stack);
    loader->stack = NULL;
    loader->thread = LWP_THREAD_NULL;
    return false;
  }
  loader->started = true;
  loader->started_tick = gettick();
  network_activity_visible = true;
  SYS_Report("REFERENCE GX: browse-page load started section=%u start=%u\n",
             library->section_id, start);
  return true;
}

static void stop_direct_browse_loader(DirectBrowseLoader *loader) {
  if (loader == NULL) {
    return;
  }
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->thread = LWP_THREAD_NULL;
}

static bool poll_direct_browse_loader(
    DirectBrowseLoader *loader,
    const MultiplexAuthCredentials *credentials,
    DirectPosterLoader *poster_loader) {
  if (loader == NULL || !loader->started) {
    return true;
  }
  uint32_t requested_section = 0;
  uint32_t requested_start = 0;
  const bool still_requested =
      multiplex_native_app_browse_request(&requested_section,
                                          &requested_start) != 0;
  if (!loader->complete) {
    if (!still_requested) {
      network_activity_visible = false;
    }
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  network_activity_visible = false;
  if (!still_requested || requested_section != loader->library.section_id ||
      requested_start != loader->start) {
    return true;
  }
  bool bound = false;
  if (loader->ready) {
    const uint32_t previous_start = multiplex_native_app_browse_view_start();
    if (!queue_direct_poster_loader(poster_loader, credentials,
                                    loader->page.items,
                                    loader->page.item_count,
                                    HOME_POSTER_COUNT, false)) {
      SYS_Report(
          "REFERENCE GX: direct browse artwork deferred; using placeholders\n");
    }
    bound = bind_browse_page(&loader->page);
    if (bound) queue_browse_motion(previous_start, loader->page.start);
    SYS_Report(
        "REFERENCE GX: direct browse-page complete section=%u start=%u us=%u\n",
        requested_section, requested_start, elapsed_us(loader->started_tick));
  } else {
    bound = multiplex_native_app_browse_fail() != 0;
    SYS_Report("REFERENCE GX: browse-page unavailable section=%u start=%u\n",
               requested_section, requested_start);
  }
  if (bound) {
    asynchronous_reference_requested = true;
    native_frame_dirty = true;
  }
  return bound;
}

static bool load_direct_browse_page(const MultiplexAuthCredentials *credentials,
                                    const MultiplexGatewayCatalog *catalog,
                                    DirectBrowseLoader *loader) {
  uint32_t requested_section = 0;
  uint32_t requested_start = 0;
  if (multiplex_native_app_browse_request(&requested_section,
                                          &requested_start) == 0) {
    return true;
  }
  if (requested_section == 0 || requested_section > UINT16_MAX ||
      requested_start > UINT16_MAX) {
    return false;
  }
  const MultiplexGatewayLibrary *library = NULL;
  for (uint16_t index = 0; index < catalog->library_count; ++index) {
    if (catalog->libraries[index].section_id == requested_section) {
      library = &catalog->libraries[index];
      break;
    }
  }
  if (library == NULL) {
    return false;
  }
  if (loader->started) {
    return true;
  }
  return launch_direct_browse_loader(loader, credentials, library,
                                     (uint16_t)requested_start);
}

static bool bind_search_page(const MultiplexGatewaySearchPage *page) {
  if (multiplex_native_app_search_begin((const uint8_t *)page->query,
                                        page->query_length,
                                        page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_search_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  if (multiplex_native_app_search_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: search-page ready query=%.*s items=%u\n",
             page->query_length, page->query, page->item_count);
  return true;
}

static bool load_search_page(const char *gateway_url) {
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY] = {0};
  const uint32_t query_length =
      multiplex_native_app_search_request((uint8_t *)query, sizeof(query) - 1u);
  if (query_length == 0) {
    return true;
  }
  if (query_length >= sizeof(query)) {
    return false;
  }

  MultiplexGatewaySearchPage page;
  if (!multiplex_gateway_load_search(gateway_url, query, (uint16_t)query_length,
                                     &page)) {
    return false;
  }

  uint8_t *browse_pixels =
      poster_texture_pixels +
      (size_t)HOME_POSTER_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (page.item_count > 0) {
    uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
    size_t encoded_size = 0;
    const size_t search_bytes =
        (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    if (encoded == NULL || poster_texture_pixels == NULL ||
        !multiplex_gateway_load_search_artwork(
            gateway_url, query, (uint16_t)query_length, encoded,
            POSTER_JPEG_CAPACITY, &encoded_size) ||
        !poster_jpeg_decode(encoded, encoded_size, page.item_count,
                            browse_pixels, search_bytes)) {
      free(encoded);
      return false;
    }
    free(encoded);
    for (uint16_t item = 0; item < page.item_count; ++item) {
      uint8_t *pixels =
          browse_pixels + (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
      GX_InitTexObj(&poster_textures[HOME_POSTER_COUNT + item], pixels,
                    MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                    MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                    GX_CLAMP, GX_FALSE);
      GX_InitTexObjLOD(&poster_textures[HOME_POSTER_COUNT + item], GX_LINEAR,
                       GX_LINEAR, 0, 0, 0, GX_FALSE, GX_FALSE, GX_ANISO_1);
    }
    DCFlushRange(browse_pixels, search_bytes);
  }

  return bind_search_page(&page);
}

static void *run_direct_search_loader(void *context) {
  DirectSearchLoader *loader = context;
  loader->ready = multiplex_plex_load_search(
      loader->credentials, loader->query, loader->query_length, &loader->page);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool launch_direct_search_loader(
    DirectSearchLoader *loader,
    const MultiplexAuthCredentials *credentials, const char *query,
    uint16_t query_length) {
  if (loader == NULL || credentials == NULL || query == NULL ||
      query_length == 0 || query_length >= sizeof(loader->query) ||
      loader->started) {
    return false;
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->credentials = credentials;
  memcpy(loader->query, query, query_length);
  loader->query[query_length] = '\0';
  loader->query_length = query_length;
  loader->thread = LWP_THREAD_NULL;
  loader->stack = malloc(DIRECT_SEARCH_LOADER_STACK_SIZE);
  if (loader->stack == NULL ||
      LWP_CreateThread(&loader->thread, run_direct_search_loader, loader,
                       loader->stack, DIRECT_SEARCH_LOADER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(loader->stack);
    loader->stack = NULL;
    loader->thread = LWP_THREAD_NULL;
    return false;
  }
  loader->started = true;
  loader->started_tick = gettick();
  network_activity_visible = true;
  SYS_Report("REFERENCE GX: search-page load started query=%.*s\n",
             query_length, query);
  return true;
}

static void stop_direct_search_loader(DirectSearchLoader *loader) {
  if (loader == NULL) {
    return;
  }
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->thread = LWP_THREAD_NULL;
}

static bool poll_direct_search_loader(
    DirectSearchLoader *loader,
    const MultiplexAuthCredentials *credentials,
    DirectPosterLoader *poster_loader) {
  if (loader == NULL || !loader->started) {
    return true;
  }
  char requested_query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY] = {0};
  const uint32_t requested_length = multiplex_native_app_search_request(
      (uint8_t *)requested_query, sizeof(requested_query) - 1u);
  const bool still_requested =
      requested_length == loader->query_length &&
      memcmp(requested_query, loader->query, loader->query_length) == 0;
  if (!loader->complete) {
    if (!still_requested) {
      network_activity_visible = false;
    }
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  network_activity_visible = false;
  if (!still_requested) {
    return true;
  }
  bool bound = false;
  if (loader->ready) {
    if (loader->page.item_count > 0 &&
        !queue_direct_poster_loader(poster_loader, credentials,
                                    loader->page.items,
                                    loader->page.item_count,
                                    HOME_POSTER_COUNT, false)) {
      SYS_Report(
          "REFERENCE GX: direct search artwork deferred; using placeholders\n");
    }
    bound = bind_search_page(&loader->page);
    SYS_Report("REFERENCE GX: direct search-page complete query=%.*s us=%u\n",
               loader->query_length, loader->query,
               elapsed_us(loader->started_tick));
  } else {
    bound = multiplex_native_app_search_fail() != 0;
    SYS_Report("REFERENCE GX: search-page unavailable query=%.*s\n",
               loader->query_length, loader->query);
  }
  if (bound) {
    asynchronous_reference_requested = true;
    native_frame_dirty = true;
  }
  return bound;
}

static bool load_direct_search_page(
    const MultiplexAuthCredentials *credentials,
    DirectSearchLoader *loader) {
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY] = {0};
  const uint32_t query_length =
      multiplex_native_app_search_request((uint8_t *)query, sizeof(query) - 1u);
  if (query_length == 0) {
    return true;
  }
  if (query_length >= sizeof(query)) {
    return false;
  }
  if (loader->started) {
    return true;
  }
  return launch_direct_search_loader(loader, credentials, query,
                                     (uint16_t)query_length);
}

static bool fail_item_details(uint32_t rating_key) {
  if (multiplex_native_app_details_fail() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: details-page unavailable rating-key=%u\n",
             rating_key);
  return true;
}

static bool bind_item_subtitles(const MultiplexGatewayDetails *details) {
  direct_subtitle_count = 0;
  uint32_t selected_subtitle = 0;
  char labels[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS]
             [MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY] = {{0}};
  uint8_t label_lengths[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS] = {0};
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (!subtitle->has_index ||
        direct_subtitle_count >= MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      continue;
    }
    direct_subtitle_indices[direct_subtitle_count] = subtitle->index;
    size_t label_length = strnlen(
        subtitle->label, MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY - 1u);
    if (label_length == 0) {
      label_length = (size_t)snprintf(labels[direct_subtitle_count],
                                      MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY,
                                      "Subtitle %u", direct_subtitle_count + 1u);
    } else {
      memcpy(labels[direct_subtitle_count], subtitle->label, label_length);
    }
    label_lengths[direct_subtitle_count] = (uint8_t)label_length;
    ++direct_subtitle_count;
    if (subtitle->selected) {
      selected_subtitle = direct_subtitle_count;
    }
  }
  return multiplex_native_app_subtitles(
             direct_subtitle_count, selected_subtitle, (const uint8_t *)labels,
             MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY, label_lengths) != 0;
}

static bool format_episode_metadata(const MultiplexGatewayDetails *details,
                                    uint16_t *secondary_length,
                                    char *hierarchy,
                                    size_t hierarchy_capacity,
                                    uint32_t *hierarchy_length) {
  if (details == NULL || secondary_length == NULL || hierarchy == NULL ||
      hierarchy_capacity == 0 || hierarchy_length == NULL) {
    return false;
  }
  uint32_t season = details->parent_index;
  uint32_t episode = details->index;
  *secondary_length = details->secondary_length;
  const char *episode_marker = strstr(details->secondary, " \xC2\xB7 S");
  if (episode_marker != NULL) {
    unsigned parsed_season = 0;
    unsigned parsed_episode = 0;
    if (sscanf(episode_marker + 4, "S%u E%u", &parsed_season,
               &parsed_episode) == 2) {
      season = parsed_season;
      episode = parsed_episode;
      *secondary_length = (uint16_t)(episode_marker - details->secondary);
    }
  }
  int formatted_length = 0;
  if (strcmp(details->media_type, "Episode") == 0 && season != 0 &&
      episode != 0) {
    formatted_length =
        snprintf(hierarchy, hierarchy_capacity, "Season %u - Episode %u",
                 (unsigned)season, (unsigned)episode);
  }
  if (formatted_length < 0 ||
      (size_t)formatted_length >= hierarchy_capacity) {
    return false;
  }
  *hierarchy_length = (uint32_t)formatted_length;
  return true;
}

static bool bind_item_details(const MultiplexGatewayDetails *details) {
  char facts[MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY] = {0};
  char hierarchy[48] = {0};
  uint16_t secondary_length = 0;
  uint32_t hierarchy_length = 0;
  if (!format_episode_metadata(details, &secondary_length, hierarchy,
                               sizeof(hierarchy), &hierarchy_length)) {
    return false;
  }
  const uint32_t minutes =
      details->duration_ms == 0 ? 0 : (details->duration_ms + 30000u) / 60000u;
  int facts_length = 0;
  if (details->year != 0 && minutes != 0 && details->rating_tenths != 0) {
    facts_length = snprintf(
        facts, sizeof(facts), "%u - %u min - %u.%u/10", details->year,
        minutes, details->rating_tenths / 10u, details->rating_tenths % 10u);
  } else if (details->year != 0 && minutes != 0) {
    facts_length =
        snprintf(facts, sizeof(facts), "%u - %u min", details->year, minutes);
  } else if (minutes != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u min", minutes);
  } else if (details->year != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u", details->year);
  }
  if (facts_length < 0 || (size_t)facts_length >= sizeof(facts)) {
    return false;
  }

  if (multiplex_native_app_details_commit(
          (const uint8_t *)details->title, details->title_length,
          (const uint8_t *)details->secondary, secondary_length,
          (const uint8_t *)hierarchy, hierarchy_length,
          (const uint8_t *)details->media_type, details->media_type_length,
          (const uint8_t *)details->library, details->library_length,
          (const uint8_t *)details->content_rating,
          details->content_rating_length, (const uint8_t *)facts,
          (uint32_t)facts_length, (const uint8_t *)details->summary,
          details->summary_length, (const uint8_t *)details->genres,
          details->genres_length, (const uint8_t *)details->directors,
          details->directors_length, (details->flags & 1u) != 0) == 0) {
    return false;
  }
  if (!bind_item_subtitles(details)) {
    return false;
  }
  SYS_Report("REFERENCE GX: details-page ready rating-key=%u title=%s\n",
             details->rating_key, details->title);
  return true;
}

static bool load_item_details(const char *gateway_url) {
  const uint32_t rating_key = multiplex_native_app_details_request();
  if (rating_key == 0) {
    return true;
  }
  MultiplexGatewayDetails details;
  if (!multiplex_gateway_load_details(gateway_url, rating_key, &details)) {
    return fail_item_details(rating_key);
  }
  return bind_item_details(&details);
}

static void reset_direct_hls_prefetch(DirectHlsSessionPrefetch *prefetch) {
  memset(prefetch, 0, sizeof(*prefetch));
  prefetch->thread = LWP_THREAD_NULL;
}

static void *run_direct_hls_prefetch(void *context) {
  DirectHlsSessionPrefetch *prefetch = context;
  prefetch->ready = multiplex_plex_hls_start(
      prefetch->credentials, prefetch->rating_key, prefetch->offset_ms, NULL,
      prefetch->burn_subtitles, prefetch->subtitle_stream_index,
      &prefetch->session) &&
      multiplex_plex_hls_refresh(prefetch->credentials, &prefetch->session,
                                 &prefetch->playlist);
  __sync_synchronize();
  prefetch->complete = true;
  return NULL;
}

static bool finish_direct_hls_prefetch(DirectHlsSessionPrefetch *prefetch,
                                       bool wait) {
  if (prefetch == NULL || !prefetch->started) {
    return false;
  }
  if (prefetch->thread != LWP_THREAD_NULL) {
    if (!wait && !prefetch->complete) {
      return false;
    }
    LWP_JoinThread(prefetch->thread, NULL);
    prefetch->thread = LWP_THREAD_NULL;
    free(prefetch->stack);
    prefetch->stack = NULL;
    __sync_synchronize();
    SYS_Report("REFERENCE GX: HLS session prefetch ready=%u rating-key=%u "
               "us=%u\n",
               prefetch->ready ? 1u : 0u, prefetch->rating_key,
               elapsed_us(prefetch->started_tick));
  }
  return prefetch->ready;
}

static void discard_direct_hls_prefetch(DirectHlsSessionPrefetch *prefetch) {
  if (prefetch == NULL || !prefetch->started) {
    return;
  }
  finish_direct_hls_prefetch(prefetch, true);
  if (prefetch->session.started) {
    multiplex_plex_hls_stop(prefetch->credentials, &prefetch->session);
  }
  reset_direct_hls_prefetch(prefetch);
}

static bool start_direct_hls_prefetch(
    DirectHlsSessionPrefetch *prefetch,
    const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayDetails *details) {
  if (prefetch == NULL || credentials == NULL || details == NULL ||
      details->rating_key == 0 || details->duration_ms == 0) {
    return false;
  }
  const uint32_t offset_ms = details->view_offset_ms < details->duration_ms
                                 ? details->view_offset_ms
                                 : 0;
  bool burn_subtitles = false;
  uint32_t subtitle_stream_index = 0;
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (subtitle->selected && subtitle->has_index) {
      burn_subtitles = true;
      subtitle_stream_index = subtitle->index;
      break;
    }
  }
  if (prefetch->started && prefetch->rating_key == details->rating_key &&
      prefetch->offset_ms == offset_ms &&
      prefetch->burn_subtitles == burn_subtitles &&
      (!burn_subtitles ||
       prefetch->subtitle_stream_index == subtitle_stream_index)) {
    SYS_Report("REFERENCE GX: HLS session prefetch retained rating-key=%u "
               "offset=%u\n",
               details->rating_key, offset_ms);
    return true;
  }
  if (prefetch->started && !prefetch->complete) {
    SYS_Report("REFERENCE GX: HLS session prefetch deferred rating-key=%u "
               "behind=%u\n",
               details->rating_key, prefetch->rating_key);
    return true;
  }
  discard_direct_hls_prefetch(prefetch);
  reset_direct_hls_prefetch(prefetch);
  prefetch->credentials = credentials;
  prefetch->rating_key = details->rating_key;
  prefetch->offset_ms = offset_ms;
  prefetch->burn_subtitles = burn_subtitles;
  prefetch->subtitle_stream_index = subtitle_stream_index;
  prefetch->stack = malloc(HLS_SESSION_PREFETCH_STACK_SIZE);
  prefetch->started_tick = gettick();
  if (prefetch->stack == NULL ||
      LWP_CreateThread(&prefetch->thread, run_direct_hls_prefetch, prefetch,
                       prefetch->stack, HLS_SESSION_PREFETCH_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(prefetch->stack);
    reset_direct_hls_prefetch(prefetch);
    return false;
  }
  prefetch->started = true;
  SYS_Report("REFERENCE GX: HLS session prefetch started rating-key=%u "
             "offset=%u\n",
             prefetch->rating_key, prefetch->offset_ms);
  return true;
}

static void *run_direct_details_loader(void *context) {
  DirectDetailsLoader *loader = context;
  loader->ready = multiplex_plex_load_details(
      loader->credentials, loader->rating_key, &loader->details);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool launch_direct_details_loader(
    DirectDetailsLoader *loader,
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    bool foreground) {
  if (loader == NULL || credentials == NULL || rating_key == 0 ||
      loader->started) {
    return false;
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->credentials = credentials;
  loader->rating_key = rating_key;
  loader->foreground = foreground;
  loader->thread = LWP_THREAD_NULL;
  loader->stack = malloc(DIRECT_DETAILS_LOADER_STACK_SIZE);
  if (loader->stack == NULL ||
      LWP_CreateThread(&loader->thread, run_direct_details_loader, loader,
                       loader->stack, DIRECT_DETAILS_LOADER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(loader->stack);
    loader->stack = NULL;
    loader->thread = LWP_THREAD_NULL;
    return false;
  }
  loader->started = true;
  network_activity_visible = foreground;
  SYS_Report("REFERENCE GX: details-page load started rating-key=%u mode=%s\n",
             rating_key, foreground ? "foreground" : "prefetch");
  return true;
}

static void stop_direct_details_loader(DirectDetailsLoader *loader) {
  if (loader == NULL) {
    return;
  }
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->thread = LWP_THREAD_NULL;
}

static bool load_direct_item_details(
    const MultiplexAuthCredentials *credentials,
    DirectDetailsLoader *loader) {
  const uint32_t rating_key = multiplex_native_app_details_request();
  if (rating_key == 0) {
    return true;
  }
  if (direct_details_cache_valid &&
      direct_details_cache.rating_key == rating_key) {
    const bool bound = bind_item_details(&direct_details_cache);
    if (bound && !start_direct_hls_prefetch(
                     &direct_hls_prefetch, credentials,
                     &direct_details_cache)) {
      SYS_Report("REFERENCE GX: HLS session prefetch unavailable "
                 "rating-key=%u\n",
                 rating_key);
    }
    return bound;
  }
  if (loader->started) {
    loader->foreground = true;
    network_activity_visible = true;
    return true;
  }
  return launch_direct_details_loader(loader, credentials, rating_key, true);
}

static bool poll_direct_details_loader(
    DirectDetailsLoader *loader,
    const MultiplexAuthCredentials *credentials) {
  if (loader == NULL || !loader->started) {
    return true;
  }
  if (!loader->complete) {
    if (loader->foreground && multiplex_native_app_details_request() == 0) {
      loader->foreground = false;
      network_activity_visible = false;
    }
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  if (loader->foreground) {
    network_activity_visible = false;
  }
  const uint32_t completed_rating_key = loader->rating_key;
  const uint32_t requested_rating_key = multiplex_native_app_details_request();
  if (loader->ready) {
    direct_details_cache = loader->details;
    direct_details_cache_valid = true;
  }
  if (requested_rating_key == completed_rating_key) {
    const bool bound = loader->ready
                           ? bind_item_details(&direct_details_cache)
                           : fail_item_details(completed_rating_key);
    if (!bound) {
      return false;
    }
    if (loader->ready &&
        !start_direct_hls_prefetch(&direct_hls_prefetch, credentials,
                                   &direct_details_cache)) {
      SYS_Report("REFERENCE GX: HLS session prefetch unavailable "
                 "rating-key=%u\n",
                 completed_rating_key);
    }
    if (!load_direct_item_children(credentials)) {
      SYS_Report("REFERENCE GX: direct details children load failed\n");
    }
    asynchronous_reference_requested = true;
    native_frame_dirty = true;
  } else if (requested_rating_key == 0 && loader->ready) {
    SYS_Report("REFERENCE GX: details-page prefetch ready rating-key=%u\n",
               completed_rating_key);
  } else if (requested_rating_key != 0 &&
             !launch_direct_details_loader(loader, credentials,
                                           requested_rating_key, true)) {
    return false;
  }
  return true;
}

static bool bind_item_children(uint32_t rating_key,
                               const MultiplexGatewayChildrenPage *page) {
  if (multiplex_native_app_details_children_begin(
          rating_key, page->start, page->total_size, page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_details_child(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  if (multiplex_native_app_details_children_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: details children ready rating-key=%u start=%u "
             "items=%u total=%u\n",
             rating_key, page->start, page->item_count, page->total_size);
  return true;
}

static bool
load_direct_item_children(const MultiplexAuthCredentials *credentials) {
  uint32_t rating_key = 0;
  uint32_t start = 0;
  if (multiplex_native_app_details_children_request(&rating_key, &start) == 0) {
    return true;
  }
  if (rating_key == 0 || start > UINT16_MAX) {
    return false;
  }
  MultiplexGatewayChildrenPage page;
  if (!multiplex_plex_load_children(credentials, rating_key, (uint16_t)start,
                                    &page)) {
    memset(&page, 0, sizeof(page));
    page.version = 1;
    page.start = (uint16_t)start;
    SYS_Report("REFERENCE GX: details children unavailable rating-key=%u "
               "start=%u\n",
               rating_key, start);
  }
  return bind_item_children(rating_key, &page);
}

static void close_media_session(HttpClient **client, MpegPsDemux **demux) {
  if (audio_output != NULL) {
    audio_dma_request_stop(audio_output);
  }
  request_video_decoder_stop();
  http_client_request_stop(*client);
  if (*demux != NULL) {
    mpeg_ps_demux_stop(*demux);
  }
  if (direct_hls_demux != NULL) {
    plex_hls_demux_stop(direct_hls_demux);
  }
  audio_dma_destroy(audio_output);
  audio_output = NULL;
  stop_video_decoder();
  if (*demux != NULL) {
    SYS_Report("REFERENCE GX: media producer loops=%u\n",
               mpeg_ps_demux_loop_count(*demux));
    mpeg_ps_demux_destroy(*demux);
    *demux = NULL;
  }
  media_demux = NULL;
  if (direct_hls_demux != NULL) {
    SYS_Report("REFERENCE GX: HLS producer segments=%u video=%u audio=%u "
               "complete=%u failed=%u\n",
               plex_hls_demux_segment_count(direct_hls_demux),
               plex_hls_demux_video_bytes(direct_hls_demux),
               plex_hls_demux_audio_bytes(direct_hls_demux),
               plex_hls_demux_complete(direct_hls_demux) ? 1u : 0u,
               plex_hls_demux_failed(direct_hls_demux) ? 1u : 0u);
    plex_hls_demux_destroy(direct_hls_demux);
    direct_hls_demux = NULL;
  }
  diagnostic_network_kib_per_second = 0;
  diagnostic_network_last_bytes = 0;
  diagnostic_network_started = 0;
  http_client_destroy(*client);
  *client = NULL;
}

static bool start_media_pipeline(MpegPsDemux *demux, uint32_t rating_key,
                                 bool start_demux) {
  const int64_t pts_delta = mpeg_ps_demux_first_video_pts90k(demux) -
                            mpeg_ps_demux_first_audio_pts90k(demux);
  if (pts_delta >= 0) {
    video_pts_offset_samples =
        (pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE;
  } else {
    video_pts_offset_samples =
        -((-pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE);
  }
  if (!start_video_decoder(
          VIDEO_CODEC_MPEG2, demux, mpeg_ps_demux_read_video, VIDEO_WIDTH,
          VIDEO_HEIGHT, (VIDEO_RATE_NUMERATOR * 1000u) / VIDEO_RATE_DENOMINATOR,
          mpeg_ps_demux_video_size(demux))) {
    return false;
  }
  audio_output =
      audio_dma_create(AUDIO_CODEC_MP2, demux, mpeg_ps_demux_read_audio);
  if (audio_output == NULL) {
    SYS_Report("REFERENCE GX: audio initialization failed rating-key=%u\n",
               rating_key);
    stop_video_decoder();
    return false;
  }
  if (start_demux && !mpeg_ps_demux_start(demux)) {
    SYS_Report(
        "REFERENCE GX: media producer initialization failed rating-key=%u\n",
        rating_key);
    audio_dma_destroy(audio_output);
    audio_output = NULL;
    stop_video_decoder();
    return false;
  }
  media_demux = demux;
  return true;
}

static bool start_hls_pipeline(PlexHlsDemux *demux, uint32_t rating_key) {
  const int64_t pts_delta = plex_hls_demux_first_video_pts90k(demux) -
                            plex_hls_demux_first_audio_pts90k(demux);
  if (pts_delta >= 0) {
    video_pts_offset_samples =
        (pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE;
  } else {
    video_pts_offset_samples =
        -((-pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE);
  }
  if (!start_video_decoder(VIDEO_CODEC_H264, demux, plex_hls_demux_read_video,
                           plex_hls_demux_width(demux),
                           plex_hls_demux_height(demux),
                           plex_hls_demux_frame_rate_millihertz(demux), 0)) {
    SYS_Report("REFERENCE GX: H.264 initialization failed rating-key=%u\n",
               rating_key);
    return false;
  }
  audio_output =
      audio_dma_create(AUDIO_CODEC_AAC, demux, plex_hls_demux_read_audio);
  if (audio_output == NULL) {
    SYS_Report("REFERENCE GX: AAC initialization failed rating-key=%u\n",
               rating_key);
    stop_video_decoder();
    return false;
  }
  direct_hls_demux = demux;
  SYS_Report("REFERENCE GX: direct playback pipeline rating-key=%u "
             "pts-delta=%lld pts-offset-samples=%lld\n",
             rating_key, pts_delta, video_pts_offset_samples);
  return true;
}

static bool open_direct_hls_session(const MultiplexAuthCredentials *credentials,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    const char *session_id,
                                    bool burn_subtitles,
                                    uint32_t subtitle_stream_index,
                                    PlexHlsDemux **demux_out) {
  PlexHlsDemux *demux = NULL;
  const bool prefetch_matches =
      session_id == NULL && direct_hls_prefetch.started &&
      direct_hls_prefetch.rating_key == rating_key &&
      direct_hls_prefetch.offset_ms == offset_ms &&
      direct_hls_prefetch.burn_subtitles == burn_subtitles &&
      (!burn_subtitles || direct_hls_prefetch.subtitle_stream_index ==
                                subtitle_stream_index) &&
      finish_direct_hls_prefetch(&direct_hls_prefetch, true);
  if (prefetch_matches) {
    demux = plex_hls_demux_create_prepared(
        credentials, &direct_hls_prefetch.session,
        &direct_hls_prefetch.playlist);
    if (demux != NULL) {
      SYS_Report("REFERENCE GX: direct playback reused prefetched HLS "
                 "rating-key=%u offset=%u\n",
                 rating_key, offset_ms);
      direct_hls_prefetch.session.started = false;
      reset_direct_hls_prefetch(&direct_hls_prefetch);
    }
  }
  if (demux == NULL) {
    discard_direct_hls_prefetch(&direct_hls_prefetch);
    demux = plex_hls_demux_create(credentials, rating_key, offset_ms,
                                  session_id, burn_subtitles,
                                  subtitle_stream_index);
  }
  if (demux == NULL || !plex_hls_demux_start(demux) ||
      !plex_hls_demux_wait_ready(demux, HLS_VIDEO_PREBUFFER_BYTES,
                                 HLS_AUDIO_PREBUFFER_BYTES,
                                 HLS_READINESS_TIMEOUT_MS) ||
      !start_hls_pipeline(demux, rating_key)) {
    SYS_Report("REFERENCE GX: direct HLS unavailable rating-key=%u\n",
               rating_key);
    plex_hls_demux_destroy(demux);
    return false;
  }
  const char *started_session_id = plex_hls_demux_session_id(demux);
  if (started_session_id == NULL ||
      strlen(started_session_id) >= sizeof(direct_hls_session_id)) {
    plex_hls_demux_destroy(demux);
    return false;
  }
  strcpy(direct_hls_session_id, started_session_id);
  *demux_out = demux;
  return true;
}

static bool
prepare_media_source(const MultiplexGatewayPlaybackManifest *manifest,
                     HttpClient **client_out, MpegPsDemux **demux_out) {
  HttpClient *client = http_client_open(manifest->media_url);
  if (client == NULL) {
    SYS_Report("REFERENCE GX: HTTP media initialization failed rating-key=%u\n",
               manifest->rating_key);
    return false;
  }
  const MpegPsInfo info = {
      .video_stream_id = 0xe0,
      .audio_stream_id = 0xc0,
      .video_size = manifest->video_bytes,
      .audio_size = manifest->audio_bytes,
      .video_packets = manifest->video_packets,
      .audio_packets = manifest->audio_packets,
      .first_video_pts90k = manifest->first_video_pts90k,
      .first_audio_pts90k = manifest->first_audio_pts90k,
  };
  MpegPsDemux *demux = mpeg_ps_demux_create_reader_with_info(
      client, http_client_size(client), read_http_program, &info);
  if (demux == NULL) {
    SYS_Report(
        "REFERENCE GX: MPEG-PS demux initialization failed rating-key=%u\n",
        manifest->rating_key);
    http_client_destroy(client);
    return false;
  }
  SYS_Report("REFERENCE GX: media-source=http rating-key=%u host=%s port=%u "
             "bytes=%u ranges=%u\n",
             manifest->rating_key, http_client_host(client),
             http_client_port(client), (unsigned)http_client_size(client),
             http_client_range_count(client));
  http_client_begin_stream(client);
  *client_out = client;
  *demux_out = demux;
  return true;
}

static bool open_media_session(const MultiplexGatewayPlaybackManifest *manifest,
                               HttpClient **client_out,
                               MpegPsDemux **demux_out) {
  HttpClient *client = NULL;
  MpegPsDemux *demux = NULL;
  if (!prepare_media_source(manifest, &client, &demux)) {
    return false;
  }
  if (!start_media_pipeline(demux, manifest->rating_key, true)) {
    mpeg_ps_demux_destroy(demux);
    http_client_destroy(client);
    return false;
  }
  *client_out = client;
  *demux_out = demux;
  return true;
}

static bool
recover_stalled_media_startup(MediaStartupWatchdog *watchdog,
                              const MultiplexGatewayPlaybackManifest *manifest,
                              HttpClient **client, MpegPsDemux **demux,
                              StagedMediaSession *staged) {
  if (watchdog == NULL || manifest == NULL || client == NULL || demux == NULL) {
    return false;
  }
  if (*demux == NULL || manifest->rating_key == 0 ||
      video_surface.visible == 0) {
    watchdog->timing = false;
    return true;
  }

  if (watchdog->rating_key != manifest->rating_key ||
      watchdog->segment_start_ms != manifest->segment_start_ms) {
    memset(watchdog, 0, sizeof(*watchdog));
    watchdog->rating_key = manifest->rating_key;
    watchdog->segment_start_ms = manifest->segment_start_ms;
  }

  const size_t video_bytes = mpeg_ps_demux_video_bytes_pumped(*demux);
  const size_t audio_bytes = mpeg_ps_demux_audio_bytes_pumped(*demux);
  if (video_was_playing) {
    watchdog->playback_started = true;
    watchdog->timing = false;
    return true;
  }
  if (watchdog->playback_started) {
    return true;
  }
  if (video_bytes != watchdog->last_video_bytes ||
      audio_bytes != watchdog->last_audio_bytes) {
    watchdog->last_video_bytes = (uint32_t)video_bytes;
    watchdog->last_audio_bytes = (uint32_t)audio_bytes;
    watchdog->started_tick = gettick();
    watchdog->timing = true;
    return true;
  }
  if (!watchdog->timing) {
    watchdog->started_tick = gettick();
    watchdog->timing = true;
    return true;
  }
  if (elapsed_us(watchdog->started_tick) < MEDIA_STARTUP_STALL_TIMEOUT_US) {
    return true;
  }
  if (watchdog->restart_count >= MEDIA_STARTUP_RESTART_LIMIT) {
    SYS_Report("REFERENCE GX: media startup recovery exhausted rating-key=%u "
               "offset=%u attempts=%u\n",
               manifest->rating_key, manifest->segment_start_ms,
               watchdog->restart_count);
    return false;
  }

  watchdog->restart_count += 1;
  SYS_Report(
      "REFERENCE GX: media startup made no progress rating-key=%u offset=%u "
      "retry=%u/%u\n",
      manifest->rating_key, manifest->segment_start_ms, watchdog->restart_count,
      MEDIA_STARTUP_RESTART_LIMIT);
  discard_staged_media_session(staged);
  close_media_session(client, demux);
  if (!open_media_session(manifest, client, demux)) {
    SYS_Report("REFERENCE GX: media startup recovery failed rating-key=%u "
               "offset=%u retry=%u\n",
               manifest->rating_key, manifest->segment_start_ms,
               watchdog->restart_count);
    return false;
  }
  watchdog->started_tick = gettick();
  watchdog->last_video_bytes = 0;
  watchdog->last_audio_bytes = 0;
  watchdog->timing = true;
  return true;
}

static bool open_initial_media_session(HttpClient **client_out,
                                       MpegPsDemux **demux_out) {
  HttpClient *client = NULL;
  MpegPsDemux *demux = NULL;
  if (MULTIPLEX_MEDIA_URL[0] != '\0') {
    client = http_client_open(MULTIPLEX_MEDIA_URL);
    if (client == NULL) {
      SYS_Report("REFERENCE GX: HTTP media initialization failed\n");
      return false;
    }
    if (MULTIPLEX_MEDIA_HAS_INFO != 0) {
      const MpegPsInfo info = {
          .video_stream_id = 0xe0,
          .audio_stream_id = 0xc0,
          .video_size = MULTIPLEX_MEDIA_VIDEO_BYTES,
          .audio_size = MULTIPLEX_MEDIA_AUDIO_BYTES,
          .video_packets = MULTIPLEX_MEDIA_VIDEO_PACKETS,
          .audio_packets = MULTIPLEX_MEDIA_AUDIO_PACKETS,
          .first_video_pts90k = MULTIPLEX_MEDIA_VIDEO_PTS90K,
          .first_audio_pts90k = MULTIPLEX_MEDIA_AUDIO_PTS90K,
      };
      demux = mpeg_ps_demux_create_reader_with_info(
          client, http_client_size(client), read_http_program, &info);
    } else {
      demux = mpeg_ps_demux_create_reader(client, http_client_size(client),
                                          read_http_program);
    }
    SYS_Report("REFERENCE GX: media-source=http rating-key=0 host=%s port=%u "
               "bytes=%u ranges=%u\n",
               http_client_host(client), http_client_port(client),
               (unsigned)http_client_size(client),
               http_client_range_count(client));
    http_client_begin_stream(client);
  } else {
    if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
      SYS_Report("REFERENCE GX: gateway playback manifest unavailable\n");
      return false;
    }
    SYS_Report("REFERENCE GX: media-source=embedded bytes=%u\n",
               multiplex_dvd_demo_mpg_size);
    demux = mpeg_ps_demux_create(multiplex_dvd_demo_mpg,
                                 (size_t)multiplex_dvd_demo_mpg_size);
  }
  if (demux == NULL) {
    SYS_Report("REFERENCE GX: MPEG-PS demux initialization failed\n");
    http_client_destroy(client);
    return false;
  }
  if (!start_media_pipeline(demux, 0, true)) {
    mpeg_ps_demux_destroy(demux);
    http_client_destroy(client);
    return false;
  }
  *client_out = client;
  *demux_out = demux;
  return true;
}

static void reset_staged_media_session(StagedMediaSession *staged) {
  memset(staged, 0, sizeof(*staged));
  staged->thread = LWP_THREAD_NULL;
}

static void *prepare_staged_media_session(void *argument) {
  StagedMediaSession *staged = argument;
  if (!multiplex_gateway_load_playback_manifest(
          staged->gateway_url, staged->rating_key, staged->offset_ms,
          &staged->manifest) ||
      !prepare_media_source(&staged->manifest, &staged->client,
                            &staged->demux) ||
      !mpeg_ps_demux_start(staged->demux)) {
    staged->failed = true;
    return NULL;
  }
  staged->ready = true;
  SYS_Report("REFERENCE GX: playback-session staged rating-key=%u offset=%u\n",
             staged->rating_key, staged->offset_ms);
  return NULL;
}

static bool start_staged_media_session(
    StagedMediaSession *staged, const char *gateway_url,
    const MultiplexGatewayPlaybackManifest *active_manifest) {
  if (staged->thread != LWP_THREAD_NULL || gateway_url == NULL ||
      active_manifest == NULL || active_manifest->rating_key == 0) {
    return false;
  }
  const uint64_t next_offset = (uint64_t)active_manifest->segment_start_ms +
                               active_manifest->segment_duration_ms;
  if (next_offset >= active_manifest->media_duration_ms) {
    return false;
  }
  staged->gateway_url = gateway_url;
  staged->rating_key = active_manifest->rating_key;
  staged->offset_ms = (uint32_t)next_offset;
  staged->stack = malloc(MEDIA_PREFETCH_STACK_SIZE);
  if (staged->stack == NULL ||
      LWP_CreateThread(&staged->thread, prepare_staged_media_session, staged,
                       staged->stack, MEDIA_PREFETCH_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(staged->stack);
    reset_staged_media_session(staged);
    return false;
  }
  SYS_Report("REFERENCE GX: playback-session staging rating-key=%u offset=%u\n",
             staged->rating_key, staged->offset_ms);
  return true;
}

static void join_staged_media_session(StagedMediaSession *staged) {
  if (staged->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(staged->thread, NULL);
    staged->thread = LWP_THREAD_NULL;
  }
  free(staged->stack);
  staged->stack = NULL;
}

static void discard_staged_media_session(StagedMediaSession *staged) {
  join_staged_media_session(staged);
  http_client_request_stop(staged->client);
  if (staged->demux != NULL) {
    mpeg_ps_demux_stop(staged->demux);
    mpeg_ps_demux_destroy(staged->demux);
  }
  http_client_destroy(staged->client);
  reset_staged_media_session(staged);
}

static void initialize_timeline_reporter(TimelineReporter *reporter) {
  memset(reporter, 0, sizeof(*reporter));
  reporter->thread = LWP_THREAD_NULL;
}

static void *run_timeline_report(void *argument) {
  TimelineReporter *reporter = argument;
  if (reporter->gateway_url != NULL && reporter->gateway_url[0] != '\0') {
    reporter->succeeded = multiplex_gateway_report_timeline(
        reporter->gateway_url, reporter->rating_key, reporter->position_ms,
        reporter->duration_ms, reporter->state);
  } else {
    reporter->succeeded = multiplex_plex_report_timeline(
        reporter->plex_credentials, reporter->plex_session_id,
        reporter->rating_key, reporter->position_ms, reporter->duration_ms,
        reporter->state);
  }
  reporter->complete = true;
  return NULL;
}

static void finish_timeline_report(TimelineReporter *reporter) {
  if (reporter->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(reporter->thread, NULL);
    reporter->thread = LWP_THREAD_NULL;
  }
  free(reporter->stack);
  reporter->stack = NULL;
  reporter->complete = false;
}

static bool
schedule_timeline_report(TimelineReporter *reporter, const char *gateway_url,
                         const MultiplexAuthCredentials *plex_credentials,
                         const char *plex_session_id, uint32_t rating_key,
                         uint32_t position_ms, uint32_t duration_ms,
                         const char *state, bool force) {
  if (reporter->thread != LWP_THREAD_NULL && reporter->complete) {
    finish_timeline_report(reporter);
  }
  const bool use_gateway = gateway_url != NULL && gateway_url[0] != '\0';
  const bool use_direct_plex =
      !use_gateway && plex_credentials != NULL &&
      plex_credentials->plex_server_url[0] != '\0' &&
      plex_credentials->plex_server_token[0] != '\0' &&
      plex_session_id != NULL && plex_session_id[0] != '\0' &&
      strlen(plex_session_id) < sizeof(reporter->plex_session_id);
  if (reporter->thread != LWP_THREAD_NULL ||
      (!use_gateway && !use_direct_plex) || rating_key == 0 ||
      duration_ms == 0) {
    return false;
  }
  const bool same_item = reporter->last_rating_key == rating_key;
  const bool same_state =
      reporter->last_state != NULL && strcmp(reporter->last_state, state) == 0;
  const bool periodic_due =
      strcmp(state, "playing") == 0 && same_item && same_state &&
      position_ms >= reporter->last_position_ms + TIMELINE_REPORT_INTERVAL_MS;
  if (!force && same_item && same_state && !periodic_due) {
    return false;
  }
  reporter->gateway_url = gateway_url;
  reporter->plex_credentials = use_direct_plex ? plex_credentials : NULL;
  if (use_direct_plex) {
    strcpy(reporter->plex_session_id, plex_session_id);
  } else {
    reporter->plex_session_id[0] = '\0';
  }
  reporter->rating_key = rating_key;
  reporter->position_ms = position_ms;
  reporter->duration_ms = duration_ms;
  reporter->state = state;
  reporter->stack = malloc(TIMELINE_REPORT_STACK_SIZE);
  if (reporter->stack == NULL ||
      LWP_CreateThread(&reporter->thread, run_timeline_report, reporter,
                       reporter->stack, TIMELINE_REPORT_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: timeline report allocation failed\n");
    free(reporter->stack);
    reporter->stack = NULL;
    reporter->thread = LWP_THREAD_NULL;
    return false;
  }
  reporter->last_rating_key = rating_key;
  reporter->last_position_ms = position_ms;
  reporter->last_state = state;
  SYS_Report("REFERENCE GX: timeline-report queued rating-key=%u position=%u "
             "state=%s\n",
             rating_key, position_ms, state);
  return true;
}

static void
flush_timeline_report(TimelineReporter *reporter, const char *gateway_url,
                      const MultiplexAuthCredentials *plex_credentials,
                      const char *plex_session_id,
                      const MultiplexGatewayPlaybackManifest *manifest,
                      uint32_t position_ms, const char *state) {
  finish_timeline_report(reporter);
  if (manifest == NULL || manifest->rating_key == 0) {
    return;
  }
  if (schedule_timeline_report(reporter, gateway_url, plex_credentials,
                               plex_session_id, manifest->rating_key,
                               position_ms, manifest->media_duration_ms, state,
                               true)) {
    finish_timeline_report(reporter);
  }
}

static bool
load_selected_playback(const char *gateway_url,
                       MultiplexGatewayPlaybackManifest *active_manifest,
                       HttpClient **client, MpegPsDemux **demux) {
  const uint32_t rating_key = multiplex_native_app_playback_request();
  if (rating_key == 0) {
    return true;
  }
  const uint32_t offset_ms = multiplex_native_app_playback_offset_request();
  MultiplexGatewayPlaybackManifest requested;
  if (!multiplex_gateway_load_playback_manifest(gateway_url, rating_key,
                                                offset_ms, &requested)) {
    if (multiplex_native_app_playback_fail() == 0) {
      return false;
    }
    SYS_Report("REFERENCE GX: playback-session unavailable rating-key=%u\n",
               rating_key);
    return true;
  }
  if (*demux == NULL || active_manifest->rating_key != requested.rating_key ||
      active_manifest->segment_start_ms != requested.segment_start_ms) {
    const uint32_t previous_rating_key = active_manifest->rating_key;
    const bool replacing_session = *demux != NULL;
    close_media_session(client, demux);
    if (!open_media_session(&requested, client, demux)) {
      if (multiplex_native_app_playback_fail() == 0) {
        return false;
      }
      SYS_Report("REFERENCE GX: playback-session switch failed requested=%u\n",
                 requested.rating_key);
      return true;
    }
    *active_manifest = requested;
    if (replacing_session) {
      SYS_Report("REFERENCE GX: playback-session switched previous=%u "
                 "active=%u offset=%u\n",
                 previous_rating_key, requested.rating_key,
                 requested.segment_start_ms);
    } else {
      SYS_Report(
          "REFERENCE GX: playback-session activated rating-key=%u offset=%u\n",
          requested.rating_key, requested.segment_start_ms);
    }
  }
  if (multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: playback-session ready rating-key=%u offset=%u\n",
             requested.rating_key, requested.segment_start_ms);
  return true;
}

static bool
load_direct_playback(const MultiplexAuthCredentials *credentials,
                     uint32_t rating_key, uint32_t requested_offset,
                     bool transition_from_watch_together,
                     MultiplexGatewayPlaybackManifest *active_manifest,
                     HttpClient **client, MpegPsDemux **demux) {
  uint32_t duration_ms =
      active_manifest->rating_key == rating_key
          ? active_manifest->media_duration_ms
          : 0;
  MultiplexGatewayDetails details;
  memset(&details, 0, sizeof(details));
  if (duration_ms == 0) {
    if (direct_details_cache_valid &&
        direct_details_cache.rating_key == rating_key) {
      details = direct_details_cache;
      SYS_Report("REFERENCE GX: direct playback reused details rating-key=%u\n",
                 rating_key);
    } else if (!multiplex_plex_load_details(credentials, rating_key,
                                            &details) ||
               details.duration_ms == 0) {
      if (transition_from_watch_together) {
        SYS_Report("REFERENCE GX: direct playback metadata unavailable "
                   "rating-key=%u\n",
                   rating_key);
        return false;
      }
      if (multiplex_native_app_playback_fail() == 0) {
        return false;
      }
      SYS_Report("REFERENCE GX: direct playback metadata unavailable "
                 "rating-key=%u\n",
                 rating_key);
      return true;
    }
    duration_ms = details.duration_ms;
  }
  if (active_manifest->rating_key != rating_key &&
      !bind_item_subtitles(&details)) {
    return false;
  }
  bool burn_subtitles = active_manifest->rating_key == rating_key &&
                        active_manifest->burn_subtitles;
  uint32_t subtitle_stream_index = active_manifest->subtitle_stream_index;
  if (active_manifest->rating_key != rating_key) {
    burn_subtitles = false;
    subtitle_stream_index = 0;
    for (uint8_t index = 0; index < details.subtitle_stream_count; ++index) {
      const MultiplexGatewaySubtitleStream *subtitle =
          &details.subtitle_streams[index];
      if (subtitle->selected && subtitle->has_index) {
        burn_subtitles = true;
        subtitle_stream_index = subtitle->index;
        break;
      }
    }
  }
  if (direct_subtitle_override_pending) {
    burn_subtitles = direct_subtitle_override_burn;
    subtitle_stream_index = direct_subtitle_override_index;
    direct_subtitle_override_pending = false;
  }
  const uint32_t offset_ms =
      requested_offset < duration_ms ? requested_offset : 0;
  const bool same_session = direct_hls_demux != NULL &&
                            active_manifest->rating_key == rating_key &&
                            active_manifest->segment_start_ms == offset_ms &&
                            active_manifest->burn_subtitles == burn_subtitles &&
                            (!burn_subtitles ||
                             active_manifest->subtitle_stream_index ==
                                 subtitle_stream_index);
  if (!same_session) {
    const uint32_t previous_rating_key = active_manifest->rating_key;
    const char *resume_session_id =
        previous_rating_key == rating_key && direct_hls_session_id[0] != '\0'
            ? direct_hls_session_id
            : NULL;
    if (previous_rating_key != rating_key) {
      direct_hls_session_id[0] = '\0';
    }
    close_media_session(client, demux);
    /*
     * Browse/details memo entries retain roughly 4 MiB. The uploaded GX frame
     * remains valid after clearing them, and the player needs only its much
     * smaller current-frame memo. Reclaim the old UI working set before H.264
     * allocates reference pictures.
     */
    const uint32_t released = multiplex_native_reference_memo_clear();
    SYS_Report("REFERENCE GX: direct playback released-render-memo=%uKiB\n",
               released / 1024u);
    PlexHlsDemux *hls = NULL;
    if (!open_direct_hls_session(credentials, rating_key, offset_ms,
                                 resume_session_id, burn_subtitles,
                                 subtitle_stream_index, &hls)) {
      if (transition_from_watch_together) {
        SYS_Report("REFERENCE GX: direct playback switch failed requested=%u\n",
                   rating_key);
        return false;
      }
      if (multiplex_native_app_playback_fail() == 0) {
        return false;
      }
      SYS_Report("REFERENCE GX: direct playback switch failed requested=%u\n",
                 rating_key);
      return true;
    }
    memset(active_manifest, 0, sizeof(*active_manifest));
    active_manifest->version = 1;
    active_manifest->rating_key = rating_key;
    active_manifest->media_duration_ms = duration_ms;
    active_manifest->segment_start_ms = offset_ms;
    active_manifest->segment_duration_ms = duration_ms - offset_ms;
    active_manifest->burn_subtitles = burn_subtitles;
    active_manifest->subtitle_stream_index = subtitle_stream_index;
    SYS_Report("REFERENCE GX: direct playback activated previous=%u active=%u "
               "offset=%u duration=%u subtitles=%s index=%u\n",
               previous_rating_key, rating_key, offset_ms, duration_ms,
               burn_subtitles ? "burn" : "none", subtitle_stream_index);
  }
  if (!transition_from_watch_together &&
      multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: direct playback ready rating-key=%u offset=%u\n",
             rating_key, offset_ms);
  SYS_Report("REFERENCE GX: playback model state=%u\n",
             multiplex_native_app_playback_state());
  return true;
}

static bool
load_selected_direct_playback(const MultiplexAuthCredentials *credentials,
                              MultiplexGatewayPlaybackManifest *active_manifest,
                              HttpClient **client, MpegPsDemux **demux) {
  const uint32_t rating_key = multiplex_native_app_playback_request();
  if (rating_key == 0) {
    return true;
  }
  uint32_t offset_ms = multiplex_native_app_playback_offset_request();
  const uint32_t subtitle_selection =
      multiplex_native_app_subtitle_selection();
  direct_subtitle_override_pending = true;
  direct_subtitle_override_burn =
      subtitle_selection > 0 && subtitle_selection <= direct_subtitle_count;
  direct_subtitle_override_index =
      direct_subtitle_override_burn
          ? direct_subtitle_indices[subtitle_selection - 1u]
          : 0;
  if (direct_playback_start_offset_pending) {
    offset_ms = MULTIPLEX_PLAYBACK_START_OFFSET_MS;
    direct_playback_start_offset_pending = false;
    SYS_Report("REFERENCE GX: direct playback start override offset=%u\n",
               offset_ms);
  }
  return load_direct_playback(credentials, rating_key, offset_ms,
                              false, active_manifest, client, demux);
}

static uint32_t
playback_position_ms(const MultiplexGatewayPlaybackManifest *manifest) {
  if (manifest == NULL || manifest->rating_key == 0 || audio_output == NULL) {
    return manifest == NULL ? 0 : manifest->segment_start_ms;
  }
  uint64_t position =
      (uint64_t)manifest->segment_start_ms +
      (audio_dma_samples_played(audio_output) * 1000u) / AUDIO_SAMPLE_RATE;
  if (position > manifest->media_duration_ms) {
    position = manifest->media_duration_ms;
  }
  return (uint32_t)position;
}

#if MULTIPLEX_PAIRING_ENABLED
static bool navigate_direct_playback_if_requested(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux, TimelineReporter *timeline_reporter) {
  const int32_t direction =
      multiplex_native_app_playback_navigation_request();
  if (direction == 0) {
    return true;
  }
  if (credentials == NULL || active_manifest == NULL ||
      active_manifest->rating_key == 0) {
    return multiplex_native_app_playback_navigation_clear() != 0;
  }

  MultiplexGatewayItem target;
  const MultiplexPlexNextEpisodeResult result =
      direction < 0
          ? multiplex_plex_load_previous_episode(
                credentials, active_manifest->rating_key, &target)
          : multiplex_plex_load_next_episode(
                credentials, active_manifest->rating_key, &target);
  if (result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    if (multiplex_native_app_playback_navigation_clear() == 0) {
      return false;
    }
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: direct playback navigation direction=%s "
               "result=%s rating-key=%u\n",
               direction < 0 ? "previous" : "next",
               result == MULTIPLEX_PLEX_NEXT_EPISODE_NONE ? "none" : "error",
               active_manifest->rating_key);
    return true;
  }

  MultiplexGatewayDetails details;
  char hierarchy[48] = {0};
  uint16_t secondary_length = 0;
  uint32_t hierarchy_length = 0;
  if (!multiplex_plex_load_details(credentials, target.rating_key, &details) ||
      !format_episode_metadata(&details, &secondary_length, hierarchy,
                               sizeof(hierarchy), &hierarchy_length)) {
    multiplex_native_app_playback_navigation_clear();
    SYS_Report("REFERENCE GX: direct playback navigation metadata failed "
               "requested=%u\n",
               target.rating_key);
    return true;
  }

  const uint32_t previous_rating_key = active_manifest->rating_key;
  const uint32_t previous_position_ms =
      playback_position_ms(active_manifest);
  audio_dma_update(audio_output, false);
  flush_timeline_report(timeline_reporter, "", credentials,
                        direct_hls_session_id, active_manifest,
                        previous_position_ms, "stopped");
  if (multiplex_native_app_playback_navigate(
          target.rating_key, (const uint8_t *)details.title,
          details.title_length, (const uint8_t *)details.secondary,
          secondary_length, (const uint8_t *)hierarchy, hierarchy_length,
          details.duration_ms) == 0 ||
      !load_selected_direct_playback(credentials, active_manifest, client,
                                     demux)) {
    SYS_Report("REFERENCE GX: direct playback navigation switch failed "
               "previous=%u requested=%u\n",
               previous_rating_key, target.rating_key);
    return false;
  }
  native_frame_dirty = true;
  SYS_Report("REFERENCE GX: direct playback navigation direction=%s "
             "previous=%u active=%u title=%s\n",
             direction < 0 ? "previous" : "next", previous_rating_key,
             active_manifest->rating_key, details.title);
  return true;
}

static void stop_direct_playback_if_hidden(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux, TimelineReporter *timeline_reporter,
    bool *timeline_player_visible) {
  if (active_manifest == NULL || active_manifest->rating_key == 0 ||
      (multiplex_native_app_playback_state() & 1u) != 0) {
    return;
  }
  const uint32_t stopped_rating_key = active_manifest->rating_key;
  const uint32_t stopped_position_ms = playback_position_ms(active_manifest);
  audio_dma_update(audio_output, false);
  flush_timeline_report(timeline_reporter, "", credentials,
                        direct_hls_session_id, active_manifest,
                        stopped_position_ms, "stopped");
  close_media_session(client, demux);
  memset(active_manifest, 0, sizeof(*active_manifest));
  direct_hls_session_id[0] = '\0';
  *timeline_player_visible = false;
  SYS_Report("REFERENCE GX: direct playback stopped rating-key=%u "
             "position=%u\n",
             stopped_rating_key, stopped_position_ms);
}
#endif

static void texture_vertex(float x, float y, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(255, 255, 255, 255);
  GX_TexCoord2f32(u, v);
}

static void load_ui_translation_xy(float x, float y) {
  Mtx transform;
  ui_draw_translation_x = x;
  ui_draw_translation_y = y;
  guMtxTrans(transform, x, y, 0.0f);
  GX_LoadPosMtxImm(transform, GX_PNMTX0);
}

static void load_ui_translation(float y) {
  load_ui_translation_xy(0.0f, y);
}

static void set_ui_draw_clip(float left, float top, float right,
                             float bottom) {
  ui_draw_clip_active = true;
  ui_draw_clip_left = left;
  ui_draw_clip_top = top;
  ui_draw_clip_right = right;
  ui_draw_clip_bottom = bottom;
}

static void clear_ui_draw_clip(void) {
  ui_draw_clip_active = false;
}

static void configure_color_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX, GX_LIGHTNULL,
                 GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(0);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_PASSCLR);
}

static void configure_font_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX,
                 GX_LIGHTNULL, GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(1);
  GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX2x4, GX_TG_TEX0, GX_IDENTITY);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORD0, GX_TEXMAP0, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE0, GX_CC_ZERO, GX_CC_ZERO, GX_CC_ZERO,
                   GX_CC_RASC);
  GX_SetTevColorOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_TRUE, GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE0, GX_CA_ZERO, GX_CA_TEXA, GX_CA_RASA,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_TRUE, GX_TEVPREV);
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  GX_LoadTexObj(&font_texture, GX_TEXMAP0);
}

static GXColor command_color(uint32_t rgba) {
  GXColor color = {
      .r = (uint8_t)(rgba >> 24u),
      .g = (uint8_t)(rgba >> 16u),
      .b = (uint8_t)(rgba >> 8u),
      .a = (uint8_t)rgba,
  };
  if (presented_screen == MULTIPLEX_SCREEN_PLAYER) {
    color.a = (uint8_t)(((uint16_t)color.a * ui_frame_alpha + 127u) / 255u);
  }
  return color;
}

static void set_text_scissor(const MultiplexGxCommand *command) {
  if (command->has_clip == 0 && !ui_draw_clip_active) {
    GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
    return;
  }
  float left = command->has_clip != 0
                   ? command->clip_x + ui_draw_translation_x
                   : 0.0f;
  float top = command->has_clip != 0
                  ? command->clip_y + ui_draw_translation_y
                  : 0.0f;
  float right = command->has_clip != 0 ? left + command->clip_width
                                       : LOGICAL_WIDTH;
  float bottom = command->has_clip != 0 ? top + command->clip_height
                                        : LOGICAL_HEIGHT;
  if (ui_draw_clip_active) {
    left = fmaxf(left, ui_draw_clip_left);
    top = fmaxf(top, ui_draw_clip_top);
    right = fminf(right, ui_draw_clip_right);
    bottom = fminf(bottom, ui_draw_clip_bottom);
  }
  if (left < 0.0f) left = 0.0f;
  if (top < 0.0f) top = 0.0f;
  if (right > LOGICAL_WIDTH) right = LOGICAL_WIDTH;
  if (bottom > LOGICAL_HEIGHT) bottom = LOGICAL_HEIGHT;
  if (right <= left || bottom <= top) {
    GX_SetScissor(0, 0, 0, 0);
    return;
  }
  const float scale_x = video_mode->fbWidth / (float)LOGICAL_WIDTH;
  const float scale_y = video_mode->efbHeight / (float)LOGICAL_HEIGHT;
  GX_SetScissor((uint32_t)(left * scale_x), (uint32_t)(top * scale_y),
                (uint32_t)((right - left) * scale_x),
                (uint32_t)((bottom - top) * scale_y));
}

static void set_poster_scissor(const MultiplexPosterSurface *surface) {
  if (surface->has_clip == 0 && !ui_draw_clip_active) {
    GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
    return;
  }
  float left = surface->has_clip != 0
                   ? surface->clip_x + ui_draw_translation_x
                   : 0.0f;
  float top = surface->has_clip != 0
                  ? surface->clip_y + ui_draw_translation_y
                  : 0.0f;
  float right = surface->has_clip != 0 ? left + surface->clip_width
                                       : LOGICAL_WIDTH;
  float bottom = surface->has_clip != 0 ? top + surface->clip_height
                                        : LOGICAL_HEIGHT;
  if (ui_draw_clip_active) {
    left = fmaxf(left, ui_draw_clip_left);
    top = fmaxf(top, ui_draw_clip_top);
    right = fminf(right, ui_draw_clip_right);
    bottom = fminf(bottom, ui_draw_clip_bottom);
  }
  left = fmaxf(0.0f, left);
  top = fmaxf(0.0f, top);
  right = fminf(LOGICAL_WIDTH, right);
  bottom = fminf(LOGICAL_HEIGHT, bottom);
  if (right <= left || bottom <= top) {
    GX_SetScissor(0, 0, 0, 0);
    return;
  }
  const float scale_x = video_mode->fbWidth / (float)LOGICAL_WIDTH;
  const float scale_y = video_mode->efbHeight / (float)LOGICAL_HEIGHT;
  GX_SetScissor((uint32_t)(left * scale_x), (uint32_t)(top * scale_y),
                (uint32_t)((right - left) * scale_x),
                (uint32_t)((bottom - top) * scale_y));
}

static unsigned geist_size_index(float size) {
  unsigned closest = 0;
  float closest_distance = fabsf(size - (float)geist_sizes[0]);
  for (unsigned index = 1; index < GEIST_SIZE_COUNT; ++index) {
    const float distance = fabsf(size - (float)geist_sizes[index]);
    if (distance < closest_distance) {
      closest = index;
      closest_distance = distance;
    }
  }
  return closest;
}

static void font_vertex(float x, float y, GXColor color, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
  GX_TexCoord2f32(u, v);
}

static void draw_native_text_command(const MultiplexGxCommand *command) {
  if (command->text_ptr == NULL || command->text_len == 0) {
    return;
  }
  const GXColor color = command_color(command->color_rgba);
  if (color.a == 0) {
    return;
  }
  const unsigned size_index = geist_size_index(command->font_size);
  const float atlas_size = (float)geist_sizes[size_index];
  const float scale = command->font_size / atlas_size;
  const float start_x = command->has_clip != 0 && command->clip_x > command->x
                            ? command->clip_x
                            : command->x;
  float cursor_x = start_x;
  float baseline = command->y;
  uint32_t draw_length = command->text_len;
  uint32_t trailing_dots = 0;
  if (command->has_clip != 0) {
    const float available =
        command->clip_x + command->clip_width - start_x;
    float total_width = 0.0f;
    for (uint32_t index = 0; index < command->text_len; ++index) {
      uint8_t character = command->text_ptr[index];
      if (character == '\n') continue;
      if (character < GEIST_FIRST_CHARACTER ||
          character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
        character = '?';
      }
      const GeistGlyphMetric *metric =
          &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
      total_width += ((float)metric->advance_64 / 64.0f) * scale;
    }
    if (total_width > available) {
      const GeistGlyphMetric *dot =
          &geist_metrics[size_index]['.' - GEIST_FIRST_CHARACTER];
      const float dot_width = ((float)dot->advance_64 / 64.0f) * scale;
      trailing_dots = available >= dot_width * 3.0f
                          ? 3u
                          : (available >= dot_width ? 1u : 0u);
      const float content_width = available - dot_width * trailing_dots;
      float prefix_width = 0.0f;
      draw_length = 0;
      while (draw_length < command->text_len) {
        uint8_t character = command->text_ptr[draw_length];
        if (character == '\n') break;
        if (character < GEIST_FIRST_CHARACTER ||
            character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
          character = '?';
        }
        const GeistGlyphMetric *metric =
            &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
        const float advance =
            ((float)metric->advance_64 / 64.0f) * scale;
        if (prefix_width + advance > content_width) break;
        prefix_width += advance;
        ++draw_length;
      }
      while (draw_length > 0 && command->text_ptr[draw_length - 1u] == '.') {
        --draw_length;
      }
    }
  }
  uint32_t glyph_count = 0;
  for (uint32_t index = 0; index < draw_length; ++index) {
    uint8_t character = command->text_ptr[index];
    if (character == '\n') continue;
    if (character < GEIST_FIRST_CHARACTER ||
        character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
      character = '?';
    }
    const GeistGlyphMetric *metric =
        &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
    if (metric->width > 0 && metric->height > 0) ++glyph_count;
  }
  glyph_count += trailing_dots;
  if (glyph_count == 0 || glyph_count > UINT16_MAX / 4u) {
    return;
  }

  GX_Begin(GX_QUADS, GX_VTXFMT0, (uint16_t)(glyph_count * 4u));
  for (uint32_t index = 0; index < draw_length; ++index) {
    uint8_t character = command->text_ptr[index];
    if (character == '\n') {
      cursor_x = start_x;
      baseline += command->font_size * 1.25f;
      continue;
    }
    if (character < GEIST_FIRST_CHARACTER ||
        character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
      character = '?';
    }
    const GeistGlyphMetric *metric =
        &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
    if (metric->width > 0 && metric->height > 0) {
      const float left = cursor_x + (float)metric->bearing_x * scale;
      const float top = baseline + (float)metric->bearing_y * scale;
      const float right = left + (float)metric->width * scale;
      const float bottom = top + (float)metric->height * scale;
      const float u0 = (float)metric->u / (float)GEIST_ATLAS_WIDTH;
      const float v0 = (float)metric->v / (float)GEIST_ATLAS_HEIGHT;
      const float u1 = (float)(metric->u + metric->width) /
                       (float)GEIST_ATLAS_WIDTH;
      const float v1 = (float)(metric->v + metric->height) /
                       (float)GEIST_ATLAS_HEIGHT;
      font_vertex(left, top, color, u0, v0);
      font_vertex(right, top, color, u1, v0);
      font_vertex(right, bottom, color, u1, v1);
      font_vertex(left, bottom, color, u0, v1);
    }
    cursor_x += ((float)metric->advance_64 / 64.0f) * scale;
  }
  const GeistGlyphMetric *dot =
      &geist_metrics[size_index]['.' - GEIST_FIRST_CHARACTER];
  for (uint32_t index = 0; index < trailing_dots; ++index) {
    if (dot->width > 0 && dot->height > 0) {
      const float left = cursor_x + (float)dot->bearing_x * scale;
      const float top = baseline + (float)dot->bearing_y * scale;
      const float right = left + (float)dot->width * scale;
      const float bottom = top + (float)dot->height * scale;
      const float u0 = (float)dot->u / (float)GEIST_ATLAS_WIDTH;
      const float v0 = (float)dot->v / (float)GEIST_ATLAS_HEIGHT;
      const float u1 =
          (float)(dot->u + dot->width) / (float)GEIST_ATLAS_WIDTH;
      const float v1 =
          (float)(dot->v + dot->height) / (float)GEIST_ATLAS_HEIGHT;
      font_vertex(left, top, color, u0, v0);
      font_vertex(right, top, color, u1, v0);
      font_vertex(right, bottom, color, u1, v1);
      font_vertex(left, bottom, color, u0, v1);
    }
    cursor_x += ((float)dot->advance_64 / 64.0f) * scale;
  }
  GX_End();
}

static void draw_native_text_command_at(const NativeUiPacket *packet,
                                        uint32_t index) {
  const MultiplexGxCommand *command = &packet->text_commands[index];
  set_text_scissor(command);
  if (command->kind == MULTIPLEX_GX_GLYPH) {
    uint8_t character = '?';
    for (uint32_t glyph_index = 0; glyph_index < GEIST_CHARACTER_COUNT;
         ++glyph_index) {
      if (geist_glyph_ids[glyph_index] == command->glyph_id) {
        character = (uint8_t)(GEIST_FIRST_CHARACTER + glyph_index);
        break;
      }
    }
    MultiplexGxCommand glyph = *command;
    glyph.text_ptr = &character;
    glyph.text_len = 1;
    draw_native_text_command(&glyph);
  } else if (command->kind == MULTIPLEX_GX_TEXT) {
    draw_native_text_command(command);
  }
}

static void color_vertex(float x, float y, GXColor color) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
}

static void fill_circle(float center_x, float center_y, float radius,
                        GXColor color) {
  static const float unit_circle[9][2] = {
      {1.0f, 0.0f},        {0.7071068f, 0.7071068f},
      {0.0f, 1.0f},        {-0.7071068f, 0.7071068f},
      {-1.0f, 0.0f},       {-0.7071068f, -0.7071068f},
      {0.0f, -1.0f},       {0.7071068f, -0.7071068f},
      {1.0f, 0.0f},
  };
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 10);
  color_vertex(center_x, center_y, color);
  for (unsigned index = 0; index < 9; ++index) {
    color_vertex(center_x + unit_circle[index][0] * radius,
                 center_y + unit_circle[index][1] * radius, color);
  }
  GX_End();
}

static void draw_activity_dots(float center_y, uint32_t frame) {
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  const uint32_t active = (frame / 10u) % 3u;
  for (uint32_t index = 0; index < 3; ++index) {
    const uint8_t alpha = index == active ? 230u : 72u;
    fill_circle(312.0f + index * 8.0f, center_y, 2.0f,
                (GXColor){212, 212, 216, alpha});
  }
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
}

static void fill_rect(float left, float top, float right, float bottom,
                      GXColor color);

static void draw_activity(void) {
  if (network_activity_visible) {
    draw_activity_dots(380.0f, network_activity_frame);
    network_activity_frame += 1;
    return;
  }
  if (blocking_activity_visible) {
    draw_activity_dots(462.0f, 0);
    return;
  }
  if (reference_renderer.thread != LWP_THREAD_NULL &&
      screen_transition_frame >= 8u) {
    draw_activity_dots(462.0f, screen_transition_frame - 8u);
  }
  if (reference_renderer.thread != LWP_THREAD_NULL) {
    screen_transition_frame += 1;
  }
}

static void draw_stats_for_nerds(void) {
  if (video_surface.visible == 0 ||
      multiplex_native_app_stats_for_nerds_enabled() == 0) {
    diagnostic_network_started = 0;
    return;
  }

  const uint32_t now = gettick();
  uint32_t network_bytes = 0;
  size_t queued_video = 0;
  size_t queued_audio = 0;
  if (direct_hls_demux != NULL) {
    network_bytes = plex_hls_demux_video_bytes(direct_hls_demux) +
                    plex_hls_demux_audio_bytes(direct_hls_demux);
    queued_video = plex_hls_demux_queued_video_bytes(direct_hls_demux);
    queued_audio = plex_hls_demux_queued_audio_bytes(direct_hls_demux);
  }
  if (diagnostic_network_started == 0) {
    diagnostic_network_started = now;
    diagnostic_network_last_bytes = network_bytes;
  } else {
    const uint32_t measured_us = elapsed_us(diagnostic_network_started);
    if (measured_us >= 1000000u) {
      const uint32_t delta = network_bytes - diagnostic_network_last_bytes;
      diagnostic_network_kib_per_second =
          (uint32_t)(((uint64_t)delta * 1000000ull) /
                     ((uint64_t)measured_us * 1024ull));
      diagnostic_network_started = now;
      diagnostic_network_last_bytes = network_bytes;
    }
  }

  const struct mallinfo heap = mallinfo();
  char text[256];
  const int length = snprintf(
      text, sizeof(text),
      "UI %u.%u  VIDEO %u.%u  CODEC %u/%u ms  UPLOAD %u ms\n"
      "NET %u KiB/s  QUEUE V%u A%u KiB  AUDIO %u/18 U%u\n"
      "HEAP %u KiB free",
      diagnostic_presentation_fps_tenths / 10u,
      diagnostic_presentation_fps_tenths % 10u,
      diagnostic_decoder_fps_tenths / 10u,
      diagnostic_decoder_fps_tenths % 10u,
      diagnostic_codec_average_us / 1000u, diagnostic_codec_max_us / 1000u,
      diagnostic_upload_average_us / 1000u,
      diagnostic_network_kib_per_second, (uint32_t)(queued_video / 1024u),
      (uint32_t)(queued_audio / 1024u),
      audio_dma_ready_buffers(audio_output), audio_dma_underruns(audio_output),
      (uint32_t)heap.fordblks / 1024u);
  if (length <= 0) {
    return;
  }

  configure_color_pipeline();
  fill_rect(8.0f, 8.0f, 632.0f, 68.0f, (GXColor){0, 0, 0, 220});
  configure_font_pipeline();
  const MultiplexGxCommand command = {
      .kind = MULTIPLEX_GX_TEXT,
      .x = 16.0f,
      .y = 12.0f,
      .color_rgba = 0xffffffffu,
      .text_ptr = (const uint8_t *)text,
      .text_len = (uint32_t)length,
      .font_size = 13.0f,
  };
  draw_native_text_command(&command);
}

static void fill_rect(float left, float top, float right, float bottom,
                      GXColor color) {
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  color_vertex(left, top, color);
  color_vertex(right, top, color);
  color_vertex(right, bottom, color);
  color_vertex(left, bottom, color);
  GX_End();
}

static const float rounded_arc[5][2] = {
    {1.0f, 0.0f},
    {0.9238795f, 0.3826834f},
    {0.7071068f, 0.7071068f},
    {0.3826834f, 0.9238795f},
    {0.0f, 1.0f},
};

static void fill_rounded_corner(float center_x, float center_y, float radius,
                                float x_sign, float y_sign, GXColor color) {
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 6);
  color_vertex(center_x, center_y, color);
  for (unsigned index = 0; index < 5; ++index) {
    color_vertex(center_x + x_sign * rounded_arc[index][0] * radius,
                 center_y + y_sign * rounded_arc[index][1] * radius, color);
  }
  GX_End();
}

static void fill_rounded_color_rect(float left, float top, float right,
                                    float bottom, float radius,
                                    GXColor color) {
  const float width = right - left;
  const float height = bottom - top;
  const float maximum = (width < height ? width : height) * 0.5f;
  if (radius > maximum) radius = maximum;
  if (radius < 1.0f) {
    fill_rect(left, top, right, bottom, color);
    return;
  }
  fill_rect(left + radius, top, right - radius, bottom, color);
  fill_rect(left, top + radius, right, bottom - radius, color);
  fill_rounded_corner(left + radius, top + radius, radius, -1.0f, -1.0f,
                      color);
  fill_rounded_corner(right - radius, top + radius, radius, 1.0f, -1.0f,
                      color);
  fill_rounded_corner(right - radius, bottom - radius, radius, 1.0f, 1.0f,
                      color);
  fill_rounded_corner(left + radius, bottom - radius, radius, -1.0f, 1.0f,
                      color);
}

static void stroke_rounded_corner(float center_x, float center_y,
                                  float outer_radius, float inner_radius,
                                  float x_sign, float y_sign, GXColor color) {
  GX_Begin(GX_TRIANGLESTRIP, GX_VTXFMT0, 10);
  for (unsigned index = 0; index < 5; ++index) {
    color_vertex(center_x + x_sign * rounded_arc[index][0] * outer_radius,
                 center_y + y_sign * rounded_arc[index][1] * outer_radius,
                 color);
    color_vertex(center_x + x_sign * rounded_arc[index][0] * inner_radius,
                 center_y + y_sign * rounded_arc[index][1] * inner_radius,
                 color);
  }
  GX_End();
}

static void stroke_rounded_color_rect(float left, float top, float right,
                                      float bottom, float radius, float stroke,
                                      GXColor color) {
  const float width = right - left;
  const float height = bottom - top;
  const float maximum = (width < height ? width : height) * 0.5f;
  if (radius > maximum) radius = maximum;
  if (stroke < 1.0f) stroke = 1.0f;
  if (stroke * 2.0f >= width || stroke * 2.0f >= height || radius < 1.0f) {
    fill_rect(left, top, right, top + stroke, color);
    fill_rect(left, bottom - stroke, right, bottom, color);
    fill_rect(left, top + stroke, left + stroke, bottom - stroke, color);
    fill_rect(right - stroke, top + stroke, right, bottom - stroke, color);
    return;
  }
  const float inner_radius = radius > stroke ? radius - stroke : 0.0f;
  fill_rect(left + radius, top, right - radius, top + stroke, color);
  fill_rect(left + radius, bottom - stroke, right - radius, bottom, color);
  fill_rect(left, top + radius, left + stroke, bottom - radius, color);
  fill_rect(right - stroke, top + radius, right, bottom - radius, color);
  stroke_rounded_corner(left + radius, top + radius, radius, inner_radius,
                        -1.0f, -1.0f, color);
  stroke_rounded_corner(right - radius, top + radius, radius, inner_radius,
                        1.0f, -1.0f, color);
  stroke_rounded_corner(right - radius, bottom - radius, radius, inner_radius,
                        1.0f, 1.0f, color);
  stroke_rounded_corner(left + radius, bottom - radius, radius, inner_radius,
                        -1.0f, 1.0f, color);
}

static float native_stroke_radius(const NativeUiPacket *packet,
                                  uint32_t command_index,
                                  const MultiplexGxCommand *stroke) {
  if (stroke->radius >= 1.0f) return stroke->radius;
  for (uint32_t index = command_index; index > 0; --index) {
    const MultiplexGxCommand *fill =
        &packet->shape_commands[index - 1u];
    if (fill->kind != MULTIPLEX_GX_FILL_ROUNDED_RECT) continue;
    const float left_inset = fill->x - stroke->x;
    const float top_inset = fill->y - stroke->y;
    const float right_inset =
        stroke->x + stroke->width - fill->x - fill->width;
    const float bottom_inset =
        stroke->y + stroke->height - fill->y - fill->height;
    if (left_inset < 0.0f || top_inset < 0.0f || right_inset < 0.0f ||
        bottom_inset < 0.0f || left_inset > 4.0f || top_inset > 4.0f ||
        right_inset > 4.0f || bottom_inset > 4.0f) {
      continue;
    }
    const float inset = fmaxf(fmaxf(left_inset, top_inset),
                              fmaxf(right_inset, bottom_inset));
    return fill->radius + inset;
  }
  return 0.0f;
}

static bool details_backdrop_active(void) {
  if (presented_screen != MULTIPLEX_SCREEN_DETAILS ||
      poster_surface_count == 0 || poster_texture_count == 0) {
    return false;
  }
  const uint32_t image_id = poster_surfaces[0].image_id;
  return image_id != 0 && image_id <= poster_texture_count;
}

static bool is_ambient_background(const MultiplexGxCommand *command) {
  return (details_backdrop_active() || player_startup_backdrop_visible) &&
         command->kind == MULTIPLEX_GX_FILL_RECT &&
         command->x <= 0.0f && command->y <= 0.0f &&
         command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT;
}

static void draw_native_shape_command_at(const NativeUiPacket *packet,
                                         uint32_t index) {
  const MultiplexGxCommand *command = &packet->shape_commands[index];
  if (is_ambient_background(command)) return;
  set_text_scissor(command);
  GXColor color = command_color(command->color_rgba);
  if (modal_surface.visible != 0 && command->kind == MULTIPLEX_GX_FILL_RECT &&
      command->x <= 0.0f && command->y <= 0.0f &&
      command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT &&
      color.a > 0u && color.a < 96u) {
    color.a = 176u;
  }
  const float left = command->x;
  const float top = command->y;
  const float right = left + command->width;
  const float bottom = top + command->height;
  switch (command->kind) {
    case MULTIPLEX_GX_FILL_RECT:
      fill_rect(left, top, right, bottom, color);
      break;
    case MULTIPLEX_GX_FILL_ROUNDED_RECT:
      fill_rounded_color_rect(left, top, right, bottom, command->radius,
                              color);
      break;
    case MULTIPLEX_GX_STROKE_RECT:
      stroke_rounded_color_rect(
          left, top, right, bottom, native_stroke_radius(packet, index, command),
          command->stroke_width, color);
      break;
    case MULTIPLEX_GX_LINE: {
      const float stroke = command->stroke_width < 1.0f
                               ? 1.0f
                               : command->stroke_width;
      if (fabsf(command->x2 - command->x) >=
          fabsf(command->y2 - command->y)) {
        fill_rect(fminf(command->x, command->x2),
                  fminf(command->y, command->y2) - stroke * 0.5f,
                  fmaxf(command->x, command->x2),
                  fminf(command->y, command->y2) + stroke * 0.5f, color);
      } else {
        fill_rect(fminf(command->x, command->x2) - stroke * 0.5f,
                  fminf(command->y, command->y2),
                  fminf(command->x, command->x2) + stroke * 0.5f,
                  fmaxf(command->y, command->y2), color);
      }
      break;
    }
    case MULTIPLEX_GX_PATH_LINE: {
      const float dx = command->x2 - command->x;
      const float dy = command->y2 - command->y;
      const float length = sqrtf(dx * dx + dy * dy);
      if (length <= 0.001f) {
        break;
      }
      unsigned line_width = (unsigned)(command->stroke_width * 6.0f + 0.5f);
      if (line_width < 6u) line_width = 6u;
      if (line_width > 255u) line_width = 255u;
      GX_SetLineWidth((uint8_t)line_width, GX_TO_ZERO);
      GX_Begin(GX_LINES, GX_VTXFMT0, 2);
      color_vertex(command->x, command->y, color);
      color_vertex(command->x2, command->y2, color);
      GX_End();
      break;
    }
    case MULTIPLEX_GX_FILL_TRIANGLE:
      GX_Begin(GX_TRIANGLES, GX_VTXFMT0, 3);
      color_vertex(command->x, command->y, color);
      color_vertex(command->x2, command->y2, color);
      color_vertex(command->width, command->height, color);
      GX_End();
      break;
  default:
    break;
  }
}

static void draw_ambient_poster(uint32_t texture_index, uint8_t scrim_alpha,
                                uint8_t left_scrim_alpha) {
  configure_ui_pipeline();
  GX_LoadTexObj(&poster_textures[texture_index], GX_TEXMAP0);

  /* Cover the screen with the center of the portrait. The heavy scrim turns
   * the cached poster into ambient color without competing with the content. */
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  texture_vertex(0.0f, 0.0f, 0.0f, 0.25f);
  texture_vertex(LOGICAL_WIDTH, 0.0f, 1.0f, 0.25f);
  texture_vertex(LOGICAL_WIDTH, LOGICAL_HEIGHT, 1.0f, 0.75f);
  texture_vertex(0.0f, LOGICAL_HEIGHT, 0.0f, 0.75f);
  GX_End();

  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  fill_rect(0.0f, 0.0f, LOGICAL_WIDTH, LOGICAL_HEIGHT,
            (GXColor){10, 10, 12, scrim_alpha});
  if (left_scrim_alpha != 0) {
    fill_rect(0.0f, 0.0f, 205.0f, LOGICAL_HEIGHT,
              (GXColor){10, 10, 12, left_scrim_alpha});
  }
}

static void draw_details_backdrop(void) {
  if (details_backdrop_active()) {
    draw_ambient_poster(poster_surfaces[0].image_id - 1u, 224u, 44u);
  }
}

static int32_t poster_texture_for_rating_key(uint32_t rating_key) {
  if (rating_key == 0) {
    return -1;
  }
  for (uint16_t index = 0; index < poster_texture_count; ++index) {
    if (poster_texture_rating_keys[index] == rating_key) {
      return (int32_t)index;
    }
  }
  return -1;
}

static uint32_t focused_poster_rating_key(void) {
  const uint32_t screen = multiplex_native_app_screen();
  if (screen != MULTIPLEX_SCREEN_HOME && screen != MULTIPLEX_SCREEN_BROWSE &&
      screen != MULTIPLEX_SCREEN_SEARCH_RESULTS) {
    return 0;
  }
  for (uint32_t index = 0; index < poster_surface_count; ++index) {
    const uint32_t image_id = poster_surfaces[index].image_id;
    if (poster_surfaces[index].focused != 0 && image_id != 0 &&
        image_id <= poster_texture_count) {
      return poster_texture_rating_keys[image_id - 1u];
    }
  }
  return 0;
}

static void draw_player_startup_backdrop(
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  player_startup_backdrop_visible = false;
  if (presented_screen != MULTIPLEX_SCREEN_PLAYER || video_texture_ready) {
    return;
  }
  uint32_t rating_key =
      playback_manifest == NULL ? 0 : playback_manifest->rating_key;
  if (rating_key == 0 && direct_details_cache_valid) {
    rating_key = direct_details_cache.rating_key;
  }
  const int32_t texture_index =
      poster_texture_for_rating_key(rating_key);
  if (texture_index < 0) {
    return;
  }
  player_startup_backdrop_visible = true;
  draw_ambient_poster((uint32_t)texture_index, 176u, 0u);
}

static void draw_reference_frame(void) {
  configure_ui_pipeline();
  for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
    for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      const float left = tile_x * TILE_WIDTH;
      const float top = tile_y * TILE_HEIGHT;
      const float right = left + TILE_WIDTH;
      const float bottom = top + TILE_HEIGHT;

      GX_LoadTexObj(&textures[tile_index], GX_TEXMAP0);
      GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
      texture_vertex(left, top, 0.0f, 0.0f);
      texture_vertex(right, top, 1.0f, 0.0f);
      texture_vertex(right, bottom, 1.0f, 1.0f);
      texture_vertex(left, bottom, 0.0f, 1.0f);
      GX_End();
    }
  }
}

static void poster_texture_vertex(const MultiplexPosterSurface *surface,
                                  float x, float y) {
  texture_vertex(x, y, (x - surface->x) / surface->width,
                 (y - surface->y) / surface->height);
}

static void draw_poster_rect(const MultiplexPosterSurface *surface, float left,
                             float top, float right, float bottom) {
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  poster_texture_vertex(surface, left, top);
  poster_texture_vertex(surface, right, top);
  poster_texture_vertex(surface, right, bottom);
  poster_texture_vertex(surface, left, bottom);
  GX_End();
}

static void draw_poster_corner(const MultiplexPosterSurface *surface,
                               float center_x, float center_y, float radius,
                               float x_sign, float y_sign) {
  static const float arc[5][2] = {
      {1.0f, 0.0f},
      {0.9238795f, 0.3826834f},
      {0.7071068f, 0.7071068f},
      {0.3826834f, 0.9238795f},
      {0.0f, 1.0f},
  };
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 6);
  poster_texture_vertex(surface, center_x, center_y);
  for (unsigned index = 0; index < 5; ++index) {
    poster_texture_vertex(surface, center_x + x_sign * arc[index][0] * radius,
                          center_y + y_sign * arc[index][1] * radius);
  }
  GX_End();
}

static void draw_rounded_poster(const MultiplexPosterSurface *surface) {
  const float maximum =
      (surface->width < surface->height ? surface->width : surface->height) *
      0.5f;
  float radius = surface->radius;
  if (radius > maximum) {
    radius = maximum;
  }
  if (radius < 1.0f) {
    draw_poster_rect(surface, surface->x, surface->y,
                     surface->x + surface->width,
                     surface->y + surface->height);
    return;
  }

  const float left = surface->x;
  const float top = surface->y;
  const float right = left + surface->width;
  const float bottom = top + surface->height;
  draw_poster_rect(surface, left + radius, top, right - radius, bottom);
  draw_poster_rect(surface, left, top + radius, right, bottom - radius);
  draw_poster_corner(surface, left + radius, top + radius, radius, -1.0f,
                     -1.0f);
  draw_poster_corner(surface, right - radius, top + radius, radius, 1.0f,
                     -1.0f);
  draw_poster_corner(surface, right - radius, bottom - radius, radius, 1.0f,
                     1.0f);
  draw_poster_corner(surface, left + radius, bottom - radius, radius, -1.0f,
                     1.0f);
}

static MultiplexPosterSurface poster_display_surface(
    const MultiplexPosterSurface *surface) {
  MultiplexPosterSurface display = *surface;
  if (surface->width < 68.0f) display.width = 68.0f;
  if (surface->height < 102.0f) display.height = 102.0f;
  return display;
}

static MultiplexPosterSurface poster_clip_surface(
    const MultiplexPosterSurface *surface) {
  MultiplexPosterSurface clip = *surface;
  if (surface->width < 68.0f || surface->height < 102.0f) {
    clip.has_clip = 1u;
    clip.clip_x = surface->x;
    clip.clip_y = surface->y;
    clip.clip_width = surface->width;
    clip.clip_height = surface->height;
  }
  return clip;
}

static void draw_poster_surfaces(void) {
  if (poster_texture_count == 0) {
    return;
  }
  configure_ui_pipeline();
  for (uint32_t index = 0; index < poster_surface_count; ++index) {
    const MultiplexPosterSurface *surface = &poster_surfaces[index];
    if (surface->image_id == 0 || surface->image_id > poster_texture_count) {
      continue;
    }
    const MultiplexPosterSurface clip = poster_clip_surface(surface);
    const MultiplexPosterSurface display = poster_display_surface(surface);
    set_poster_scissor(&clip);
    GX_LoadTexObj(&poster_textures[surface->image_id - 1u], GX_TEXMAP0);
    if (surface->focused != 0) {
      const float progress =
          POSTER_FOCUS_FRAMES <= 1u
              ? 1.0f
              : (float)poster_focus_frame / (float)(POSTER_FOCUS_FRAMES - 1u);
      const float remaining = 1.0f - progress;
      const float eased = 1.0f - remaining * remaining * remaining;
      MultiplexPosterSurface lifted = display;
      lifted.x -= eased * 2.0f;
      lifted.y -= eased * 3.0f;
      lifted.width += eased * 4.0f;
      lifted.height += eased * 4.0f;
      lifted.radius += eased;
      draw_rounded_poster(&lifted);
    } else {
      draw_rounded_poster(&display);
    }
  }
  for (uint32_t index = 0; index < poster_surface_count; ++index) {
    const MultiplexPosterSurface *surface = &poster_surfaces[index];
    set_poster_scissor(surface);
    if (surface->focused == 0 || surface->card_width <= 0 ||
        surface->card_height <= 0) {
      continue;
    }
    configure_color_pipeline();
    GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                    GX_LO_CLEAR);
    const float progress =
        POSTER_FOCUS_FRAMES <= 1u
            ? 1.0f
            : (float)poster_focus_frame / (float)(POSTER_FOCUS_FRAMES - 1u);
    const float remaining = 1.0f - progress;
    const float eased = 1.0f - remaining * remaining * remaining;
    const float poster_left = surface->x - eased * 2.0f;
    const float poster_top = surface->y - eased * 3.0f;
    const float poster_right = surface->x + surface->width + eased * 2.0f;
    const float poster_bottom = surface->y + surface->height + eased;
    stroke_rounded_color_rect(poster_left, poster_top, poster_right,
                              poster_bottom, surface->radius + eased, 1.5f,
                              (GXColor){255, 255, 255, 176});
    break;
  }
  if (poster_focus_frame < POSTER_FOCUS_FRAMES) {
    poster_focus_frame += 1u;
  }
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void draw_packet_shapes_region(const NativeUiPacket *packet,
                                      float top, float bottom, float x,
                                      float y) {
  set_ui_draw_clip(0.0f, top, LOGICAL_WIDTH, bottom);
  load_ui_translation_xy(x, y);
  if (packet->shape_command_count == 0) return;
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  for (uint32_t index = 0; index < packet->shape_command_count; ++index) {
    const MultiplexGxCommand *command = &packet->shape_commands[index];
    const bool full_screen =
        command->x <= 0.0f && command->y <= 0.0f &&
        command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT;
    const float center_y =
        command->kind == MULTIPLEX_GX_LINE ||
                command->kind == MULTIPLEX_GX_PATH_LINE
            ? (command->y + command->y2) * 0.5f
            : command->y + command->height * 0.5f;
    if (full_screen || center_y < top || center_y >= bottom) continue;
    draw_native_shape_command_at(packet, index);
  }
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void draw_packet_posters_region(
    const MultiplexPosterSurface *surfaces, uint32_t count, float top,
    float bottom, float x, float y) {
  set_ui_draw_clip(HOME_CAROUSEL_LEFT, top, HOME_CAROUSEL_RIGHT, bottom);
  load_ui_translation_xy(x, y);
  if (poster_texture_count == 0) return;
  configure_ui_pipeline();
  for (uint32_t index = 0; index < count; ++index) {
    const MultiplexPosterSurface *surface = &surfaces[index];
    const float center_y = surface->y + surface->height * 0.5f;
    if (center_y < top || center_y >= bottom || surface->image_id == 0 ||
        surface->image_id > poster_texture_count) {
      continue;
    }
    const MultiplexPosterSurface clip = poster_clip_surface(surface);
    const MultiplexPosterSurface display = poster_display_surface(surface);
    set_poster_scissor(&clip);
    GX_LoadTexObj(&poster_textures[surface->image_id - 1u], GX_TEXMAP0);
    draw_rounded_poster(&display);
  }
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void draw_packet_text_region(const NativeUiPacket *packet, float top,
                                    float bottom, float x, float y) {
  set_ui_draw_clip(0.0f, top, LOGICAL_WIDTH, bottom);
  load_ui_translation_xy(x, y);
  if (packet->text_command_count == 0) return;
  configure_font_pipeline();
  for (uint32_t index = 0; index < packet->text_command_count; ++index) {
    const MultiplexGxCommand *command = &packet->text_commands[index];
    if (command->y < top || command->y >= bottom) continue;
    draw_native_text_command_at(packet, index);
  }
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void draw_home_background(void) {
  load_ui_translation_xy(0.0f, 0.0f);
  clear_ui_draw_clip();
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  for (uint32_t index = 0; index < presented_ui_packet.shape_command_count;
       ++index) {
    const MultiplexGxCommand *command =
        &presented_ui_packet.shape_commands[index];
    if (command->x <= 0.0f && command->y <= 0.0f &&
        command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT) {
      draw_native_shape_command_at(&presented_ui_packet, index);
    }
  }
}

static void draw_home_motion(void) {
  const float progress = HOME_MOTION_FRAMES <= 1u
                             ? 1.0f
                             : (float)home_motion_frame /
                                   (float)(HOME_MOTION_FRAMES - 1u);
  const float eased = progress * progress * (3.0f - 2.0f * progress);
  const float direction = (float)home_motion_direction;
  if (presented_screen == MULTIPLEX_SCREEN_BROWSE) {
    const float current_y =
        direction * BROWSE_ROW_STRIDE * (1.0f - eased);
    draw_home_background();
    draw_packet_shapes_region(&presented_ui_packet, 0.0f, BROWSE_GRID_TOP,
                              0.0f, 0.0f);
    draw_packet_shapes_region(&presented_ui_packet, BROWSE_GRID_TOP,
                              LOGICAL_HEIGHT, 0.0f, current_y);
    draw_packet_posters_region(poster_surfaces, poster_surface_count,
                               BROWSE_GRID_TOP, LOGICAL_HEIGHT, 0.0f,
                               current_y);
    draw_packet_text_region(&presented_ui_packet, 0.0f, BROWSE_GRID_TOP,
                            0.0f, 0.0f);
    draw_packet_text_region(&presented_ui_packet, BROWSE_GRID_TOP,
                            LOGICAL_HEIGHT, 0.0f, current_y);
    clear_ui_draw_clip();
    load_ui_translation_xy(0.0f, 0.0f);
    GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
    if (home_motion_frame + 1u >= HOME_MOTION_FRAMES) {
      home_motion_frame = HOME_MOTION_FRAMES;
      home_motion_kind = HOME_MOTION_NONE;
      SYS_Report("REFERENCE GX: browse motion complete\n");
    } else {
      home_motion_frame += 1u;
    }
    return;
  }
  float previous_x = 0.0f;
  float previous_y = 0.0f;
  float current_x = 0.0f;
  float moving_top = HOME_CONTENT_TOP;
  float moving_bottom = LOGICAL_HEIGHT;

  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    previous_x = -direction * HOME_CARD_STRIDE * eased;
    current_x = direction * HOME_CARD_STRIDE * (1.0f - eased);
    moving_top = HOME_ACTIVE_CARD_TOP;
    moving_bottom = HOME_ACTIVE_SHELF_BOTTOM;
  } else {
    previous_y = -direction * HOME_SHELF_STRIDE * eased;
  }

  draw_home_background();
  draw_packet_shapes_region(&presented_ui_packet, 0.0f, moving_top,
                            0.0f, 0.0f);
  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_shapes_region(&presented_ui_packet, moving_bottom,
                              LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_shapes_region(&home_motion_previous_packet, moving_top,
                            moving_bottom, previous_x, previous_y);
  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_shapes_region(&presented_ui_packet, moving_top,
                              moving_bottom, current_x, 0.0f);
  }

  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_posters_region(poster_surfaces, poster_surface_count,
                               moving_bottom, LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_posters_region(home_motion_previous_surfaces,
                             home_motion_previous_surface_count,
                             moving_top, moving_bottom, previous_x,
                             previous_y);
  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_posters_region(poster_surfaces, poster_surface_count,
                               moving_top, moving_bottom, current_x,
                               0.0f);
  }

  draw_packet_text_region(&presented_ui_packet, 0.0f, moving_top, 0.0f,
                          0.0f);
  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_text_region(&presented_ui_packet, moving_bottom,
                            LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_text_region(&home_motion_previous_packet, moving_top,
                          moving_bottom, previous_x, previous_y);
  if (home_motion_kind == HOME_MOTION_HORIZONTAL) {
    draw_packet_text_region(&presented_ui_packet, moving_top,
                            moving_bottom, current_x, 0.0f);
  }

  clear_ui_draw_clip();
  load_ui_translation_xy(0.0f, 0.0f);
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
  if (home_motion_frame + 1u >= HOME_MOTION_FRAMES) {
    home_motion_frame = HOME_MOTION_FRAMES;
    home_motion_kind = HOME_MOTION_NONE;
    SYS_Report("REFERENCE GX: home motion complete\n");
  } else {
    home_motion_frame += 1u;
  }
}

static uint32_t modal_layer_sequence(const NativeUiPacket *packet) {
  if (modal_surface.visible == 0) return UINT32_MAX;
  for (uint32_t index = 0; index < packet->shape_command_count; ++index) {
    const MultiplexGxCommand *command = &packet->shape_commands[index];
    const uint8_t alpha = (uint8_t)command->color_rgba;
    if (command->kind == MULTIPLEX_GX_FILL_RECT && command->x <= 0.0f &&
        command->y <= 0.0f && command->width >= LOGICAL_WIDTH &&
        command->height >= LOGICAL_HEIGHT && alpha > 0u && alpha < 96u) {
      return packet->shape_sequences[index];
    }
  }
  return UINT32_MAX;
}

static void draw_video_surface(void) {
  if (video_surface.visible == 0 || video_surface.width <= 0 ||
      video_surface.height <= 0) {
    audio_dma_update(audio_output, false);
    video_audio_clock_started = false;
    video_was_playing = false;
    return;
  }

  const size_t video_size = mpeg_ps_demux_video_size(media_demux);
  const size_t audio_size = mpeg_ps_demux_audio_size(media_demux);
  const size_t video_prebuffer =
      video_size < VIDEO_PREBUFFER_BYTES ? video_size : VIDEO_PREBUFFER_BYTES;
  const size_t audio_prebuffer =
      audio_size < AUDIO_PREBUFFER_BYTES ? audio_size : AUDIO_PREBUFFER_BYTES;
  const bool source_ready =
      media_demux == NULL ||
      (mpeg_ps_demux_video_bytes_pumped(media_demux) >= video_prebuffer &&
       mpeg_ps_demux_audio_bytes_pumped(media_demux) >= audio_prebuffer);
  const bool playing = video_surface.playing != 0 && source_ready;
  audio_dma_update(audio_output, playing);
  const bool playback_changed = playing != video_was_playing;
  if (playback_changed) {
    video_frame_count = 0;
    video_decode_total_us = 0;
    video_decode_max_us = 0;
    video_codec_total_us = 0;
    video_codec_max_us = 0;
    video_upload_total_us = 0;
    video_upload_max_us = 0;
    video_was_playing = playing;
  }

  bool texture_changed = false;
  uint32_t completed_decode_us = 0;
  uint32_t completed_codec_us = 0;
  uint32_t completed_upload_us = 0;
  LWP_MutexLock(video_decoder_mutex);
  if (video_decode_ready) {
    completed_decode_us = video_decode_ready_us;
    completed_codec_us = video_codec_ready_us;
    completed_upload_us = video_upload_ready_us;
    video_decode_ready = false;
    video_texture_ready = true;
    texture_changed = true;
  }
  bool decoder_failed = video_decode_failed;
  LWP_MutexUnlock(video_decoder_mutex);

  /*
   * Swap before requesting another decode. That makes the former front buffer
   * the worker's back buffer and lets a late clock request catch up in this
   * same presentation frame without racing the GX texture swap.
   */
  if (texture_changed) {
    yuv420_gx_swap();
    profile_decoded_frame(completed_decode_us, completed_codec_us,
                          completed_upload_us);
  }
  const uint64_t audio_samples = audio_dma_samples_played(audio_output);
  if (playing && !video_audio_clock_started) {
    video_audio_start_samples = audio_samples;
    video_audio_start_completions = video_decode_completion_count;
    video_audio_clock_started = true;
  }
  LWP_MutexLock(video_decoder_mutex);
  uint32_t desired_completions = video_decode_completion_count;
  int64_t media_elapsed_samples = -video_pts_offset_samples;
  if (video_audio_clock_started) {
    media_elapsed_samples +=
        (int64_t)(audio_samples - video_audio_start_samples);
  }
  if (playing && media_elapsed_samples >= 0) {
    desired_completions =
        video_audio_start_completions + 1u +
        (uint32_t)(((uint64_t)media_elapsed_samples * video_rate_millihertz) /
                   (AUDIO_SAMPLE_RATE * 1000u));
  }
  const bool cadence_due =
      (!video_texture_ready && (!playing || media_elapsed_samples >= 0)) ||
      (playing && video_decode_completion_count < desired_completions);
  if (cadence_due && !video_decode_running && !video_decode_ready &&
      !video_decode_failed) {
    video_decode_running = true;
    video_decode_requested = true;
    video_decode_request_count += 1;
    LWP_CondSignal(video_decoder_condition);
  }
  decoder_failed = video_decode_failed;
  if (playback_changed) {
    SYS_Report("REFERENCE GX: playback=%s clock=audio samples=%llu "
               "pts-offset-samples=%lld target=%u decoder requests=%u "
               "completed=%u running=%u ready=%u\n",
               playing ? "playing" : "paused", audio_samples,
               video_pts_offset_samples, desired_completions,
               video_decode_request_count, video_decode_completion_count,
               video_decode_running, video_decode_ready);
  }
  LWP_MutexUnlock(video_decoder_mutex);

  if (!video_texture_ready || decoder_failed) {
    return;
  }

  float left = video_surface.x;
  float top = video_surface.y;
  float width = video_surface.width;
  float height = video_surface.height;
  if (video_content_width > 0 && video_content_height > 0) {
    const float width_scale = width / (float)video_content_width;
    const float height_scale = height / (float)video_content_height;
    const float scale = width_scale < height_scale ? width_scale : height_scale;
    const float fitted_width = (float)video_content_width * scale;
    const float fitted_height = (float)video_content_height * scale;
    left += (width - fitted_width) * 0.5f;
    top += (height - fitted_height) * 0.5f;
    width = fitted_width;
    height = fitted_height;
  }
  const float right = left + width;
  const float bottom = top + height;
  yuv420_gx_draw(left, top, right, bottom);
}

static void
draw_playback_progress(const MultiplexGatewayPlaybackManifest *manifest) {
  if (video_surface.visible == 0 || manifest == NULL ||
      manifest->rating_key == 0 || manifest->media_duration_ms == 0) {
    return;
  }
  if (player_controls_surface.visible == 0 ||
      player_controls_surface.width <= 0 ||
      player_controls_surface.height <= 0) {
    return;
  }
  const uint32_t position_ms = playback_position_ms(manifest);
  const float left = player_controls_surface.x + 1.0f;
  const float right = player_controls_surface.x +
                      player_controls_surface.width - 1.0f;
  const float top = player_controls_surface.y;
  const float bottom = top + 4.0f;
  const float progress =
      (float)position_ms / (float)manifest->media_duration_ms;
  const float filled = left + (right - left) * progress;
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  fill_rect(left, top, right, bottom, (GXColor){24, 24, 27, 210});
  if (filled > left) {
    fill_rect(left, top, filled, bottom, (GXColor){250, 250, 250, 255});
  }
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
}

typedef enum {
  UI_PIPELINE_NONE = 0,
  UI_PIPELINE_SHAPE = 1,
  UI_PIPELINE_TEXT = 2,
} UiPipeline;

static void draw_native_packet_ordered(
    const NativeUiPacket *packet,
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  uint32_t shape_index = 0;
  uint32_t text_index = 0;
  const uint32_t modal_sequence = modal_layer_sequence(packet);
  uint32_t poster_sequence = UINT32_MAX;
  if (packet->text_command_count != 0) {
    poster_sequence = packet->text_sequences[0];
  }
  if (modal_sequence < poster_sequence) poster_sequence = modal_sequence;

  bool posters_drawn = poster_surface_count == 0;
  bool progress_drawn = false;
  UiPipeline pipeline = UI_PIPELINE_NONE;
  while (shape_index < packet->shape_command_count ||
         text_index < packet->text_command_count) {
    const uint32_t shape_sequence =
        shape_index < packet->shape_command_count
            ? packet->shape_sequences[shape_index]
            : UINT32_MAX;
    const uint32_t text_sequence =
        text_index < packet->text_command_count
            ? packet->text_sequences[text_index]
            : UINT32_MAX;
    const uint32_t next_sequence =
        shape_sequence < text_sequence ? shape_sequence : text_sequence;

    if (!posters_drawn && next_sequence >= poster_sequence) {
      draw_poster_surfaces();
      posters_drawn = true;
      pipeline = UI_PIPELINE_NONE;
    }
    if (!progress_drawn && modal_sequence != UINT32_MAX &&
        next_sequence >= modal_sequence) {
      draw_playback_progress(playback_manifest);
      progress_drawn = true;
      pipeline = UI_PIPELINE_NONE;
    }

    if (shape_sequence < text_sequence) {
      if (pipeline != UI_PIPELINE_SHAPE) {
        configure_color_pipeline();
        GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                        GX_LO_CLEAR);
        pipeline = UI_PIPELINE_SHAPE;
      }
      draw_native_shape_command_at(packet, shape_index++);
    } else {
      if (pipeline != UI_PIPELINE_TEXT) {
        configure_font_pipeline();
        pipeline = UI_PIPELINE_TEXT;
      }
      draw_native_text_command_at(packet, text_index++);
    }
  }

  if (!posters_drawn) draw_poster_surfaces();
  if (!progress_drawn) draw_playback_progress(playback_manifest);
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void
present_frame(const MultiplexGatewayPlaybackManifest *playback_manifest) {
  if (native_frame_dirty && reference_renderer.thread == LWP_THREAD_NULL) {
    const uint32_t target_screen = multiplex_native_app_screen();
    const bool asynchronous_transition =
        asynchronous_reference_enabled &&
        (target_screen != presented_screen ||
         asynchronous_reference_requested) &&
        target_screen != MULTIPLEX_SCREEN_PLAYER;
    if (asynchronous_transition) {
      asynchronous_reference_requested = false;
      if (!launch_reference_renderer()) {
        refresh_reference_frame(false);
      }
    } else if (!refresh_reference_frame(false)) {
      native_frame_dirty = false;
    }
  }

  draw_player_startup_backdrop(playback_manifest);
  draw_video_surface();
  if (video_surface.visible == 0 || player_controls_overlay_visible) {
    draw_details_backdrop();
    float entry_offset = 0.0f;
    if (ui_entry_frame < UI_ENTRY_FRAMES) {
      const float progress = UI_ENTRY_FRAMES <= 1u
                                 ? 1.0f
                                 : (float)ui_entry_frame /
                                       (float)(UI_ENTRY_FRAMES - 1u);
      const float remaining = 1.0f - progress;
      entry_offset = 6.0f * remaining * remaining * remaining;
      ui_entry_frame += 1u;
    }
    if (home_motion_kind != HOME_MOTION_NONE &&
        (presented_screen == MULTIPLEX_SCREEN_HOME ||
         presented_screen == MULTIPLEX_SCREEN_BROWSE)) {
      draw_home_motion();
    } else {
      load_ui_translation(entry_offset);
      draw_reference_frame();
      draw_native_packet_ordered(&presented_ui_packet, playback_manifest);
      load_ui_translation(0.0f);
    }
  }
  draw_activity();
  draw_stats_for_nerds();
  GX_CopyDisp(framebuffers[framebuffer_index], GX_TRUE);
  GX_DrawDone();
  VIDEO_SetNextFramebuffer(framebuffers[framebuffer_index]);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  framebuffer_index ^= 1;

  if (presentation_frames == 0) {
    presentation_started = gettick();
  }
  presentation_frames += 1;
  if (presentation_frames == 120) {
    const uint32_t measured_us = elapsed_us(presentation_started);
    const uint32_t fps_tenths =
        measured_us == 0 ? 0 : (uint32_t)((120ull * 10000000ull) / measured_us);
    diagnostic_presentation_fps_tenths = fps_tenths;
    SYS_Report("REFERENCE GX: presentation=120 frames/%uus (%u.%u fps)\n",
               measured_us, fps_tenths / 10, fps_tenths % 10);
    if (media_demux != NULL) {
      SYS_Report("REFERENCE GX: stream-progress video=%u audio=%u loops=%u\n",
                 mpeg_ps_demux_video_bytes_pumped(media_demux),
                 mpeg_ps_demux_audio_bytes_pumped(media_demux),
                 mpeg_ps_demux_loop_count(media_demux));
      if (playback_manifest != NULL && playback_manifest->rating_key != 0) {
        SYS_Report(
            "REFERENCE GX: timeline rating-key=%u position=%u duration=%u "
            "segment-start=%u segment-duration=%u\n",
            playback_manifest->rating_key,
            playback_position_ms(playback_manifest),
            playback_manifest->media_duration_ms,
            playback_manifest->segment_start_ms,
            playback_manifest->segment_duration_ms);
      }
    } else if (direct_hls_demux != NULL) {
      SYS_Report("REFERENCE GX: HLS progress segments=%u video=%u audio=%u\n",
                 plex_hls_demux_segment_count(direct_hls_demux),
                 plex_hls_demux_video_bytes(direct_hls_demux),
                 plex_hls_demux_audio_bytes(direct_hls_demux));
    }
    presentation_frames = 0;
  }
}

static bool wait_network_warmup(
    NetworkWarmup *warmup,
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  network_activity_visible = true;
  network_activity_frame = 0;
  while (!warmup->complete && SYS_MainLoop()) {
    present_frame(playback_manifest);
  }
  __sync_synchronize();
  network_activity_visible = false;
  return finish_network_warmup(warmup);
}

static bool wait_reference_transition(
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  while (reference_renderer.thread != LWP_THREAD_NULL && SYS_MainLoop()) {
    if (!poll_reference_renderer()) {
      return false;
    }
    present_frame(playback_manifest);
  }
  return reference_renderer.thread == LWP_THREAD_NULL;
}

static bool has_pending_page_request(void) {
  uint32_t section_id = 0;
  uint32_t start = 0;
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY] = {0};

  return multiplex_native_app_browse_request(&section_id, &start) != 0 ||
         multiplex_native_app_search_request((uint8_t *)query,
                                             sizeof(query) - 1u) != 0 ||
         multiplex_native_app_details_request() != 0 ||
         multiplex_native_app_details_children_request(&section_id, &start) !=
             0;
}

static bool present_pending_page_transition(
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  if (!has_pending_page_request()) {
    return true;
  }

  const uint32_t started = gettick();
  network_activity_visible = true;
  if (!wait_reference_transition(playback_manifest)) {
    network_activity_visible = false;
    return false;
  }
  native_frame_dirty = true;
  if (!refresh_reference_frame(false)) {
    network_activity_visible = false;
    return false;
  }
  present_frame(playback_manifest);
  network_activity_visible = false;
  SYS_Report("REFERENCE GX: network transition presented us=%u screen=%u\n",
             elapsed_us(started), multiplex_native_app_screen());
  return true;
}

static void pause_audio_for_player_input(
    uint32_t pressed,
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  if ((pressed &
       (PAD_BUTTON_A | PAD_BUTTON_B | PAD_TRIGGER_L | PAD_TRIGGER_R)) != 0) {
    if (video_surface.visible != 0) {
      /*
       * The exact player repaint takes longer than one VBlank. Stop the media
       * clock before dispatching pause/resume/exit; resume stays paused until
       * the new UI frame is ready and draw_video_surface restarts both clocks.
       */
      const uint32_t position_ms = playback_position_ms(playback_manifest);
      multiplex_native_app_playback_position(position_ms);
      audio_dma_update(audio_output, false);
      SYS_Report("REFERENCE GX: timeline synced for input position=%u\n",
                 position_ms);
    }
  }
}

static bool
activate_staged_media_session(StagedMediaSession *staged,
                              MultiplexGatewayPlaybackManifest *active_manifest,
                              HttpClient **client, MpegPsDemux **demux) {
  join_staged_media_session(staged);
  if (!staged->ready || staged->failed || staged->client == NULL ||
      staged->demux == NULL) {
    discard_staged_media_session(staged);
    return false;
  }
  const uint32_t previous_rating_key = active_manifest->rating_key;
  close_media_session(client, demux);
  if (!start_media_pipeline(staged->demux, staged->manifest.rating_key,
                            false)) {
    discard_staged_media_session(staged);
    return false;
  }
  *active_manifest = staged->manifest;
  *client = staged->client;
  *demux = staged->demux;
  staged->client = NULL;
  staged->demux = NULL;
  reset_staged_media_session(staged);
  if (multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report(
      "REFERENCE GX: playback-session staged-switch previous=%u active=%u "
      "offset=%u video-buffered=%u audio-buffered=%u\n",
      previous_rating_key, active_manifest->rating_key,
      active_manifest->segment_start_ms,
      mpeg_ps_demux_video_bytes_pumped(*demux),
      mpeg_ps_demux_audio_bytes_pumped(*demux));
  SYS_Report("REFERENCE GX: playback-session ready rating-key=%u offset=%u\n",
             active_manifest->rating_key, active_manifest->segment_start_ms);
  return true;
}

static bool continue_playback_if_needed(
    const char *gateway_url, MultiplexGatewayPlaybackManifest *active_manifest,
    HttpClient **client, MpegPsDemux **demux, StagedMediaSession *staged) {
  if (gateway_url == NULL || gateway_url[0] == '\0' ||
      active_manifest == NULL || active_manifest->rating_key == 0 ||
      !video_was_playing || audio_output == NULL) {
    return true;
  }
  const uint32_t position_ms = playback_position_ms(active_manifest);
  const uint64_t segment_end = (uint64_t)active_manifest->segment_start_ms +
                               active_manifest->segment_duration_ms;
  if ((uint64_t)position_ms + SEGMENT_HANDOFF_MARGIN_MS < segment_end) {
    return true;
  }
  audio_dma_update(audio_output, false);
  if (segment_end >= active_manifest->media_duration_ms) {
    multiplex_native_app_playback_position(active_manifest->media_duration_ms);
    if (multiplex_native_app_playback_complete() == 0) {
      return false;
    }
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: playback-complete rating-key=%u duration=%u\n",
               active_manifest->rating_key, active_manifest->media_duration_ms);
    return true;
  }
  const uint32_t next_offset_ms = (uint32_t)segment_end;
  if (multiplex_native_app_playback_continue(next_offset_ms) == 0) {
    return false;
  }
  SYS_Report(
      "REFERENCE GX: playback-continuation requested rating-key=%u offset=%u\n",
      active_manifest->rating_key, next_offset_ms);
  if (staged != NULL && staged->rating_key == active_manifest->rating_key &&
      staged->offset_ms == next_offset_ms &&
      activate_staged_media_session(staged, active_manifest, client, demux)) {
    native_frame_dirty = true;
    return true;
  }
  if (staged != NULL) {
    discard_staged_media_session(staged);
  }
  if (!load_selected_playback(gateway_url, active_manifest, client, demux)) {
    return false;
  }
  native_frame_dirty = true;
  return true;
}

static bool direct_playback_reached_end(
    const MultiplexGatewayPlaybackManifest *active_manifest) {
  if (active_manifest == NULL ||
      active_manifest->rating_key == 0 || direct_hls_demux == NULL ||
      audio_output == NULL || !video_was_playing ||
      plex_hls_demux_failed(direct_hls_demux) ||
      !plex_hls_demux_complete(direct_hls_demux)) {
    return false;
  }
  const uint32_t position_ms = playback_position_ms(active_manifest);
  return (uint64_t)position_ms + DIRECT_PLAYBACK_END_MARGIN_MS >=
         active_manifest->media_duration_ms;
}

#if MULTIPLEX_PAIRING_ENABLED
static bool advance_direct_playback_if_complete(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux, TimelineReporter *timeline_reporter,
    bool *advanced) {
  *advanced = false;
  if (credentials == NULL || !direct_playback_reached_end(active_manifest)) {
    return true;
  }

  const MultiplexGatewayPlaybackManifest completed_manifest =
      *active_manifest;
  char completed_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  snprintf(completed_session_id, sizeof(completed_session_id), "%s",
           direct_hls_session_id);
  multiplex_native_app_playback_position(
      completed_manifest.media_duration_ms);
  audio_dma_update(audio_output, false);
  flush_timeline_report(timeline_reporter, "", credentials,
                        completed_session_id, &completed_manifest,
                        completed_manifest.media_duration_ms, "stopped");

  MultiplexGatewayItem next_episode;
  const MultiplexPlexNextEpisodeResult next_result =
      multiplex_plex_load_next_episode(credentials,
                                       completed_manifest.rating_key,
                                       &next_episode);
  if (next_result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    if (multiplex_native_app_playback_complete() == 0) {
      return false;
    }
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: direct playback complete rating-key=%u "
               "next=%s\n",
               completed_manifest.rating_key,
               next_result == MULTIPLEX_PLEX_NEXT_EPISODE_NONE ? "none"
                                                               : "error");
    return true;
  }

  if (multiplex_native_app_playback_advance(
          next_episode.rating_key, (const uint8_t *)next_episode.title,
          next_episode.title_length, next_episode.duration_ms) == 0 ||
      !load_selected_direct_playback(credentials, active_manifest, client,
                                     demux)) {
    SYS_Report("REFERENCE GX: direct autoplay switch failed previous=%u "
               "requested=%u\n",
               completed_manifest.rating_key, next_episode.rating_key);
    return false;
  }
  native_frame_dirty = true;
  *advanced = true;
  SYS_Report("REFERENCE GX: direct autoplay-next previous=%u active=%u "
             "title=%s\n",
             completed_manifest.rating_key, next_episode.rating_key,
             next_episode.title);
  return true;
}
#endif

static void stage_following_media_if_due(
    StagedMediaSession *staged, const char *gateway_url,
    const MultiplexGatewayPlaybackManifest *active_manifest) {
  if (!video_was_playing || audio_output == NULL || staged == NULL ||
      staged->thread != LWP_THREAD_NULL || staged->ready || staged->failed ||
      active_manifest == NULL || active_manifest->rating_key == 0) {
    return;
  }
  const uint32_t position_ms = playback_position_ms(active_manifest);
  const uint64_t segment_end = (uint64_t)active_manifest->segment_start_ms +
                               active_manifest->segment_duration_ms;
  if ((uint64_t)position_ms + SEGMENT_PREFETCH_MARGIN_MS < segment_end) {
    return;
  }
  const uint32_t released = multiplex_native_reference_memo_clear();
  if (start_staged_media_session(staged, gateway_url, active_manifest)) {
    SYS_Report("REFERENCE GX: playback-session released-render-memo=%uKiB\n",
               released / 1024u);
  }
}

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size) {
  return http_client_read_at(context, offset, destination, size);
}

static bool bind_catalog_to_app(const MultiplexGatewayCatalog *catalog) {
  if (multiplex_native_app_catalog_begin(
          (const uint8_t *)catalog->server_name, catalog->server_name_length,
          catalog->row_count, catalog->library_count) == 0) {
    SYS_Report("REFERENCE GX: failed to bind catalog to app\n");
    return false;
  }
  for (uint16_t index = 0; index < catalog->library_count; ++index) {
    const MultiplexGatewayLibrary *library = &catalog->libraries[index];
    if (multiplex_native_app_catalog_library(
            index, library->section_id, library->media_type,
            (const uint8_t *)library->title, library->title_length) == 0) {
      SYS_Report("REFERENCE GX: failed to bind library %u\n", index);
      return false;
    }
  }
  for (uint16_t row_index = 0; row_index < catalog->row_count; ++row_index) {
    const MultiplexGatewayRow *row = &catalog->rows[row_index];
    if (multiplex_native_app_catalog_row(row_index, (const uint8_t *)row->title,
                                         row->title_length,
                                         row->item_count) == 0) {
      SYS_Report("REFERENCE GX: failed to bind catalog row %u\n", row_index);
      return false;
    }
    for (uint16_t item_index = 0; item_index < row->item_count; ++item_index) {
      const MultiplexGatewayItem *item =
          &catalog->items[row->item_offset + item_index];
      if (multiplex_native_app_catalog_item(
              row_index, item_index, item->rating_key,
              (const uint8_t *)item->title, item->title_length,
              (const uint8_t *)item->subtitle, item->subtitle_length,
              item->artwork_slot, item->duration_ms, item->view_offset_ms,
              item->progress_percent) == 0) {
        SYS_Report("REFERENCE GX: failed to bind catalog item %u/%u\n",
                   row_index, item_index);
        return false;
      }
    }
  }
  if (multiplex_native_app_catalog_commit() == 0) {
    SYS_Report("REFERENCE GX: failed to commit catalog\n");
    return false;
  }
  return true;
}

static bool bind_watch_together_rooms(const MultiplexTrpcRoomList *rooms,
                                      bool available) {
  if (rooms == NULL ||
      multiplex_native_app_watch_together_begin(
          available ? 1u : 0u, available ? rooms->room_count : 0u) == 0) {
    SYS_Report("REFERENCE GX: failed to begin Watch Together binding\n");
    return false;
  }
  if (available) {
    for (uint8_t index = 0; index < rooms->room_count; ++index) {
      const MultiplexTrpcRoom *room = &rooms->rooms[index];
      const size_t title_length = strlen(room->title);
      if (multiplex_native_app_watch_together_room(
              index, (const uint8_t *)room->title, title_length,
              room->user_count) == 0) {
        SYS_Report("REFERENCE GX: failed to bind Watch Together room %u\n",
                   index);
        return false;
      }
      SYS_Report("REFERENCE GX: Watch Together room=%u id=%s invited=%u\n",
                 index, room->id, room->user_count);
    }
  }
  if (multiplex_native_app_watch_together_commit() == 0) {
    SYS_Report("REFERENCE GX: failed to commit Watch Together rooms\n");
    return false;
  }
  SYS_Report("REFERENCE GX: Watch Together model rooms=%u available=%u\n",
             available ? rooms->room_count : 0u, available ? 1u : 0u);
  return true;
}

static bool bind_watch_together_invitees(
    const MultiplexTrpcInviteeList *invitees, bool available) {
  if (invitees == NULL) {
    return false;
  }
  if (multiplex_native_app_watch_together_invitees_begin(
          available ? 1u : 0u, available ? invitees->invitee_count : 0u) ==
      0) {
    return false;
  }
  if (available) {
    for (uint8_t index = 0; index < invitees->invitee_count; ++index) {
      const MultiplexTrpcInvitee *invitee = &invitees->invitees[index];
      if (multiplex_native_app_watch_together_invitee(
              index, invitee->user_id, (const uint8_t *)invitee->name,
              strlen(invitee->name)) == 0) {
        return false;
      }
    }
  }
  return multiplex_native_app_watch_together_invitees_commit() != 0;
}

#if MULTIPLEX_PAIRING_ENABLED
static bool
refresh_watch_together_rooms(const MultiplexAuthCredentials *credentials,
                             MultiplexTrpcRoomList *rooms) {
  if (credentials == NULL || rooms == NULL) {
    return false;
  }
  memset(rooms, 0, sizeof(*rooms));
  const bool available = multiplex_trpc_load_watch_together_rooms(
      MULTIPLEX_BASE_URL, credentials->session_token, rooms);
  return bind_watch_together_rooms(rooms, available);
}

static void *run_catalog_loader(void *context) {
  CatalogLoader *loader = context;
  loader->available =
      multiplex_plex_load_catalog(loader->credentials, loader->catalog);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool launch_catalog_loader(
    CatalogLoader *loader, const MultiplexAuthCredentials *credentials,
    MultiplexGatewayCatalog *catalog) {
  if (loader == NULL || credentials == NULL || catalog == NULL ||
      loader->started) {
    return false;
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->credentials = credentials;
  loader->catalog = catalog;
  loader->thread = LWP_THREAD_NULL;
  loader->stack = malloc(CATALOG_LOADER_STACK_SIZE);
  if (loader->stack == NULL) {
    return false;
  }
  if (LWP_CreateThread(&loader->thread, run_catalog_loader, loader,
                       loader->stack, CATALOG_LOADER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(loader->stack);
    loader->stack = NULL;
    return false;
  }
  loader->started = true;
  SYS_Report("REFERENCE GX: Plex catalog load started\n");
  return true;
}

static CatalogLoaderStatus poll_catalog_loader(CatalogLoader *loader) {
  if (loader == NULL || !loader->started) {
    return CATALOG_LOADER_IDLE;
  }
  if (!loader->complete) {
    return CATALOG_LOADER_LOADING;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  loader->complete = false;
  return loader->available ? CATALOG_LOADER_READY : CATALOG_LOADER_FAILED;
}

static void stop_catalog_loader(CatalogLoader *loader) {
  if (loader == NULL) {
    return;
  }
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  free(loader->stack);
  memset(loader, 0, sizeof(*loader));
  loader->thread = LWP_THREAD_NULL;
}

static void *run_catalog_cache_saver(void *context) {
  CatalogCacheSaver *saver = context;
  saver->result = multiplex_memory_card_save_cache(
      &saver->location, saver->bytes, sizeof(saver->bytes));
  __sync_synchronize();
  saver->complete = true;
  return NULL;
}

static bool launch_catalog_cache_saver(
    CatalogCacheSaver *saver, const MultiplexMemoryCardLocation *location,
    const MultiplexGatewayCatalog *catalog) {
  if (saver == NULL || location == NULL || catalog == NULL || saver->started ||
      (location->slot != 0 && location->slot != 1)) {
    return false;
  }
  free(saver->stack);
  memset(saver, 0, sizeof(*saver));
  saver->location = *location;
  saver->thread = LWP_THREAD_NULL;
  if (!multiplex_catalog_cache_encode(saver->bytes, catalog)) {
    return false;
  }
  saver->stack = malloc(CATALOG_CACHE_SAVER_STACK_SIZE);
  if (saver->stack == NULL ||
      LWP_CreateThread(&saver->thread, run_catalog_cache_saver, saver,
                       saver->stack, CATALOG_CACHE_SAVER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(saver->stack);
    saver->stack = NULL;
    saver->thread = LWP_THREAD_NULL;
    return false;
  }
  saver->started = true;
  return true;
}

static void poll_catalog_cache_saver(CatalogCacheSaver *saver) {
  if (saver == NULL || !saver->started || !saver->complete) {
    return;
  }
  __sync_synchronize();
  if (saver->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(saver->thread, NULL);
    saver->thread = LWP_THREAD_NULL;
  }
  saver->started = false;
  SYS_Report("REFERENCE GX: catalog cache persistence result=%u\n",
             saver->result);
}

static void stop_catalog_cache_saver(CatalogCacheSaver *saver) {
  if (saver == NULL) {
    return;
  }
  if (saver->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(saver->thread, NULL);
  }
  free(saver->stack);
  memset(saver, 0, sizeof(*saver));
  saver->thread = LWP_THREAD_NULL;
}

static void *run_startup_data_loader(void *context) {
  StartupDataLoader *loader = context;
  loader->user_available = multiplex_trpc_load_user_id(
      loader->credentials->origin, loader->credentials->session_token,
      &loader->user_id);
  loader->rooms_available = multiplex_trpc_load_watch_together_rooms(
      MULTIPLEX_BASE_URL, loader->credentials->session_token, &loader->rooms);
  loader->invitees_available = multiplex_trpc_load_watch_together_invitees(
      MULTIPLEX_BASE_URL, loader->credentials->session_token,
      &loader->invitees);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool launch_startup_data_loader(
    StartupDataLoader *loader,
    const MultiplexAuthCredentials *credentials) {
  if (loader == NULL || credentials == NULL || loader->started) {
    return false;
  }
  memset(loader, 0, sizeof(*loader));
  loader->credentials = credentials;
  loader->thread = LWP_THREAD_NULL;
  loader->stack = malloc(STARTUP_DATA_LOADER_STACK_SIZE);
  if (loader->stack == NULL) {
    return false;
  }
  if (LWP_CreateThread(&loader->thread, run_startup_data_loader, loader,
                       loader->stack, STARTUP_DATA_LOADER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(loader->stack);
    loader->stack = NULL;
    return false;
  }
  loader->started = true;
  SYS_Report("REFERENCE GX: background account data started\n");
  return true;
}

static bool poll_startup_data_loader(
    StartupDataLoader *loader, uint32_t *user_id,
    MultiplexTrpcRoomList *rooms, MultiplexTrpcInviteeList *invitees) {
  if (loader == NULL || !loader->started || loader->applied ||
      !loader->complete) {
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  if (loader->user_available) {
    *user_id = loader->user_id;
  }
  *rooms = loader->rooms;
  *invitees = loader->invitees;
  if (!bind_watch_together_rooms(rooms, loader->rooms_available) ||
      !bind_watch_together_invitees(invitees,
                                    loader->invitees_available)) {
    return false;
  }
  loader->applied = true;
  SYS_Report("REFERENCE GX: background account data ready user=%u rooms=%u "
             "invitees=%u\n",
             loader->user_available ? 1u : 0u,
             loader->rooms_available ? rooms->room_count : 0u,
             loader->invitees_available ? invitees->invitee_count : 0u);
  return true;
}

static void stop_startup_data_loader(StartupDataLoader *loader) {
  if (loader == NULL) {
    return;
  }
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  free(loader->stack);
  loader->stack = NULL;
  loader->started = false;
  loader->complete = false;
  loader->applied = false;
}

static bool retain_watch_together_room(MultiplexTrpcRoomList *rooms,
                                       const MultiplexTrpcRoom *room) {
  uint8_t existing = rooms->room_count;
  for (uint8_t index = 0; index < rooms->room_count; ++index) {
    if (strcmp(rooms->rooms[index].id, room->id) == 0) {
      existing = index;
      break;
    }
  }
  if (existing < rooms->room_count) {
    rooms->rooms[existing] = *room;
  } else {
    const uint8_t retained = rooms->room_count < MULTIPLEX_TRPC_MAX_ROOMS
                                 ? rooms->room_count
                                 : MULTIPLEX_TRPC_MAX_ROOMS - 1u;
    memmove(&rooms->rooms[1], &rooms->rooms[0],
            (size_t)retained * sizeof(rooms->rooms[0]));
    rooms->rooms[0] = *room;
    rooms->room_count = retained + 1u;
  }
  return bind_watch_together_rooms(rooms, true);
}

static void create_requested_watch_together_room(
    const MultiplexAuthCredentials *credentials, MultiplexTrpcRoomList *rooms,
    char *hosted_room_id, size_t hosted_room_id_capacity,
    uint32_t *hosted_invitee_user_id) {
  uint32_t rating_key = 0;
  uint32_t invitee_user_id = 0;
  char title[MULTIPLEX_TRPC_ROOM_TITLE_CAPACITY];
  const uint32_t title_length =
      multiplex_native_app_watch_together_create_request(
          &rating_key, &invitee_user_id, (uint8_t *)title, sizeof(title));
  if (title_length == 0) {
    return;
  }

  MultiplexTrpcRoom created;
  memset(&created, 0, sizeof(created));
  if (!multiplex_trpc_create_watch_together_room(
          MULTIPLEX_BASE_URL, credentials->session_token,
          credentials->plex_server_id, rating_key, title, invitee_user_id,
          &created)) {
    SYS_Report("REFERENCE GX: Watch Together room creation failed "
               "rating-key=%u\n",
               rating_key);
    multiplex_native_app_watch_together_create_fail();
    return;
  }

  if (!retain_watch_together_room(rooms, &created)) {
    multiplex_native_app_watch_together_create_fail();
    return;
  }
  const int hosted_id_size =
      snprintf(hosted_room_id, hosted_room_id_capacity, "%s", created.id);
  if (hosted_id_size <= 0 ||
      (size_t)hosted_id_size >= hosted_room_id_capacity) {
    hosted_room_id[0] = '\0';
    *hosted_invitee_user_id = 0;
  } else {
    *hosted_invitee_user_id = invitee_user_id;
  }
  SYS_Report("REFERENCE GX: Watch Together room created id=%s "
             "rating-key=%u\n",
             created.id, rating_key);
}

static uint32_t watch_together_rating_key(const MultiplexTrpcRoom *room) {
  static const char marker[] = "/metadata/";
  if (room == NULL) {
    return 0;
  }
  const char *value = strstr(room->source_uri, marker);
  if (value == NULL) {
    return 0;
  }
  value += sizeof(marker) - 1u;
  char *end = NULL;
  const unsigned long parsed = strtoul(value, &end, 10);
  return end != value && *end == '\0' && parsed != 0 && parsed <= UINT32_MAX
             ? (uint32_t)parsed
             : 0;
}

static void
join_requested_watch_together_room(const MultiplexAuthCredentials *credentials,
                                   const MultiplexTrpcRoomList *rooms,
                                   MultiplexSyncplaySession **session,
                                   uint32_t *joined_room_index,
                                   uint32_t plex_user_id, bool *in_lobby,
                                   uint64_t *all_present_since_ms,
                                   const char *hosted_room_id) {
  const uint32_t requested = multiplex_native_app_watch_together_join_request();
  if (requested == 0) {
    return;
  }
  const uint32_t index = requested - 1u;
  multiplex_syncplay_session_destroy(*session);
  *session = NULL;
  *joined_room_index = UINT32_MAX;
  *in_lobby = false;
  *all_present_since_ms = 0;
  if (index >= rooms->room_count) {
    multiplex_native_app_watch_together_join_commit(0);
    return;
  }
  const uint32_t rating_key = watch_together_rating_key(&rooms->rooms[index]);
  if (rating_key == 0 || plex_user_id == 0) {
    SYS_Report("REFERENCE GX: Watch Together playback unavailable "
               "room=%u rating-key=%u user=%u\n",
               index, rating_key, plex_user_id);
    multiplex_native_app_watch_together_join_commit(0);
    return;
  }
  *session = multiplex_syncplay_session_connect(&rooms->rooms[index],
                                                credentials->plex_client_id,
                                                plex_user_id, true);
  if (*session == NULL) {
    multiplex_native_app_watch_together_join_commit(0);
    SYS_Report("REFERENCE GX: Watch Together join room=%u connected=0\n",
               index);
    return;
  }
  multiplex_native_app_watch_together_join_commit(1);
  multiplex_native_app_watch_together_host(
      hosted_room_id != NULL && hosted_room_id[0] != '\0' &&
              strcmp(rooms->rooms[index].id, hosted_room_id) == 0
          ? 1u
          : 0u);
  multiplex_native_app_watch_together_presence(1, 1);
  *joined_room_index = index;
  *in_lobby = true;
  SYS_Report("REFERENCE GX: Watch Together lobby room=%u connected=1 "
             "invited=%u\n",
             index, rooms->rooms[index].user_count);
}

static bool start_joined_watch_together_playback(
    const MultiplexAuthCredentials *credentials,
    const MultiplexTrpcRoomList *rooms, uint32_t room_index,
    uint32_t plex_user_id, uint32_t offset_ms,
    MultiplexSyncplaySession **session,
    MultiplexGatewayPlaybackManifest *manifest, HttpClient **client,
    MpegPsDemux **demux) {
  if (room_index >= rooms->room_count || plex_user_id == 0) {
    return false;
  }
  const MultiplexTrpcRoom *room = &rooms->rooms[room_index];
  const uint32_t rating_key = watch_together_rating_key(room);
  uint32_t playback_offset_ms = offset_ms;
  if (direct_playback_start_offset_pending) {
    playback_offset_ms = MULTIPLEX_PLAYBACK_START_OFFSET_MS;
    direct_playback_start_offset_pending = false;
    SYS_Report("REFERENCE GX: Watch Together playback start override "
               "offset=%u\n",
               playback_offset_ms);
  }
  if (rating_key == 0 ||
      !load_direct_playback(credentials, rating_key, playback_offset_ms, true,
                            manifest, client, demux)) {
    return false;
  }
  *session = multiplex_syncplay_session_connect(
      room, credentials->plex_client_id, plex_user_id, false);
  if (*session == NULL ||
      multiplex_native_app_watch_together_playback(
          room_index, rating_key, (const uint8_t *)room->title,
          strlen(room->title), manifest->media_duration_ms,
          manifest->segment_start_ms) == 0) {
    multiplex_syncplay_session_destroy(*session);
    *session = NULL;
    close_media_session(client, demux);
    return false;
  }
  multiplex_syncplay_session_set_playback(
      *session, false, manifest->segment_start_ms);
  SYS_Report("REFERENCE GX: Watch Together playback room=%u rating-key=%u "
             "offset=%u\n",
             room_index, rating_key, manifest->segment_start_ms);
  return true;
}

static uint32_t find_watch_together_rotation_room(
    const MultiplexTrpcRoomList *rooms, const char *previous_room_id,
    uint32_t rating_key, uint8_t user_count) {
  for (uint32_t index = 0; index < rooms->room_count; ++index) {
    const MultiplexTrpcRoom *room = &rooms->rooms[index];
    if (strcmp(room->id, previous_room_id) != 0 &&
        room->user_count == user_count &&
        watch_together_rating_key(room) == rating_key) {
      return index;
    }
  }
  return UINT32_MAX;
}

static bool rotate_watch_together_if_complete(
    const MultiplexAuthCredentials *credentials, MultiplexTrpcRoomList *rooms,
    MultiplexSyncplaySession **session, uint32_t *joined_room_index,
    uint32_t plex_user_id, char *hosted_room_id,
    size_t hosted_room_id_capacity, uint32_t hosted_invitee_user_id,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux, TimelineReporter *timeline_reporter,
    bool *advanced) {
  *advanced = false;
  if (!direct_playback_reached_end(active_manifest)) {
    return true;
  }
  if (*joined_room_index >= rooms->room_count) {
    return false;
  }

  const MultiplexGatewayPlaybackManifest completed_manifest =
      *active_manifest;
  const MultiplexTrpcRoom previous_room = rooms->rooms[*joined_room_index];
  char completed_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  snprintf(completed_session_id, sizeof(completed_session_id), "%s",
           direct_hls_session_id);
  multiplex_native_app_playback_position(
      completed_manifest.media_duration_ms);
  audio_dma_update(audio_output, false);
  flush_timeline_report(timeline_reporter, "", credentials,
                        completed_session_id, &completed_manifest,
                        completed_manifest.media_duration_ms, "stopped");

  MultiplexGatewayItem next_episode;
  const MultiplexPlexNextEpisodeResult next_result =
      multiplex_plex_load_next_episode(credentials,
                                       completed_manifest.rating_key,
                                       &next_episode);
  if (next_result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    multiplex_native_app_playback_complete();
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: Watch Together playback complete rating-key=%u "
               "next=%s\n",
               completed_manifest.rating_key,
               next_result == MULTIPLEX_PLEX_NEXT_EPISODE_NONE ? "none"
                                                               : "error");
    return true;
  }

  if (!refresh_watch_together_rooms(credentials, rooms)) {
    return false;
  }
  uint32_t next_room_index = find_watch_together_rotation_room(
      rooms, previous_room.id, next_episode.rating_key,
      previous_room.user_count);
  bool created = false;
  if (next_room_index == UINT32_MAX && hosted_invitee_user_id != 0) {
    MultiplexTrpcRoom next_room;
    memset(&next_room, 0, sizeof(next_room));
    created = multiplex_trpc_create_watch_together_room(
        MULTIPLEX_BASE_URL, credentials->session_token,
        credentials->plex_server_id, next_episode.rating_key,
        next_episode.title, hosted_invitee_user_id, &next_room);
    if (created && retain_watch_together_room(rooms, &next_room)) {
      next_room_index = find_watch_together_rotation_room(
          rooms, previous_room.id, next_episode.rating_key,
          previous_room.user_count);
      snprintf(hosted_room_id, hosted_room_id_capacity, "%s", next_room.id);
    } else {
      created = false;
    }
  }
  if (next_room_index == UINT32_MAX) {
    multiplex_native_app_playback_complete();
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: Watch Together autoplay room unavailable "
               "rating-key=%u\n",
               next_episode.rating_key);
    return true;
  }

  multiplex_syncplay_session_destroy(*session);
  *session = NULL;
  if (!start_joined_watch_together_playback(
          credentials, rooms, next_room_index, plex_user_id, 0, session,
          active_manifest, client, demux)) {
    multiplex_native_app_playback_complete();
    native_frame_dirty = true;
    return true;
  }
  *joined_room_index = next_room_index;
  multiplex_native_app_watch_together_host(created ? 1u : 0u);
  if (!created) {
    hosted_room_id[0] = '\0';
  }
  const bool deleted = multiplex_trpc_delete_watch_together_room(
      MULTIPLEX_BASE_URL, credentials->session_token, previous_room.id);
  native_frame_dirty = true;
  *advanced = true;
  SYS_Report("REFERENCE GX: Watch Together autoplay-next previous=%u "
             "active=%u room=%s created=%u old-deleted=%u\n",
             completed_manifest.rating_key, next_episode.rating_key,
             rooms->rooms[next_room_index].id, created ? 1u : 0u,
             deleted ? 1u : 0u);
  return true;
}
#endif

static void *run_app(void *unused) {
  (void)unused;
#if MULTIPLEX_PAIRING_ENABLED
  const uint32_t app_started = gettick();
#endif
  memset(&reference_renderer, 0, sizeof(reference_renderer));
  reference_renderer.thread = LWP_THREAD_NULL;
  if (!initialize_video_and_gx()) {
    return (void *)(uintptr_t)APP_EXIT_VIDEO_INIT;
  }
  if (!poster_jpeg_initialize()) {
    return (void *)(uintptr_t)APP_EXIT_JPEG_INIT;
  }
  if (!allocate_buffers()) {
    poster_jpeg_shutdown();
    return (void *)(uintptr_t)APP_EXIT_BUFFER_INIT;
  }
  NetworkWarmup network_warmup;
  bool network_warmup_pending = launch_network_warmup(&network_warmup);

  MpegPsDemux *demux = NULL;
  HttpClient *client = NULL;
  MultiplexGatewayPlaybackManifest playback_manifest;
  memset(&playback_manifest, 0, sizeof(playback_manifest));
  StagedMediaSession staged_media;
  reset_staged_media_session(&staged_media);
  TimelineReporter timeline_reporter;
  initialize_timeline_reporter(&timeline_reporter);
  MediaStartupWatchdog media_startup_watchdog;
  memset(&media_startup_watchdog, 0, sizeof(media_startup_watchdog));
  DirectPosterLoader direct_home_poster_loader;
  memset(&direct_home_poster_loader, 0, sizeof(direct_home_poster_loader));
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    direct_home_poster_loader.threads[lane] = LWP_THREAD_NULL;
  }
  DirectPosterLoader direct_page_poster_loader;
  memset(&direct_page_poster_loader, 0, sizeof(direct_page_poster_loader));
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    direct_page_poster_loader.threads[lane] = LWP_THREAD_NULL;
  }
  reset_direct_hls_prefetch(&direct_hls_prefetch);
  bool timeline_player_visible = false;
  bool timeline_started = false;
  uint64_t player_controls_last_input_ms = 0;
  uint64_t player_controls_fade_started_ms = 0;
  uint64_t toast_dismiss_at_ms = 0;
  MultiplexGatewayCatalog catalog;
  memset(&catalog, 0, sizeof(catalog));
  MultiplexTrpcRoomList watch_together_rooms;
  memset(&watch_together_rooms, 0, sizeof(watch_together_rooms));
  MultiplexTrpcInviteeList watch_together_invitees;
  memset(&watch_together_invitees, 0, sizeof(watch_together_invitees));
#if MULTIPLEX_PAIRING_ENABLED
  DirectBrowseLoader direct_browse_loader;
  memset(&direct_browse_loader, 0, sizeof(direct_browse_loader));
  direct_browse_loader.thread = LWP_THREAD_NULL;
  DirectSearchLoader direct_search_loader;
  memset(&direct_search_loader, 0, sizeof(direct_search_loader));
  direct_search_loader.thread = LWP_THREAD_NULL;
  DirectDetailsLoader direct_details_loader;
  memset(&direct_details_loader, 0, sizeof(direct_details_loader));
  direct_details_loader.thread = LWP_THREAD_NULL;
  CatalogLoader catalog_loader;
  memset(&catalog_loader, 0, sizeof(catalog_loader));
  catalog_loader.thread = LWP_THREAD_NULL;
  CatalogCacheSaver catalog_cache_saver;
  memset(&catalog_cache_saver, 0, sizeof(catalog_cache_saver));
  catalog_cache_saver.thread = LWP_THREAD_NULL;
  bool cached_catalog_loaded = false;
  bool catalog_cache_save_pending = false;
  uint64_t catalog_retry_at_ms = 0;
  uint32_t catalog_retry_delay_ms = CATALOG_RETRY_INITIAL_DELAY_MS;
  uint64_t startup_data_not_before_ms = 0;
  uint64_t details_prefetch_at_ms = 0;
  uint32_t details_prefetch_candidate_key = 0;
  StartupDataLoader startup_data_loader;
  memset(&startup_data_loader, 0, sizeof(startup_data_loader));
  startup_data_loader.thread = LWP_THREAD_NULL;
  MultiplexSyncplaySession *syncplay_session = NULL;
  uint32_t joined_watch_together_room = UINT32_MAX;
  uint64_t watch_together_all_present_since_ms = 0;
  uint64_t watch_together_reconnect_at_ms = 0;
  uint32_t plex_user_id = 0;
  bool watch_together_lobby = false;
  char hosted_watch_together_room_id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY] = "";
  uint32_t hosted_watch_together_invitee_user_id = 0;
#endif
  multiplex_native_app_init();
  multiplex_native_reference_text_overlay(1);
#if MULTIPLEX_PAIRING_ENABLED
  if (multiplex_native_app_pairing_status(
          MULTIPLEX_PAIRING_CONNECTING, (const uint8_t *)"", 0,
          (const uint8_t *)"", 0) == 0) {
    SYS_Report("REFERENCE GX: failed to bind network startup status\n");
    if (network_warmup_pending) {
      finish_network_warmup(&network_warmup);
    }
    return (void *)(uintptr_t)APP_EXIT_UI_BIND;
  }
#endif
  initialize_textures();
  if (!refresh_reference_frame(false)) {
    if (network_warmup_pending) {
      finish_network_warmup(&network_warmup);
    }
    return (void *)(uintptr_t)APP_EXIT_UI_RENDER;
  }
  present_frame(&playback_manifest);
  asynchronous_reference_enabled = true;

  if (network_warmup_pending && MULTIPLEX_GATEWAY_URL[0] != '\0') {
    SYS_Report("REFERENCE GX: network warmup ready=%u\n",
               wait_network_warmup(&network_warmup, &playback_manifest) ? 1u
                                                                        : 0u);
    network_warmup_pending = false;
  }

  bool has_catalog =
      MULTIPLEX_GATEWAY_URL[0] != '\0' &&
      multiplex_gateway_load_catalog(MULTIPLEX_GATEWAY_URL, &catalog);
  if (has_catalog && !initialize_poster_textures(MULTIPLEX_GATEWAY_URL,
                                                 catalog.total_item_count)) {
    SYS_Report(
        "REFERENCE GX: gateway artwork unavailable; using placeholders\n");
  }
  if (has_catalog && !bind_catalog_to_app(&catalog)) {
    return (void *)(uintptr_t)APP_EXIT_UI_BIND;
  }
#if MULTIPLEX_PAIRING_ENABLED
  MultiplexAuthCredentials auth_credentials;
  memset(&auth_credentials, 0, sizeof(auth_credentials));
  MultiplexMemoryCardLocation auth_location = {
      .slot = -1,
      .generation = 0,
      .needs_presentation = false,
  };
  uint8_t cached_catalog[MULTIPLEX_CATALOG_CACHE_SIZE] = {0};
  const MultiplexMemoryCardResult stored_auth =
      multiplex_memory_card_load_auth_with_cache(
          &auth_credentials, &auth_location, cached_catalog,
          sizeof(cached_catalog));
  MultiplexDeviceAuth device_auth;
  memset(&device_auth, 0, sizeof(device_auth));
  bool pairing_status_presented = false;
  if (stored_auth == MULTIPLEX_MEMORY_CARD_OK) {
    device_auth.status = MULTIPLEX_DEVICE_AUTH_LINKED;
    SYS_Report("REFERENCE GX: auth restored slot=%c generation=%u\n",
               auth_location.slot == 0 ? 'A' : 'B', auth_location.generation);
    if (multiplex_native_app_pairing_status(
            device_auth.status, (const uint8_t *)"", 0,
            (const uint8_t *)"", 0) == 0) {
      SYS_Report("REFERENCE GX: failed to bind restored authorization\n");
      return (void *)(uintptr_t)APP_EXIT_UI_BIND;
    }
    if (multiplex_catalog_cache_decode(cached_catalog, &catalog) &&
        bind_catalog_to_app(&catalog)) {
      has_catalog = true;
      cached_catalog_loaded = true;
      SYS_Report("REFERENCE GX: cached catalog ready rows=%u items=%u us=%u\n",
                 catalog.row_count, catalog.total_item_count,
                 elapsed_us(app_started));
    }
    native_frame_dirty = true;
    present_frame(&playback_manifest);
    if (!wait_reference_transition(&playback_manifest)) {
      return (void *)(uintptr_t)APP_EXIT_UI_RENDER;
    }
    pairing_status_presented = true;
    if (network_warmup_pending) {
      SYS_Report("REFERENCE GX: network warmup ready=%u\n",
                 wait_network_warmup(&network_warmup, &playback_manifest)
                     ? 1u
                     : 0u);
      network_warmup_pending = false;
    }
    bool credentials_changed = false;
    if (auth_credentials.plex_token[0] == '\0') {
      const bool credentials_refreshed =
          multiplex_device_auth_refresh_credentials(auth_credentials.origin,
                                                    &auth_credentials);
      SYS_Report("REFERENCE GX: Plex credential refresh=%u\n",
                 credentials_refreshed ? 1u : 0u);
      credentials_changed = credentials_refreshed;
    }
    if (auth_credentials.plex_server_url[0] == '\0' &&
        multiplex_plex_bootstrap_credentials(&auth_credentials,
                                             MULTIPLEX_PLEX_BASE_URL)) {
      credentials_changed = true;
    }
    if (credentials_changed || auth_location.needs_presentation) {
      SYS_Report("REFERENCE GX: persisting refreshed Plex credentials "
                 "presentation=%u\n",
                 auth_location.needs_presentation ? 1u : 0u);
      const MultiplexMemoryCardResult refreshed =
          multiplex_memory_card_save_auth(&auth_credentials, &auth_location);
      SYS_Report("REFERENCE GX: Plex credential persistence=%s\n",
                 multiplex_memory_card_result_message(refreshed));
    }
  } else {
    if (network_warmup_pending) {
      SYS_Report("REFERENCE GX: network warmup ready=%u\n",
                 wait_network_warmup(&network_warmup, &playback_manifest)
                     ? 1u
                     : 0u);
      network_warmup_pending = false;
    }
    if (!multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &device_auth)) {
      device_auth.status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
      SYS_Report("REFERENCE GX: device authorization unavailable card=%s\n",
                 multiplex_memory_card_result_message(stored_auth));
    }
  }
  bool pairing_linked = device_auth.status == MULTIPLEX_DEVICE_AUTH_LINKED;
  if (!pairing_status_presented) {
    if (multiplex_native_app_pairing_status(
            device_auth.status, (const uint8_t *)device_auth.user_code,
            strlen(device_auth.user_code),
            (const uint8_t *)device_auth.link_url,
            strlen(device_auth.link_url)) == 0) {
      SYS_Report("REFERENCE GX: failed to bind device authorization status\n");
      return (void *)(uintptr_t)APP_EXIT_UI_BIND;
    }
    native_frame_dirty = true;
    if (!pairing_linked || has_catalog) {
      present_frame(&playback_manifest);
    }
  }
  bool auth_reset_latched = false;
  uint32_t pairing_poll_frames = 0;
  if (pairing_linked && (!has_catalog || cached_catalog_loaded)) {
    if (launch_catalog_loader(&catalog_loader, &auth_credentials, &catalog)) {
      network_activity_visible = !has_catalog;
    } else {
      catalog_retry_at_ms = ticks_to_millisecs(gettime()) +
                            CATALOG_RETRY_INITIAL_DELAY_MS;
      if (multiplex_native_app_pairing_status(
              MULTIPLEX_DEVICE_AUTH_UNAVAILABLE, (const uint8_t *)"", 0,
              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind network unavailable status\n");
        return (void *)(uintptr_t)APP_EXIT_UI_BIND;
      }
    }
    if (!has_catalog) {
      native_frame_dirty = true;
      present_frame(&playback_manifest);
    }
  }
#endif
  if (network_warmup_pending) {
    SYS_Report("REFERENCE GX: network warmup ready=%u\n",
               wait_network_warmup(&network_warmup, &playback_manifest) ? 1u
                                                                        : 0u);
    network_warmup_pending = false;
  }
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexAuthCredentials *timeline_plex_credentials =
      MULTIPLEX_GATEWAY_URL[0] == '\0' ? &auth_credentials : NULL;
#else
  const MultiplexAuthCredentials *timeline_plex_credentials = NULL;
#endif
  const bool has_playback_manifest =
      MULTIPLEX_GATEWAY_URL[0] != '\0' &&
      multiplex_gateway_load_playback_manifest(MULTIPLEX_GATEWAY_URL, 0, 0,
                                               &playback_manifest);
  if (has_playback_manifest) {
    SYS_Report("REFERENCE GX: playback-session deferred rating-key=%u until "
               "selected\n",
               playback_manifest.rating_key);
  } else if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
             !open_initial_media_session(&client, &demux)) {
    return (void *)(uintptr_t)APP_EXIT_MEDIA_PRODUCER;
  }

  uint32_t queued_transition_buttons = 0;
  uint32_t queued_transition_navigation = UINT32_MAX;
  AppExitCode exit_code = APP_EXIT_OK;
  while (SYS_MainLoop()) {
    poll_direct_poster_loader(&direct_home_poster_loader);
    poll_direct_poster_loader(&direct_page_poster_loader);
    finish_direct_hls_prefetch(&direct_hls_prefetch, false);
    if (direct_hls_prefetch.started && direct_hls_prefetch.complete) {
      const uint32_t screen = multiplex_native_app_screen();
      const bool stale_for_details =
          screen == MULTIPLEX_SCREEN_DETAILS && direct_details_cache_valid &&
          direct_hls_prefetch.rating_key != direct_details_cache.rating_key;
      if (screen != MULTIPLEX_SCREEN_DETAILS || stale_for_details) {
        discard_direct_hls_prefetch(&direct_hls_prefetch);
#if MULTIPLEX_PAIRING_ENABLED
        if (stale_for_details &&
            !start_direct_hls_prefetch(&direct_hls_prefetch,
                                       &auth_credentials,
                                       &direct_details_cache)) {
          SYS_Report("REFERENCE GX: deferred HLS session prefetch unavailable "
                     "rating-key=%u\n",
                     direct_details_cache.rating_key);
        }
#endif
      }
    }
    if (!poll_reference_renderer()) {
      exit_code = APP_EXIT_UI_RENDER;
      break;
    }
    if (reference_renderer.thread != LWP_THREAD_NULL) {
      PAD_ScanPads();
      queued_transition_buttons |= PAD_ButtonsDown(0);
#if defined(HW_RVL)
      WPAD_ScanPads();
      queued_transition_buttons |=
          wii_buttons_as_gamecube(WPAD_ButtonsDown(0));
#endif
      const uint64_t transition_input_ms = ticks_to_millisecs(gettime());
      const uint32_t transition_navigation = navigation_action(
          multiplex_gui_navigation_poll(&gui_navigation, PAD_StickX(0),
                                          PAD_StickY(0),
                                          transition_input_ms * 1000u));
      if (queued_transition_navigation == UINT32_MAX &&
          transition_navigation != UINT32_MAX) {
        queued_transition_navigation = transition_navigation;
      }
      present_frame(&playback_manifest);
      continue;
    }
#if MULTIPLEX_PAIRING_ENABLED
    if (!poll_direct_browse_loader(&direct_browse_loader, &auth_credentials,
                                   &direct_page_poster_loader)) {
      SYS_Report("REFERENCE GX: background browse binding failed\n");
      exit_code = APP_EXIT_BACKGROUND_BIND;
      break;
    }
    if (!poll_direct_search_loader(&direct_search_loader, &auth_credentials,
                                   &direct_page_poster_loader)) {
      SYS_Report("REFERENCE GX: background search binding failed\n");
      exit_code = APP_EXIT_BACKGROUND_BIND;
      break;
    }
    if (!poll_direct_details_loader(&direct_details_loader,
                                    &auth_credentials)) {
      SYS_Report("REFERENCE GX: background details binding failed\n");
      exit_code = APP_EXIT_BACKGROUND_BIND;
      break;
    }
    const uint64_t catalog_now_ms = ticks_to_millisecs(gettime());
    const CatalogLoaderStatus catalog_loader_status =
        poll_catalog_loader(&catalog_loader);
    poll_catalog_cache_saver(&catalog_cache_saver);
    if (catalog_loader_status == CATALOG_LOADER_READY) {
      network_activity_visible = false;
      if (multiplex_native_app_pairing_status(
              MULTIPLEX_DEVICE_AUTH_LINKED, (const uint8_t *)"", 0,
              (const uint8_t *)"", 0) == 0 ||
          !bind_catalog_to_app(&catalog)) {
        SYS_Report("REFERENCE GX: recovered Plex catalog binding failed\n");
        exit_code = APP_EXIT_BACKGROUND_BIND;
        break;
      }
      has_catalog = true;
      catalog_retry_at_ms = 0;
      catalog_retry_delay_ms = CATALOG_RETRY_INITIAL_DELAY_MS;
      startup_data_not_before_ms = catalog_now_ms + STARTUP_DATA_IDLE_DELAY_MS;
      if (!queue_direct_poster_loader(&direct_home_poster_loader,
                                      &auth_credentials, catalog.items,
                                      catalog.total_item_count, 0, false)) {
        SYS_Report("REFERENCE GX: direct Plex artwork unavailable; using "
                   "placeholders\n");
      }
      catalog_cache_save_pending = true;
      native_frame_dirty = true;
      SYS_Report("REFERENCE GX: Plex catalog ready after background load\n");
      SYS_Report("REFERENCE GX: interactive home ready us=%u\n",
                 elapsed_us(app_started));
    } else if (catalog_loader_status == CATALOG_LOADER_FAILED) {
      network_activity_visible = false;
      if (multiplex_native_app_pairing_status(
              MULTIPLEX_DEVICE_AUTH_UNAVAILABLE, (const uint8_t *)"", 0,
              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind network unavailable status\n");
        exit_code = APP_EXIT_UI_BIND;
        break;
      }
      catalog_retry_at_ms = catalog_now_ms + catalog_retry_delay_ms;
      if (catalog_retry_delay_ms < CATALOG_RETRY_MAX_DELAY_MS) {
        catalog_retry_delay_ms *= 2u;
        if (catalog_retry_delay_ms > CATALOG_RETRY_MAX_DELAY_MS) {
          catalog_retry_delay_ms = CATALOG_RETRY_MAX_DELAY_MS;
        }
      }
      native_frame_dirty = true;
      SYS_Report("REFERENCE GX: Plex catalog retry scheduled delay-ms=%u\n",
                 (uint32_t)(catalog_retry_at_ms - catalog_now_ms));
    }
    if (catalog_cache_save_pending && !catalog_cache_saver.started &&
        !direct_poster_loader_running(&direct_home_poster_loader) &&
        !direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_page_poster_loader) &&
        !direct_page_poster_loader.pending) {
      if (launch_catalog_cache_saver(&catalog_cache_saver, &auth_location,
                                     &catalog)) {
        catalog_cache_save_pending = false;
      }
    }
    if (pairing_linked && !has_catalog && !catalog_loader.started &&
        catalog_retry_at_ms != 0 && catalog_now_ms >= catalog_retry_at_ms) {
      if (multiplex_native_app_pairing_status(
              MULTIPLEX_PAIRING_CONNECTING, (const uint8_t *)"", 0,
              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind Plex retry status\n");
        exit_code = APP_EXIT_UI_BIND;
        break;
      }
      if (launch_catalog_loader(&catalog_loader, &auth_credentials, &catalog)) {
        network_activity_visible = true;
        catalog_retry_at_ms = 0;
      } else {
        catalog_retry_at_ms = catalog_now_ms + catalog_retry_delay_ms;
      }
      native_frame_dirty = true;
    }
    if (!poll_startup_data_loader(&startup_data_loader, &plex_user_id,
                                  &watch_together_rooms,
                                  &watch_together_invitees)) {
      SYS_Report("REFERENCE GX: background account data binding failed\n");
      exit_code = APP_EXIT_BACKGROUND_BIND;
      break;
    }
#endif
    const uint32_t active_screen = multiplex_native_app_screen();
    if (active_screen == MULTIPLEX_SCREEN_HOME &&
        presented_screen == active_screen &&
        direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_home_poster_loader)) {
      launch_direct_poster_loader(&direct_home_poster_loader);
    } else if ((active_screen == MULTIPLEX_SCREEN_BROWSE ||
                active_screen == MULTIPLEX_SCREEN_SEARCH_RESULTS) &&
               !direct_poster_loader_running(&direct_home_poster_loader) &&
               !direct_home_poster_loader.pending &&
               direct_page_poster_loader.pending &&
               !direct_poster_loader_running(&direct_page_poster_loader)) {
      launch_direct_poster_loader(&direct_page_poster_loader);
    }
    if (demux != NULL && mpeg_ps_demux_failed(demux)) {
      SYS_Report("REFERENCE GX: media producer failure\n");
      exit_code = APP_EXIT_MEDIA_PRODUCER;
      break;
    }
    if (direct_hls_demux != NULL && plex_hls_demux_failed(direct_hls_demux)) {
      SYS_Report("REFERENCE GX: HLS media producer failure\n");
      exit_code = APP_EXIT_MEDIA_PRODUCER;
      break;
    }
    const uint32_t connected_pads = PAD_ScanPads();
#if defined(HW_RVL)
    const int32_t connected_wii_remotes = WPAD_ScanPads();
#endif
    if (!controller_status_reported) {
      uint32_t controller_type = 0;
      const uint32_t type_status = PAD_GetType(0, &controller_type);
#if defined(HW_RVL)
      uint32_t wii_remote_type = 0;
      const int32_t wii_remote_status = WPAD_Probe(0, &wii_remote_type);
      SYS_Report(
          "REFERENCE GX: controller scan=%08x type-status=%08x type=%08x "
          "held=%08x wii-scan=%d wii-status=%d wii-type=%08x\n",
          connected_pads, type_status, controller_type, PAD_ButtonsHeld(0),
          connected_wii_remotes, wii_remote_status, wii_remote_type);
#else
      SYS_Report(
          "REFERENCE GX: controller scan=%08x type-status=%08x type=%08x "
          "held=%08x\n",
          connected_pads, type_status, controller_type, PAD_ButtonsHeld(0));
#endif
      controller_status_reported = true;
    }
#if MULTIPLEX_PAIRING_ENABLED
    if (!pairing_linked &&
        device_auth.status == MULTIPLEX_DEVICE_AUTH_WAITING &&
        ++pairing_poll_frames >= (uint32_t)device_auth.interval_seconds *
                                     PAIRING_POLL_INTERVAL_FRAMES) {
      pairing_poll_frames = 0;
      const MultiplexDeviceAuthStatus previous_status = device_auth.status;
      if (!multiplex_device_auth_poll(MULTIPLEX_BASE_URL, &device_auth,
                                      &auth_credentials)) {
        SYS_Report("REFERENCE GX: device authorization poll unavailable\n");
      }
      if (device_auth.status != previous_status) {
        pairing_linked = device_auth.status == MULTIPLEX_DEVICE_AUTH_LINKED;
        if (pairing_linked) {
          multiplex_plex_bootstrap_credentials(&auth_credentials,
                                               MULTIPLEX_PLEX_BASE_URL);
          const MultiplexMemoryCardResult saved =
              multiplex_memory_card_save_auth(&auth_credentials,
                                              &auth_location);
          SYS_Report("REFERENCE GX: auth persistence=%s\n",
                     multiplex_memory_card_result_message(saved));
          if (!has_catalog && !catalog_loader.started) {
            if (launch_catalog_loader(&catalog_loader, &auth_credentials,
                                      &catalog)) {
              network_activity_visible = true;
              catalog_retry_at_ms = 0;
            } else {
              catalog_retry_at_ms = ticks_to_millisecs(gettime()) +
                                    CATALOG_RETRY_INITIAL_DELAY_MS;
            }
          }
        }
        if (multiplex_native_app_pairing_status(
                device_auth.status, (const uint8_t *)device_auth.user_code,
                strlen(device_auth.user_code),
                (const uint8_t *)device_auth.link_url,
                strlen(device_auth.link_url)) == 0) {
          SYS_Report(
              "REFERENCE GX: failed to update device authorization status\n");
          exit_code = APP_EXIT_UI_BIND;
          break;
        }
        native_frame_dirty = true;
      }
    }
#endif
    uint32_t pressed = PAD_ButtonsDown(0) | queued_transition_buttons;
    queued_transition_buttons = 0;
#if defined(HW_RVL)
    pressed |= wii_buttons_as_gamecube(WPAD_ButtonsDown(0));
#endif
    const uint64_t input_now_ms = ticks_to_millisecs(gettime());
    if (toast_dismiss_at_ms != 0 && input_now_ms >= toast_dismiss_at_ms &&
        multiplex_native_app_toast_dismiss() != 0) {
      toast_dismiss_at_ms = 0;
      asynchronous_reference_requested = true;
      native_frame_dirty = true;
    }
    const MultiplexGuiNavigationDirection stick_direction =
        multiplex_gui_navigation_poll(&gui_navigation, PAD_StickX(0),
                                      PAD_StickY(0), input_now_ms * 1000u);
    const uint32_t stick_navigation =
        queued_transition_navigation != UINT32_MAX
            ? queued_transition_navigation
            : navigation_action(stick_direction);
    queued_transition_navigation = UINT32_MAX;
#if MULTIPLEX_PAIRING_ENABLED
    if (!startup_data_loader.started &&
        (pressed != 0 || stick_navigation != UINT32_MAX)) {
      startup_data_not_before_ms =
          input_now_ms + STARTUP_DATA_IDLE_DELAY_MS;
    }
    if (pairing_linked && has_catalog && !startup_data_loader.started &&
        input_now_ms >= startup_data_not_before_ms &&
        multiplex_native_app_screen() == MULTIPLEX_SCREEN_HOME &&
        !direct_poster_loader_running(&direct_home_poster_loader) &&
        !direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_page_poster_loader) &&
        !direct_page_poster_loader.pending && !direct_hls_prefetch.started &&
        !direct_details_loader.started && !direct_browse_loader.started &&
        !direct_search_loader.started && !catalog_loader.started) {
      if (!launch_startup_data_loader(&startup_data_loader,
                                      &auth_credentials)) {
        startup_data_not_before_ms =
            input_now_ms + STARTUP_DATA_IDLE_DELAY_MS;
        SYS_Report("REFERENCE GX: background account data unavailable\n");
      }
    }
#endif
    const bool controller_input = pressed != 0 || stick_navigation != UINT32_MAX;
    if (pressed != 0) {
      SYS_Report("REFERENCE GX: controller buttons %08x\n", pressed);
    }
    const bool reveal_player_controls_only =
        video_surface.visible != 0 && !player_controls_overlay_visible &&
        (pressed & PAD_BUTTON_A) != 0;
    if (video_surface.visible != 0) {
      if (player_controls_last_input_ms == 0) {
        player_controls_last_input_ms = input_now_ms;
      }
      if (controller_input) {
        player_controls_last_input_ms = input_now_ms;
        player_controls_fade_started_ms = 0;
        if (ui_frame_alpha != 255) {
          ui_frame_alpha = 255;
          set_player_controls_texture_alpha(ui_frame_alpha);
        }
        if (!player_controls_overlay_visible) {
          player_controls_overlay_visible = true;
          SYS_Report("REFERENCE GX: player controls visible=1\n");
        }
      }
    } else {
      player_controls_last_input_ms = 0;
      player_controls_fade_started_ms = 0;
      if (ui_frame_alpha != 255) {
        ui_frame_alpha = 255;
        set_player_controls_texture_alpha(ui_frame_alpha);
      }
      player_controls_overlay_visible = true;
    }
    if (reveal_player_controls_only) {
      pressed &= ~PAD_BUTTON_A;
      SYS_Report("REFERENCE GX: player controls reveal consumed A\n");
    }
#if MULTIPLEX_PAIRING_ENABLED
    uint32_t held = PAD_ButtonsHeld(0);
#if defined(HW_RVL)
    held |= wii_buttons_as_gamecube(WPAD_ButtonsHeld(0));
#endif
    const uint32_t auth_reset_buttons =
        PAD_TRIGGER_L | PAD_TRIGGER_R | PAD_TRIGGER_Z;
    const bool auth_reset_held =
        (held & auth_reset_buttons) == auth_reset_buttons;
    if (pairing_linked && auth_reset_held && !auth_reset_latched) {
      auth_reset_latched = true;
      stop_direct_poster_loader(&direct_home_poster_loader);
      stop_direct_poster_loader(&direct_page_poster_loader);
      discard_direct_hls_prefetch(&direct_hls_prefetch);
      stop_direct_browse_loader(&direct_browse_loader);
      stop_direct_search_loader(&direct_search_loader);
      stop_direct_details_loader(&direct_details_loader);
      stop_catalog_loader(&catalog_loader);
      stop_catalog_cache_saver(&catalog_cache_saver);
      stop_startup_data_loader(&startup_data_loader);
      const MultiplexMemoryCardResult deleted =
          multiplex_memory_card_delete_auth(&auth_location);
      SYS_Report("REFERENCE GX: linked-account reset=%s\n",
                 multiplex_memory_card_result_message(deleted));
      if (deleted == MULTIPLEX_MEMORY_CARD_OK) {
        finish_timeline_report(&timeline_reporter);
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        joined_watch_together_room = UINT32_MAX;
        watch_together_all_present_since_ms = 0;
        watch_together_reconnect_at_ms = 0;
        watch_together_lobby = false;
        plex_user_id = 0;
        pairing_linked = false;
        has_catalog = false;
        catalog_cache_save_pending = false;
        catalog_retry_at_ms = 0;
        catalog_retry_delay_ms = CATALOG_RETRY_INITIAL_DELAY_MS;
        startup_data_not_before_ms = 0;
        details_prefetch_at_ms = 0;
        details_prefetch_candidate_key = 0;
        network_activity_visible = false;
        memset(&auth_credentials, 0, sizeof(auth_credentials));
        memset(&watch_together_rooms, 0, sizeof(watch_together_rooms));
        if (!bind_watch_together_rooms(&watch_together_rooms, false)) {
          exit_code = APP_EXIT_UI_BIND;
          break;
        }
        memset(&device_auth, 0, sizeof(device_auth));
        if (!multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &device_auth)) {
          device_auth.status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
        }
        if (multiplex_native_app_pairing_status(
                device_auth.status, (const uint8_t *)device_auth.user_code,
                strlen(device_auth.user_code),
                (const uint8_t *)device_auth.link_url,
                strlen(device_auth.link_url)) == 0) {
          SYS_Report(
              "REFERENCE GX: failed to bind reset authorization status\n");
          exit_code = APP_EXIT_UI_BIND;
          break;
        }
        pairing_poll_frames = 0;
        native_frame_dirty = true;
        pressed = 0;
      }
    } else if (!auth_reset_held) {
      auth_reset_latched = false;
    }
#endif
    /*
     * libogc2's BBA stack is reliable with one foreground HTTP transaction,
     * but concurrent poster and navigation requests can consume each other's
     * receive progress and leave both waiting for a timeout. Give activation
     * priority to the user before opening details or starting playback.
     */
#if MULTIPLEX_PAIRING_ENABLED
    if (pairing_linked && (pressed & (PAD_BUTTON_A | PAD_BUTTON_START)) != 0) {
      suspend_direct_poster_loader(&direct_home_poster_loader);
      suspend_direct_poster_loader(&direct_page_poster_loader);
    }
#endif
    pause_audio_for_player_input(pressed, &playback_manifest);
    bool app_changed = false;
    if (stick_navigation != UINT32_MAX) {
      const uint32_t home_view_before = multiplex_native_app_home_view_state();
      if (multiplex_native_app_input(stick_navigation) != 0) {
        const uint32_t home_view_after = multiplex_native_app_home_view_state();
        begin_home_motion(home_view_before, home_view_after);
        app_changed = true;
      }
    }
    if ((pressed & PAD_BUTTON_LEFT) != 0 &&
        multiplex_native_app_input(12) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_RIGHT) != 0 &&
        multiplex_native_app_input(13) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_A) != 0 && multiplex_native_app_input(2) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_B) != 0 && multiplex_native_app_input(3) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_Y) != 0 && multiplex_native_app_input(4) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_X) != 0 && multiplex_native_app_input(5) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_R) != 0 && multiplex_native_app_input(6) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_L) != 0 && multiplex_native_app_input(7) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_Z) != 0 && multiplex_native_app_input(10) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_START) != 0 &&
        multiplex_native_app_input(11) != 0) {
      app_changed = true;
    }
    if (app_changed) {
      if (!present_pending_page_transition(&playback_manifest)) {
        SYS_Report("REFERENCE GX: network transition presentation failed\n");
        exit_code = APP_EXIT_UI_RENDER;
        break;
      }
      const uint32_t mark_watched_rating_key =
          multiplex_native_app_mark_watched_request();
      if (mark_watched_rating_key != 0) {
        bool marked = false;
#if MULTIPLEX_PAIRING_ENABLED
        if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked) {
          marked = multiplex_plex_mark_watched(&auth_credentials,
                                               mark_watched_rating_key);
        }
#endif
        if (multiplex_native_app_mark_watched_commit(marked ? 1u : 0u) != 0) {
          toast_dismiss_at_ms = input_now_ms + 2500u;
          asynchronous_reference_requested = true;
        }
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_browse_page(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: browse-page load failed\n");
      }
#if MULTIPLEX_PAIRING_ENABLED
      if (multiplex_native_app_watch_together_reconnect_request() != 0) {
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        multiplex_native_app_watch_together_presence(0, 0);
        watch_together_reconnect_at_ms = ticks_to_millisecs(gettime());
        multiplex_native_app_watch_together_reconnect_commit();
        SYS_Report("REFERENCE GX: Syncplay reconnect requested room=%u\n",
                   joined_watch_together_room);
      }
      const bool disband_watch_together =
          multiplex_native_app_watch_together_disband_request() != 0;
      if (multiplex_native_app_watch_together_leave_request() != 0 ||
          disband_watch_together) {
        const uint32_t left_room = joined_watch_together_room;
        char left_room_id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY] = "";
        if (left_room < watch_together_rooms.room_count) {
          snprintf(left_room_id, sizeof(left_room_id), "%s",
                   watch_together_rooms.rooms[left_room].id);
        }
        flush_timeline_report(
            &timeline_reporter, MULTIPLEX_GATEWAY_URL,
            timeline_plex_credentials, direct_hls_session_id,
            &playback_manifest, playback_position_ms(&playback_manifest),
            "stopped");
        timeline_player_visible = false;
        discard_staged_media_session(&staged_media);
        close_media_session(&client, &demux);
        memset(&playback_manifest, 0, sizeof(playback_manifest));
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        joined_watch_together_room = UINT32_MAX;
        watch_together_all_present_since_ms = 0;
        watch_together_reconnect_at_ms = 0;
        watch_together_lobby = false;
        bool deleted = false;
        if (disband_watch_together && left_room_id[0] != '\0' &&
            strcmp(left_room_id, hosted_watch_together_room_id) == 0) {
          deleted = multiplex_trpc_delete_watch_together_room(
              MULTIPLEX_BASE_URL, auth_credentials.session_token,
              left_room_id);
          if (deleted) {
            hosted_watch_together_room_id[0] = '\0';
          }
        }
        if (disband_watch_together) {
          multiplex_native_app_watch_together_disband_commit(deleted ? 1u
                                                                     : 0u);
        } else {
          multiplex_native_app_watch_together_leave_commit();
        }
        if (!refresh_watch_together_rooms(&auth_credentials,
                                          &watch_together_rooms)) {
          SYS_Report("REFERENCE GX: Watch Together rooms refresh after exit "
                     "failed\n");
        }
        if (disband_watch_together) {
          SYS_Report("REFERENCE GX: Watch Together disbanded room=%s "
                     "deleted=%u\n",
                     left_room_id, deleted ? 1u : 0u);
        } else {
          SYS_Report("REFERENCE GX: Watch Together left room=%u\n", left_room);
        }
      }
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked && has_catalog &&
          !load_direct_browse_page(&auth_credentials, &catalog,
                                   &direct_browse_loader)) {
        SYS_Report("REFERENCE GX: direct browse-page load failed\n");
      }
#endif
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_search_page(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: search-page load failed\n");
      }
#if MULTIPLEX_PAIRING_ENABLED
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked &&
          !load_direct_search_page(&auth_credentials,
                                   &direct_search_loader)) {
        SYS_Report("REFERENCE GX: direct search-page load failed\n");
      }
#endif
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_item_details(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: details-page load failed\n");
      }
#if MULTIPLEX_PAIRING_ENABLED
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked &&
          !load_direct_item_details(&auth_credentials,
                                    &direct_details_loader)) {
        SYS_Report("REFERENCE GX: direct details-page load failed\n");
      }
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked &&
          !load_direct_item_children(&auth_credentials)) {
        SYS_Report("REFERENCE GX: direct details children load failed\n");
      }
      if (pairing_linked) {
        create_requested_watch_together_room(
            &auth_credentials, &watch_together_rooms,
            hosted_watch_together_room_id,
            sizeof(hosted_watch_together_room_id),
            &hosted_watch_together_invitee_user_id);
        join_requested_watch_together_room(
            &auth_credentials, &watch_together_rooms, &syncplay_session,
            &joined_watch_together_room, plex_user_id, &watch_together_lobby,
            &watch_together_all_present_since_ms,
            hosted_watch_together_room_id);
        if (syncplay_session != NULL) {
          watch_together_reconnect_at_ms = 0;
        }
      }
#endif
      const uint32_t pending_playback_key =
          multiplex_native_app_playback_request();
      if (pending_playback_key != 0) {
        const bool retained_dirty = native_frame_dirty;
        native_frame_dirty = false;
        blocking_activity_visible = true;
        present_frame(&playback_manifest);
        native_frame_dirty = retained_dirty;
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          pending_playback_key != 0) {
        discard_staged_media_session(&staged_media);
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_selected_playback(MULTIPLEX_GATEWAY_URL, &playback_manifest,
                                  &client, &demux)) {
        SYS_Report("REFERENCE GX: playback-session load failed\n");
      }
#if MULTIPLEX_PAIRING_ENABLED
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked) {
        stop_direct_playback_if_hidden(
            &auth_credentials, &playback_manifest, &client, &demux,
            &timeline_reporter, &timeline_player_visible);
        if (syncplay_session == NULL &&
            !navigate_direct_playback_if_requested(
                &auth_credentials, &playback_manifest, &client, &demux,
                &timeline_reporter)) {
          SYS_Report("REFERENCE GX: direct playback navigation failed\n");
        }
      }
      const uint32_t local_playback_request =
          multiplex_native_app_playback_request();
      const uint32_t local_playback_offset =
          multiplex_native_app_playback_offset_request();
      const bool local_syncplay_seek =
          syncplay_session != NULL &&
          local_playback_request == playback_manifest.rating_key &&
          local_playback_offset != playback_manifest.segment_start_ms;
      const uint32_t local_seek_room = joined_watch_together_room;
      if (local_syncplay_seek) {
        /*
         * A transcode seek can block while the old HLS producer winds down.
         * Reconnect afterward instead of letting the retained Syncplay socket
         * expire during that reload.
         */
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
      }
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked &&
          !load_selected_direct_playback(&auth_credentials, &playback_manifest,
                                         &client, &demux)) {
        SYS_Report("REFERENCE GX: direct playback-session load failed\n");
      }
      if (local_syncplay_seek &&
          playback_manifest.segment_start_ms == local_playback_offset) {
        if (local_seek_room < watch_together_rooms.room_count) {
          syncplay_session = multiplex_syncplay_session_connect(
              &watch_together_rooms.rooms[local_seek_room],
              auth_credentials.plex_client_id, plex_user_id, false);
        }
        if (syncplay_session != NULL) {
          multiplex_syncplay_session_set_playback(
              syncplay_session, video_surface.playing == 0,
              local_playback_offset);
          multiplex_syncplay_session_mark_local_seek(syncplay_session);
          SYS_Report("REFERENCE GX: Syncplay local seek position=%u\n",
                     local_playback_offset);
        } else {
          joined_watch_together_room = UINT32_MAX;
          SYS_Report("REFERENCE GX: Syncplay local seek reconnect failed\n");
        }
      } else if (local_syncplay_seek) {
        joined_watch_together_room = UINT32_MAX;
      }
#endif
      blocking_activity_visible = false;
      native_frame_dirty = true;
    }
#if MULTIPLEX_PAIRING_ENABLED
    const uint32_t selected_item_rating_key = focused_poster_rating_key();
    if (selected_item_rating_key != details_prefetch_candidate_key) {
      details_prefetch_candidate_key = selected_item_rating_key;
      details_prefetch_at_ms =
          selected_item_rating_key == 0
              ? 0
              : input_now_ms + DETAILS_PREFETCH_IDLE_DELAY_MS;
    }
    const bool selected_details_cached =
        direct_details_cache_valid &&
        direct_details_cache.rating_key == selected_item_rating_key;
    if (selected_item_rating_key != 0 && !selected_details_cached &&
        !direct_details_loader.started && details_prefetch_at_ms != 0 &&
        input_now_ms >= details_prefetch_at_ms &&
        !direct_poster_loader_running(&direct_home_poster_loader) &&
        !direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_page_poster_loader) &&
        !direct_page_poster_loader.pending && !direct_hls_prefetch.started &&
        !direct_browse_loader.started && !direct_search_loader.started &&
        (!startup_data_loader.started || startup_data_loader.complete)) {
      if (launch_direct_details_loader(
              &direct_details_loader, &auth_credentials,
              selected_item_rating_key, false)) {
        details_prefetch_at_ms = 0;
      }
    }
    if (watch_together_lobby && syncplay_session != NULL) {
      if ((pressed & PAD_BUTTON_B) != 0) {
        SYS_Report("REFERENCE GX: Watch Together lobby left room=%u\n",
                   joined_watch_together_room);
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        joined_watch_together_room = UINT32_MAX;
        watch_together_all_present_since_ms = 0;
        watch_together_lobby = false;
      } else if (!multiplex_syncplay_session_poll(syncplay_session)) {
        SYS_Report("REFERENCE GX: Watch Together lobby disconnected\n");
        multiplex_native_app_watch_together_presence(0, 0);
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        joined_watch_together_room = UINT32_MAX;
        watch_together_all_present_since_ms = 0;
        watch_together_lobby = false;
        multiplex_native_app_watch_together_join_commit(0);
        native_frame_dirty = true;
      } else if (joined_watch_together_room <
                 watch_together_rooms.room_count) {
        const MultiplexTrpcRoom *room =
            &watch_together_rooms.rooms[joined_watch_together_room];
        const unsigned present =
            multiplex_syncplay_session_participant_count(syncplay_session);
        multiplex_native_app_watch_together_presence(1, present);
        const bool everyone_present =
            room->user_count > 1u && present >= room->user_count;
        const uint64_t now_ms = ticks_to_millisecs(gettime());
        if (!everyone_present) {
          if (watch_together_all_present_since_ms != 0) {
            SYS_Report("REFERENCE GX: Watch Together lobby rearmed "
                       "present=%u invited=%u\n",
                       present, room->user_count);
          }
          watch_together_all_present_since_ms = 0;
        } else if (watch_together_all_present_since_ms == 0) {
          watch_together_all_present_since_ms = now_ms;
          SYS_Report("REFERENCE GX: Watch Together lobby gathered "
                     "present=%u invited=%u\n",
                     present, room->user_count);
        } else if (now_ms - watch_together_all_present_since_ms >=
                   WATCH_TOGETHER_AUTO_START_DELAY_MS) {
          uint32_t room_position_ms = 0;
          bool room_paused = true;
          multiplex_syncplay_session_room_position(
              syncplay_session, &room_position_ms, &room_paused);
          const uint32_t room_index = joined_watch_together_room;
          multiplex_syncplay_session_destroy(syncplay_session);
          syncplay_session = NULL;
          watch_together_lobby = false;
          watch_together_all_present_since_ms = 0;
          if (!start_joined_watch_together_playback(
                  &auth_credentials, &watch_together_rooms, room_index,
                  plex_user_id, room_position_ms, &syncplay_session,
                  &playback_manifest, &client, &demux)) {
            joined_watch_together_room = UINT32_MAX;
            multiplex_native_app_watch_together_join_commit(0);
            SYS_Report("REFERENCE GX: Watch Together auto-start failed "
                       "room=%u\n",
                       room_index);
          } else {
            SYS_Report("REFERENCE GX: Watch Together auto-start room=%u "
                       "position=%u paused=%u\n",
                       room_index, room_position_ms,
                       room_paused ? 1u : 0u);
          }
          native_frame_dirty = true;
        }
      }
    }
    if (!watch_together_lobby && syncplay_session == NULL &&
        joined_watch_together_room < watch_together_rooms.room_count &&
        watch_together_reconnect_at_ms != 0 &&
        ticks_to_millisecs(gettime()) >= watch_together_reconnect_at_ms) {
      syncplay_session = multiplex_syncplay_session_connect(
          &watch_together_rooms.rooms[joined_watch_together_room],
          auth_credentials.plex_client_id, plex_user_id, false);
      if (syncplay_session == NULL) {
        watch_together_reconnect_at_ms =
            ticks_to_millisecs(gettime()) + WATCH_TOGETHER_RECONNECT_DELAY_MS;
        SYS_Report("REFERENCE GX: Syncplay reconnect retry room=%u\n",
                   joined_watch_together_room);
      } else {
        watch_together_reconnect_at_ms = 0;
        multiplex_syncplay_session_adopt_playback(
            syncplay_session, video_surface.playing == 0,
            playback_position_ms(&playback_manifest));
        multiplex_native_app_watch_together_presence(1, 1);
        SYS_Report("REFERENCE GX: Syncplay reconnected room=%u\n",
                   joined_watch_together_room);
      }
    }
    if (!watch_together_lobby && syncplay_session != NULL) {
      multiplex_syncplay_session_set_playback(
          syncplay_session, video_surface.playing == 0,
          playback_position_ms(&playback_manifest));
      if (!multiplex_syncplay_session_poll(syncplay_session)) {
        SYS_Report("REFERENCE GX: Syncplay session disconnected\n");
        multiplex_native_app_watch_together_presence(0, 0);
        multiplex_syncplay_session_destroy(syncplay_session);
        syncplay_session = NULL;
        watch_together_reconnect_at_ms =
            ticks_to_millisecs(gettime()) + WATCH_TOGETHER_RECONNECT_DELAY_MS;
      } else {
        multiplex_native_app_watch_together_presence(
            1, multiplex_syncplay_session_participant_count(syncplay_session));
        bool remote_paused = false;
        bool remote_seek = false;
        uint32_t remote_position_ms = 0;
        if (multiplex_syncplay_session_take_remote_playback(
                syncplay_session, &remote_paused, &remote_position_ms,
                &remote_seek)) {
          const uint32_t room_index = joined_watch_together_room;
          bool applied = true;
          if (remote_seek) {
            multiplex_syncplay_session_destroy(syncplay_session);
            syncplay_session = NULL;
            applied =
                load_direct_playback(
                    &auth_credentials, playback_manifest.rating_key,
                    remote_position_ms, true, &playback_manifest, &client,
                    &demux) &&
                room_index < watch_together_rooms.room_count;
            if (applied) {
              syncplay_session = multiplex_syncplay_session_connect(
                  &watch_together_rooms.rooms[room_index],
                  auth_credentials.plex_client_id, plex_user_id, false);
              applied = syncplay_session != NULL;
            }
            if (!applied) {
              joined_watch_together_room = UINT32_MAX;
              watch_together_reconnect_at_ms = 0;
              SYS_Report("REFERENCE GX: Syncplay remote seek failed "
                         "position=%u\n",
                         remote_position_ms);
            }
          }
          if (applied &&
              multiplex_native_app_playback_set_paused(remote_paused ? 1u
                                                                     : 0u) !=
                  0) {
            if (syncplay_session != NULL) {
              multiplex_syncplay_session_adopt_playback(
                  syncplay_session, remote_paused, remote_position_ms);
            }
            native_frame_dirty = true;
            SYS_Report("REFERENCE GX: Syncplay remote playback paused=%u "
                       "position=%u seek=%u\n",
                       remote_paused ? 1u : 0u, remote_position_ms,
                       remote_seek ? 1u : 0u);
          }
        }
      }
    }
#endif
    const uint64_t present_now_ms = ticks_to_millisecs(gettime());
    if (video_surface.visible != 0 && player_controls_overlay_visible &&
        player_controls_last_input_ms != 0 &&
        multiplex_native_app_player_settings_open() == 0) {
      if (player_controls_fade_started_ms == 0 &&
          present_now_ms - player_controls_last_input_ms >=
              PLAYER_CONTROLS_IDLE_MS) {
        player_controls_fade_started_ms = present_now_ms;
      }
      if (player_controls_fade_started_ms != 0) {
        const uint64_t fade_elapsed_ms =
            present_now_ms - player_controls_fade_started_ms;
        if (fade_elapsed_ms >= PLAYER_CONTROLS_FADE_MS) {
          player_controls_overlay_visible = false;
          player_controls_last_input_ms = 0;
          player_controls_fade_started_ms = 0;
          SYS_Report("REFERENCE GX: player controls visible=0 idle-ms=%u "
                     "fade-ms=%u\n",
                     PLAYER_CONTROLS_IDLE_MS, PLAYER_CONTROLS_FADE_MS);
        } else {
          const uint8_t next_alpha = (uint8_t)(
              255u * (PLAYER_CONTROLS_FADE_MS - (uint32_t)fade_elapsed_ms) /
              PLAYER_CONTROLS_FADE_MS);
          if (next_alpha != ui_frame_alpha) {
            ui_frame_alpha = next_alpha;
            set_player_controls_texture_alpha(ui_frame_alpha);
          }
        }
      }
    }
    present_frame(&playback_manifest);
    if (!recover_stalled_media_startup(&media_startup_watchdog,
                                       &playback_manifest, &client, &demux,
                                       &staged_media)) {
      exit_code = APP_EXIT_MEDIA_RECOVERY;
      break;
    }
    if (video_surface.visible != 0) {
      const uint32_t position_ms = playback_position_ms(&playback_manifest);
      if (video_surface.playing == 0) {
        timeline_started |= schedule_timeline_report(
            &timeline_reporter, MULTIPLEX_GATEWAY_URL,
            timeline_plex_credentials, direct_hls_session_id,
            playback_manifest.rating_key, position_ms,
            playback_manifest.media_duration_ms, "paused", false);
      } else if (video_was_playing) {
        timeline_started |= schedule_timeline_report(
            &timeline_reporter, MULTIPLEX_GATEWAY_URL,
            timeline_plex_credentials, direct_hls_session_id,
            playback_manifest.rating_key, position_ms,
            playback_manifest.media_duration_ms, "playing", false);
      }
      timeline_player_visible = true;
    } else if (timeline_player_visible) {
      if (schedule_timeline_report(
              &timeline_reporter, MULTIPLEX_GATEWAY_URL,
              timeline_plex_credentials, direct_hls_session_id,
              playback_manifest.rating_key,
              playback_position_ms(&playback_manifest),
              playback_manifest.media_duration_ms, "stopped", false)) {
        timeline_player_visible = false;
      }
    }
    stage_following_media_if_due(&staged_media, MULTIPLEX_GATEWAY_URL,
                                 &playback_manifest);
    if (!continue_playback_if_needed(MULTIPLEX_GATEWAY_URL, &playback_manifest,
                                     &client, &demux, &staged_media)) {
      SYS_Report("REFERENCE GX: playback continuation failed\n");
      exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
      break;
    }
#if MULTIPLEX_PAIRING_ENABLED
    bool autoplay_advanced = false;
    if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked) {
      if (syncplay_session == NULL &&
          !advance_direct_playback_if_complete(
              &auth_credentials, &playback_manifest, &client, &demux,
              &timeline_reporter, &autoplay_advanced)) {
        SYS_Report("REFERENCE GX: direct playback completion failed\n");
        exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        break;
      }
      if (syncplay_session != NULL && !watch_together_lobby &&
          !rotate_watch_together_if_complete(
              &auth_credentials, &watch_together_rooms, &syncplay_session,
              &joined_watch_together_room, plex_user_id,
              hosted_watch_together_room_id,
              sizeof(hosted_watch_together_room_id),
              hosted_watch_together_invitee_user_id, &playback_manifest,
              &client, &demux, &timeline_reporter, &autoplay_advanced)) {
        SYS_Report("REFERENCE GX: Watch Together playback completion "
                   "failed\n");
        exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        break;
      }
    }
    if (autoplay_advanced) {
      ui_frame_alpha = 255;
      player_controls_overlay_visible = true;
      player_controls_last_input_ms = ticks_to_millisecs(gettime());
      player_controls_fade_started_ms = 0;
    }
#endif
  }

  discard_staged_media_session(&staged_media);
  stop_reference_renderer();
#if MULTIPLEX_PAIRING_ENABLED
  multiplex_syncplay_session_destroy(syncplay_session);
  stop_direct_browse_loader(&direct_browse_loader);
  stop_direct_search_loader(&direct_search_loader);
  stop_direct_details_loader(&direct_details_loader);
  stop_catalog_loader(&catalog_loader);
  stop_catalog_cache_saver(&catalog_cache_saver);
  stop_startup_data_loader(&startup_data_loader);
#endif
  stop_direct_poster_loader(&direct_home_poster_loader);
  stop_direct_poster_loader(&direct_page_poster_loader);
  discard_direct_hls_prefetch(&direct_hls_prefetch);
  if (timeline_started) {
    flush_timeline_report(&timeline_reporter, MULTIPLEX_GATEWAY_URL,
                          timeline_plex_credentials, direct_hls_session_id,
                          &playback_manifest,
                          playback_position_ms(&playback_manifest), "stopped");
  } else {
    finish_timeline_report(&timeline_reporter);
  }
  close_media_session(&client, &demux);
  multiplex_native_cache_free(poster_texture_pixels);
  poster_texture_pixels = NULL;
  poster_texture_count = 0;
  poster_jpeg_shutdown();
  return (void *)(uintptr_t)exit_code;
}

static const char *app_exit_message(AppExitCode code) {
  switch (code) {
  case APP_EXIT_VIDEO_INIT:
    return "Video or GX initialization failed.";
  case APP_EXIT_JPEG_INIT:
    return "JPEG decoder initialization failed.";
  case APP_EXIT_BUFFER_INIT:
    return "UI framebuffer allocation failed.";
  case APP_EXIT_UI_BIND:
    return "Native UI state binding failed.";
  case APP_EXIT_UI_RENDER:
    return "Native UI rendering failed.";
  case APP_EXIT_BACKGROUND_BIND:
    return "Background Plex data binding failed.";
  case APP_EXIT_MEDIA_PRODUCER:
    return "The network media producer stopped.";
  case APP_EXIT_MEDIA_RECOVERY:
    return "Playback could not recover from a stall.";
  case APP_EXIT_PLAYBACK_CONTINUATION:
    return "Playback could not continue to the next segment.";
  case APP_EXIT_OK:
    return "The application exited normally.";
  }
  return "An unknown application failure occurred.";
}

static void show_app_failure(AppExitCode code) {
  SYS_Report("REFERENCE GX: stopped with diagnostic code MGC-%u\n",
             (unsigned)code);
  if (video_mode == NULL || framebuffers[0] == NULL) {
    return;
  }

  void *framebuffer = framebuffers[framebuffer_index & 1u];
  const uint32_t framebuffer_bytes = VIDEO_GetFrameBufferSize(video_mode);
  memset(framebuffer, 0, framebuffer_bytes);
  CON_Init(framebuffer, 32, 32, video_mode->fbWidth - 64,
           video_mode->xfbHeight - 64, video_mode->fbWidth * VI_DISPLAY_PIX_SZ);
  VIDEO_Configure(video_mode);
  VIDEO_SetNextFramebuffer(framebuffer);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();

  const struct mallinfo heap = mallinfo();
  printf("\nMultiplex stopped safely\n");
  printf("========================\n\n");
  printf("Diagnostic code: MGC-%u\n\n", (unsigned)code);
  printf("%s\n\n", app_exit_message(code));
  printf("Heap: %lu KiB free, %lu KiB used\n\n",
         (unsigned long)heap.fordblks / 1024ul,
         (unsigned long)heap.uordblks / 1024ul);
  printf("Photograph this screen so the exact failure can be fixed.\n");
  printf("Reset the console to return to Swiss.\n");

  while (SYS_MainLoop()) {
    PAD_ScanPads();
    VIDEO_WaitVSync();
  }
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  void *app_stack = malloc(APP_STACK_SIZE);
  if (app_stack == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate %u-byte app stack\n",
               APP_STACK_SIZE);
    return 1;
  }

  lwp_t app_thread = LWP_THREAD_NULL;
  if (LWP_CreateThread(&app_thread, run_app, NULL, app_stack, APP_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    SYS_Report("REFERENCE GX: failed to create app thread\n");
    free(app_stack);
    return 1;
  }

  void *result = NULL;
  const int join_status = LWP_JoinThread(app_thread, &result);
  free(app_stack);
  if (join_status != 0) {
    SYS_Report("REFERENCE GX: failed to join app thread\n");
    return 1;
  }
  const AppExitCode exit_code = (AppExitCode)(uintptr_t)result;
  if (exit_code != APP_EXIT_OK) {
    show_app_failure(exit_code);
  }
  return (int)exit_code;
}
