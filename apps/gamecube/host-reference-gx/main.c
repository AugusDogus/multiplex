#include "catalog_cache.h"
#include "device_auth.h"
#include "gateway_client.h"
#include "gui_navigation.h"
#include "http_client.h"
#include "media-source.h"
#include "memory_card_auth.h"
#include "native_ui.h"
#include "playback_session.h"
#include "plex_bootstrap.h"
#include "plex_catalog.h"
#include "poster_jpeg.h"
#include "presentation.h"
#include "reference_frame.h"
#include "syncplay_probe.h"
#include "tls_client.h"
#include "trpc_client.h"

#include <gccore.h>
#include <malloc.h>
#include <network.h>
#include <ogc/consol.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#if defined(HW_RVL)
#include <wiiuse/wpad.h>
#endif
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if MULTIPLEX_PAIRING_ENABLED
#define MULTIPLEX_PAIRING_ONLY
#else
#define MULTIPLEX_PAIRING_ONLY __attribute__((unused))
#endif

#define APP_STACK_SIZE (512 * 1024)
#define POSTER_LOADER_STACK_SIZE (256 * 1024)
#define POSTER_LOADER_LANE_COUNT 4u
#define DIRECT_DETAILS_LOADER_STACK_SIZE (256 * 1024)
#define DIRECT_BROWSE_LOADER_STACK_SIZE (256 * 1024)
#define DIRECT_SEARCH_LOADER_STACK_SIZE (256 * 1024)
#define STARTUP_DATA_LOADER_STACK_SIZE (256 * 1024)
#define CATALOG_LOADER_STACK_SIZE (256 * 1024)
#define CATALOG_CACHE_SAVER_STACK_SIZE (128 * 1024)
#define NETWORK_WARMUP_STACK_SIZE (64 * 1024)
#define PAIRING_POLL_INTERVAL_FRAMES 60u
#define WATCH_TOGETHER_AUTO_START_DELAY_MS 1200u
#define WATCH_TOGETHER_RECONNECT_DELAY_MS 1000u
#define CATALOG_RETRY_INITIAL_DELAY_MS 1000u
#define CATALOG_RETRY_MAX_DELAY_MS 8000u
#define PAIRING_RETRY_INITIAL_DELAY_MS 1000u
#define PAIRING_RETRY_MAX_DELAY_MS 8000u
#define STARTUP_DATA_IDLE_DELAY_MS 2000u
#define DETAILS_PREFETCH_IDLE_DELAY_MS 250u
#define MULTIPLEX_SCREEN_HOME 1u
#define MULTIPLEX_SCREEN_BROWSE 3u
#define MULTIPLEX_SCREEN_SEARCH_RESULTS 5u
#define MULTIPLEX_SCREEN_DETAILS 9u
#define MULTIPLEX_SCREEN_PLAYER 10u
#define MULTIPLEX_PLAYBACK_STATE_PLAYER 0x1u
#define MULTIPLEX_PLAYBACK_STATE_PLAYING 0x4u
#define MULTIPLEX_PAIRING_CONNECTING 4u
#define POSTER_JPEG_CAPACITY (256u * 1024u)
#define PLEX_POSTER_JPEG_CAPACITY (32u * 1024u)
#define HOME_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS
#define BROWSE_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS
#define POSTER_TEXTURE_COUNT (HOME_POSTER_COUNT + BROWSE_POSTER_COUNT)

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
  lwp_t thread;
  void *stack;
  bool ready;
  volatile bool complete;
} NetworkWarmup;

typedef struct {
  uint32_t rating_key;
  uint32_t stream_indices[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS];
  uint8_t count;
} ActiveSubtitleMap;

static MultiplexPresentation *presentation;
static MultiplexPlaybackSession *playback_session;
static MultiplexPlaybackSnapshot playback_snapshot;
static MultiplexGatewayDetails direct_details_cache;
static bool direct_details_cache_valid;
static ActiveSubtitleMap active_subtitle_map;
static MultiplexGuiNavigation gui_navigation;
static bool controller_status_reported;
static char boot_diagnostic_operation[64] = "Process startup";
static bool direct_playback_start_offset_pending =
    MULTIPLEX_PLAYBACK_START_OFFSET_MS != 0;

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
  multiplex_presentation_profile_mark(presentation, stage);
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

static int format_boot_diagnostics(char *destination, size_t capacity) {
  const MultiplexPresentationRenderDiagnostic render_diagnostic =
      multiplex_presentation_render_diagnostic(presentation);
  struct in_addr address = {.s_addr = net_gethostip()};
  char local_ip[16] = "0.0.0.0";
  if (address.s_addr != 0) {
    inet_ntoa_r(address, local_ip, sizeof(local_ip));
  }
  return snprintf(
      destination, capacity,
      "Stage: %s\nNetwork: %s, code %ld\n"
      "DHCP status: %ld, attempt %lu, IP: %s\n"
      "DNS attempts: %lu, TLS verify: %08lx\n"
      "UI render: %s, stage %08lx, async: %u",
      boot_diagnostic_operation, http_client_diagnostic_stage_name(),
      (long)http_client_diagnostic_error(), (long)http_client_network_status(),
      (unsigned long)http_client_network_attempts(), local_ip,
      (unsigned long)http_client_dns_attempts(),
      (unsigned long)http_client_tls_verify_flags(),
      multiplex_reference_frame_status_name(render_diagnostic.status),
      (unsigned long)render_diagnostic.stage,
      render_diagnostic.asynchronous ? 1u : 0u);
}

static bool bind_boot_diagnostics(const char *operation) {
  snprintf(boot_diagnostic_operation, sizeof(boot_diagnostic_operation), "%s",
           operation);
  char diagnostics[256];
  const int length = format_boot_diagnostics(diagnostics, sizeof(diagnostics));
  if (length <= 0) {
    return false;
  }
  const size_t available = (size_t)length < sizeof(diagnostics)
                               ? (size_t)length
                               : sizeof(diagnostics) - 1u;
  const bool committed =
      multiplex_native_app_boot_diagnostics((const uint8_t *)diagnostics,
                                            (uint32_t)available) != 0;
  if (committed) {
    multiplex_presentation_request_refresh(presentation, false);
  }
  return committed;
}

static bool initialize_poster_textures(const char *gateway_url,
                                       uint16_t item_count) {
  if (gateway_url == NULL || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS) {
    return false;
  }
  const size_t home_bytes =
      (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  MultiplexPresentationPosterWrite write = {0};
  if (!multiplex_presentation_posters_begin(
          presentation, 0, item_count, MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE,
          &write)) {
    free(encoded);
    return false;
  }
  size_t encoded_size = 0;
  if (encoded == NULL ||
      !multiplex_gateway_load_artwork(gateway_url, encoded,
                                      POSTER_JPEG_CAPACITY, &encoded_size) ||
      !poster_jpeg_decode_columns(encoded, encoded_size, item_count,
                                  MULTIPLEX_GATEWAY_MAX_HOME_ITEMS,
                                  write.pixels, home_bytes)) {
    free(encoded);
    multiplex_presentation_posters_cancel(presentation, &write);
    return false;
  }

  free(encoded);
  const uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS] = {0};
  if (!multiplex_presentation_posters_commit(presentation, &write,
                                             rating_keys)) {
    return false;
  }
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
        const uint8_t luma =
            (uint8_t)(13u + variation +
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
  loader->lane_count = loader->item_count < POSTER_LOADER_LANE_COUNT
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
  MultiplexPresentationPosterWrite write;
  if (!multiplex_presentation_posters_begin(
          presentation, texture_offset, item_count,
          MULTIPLEX_PRESENTATION_POSTERS_REUSE, &write)) {
    return false;
  }
  uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS] = {0};
  uint16_t download_count = 0;
  for (uint16_t index = 0; index < item_count; ++index) {
    const uint16_t target_slot = texture_offset + index;
    uint8_t *pixels =
        write.pixels + (size_t)index * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    if (multiplex_presentation_posters_reuse(presentation, &write, index,
                                             items[index].rating_key)) {
      rating_keys[index] = items[index].rating_key;
      ++loader->cache_hits;
    } else {
      fill_poster_fallback(pixels, items[index].rating_key);
      loader->items[download_count] = items[index];
      loader->texture_slots[download_count] = target_slot;
      ++download_count;
    }
  }
  if (!multiplex_presentation_posters_commit(presentation, &write,
                                             rating_keys)) {
    multiplex_presentation_posters_cancel(presentation, &write);
    return false;
  }
  loader->credentials = credentials;
  loader->item_count = download_count;
  loader->requested_count = item_count;
  loader->texture_offset = texture_offset;
  loader->pending = download_count != 0;
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
  for (uint16_t lane = 0; lane < loader->lane_count; ++lane) {
    if (loader->item_ready[lane]) {
      __sync_synchronize();
      if (loader->item_decoded[lane]) {
        const uint16_t item_index = loader->item_index[lane];
        const uint16_t texture_slot = loader->texture_slots[item_index];
        MultiplexPresentationPosterWrite write;
        const uint32_t rating_key = loader->items[item_index].rating_key;
        if (!multiplex_presentation_posters_begin(
                presentation, texture_slot, 1,
                MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write)) {
          loader->item_decoded[lane] = false;
        } else {
          memcpy(write.pixels, loader->decoded_pixels[lane],
                 MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
          loader->item_decoded[lane] = multiplex_presentation_posters_commit(
              presentation, &write, &rating_key);
        }
      }
      if (loader->item_decoded[lane]) {
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
    all_complete =
        all_complete && loader->complete[lane] && !loader->item_ready[lane];
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

static void MULTIPLEX_PAIRING_ONLY
suspend_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL ||
      (!loader->pending && !direct_poster_loader_running(loader))) {
    return;
  }
  loader->stopping = true;
  release_direct_poster_workers(loader);
  uint16_t remaining = 0;
  for (uint16_t index = 0; index < loader->item_count; ++index) {
    const uint16_t texture_slot = loader->texture_slots[index];
    if (multiplex_presentation_poster_matches(
            presentation, texture_slot, loader->items[index].rating_key)) {
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
  MultiplexPresentationPosterWrite write = {0};
  const bool write_started =
      page.item_count != 0 &&
      multiplex_presentation_posters_begin(
          presentation, HOME_POSTER_COUNT, page.item_count,
          MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write);
  const size_t browse_bytes =
      (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (encoded == NULL ||
      (page.item_count != 0 &&
       (!write_started ||
        !multiplex_gateway_load_browse_artwork(
            gateway_url, page.section_id, page.start, encoded,
            POSTER_JPEG_CAPACITY, &encoded_size) ||
        !poster_jpeg_decode_columns(encoded, encoded_size, page.item_count,
                                    MULTIPLEX_GATEWAY_BROWSE_COLUMNS,
                                    write.pixels, browse_bytes)))) {
    free(encoded);
    if (write_started) {
      multiplex_presentation_posters_cancel(presentation, &write);
    }
    return false;
  }
  free(encoded);
  if (write_started) {
    const uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS] = {0};
    if (!multiplex_presentation_posters_commit(presentation, &write,
                                               rating_keys)) {
      return false;
    }
  }

  const bool bound = bind_browse_page(&page);
  if (bound) {
    multiplex_presentation_queue_browse_motion(presentation, previous_start,
                                               page.start);
  }
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
    DirectBrowseLoader *loader, const MultiplexAuthCredentials *credentials,
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
  multiplex_presentation_set_network_activity(presentation, true);
  SYS_Report("REFERENCE GX: browse-page load started section=%u start=%u\n",
             library->section_id, start);
  return true;
}

static void MULTIPLEX_PAIRING_ONLY
stop_direct_browse_loader(DirectBrowseLoader *loader) {
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

static bool MULTIPLEX_PAIRING_ONLY poll_direct_browse_loader(
    DirectBrowseLoader *loader, const MultiplexAuthCredentials *credentials,
    DirectPosterLoader *poster_loader) {
  if (loader == NULL || !loader->started) {
    return true;
  }
  uint32_t requested_section = 0;
  uint32_t requested_start = 0;
  const bool still_requested = multiplex_native_app_browse_request(
                                   &requested_section, &requested_start) != 0;
  if (!loader->complete) {
    if (!still_requested) {
      multiplex_presentation_set_network_activity(presentation, false);
    }
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  multiplex_presentation_set_network_activity(presentation, false);
  if (!still_requested || requested_section != loader->library.section_id ||
      requested_start != loader->start) {
    return true;
  }
  bool bound = false;
  if (loader->ready) {
    const uint32_t previous_start = multiplex_native_app_browse_view_start();
    if (!queue_direct_poster_loader(poster_loader, credentials,
                                    loader->page.items, loader->page.item_count,
                                    HOME_POSTER_COUNT, false)) {
      SYS_Report(
          "REFERENCE GX: direct browse artwork deferred; using placeholders\n");
    }
    bound = bind_browse_page(&loader->page);
    if (bound) {
      multiplex_presentation_queue_browse_motion(presentation, previous_start,
                                                 loader->page.start);
    }
    SYS_Report(
        "REFERENCE GX: direct browse-page complete section=%u start=%u us=%u\n",
        requested_section, requested_start, elapsed_us(loader->started_tick));
  } else {
    bound = multiplex_native_app_browse_fail() != 0;
    SYS_Report("REFERENCE GX: browse-page unavailable section=%u start=%u\n",
               requested_section, requested_start);
  }
  if (bound) {
    multiplex_presentation_request_refresh(presentation, true);
  }
  return bound;
}

static bool MULTIPLEX_PAIRING_ONLY load_direct_browse_page(
    const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayCatalog *catalog, DirectBrowseLoader *loader) {
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

  if (page.item_count > 0) {
    uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
    size_t encoded_size = 0;
    MultiplexPresentationPosterWrite write;
    const bool write_started = multiplex_presentation_posters_begin(
        presentation, HOME_POSTER_COUNT, page.item_count,
        MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write);
    const size_t search_bytes =
        (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    if (encoded == NULL || !write_started ||
        !multiplex_gateway_load_search_artwork(
            gateway_url, query, (uint16_t)query_length, encoded,
            POSTER_JPEG_CAPACITY, &encoded_size) ||
        !poster_jpeg_decode(encoded, encoded_size, page.item_count,
                            write.pixels, search_bytes)) {
      free(encoded);
      if (write_started) {
        multiplex_presentation_posters_cancel(presentation, &write);
      }
      return false;
    }
    free(encoded);
    const uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS] = {0};
    if (!multiplex_presentation_posters_commit(presentation, &write,
                                               rating_keys)) {
      return false;
    }
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

static bool
launch_direct_search_loader(DirectSearchLoader *loader,
                            const MultiplexAuthCredentials *credentials,
                            const char *query, uint16_t query_length) {
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
  multiplex_presentation_set_network_activity(presentation, true);
  SYS_Report("REFERENCE GX: search-page load started query=%.*s\n",
             query_length, query);
  return true;
}

static void MULTIPLEX_PAIRING_ONLY
stop_direct_search_loader(DirectSearchLoader *loader) {
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

static bool MULTIPLEX_PAIRING_ONLY poll_direct_search_loader(
    DirectSearchLoader *loader, const MultiplexAuthCredentials *credentials,
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
      multiplex_presentation_set_network_activity(presentation, false);
    }
    return true;
  }
  __sync_synchronize();
  if (loader->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(loader->thread, NULL);
    loader->thread = LWP_THREAD_NULL;
  }
  loader->started = false;
  multiplex_presentation_set_network_activity(presentation, false);
  if (!still_requested) {
    return true;
  }
  bool bound = false;
  if (loader->ready) {
    if (loader->page.item_count > 0 &&
        !queue_direct_poster_loader(poster_loader, credentials,
                                    loader->page.items, loader->page.item_count,
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
    multiplex_presentation_request_refresh(presentation, true);
  }
  return bound;
}

static bool MULTIPLEX_PAIRING_ONLY load_direct_search_page(
    const MultiplexAuthCredentials *credentials, DirectSearchLoader *loader) {
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
  uint8_t subtitle_count = 0;
  uint32_t selected_subtitle = 0;
  char labels[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS]
             [MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY] = {{0}};
  uint8_t label_lengths[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS] = {0};
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (!subtitle->has_index ||
        subtitle_count >= MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      continue;
    }
    size_t label_length = strnlen(
        subtitle->label, MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY - 1u);
    if (label_length == 0) {
      label_length = (size_t)snprintf(labels[subtitle_count],
                                      MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY,
                                      "Subtitle %u", subtitle_count + 1u);
    } else {
      memcpy(labels[subtitle_count], subtitle->label, label_length);
    }
    label_lengths[subtitle_count] = (uint8_t)label_length;
    ++subtitle_count;
    if (subtitle->selected) {
      selected_subtitle = subtitle_count;
    }
  }
  return multiplex_native_app_subtitles(
             subtitle_count, selected_subtitle, (const uint8_t *)labels,
             MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY, label_lengths) != 0;
}

static bool retain_details_prefetch(const MultiplexAuthCredentials *credentials,
                                    const MultiplexGatewayDetails *details,
                                    bool visible) {
  if (credentials == NULL || details == NULL) {
    return false;
  }
  if (visible && (details->rating_key == 0 || details->duration_ms == 0)) {
    return false;
  }
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
  const MultiplexPlaybackPrefetchRequest request = {
      .credentials = *credentials,
      .rating_key = details->rating_key,
      .offset_ms = details->view_offset_ms < details->duration_ms
                       ? details->view_offset_ms
                       : 0,
      .burn_subtitles = burn_subtitles,
      .subtitle_stream_index = subtitle_stream_index,
      .disposition = visible ? MULTIPLEX_PLAYBACK_PREFETCH_RETAIN
                             : MULTIPLEX_PLAYBACK_PREFETCH_RELEASE_WHEN_READY,
  };
  return multiplex_playback_session_retain_prefetch(playback_session, &request);
}

static bool format_episode_metadata(const MultiplexGatewayDetails *details,
                                    uint16_t *secondary_length, char *hierarchy,
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
  if (formatted_length < 0 || (size_t)formatted_length >= hierarchy_capacity) {
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
        facts, sizeof(facts), "%u - %u min - %u.%u/10", details->year, minutes,
        details->rating_tenths / 10u, details->rating_tenths % 10u);
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

static void *run_direct_details_loader(void *context) {
  DirectDetailsLoader *loader = context;
  loader->ready = multiplex_plex_load_details(
      loader->credentials, loader->rating_key, &loader->details);
  __sync_synchronize();
  loader->complete = true;
  return NULL;
}

static bool
launch_direct_details_loader(DirectDetailsLoader *loader,
                             const MultiplexAuthCredentials *credentials,
                             uint32_t rating_key, bool foreground) {
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
  multiplex_presentation_set_network_activity(presentation, foreground);
  SYS_Report("REFERENCE GX: details-page load started rating-key=%u mode=%s\n",
             rating_key, foreground ? "foreground" : "prefetch");
  return true;
}

static void MULTIPLEX_PAIRING_ONLY
stop_direct_details_loader(DirectDetailsLoader *loader) {
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

static bool MULTIPLEX_PAIRING_ONLY load_direct_item_details(
    const MultiplexAuthCredentials *credentials, DirectDetailsLoader *loader) {
  const uint32_t rating_key = multiplex_native_app_details_request();
  if (rating_key == 0) {
    return true;
  }
  if (direct_details_cache_valid &&
      direct_details_cache.rating_key == rating_key) {
    const bool bound = bind_item_details(&direct_details_cache);
    if (bound &&
        !retain_details_prefetch(credentials, &direct_details_cache, true)) {
      SYS_Report("REFERENCE GX: HLS session prefetch unavailable "
                 "rating-key=%u\n",
                 rating_key);
    }
    return bound;
  }
  if (loader->started) {
    loader->foreground = true;
    multiplex_presentation_set_network_activity(presentation, true);
    return true;
  }
  return launch_direct_details_loader(loader, credentials, rating_key, true);
}

static bool MULTIPLEX_PAIRING_ONLY poll_direct_details_loader(
    DirectDetailsLoader *loader, const MultiplexAuthCredentials *credentials) {
  if (loader == NULL || !loader->started) {
    return true;
  }
  if (!loader->complete) {
    if (loader->foreground && multiplex_native_app_details_request() == 0) {
      loader->foreground = false;
      multiplex_presentation_set_network_activity(presentation, false);
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
    multiplex_presentation_set_network_activity(presentation, false);
  }
  const uint32_t completed_rating_key = loader->rating_key;
  const uint32_t requested_rating_key = multiplex_native_app_details_request();
  if (loader->ready) {
    direct_details_cache = loader->details;
    direct_details_cache_valid = true;
  }
  if (requested_rating_key == completed_rating_key) {
    const bool bound = loader->ready ? bind_item_details(&direct_details_cache)
                                     : fail_item_details(completed_rating_key);
    if (!bound) {
      return false;
    }
    if (loader->ready &&
        !retain_details_prefetch(credentials, &direct_details_cache, true)) {
      SYS_Report("REFERENCE GX: HLS session prefetch unavailable "
                 "rating-key=%u\n",
                 completed_rating_key);
    }
    if (!load_direct_item_children(credentials)) {
      SYS_Report("REFERENCE GX: direct details children load failed\n");
    }
    multiplex_presentation_request_refresh(presentation, true);
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

static uint32_t playback_position_ms(void) {
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  return playback_snapshot.position_ms;
}

static void remember_active_subtitles(const MultiplexGatewayDetails *details) {
  ActiveSubtitleMap mapping = {.rating_key = details->rating_key};
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (subtitle->has_index &&
        mapping.count < MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      mapping.stream_indices[mapping.count++] = subtitle->index;
    }
  }
  active_subtitle_map = mapping;
}

static bool selected_active_subtitle(uint32_t rating_key, uint32_t selection,
                                     bool *burn, uint32_t *stream_index) {
  if (active_subtitle_map.rating_key != rating_key) {
    return false;
  }
  if (selection == 0) {
    *burn = false;
    *stream_index = 0;
    return true;
  }
  if (selection > active_subtitle_map.count) {
    return false;
  }
  *burn = true;
  *stream_index = active_subtitle_map.stream_indices[selection - 1u];
  return true;
}

static void selected_subtitle(const MultiplexGatewayDetails *details,
                              uint32_t selection, bool *burn,
                              uint32_t *stream_index) {
  *burn = false;
  *stream_index = 0;
  if (details == NULL || selection == 0) {
    return;
  }
  uint32_t ordinal = 0;
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (!subtitle->has_index) {
      continue;
    }
    ordinal += 1u;
    if (ordinal == selection) {
      *burn = true;
      *stream_index = subtitle->index;
      return;
    }
  }
}

static bool load_selected_playback(const char *gateway_url) {
  const uint32_t rating_key = multiplex_native_app_playback_request();
  if (rating_key == 0) {
    return true;
  }
  MultiplexPlaybackGatewayOpenRequest request = {
      .rating_key = rating_key,
      .offset_ms = multiplex_native_app_playback_offset_request(),
  };
  snprintf(request.gateway_url, sizeof(request.gateway_url), "%s", gateway_url);
  const MultiplexPlaybackOpenResult result =
      multiplex_playback_session_open_gateway(playback_session, &request);
  if (result != MULTIPLEX_PLAYBACK_OPEN_READY) {
    if (multiplex_native_app_playback_fail() == 0) {
      return false;
    }
    SYS_Report("REFERENCE GX: playback-session unavailable rating-key=%u "
               "result=%u\n",
               rating_key, (unsigned)result);
    return true;
  }
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  if (multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: playback-session ready rating-key=%u offset=%u\n",
             playback_snapshot.rating_key, playback_snapshot.segment_start_ms);
  return true;
}

static bool load_direct_playback(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key, uint32_t requested_offset,
                                 bool transition_from_watch_together) {
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  uint32_t duration_ms = playback_snapshot.rating_key == rating_key
                             ? playback_snapshot.duration_ms
                             : 0;
  MultiplexGatewayDetails details;
  memset(&details, 0, sizeof(details));
  if (duration_ms == 0) {
    if (direct_details_cache_valid &&
        direct_details_cache.rating_key == rating_key) {
      details = direct_details_cache;
    } else if (!multiplex_plex_load_details(credentials, rating_key,
                                            &details) ||
               details.duration_ms == 0) {
      if (transition_from_watch_together) {
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
  if (playback_snapshot.rating_key != rating_key &&
      !bind_item_subtitles(&details)) {
    return false;
  }

  bool burn_subtitles = playback_snapshot.rating_key == rating_key &&
                        playback_snapshot.burn_subtitles;
  uint32_t subtitle_stream_index = playback_snapshot.rating_key == rating_key
                                       ? playback_snapshot.subtitle_stream_index
                                       : 0;
  const MultiplexGatewayDetails *subtitle_details = NULL;
  if (details.rating_key == rating_key) {
    subtitle_details = &details;
  } else if (direct_details_cache_valid &&
             direct_details_cache.rating_key == rating_key) {
    subtitle_details = &direct_details_cache;
  }
  if (subtitle_details != NULL) {
    selected_subtitle(subtitle_details,
                      multiplex_native_app_subtitle_selection(),
                      &burn_subtitles, &subtitle_stream_index);
  } else {
    selected_active_subtitle(rating_key,
                             multiplex_native_app_subtitle_selection(),
                             &burn_subtitles, &subtitle_stream_index);
  }
  const uint32_t offset_ms =
      requested_offset < duration_ms ? requested_offset : 0;
  MultiplexPlaybackHlsOpenRequest request = {
      .credentials = *credentials,
      .rating_key = rating_key,
      .offset_ms = offset_ms,
      .duration_ms = duration_ms,
      .resume_current_session = playback_snapshot.rating_key == rating_key,
      .burn_subtitles = burn_subtitles,
      .subtitle_stream_index = subtitle_stream_index,
  };
  const MultiplexPlaybackOpenResult result =
      multiplex_playback_session_open_hls(playback_session, &request);
  if (result != MULTIPLEX_PLAYBACK_OPEN_READY) {
    if (transition_from_watch_together) {
      return false;
    }
    if (multiplex_native_app_playback_fail() == 0) {
      return false;
    }
    SYS_Report("REFERENCE GX: direct playback unavailable rating-key=%u "
               "result=%u\n",
               rating_key, (unsigned)result);
    return true;
  }
  if (subtitle_details != NULL) {
    remember_active_subtitles(subtitle_details);
  }
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  if (!transition_from_watch_together &&
      multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: direct playback ready rating-key=%u offset=%u\n",
             playback_snapshot.rating_key, playback_snapshot.segment_start_ms);
  return true;
}

static bool MULTIPLEX_PAIRING_ONLY
load_selected_direct_playback(const MultiplexAuthCredentials *credentials) {
  const uint32_t rating_key = multiplex_native_app_playback_request();
  if (rating_key == 0) {
    return true;
  }
  uint32_t offset_ms = multiplex_native_app_playback_offset_request();
  if (direct_playback_start_offset_pending) {
    offset_ms = MULTIPLEX_PLAYBACK_START_OFFSET_MS;
    direct_playback_start_offset_pending = false;
    SYS_Report("REFERENCE GX: direct playback start override offset=%u\n",
               offset_ms);
  }
  return load_direct_playback(credentials, rating_key, offset_ms, false);
}

#if MULTIPLEX_PAIRING_ENABLED
static bool navigate_direct_playback_if_requested(
    const MultiplexAuthCredentials *credentials) {
  const int32_t direction = multiplex_native_app_playback_navigation_request();
  if (direction == 0) {
    return true;
  }
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  if (credentials == NULL || playback_snapshot.rating_key == 0) {
    return multiplex_native_app_playback_navigation_clear() != 0;
  }

  MultiplexGatewayItem target;
  const MultiplexPlexNextEpisodeResult result =
      direction < 0 ? multiplex_plex_load_previous_episode(
                          credentials, playback_snapshot.rating_key, &target)
                    : multiplex_plex_load_next_episode(
                          credentials, playback_snapshot.rating_key, &target);
  if (result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    if (multiplex_native_app_playback_navigation_clear() == 0) {
      return false;
    }
    multiplex_presentation_request_refresh(presentation, false);
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
    return true;
  }

  const uint32_t previous_rating_key = playback_snapshot.rating_key;
  multiplex_playback_session_stop(playback_session);
  if (multiplex_native_app_playback_navigate(
          target.rating_key, (const uint8_t *)details.title,
          details.title_length, (const uint8_t *)details.secondary,
          secondary_length, (const uint8_t *)hierarchy, hierarchy_length,
          details.duration_ms) == 0) {
    return false;
  }
  direct_details_cache = details;
  direct_details_cache_valid = true;
  if (!load_selected_direct_playback(credentials)) {
    SYS_Report("REFERENCE GX: direct playback navigation switch failed "
               "previous=%u requested=%u\n",
               previous_rating_key, target.rating_key);
    return false;
  }
  multiplex_presentation_request_refresh(presentation, false);
  return true;
}

static void stop_direct_playback_if_hidden(void) {
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  if (playback_snapshot.rating_key == 0 ||
      (multiplex_native_app_playback_state() &
       MULTIPLEX_PLAYBACK_STATE_PLAYER) != 0) {
    return;
  }
  const uint32_t stopped_rating_key = playback_snapshot.rating_key;
  const uint32_t stopped_position_ms = playback_snapshot.position_ms;
  multiplex_playback_session_stop(playback_session);
  SYS_Report("REFERENCE GX: direct playback stopped rating-key=%u "
             "position=%u\n",
             stopped_rating_key, stopped_position_ms);
}

static bool
advance_direct_playback_if_complete(const MultiplexAuthCredentials *credentials,
                                    bool completion_pending, bool *advanced) {
  *advanced = false;
  if (!completion_pending) {
    return true;
  }
  const MultiplexPlaybackSnapshot completed =
      multiplex_playback_session_snapshot(playback_session);
  multiplex_native_app_playback_position(completed.duration_ms);
  multiplex_playback_session_stop(playback_session);

  MultiplexGatewayItem next_episode;
  const MultiplexPlexNextEpisodeResult next_result =
      multiplex_plex_load_next_episode(credentials, completed.rating_key,
                                       &next_episode);
  if (next_result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    if (multiplex_native_app_playback_complete() == 0) {
      return false;
    }
    multiplex_presentation_request_refresh(presentation, false);
    return true;
  }
  if (multiplex_native_app_playback_advance(
          next_episode.rating_key, (const uint8_t *)next_episode.title,
          next_episode.title_length, next_episode.duration_ms) == 0 ||
      !load_selected_direct_playback(credentials)) {
    return false;
  }
  multiplex_presentation_request_refresh(presentation, false);
  *advanced = true;
  SYS_Report("REFERENCE GX: direct autoplay-next previous=%u active=%u "
             "title=%s\n",
             completed.rating_key, next_episode.rating_key, next_episode.title);
  return true;
}
#endif

static MultiplexPlaybackSnapshot
step_presentation_playback(bool desired_playing) {
  const MultiplexPresentationStatus status =
      multiplex_presentation_status(presentation);
  const MultiplexPlaybackStepInput input = {
      .visible = status.video_visible,
      .playing = desired_playing,
      .collect_network_metrics =
          status.video_visible &&
          multiplex_native_app_stats_for_nerds_enabled() != 0,
  };
  playback_snapshot = multiplex_playback_session_step(playback_session, &input);
  return playback_snapshot;
}

static MultiplexPresentationFrameResult
present_frame(MultiplexPresentationPrepareMode mode) {
  const MultiplexPresentationFrameResult frame =
      multiplex_presentation_prepare_frame(presentation, mode);
  const uint32_t playback_state = multiplex_native_app_playback_state();
  const uint32_t active_playback_state =
      MULTIPLEX_PLAYBACK_STATE_PLAYER | MULTIPLEX_PLAYBACK_STATE_PLAYING;
  const bool desired_playing =
      frame == MULTIPLEX_PRESENTATION_FRAME_READY &&
      (playback_state & active_playback_state) == active_playback_state;
  const MultiplexPresentationFrameInput input = {
      .playback = step_presentation_playback(desired_playing),
      .startup_rating_key =
          direct_details_cache_valid ? direct_details_cache.rating_key : 0,
  };
  if (!multiplex_presentation_present(presentation, &input)) {
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  return frame;
}

static bool wait_network_warmup(NetworkWarmup *warmup) {
  multiplex_presentation_set_network_activity(presentation, true);
  while (!warmup->complete && SYS_MainLoop()) {
    present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
  }
  __sync_synchronize();
  multiplex_presentation_set_network_activity(presentation, false);
  const bool ready = finish_network_warmup(warmup);
  bind_boot_diagnostics(ready ? "Network ready" : "Waiting for DHCP");
  return ready;
}

static bool wait_reference_transition(void) {
  while (SYS_MainLoop()) {
    const MultiplexPresentationFrameResult frame =
        multiplex_presentation_prepare_frame(
            presentation, MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
    if (frame == MULTIPLEX_PRESENTATION_FRAME_FAILED) {
      return false;
    }
    if (frame == MULTIPLEX_PRESENTATION_FRAME_READY) {
      return true;
    }
    present_frame(MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
  }
  return false;
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

static bool present_pending_page_transition(void) {
  if (!has_pending_page_request()) {
    return true;
  }

  const uint32_t started = gettick();
  multiplex_presentation_set_network_activity(presentation, true);
  if (!wait_reference_transition()) {
    multiplex_presentation_set_network_activity(presentation, false);
    return false;
  }
  multiplex_presentation_request_refresh(presentation, false);
  if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_SYNCHRONOUS) ==
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    multiplex_presentation_set_network_activity(presentation, false);
    return false;
  }
  multiplex_presentation_set_network_activity(presentation, false);
  SYS_Report("REFERENCE GX: network transition presented us=%u screen=%u\n",
             elapsed_us(started), multiplex_native_app_screen());
  return true;
}

static void pause_audio_for_player_input(uint32_t pressed) {
  if ((pressed &
       (PAD_BUTTON_A | PAD_BUTTON_B | PAD_TRIGGER_L | PAD_TRIGGER_R)) != 0 &&
      multiplex_presentation_status(presentation).video_visible) {
    const uint32_t position_ms = playback_position_ms();
    multiplex_native_app_playback_position(position_ms);
    multiplex_playback_session_pause(playback_session);
    SYS_Report("REFERENCE GX: timeline synced for input position=%u\n",
               position_ms);
  }
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

static bool MULTIPLEX_PAIRING_ONLY
bind_watch_together_rooms(const MultiplexTrpcRoomList *rooms, bool available) {
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

static bool MULTIPLEX_PAIRING_ONLY bind_watch_together_invitees(
    const MultiplexTrpcInviteeList *invitees, bool available) {
  if (invitees == NULL) {
    return false;
  }
  if (multiplex_native_app_watch_together_invitees_begin(
          available ? 1u : 0u, available ? invitees->invitee_count : 0u) == 0) {
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

static bool launch_catalog_loader(CatalogLoader *loader,
                                  const MultiplexAuthCredentials *credentials,
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

static bool
launch_catalog_cache_saver(CatalogCacheSaver *saver,
                           const MultiplexMemoryCardLocation *location,
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

static bool
launch_startup_data_loader(StartupDataLoader *loader,
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

static bool poll_startup_data_loader(StartupDataLoader *loader,
                                     uint32_t *user_id,
                                     MultiplexTrpcRoomList *rooms,
                                     MultiplexTrpcInviteeList *invitees) {
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
      !bind_watch_together_invitees(invitees, loader->invitees_available)) {
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

static void join_requested_watch_together_room(
    const MultiplexAuthCredentials *credentials,
    const MultiplexTrpcRoomList *rooms, MultiplexSyncplaySession **session,
    uint32_t *joined_room_index, uint32_t plex_user_id, bool *in_lobby,
    uint64_t *all_present_since_ms, const char *hosted_room_id) {
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
  *session = multiplex_syncplay_session_connect(
      &rooms->rooms[index], credentials->plex_client_id, plex_user_id, true);
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
    MultiplexSyncplaySession **session) {
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
  if (rating_key == 0 || !load_direct_playback(credentials, rating_key,
                                               playback_offset_ms, true)) {
    return false;
  }
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  *session = multiplex_syncplay_session_connect(
      room, credentials->plex_client_id, plex_user_id, false);
  if (*session == NULL ||
      multiplex_native_app_watch_together_playback(
          room_index, rating_key, (const uint8_t *)room->title,
          strlen(room->title), playback_snapshot.duration_ms,
          playback_snapshot.segment_start_ms) == 0) {
    multiplex_syncplay_session_destroy(*session);
    *session = NULL;
    multiplex_playback_session_stop(playback_session);
    return false;
  }
  multiplex_syncplay_session_set_playback(*session, false,
                                          playback_snapshot.segment_start_ms);
  SYS_Report("REFERENCE GX: Watch Together playback room=%u rating-key=%u "
             "offset=%u\n",
             room_index, rating_key, playback_snapshot.segment_start_ms);
  return true;
}

static uint32_t
find_watch_together_rotation_room(const MultiplexTrpcRoomList *rooms,
                                  const char *previous_room_id,
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
    uint32_t plex_user_id, char *hosted_room_id, size_t hosted_room_id_capacity,
    uint32_t hosted_invitee_user_id, bool completion_pending, bool *advanced) {
  *advanced = false;
  if (!completion_pending) {
    return true;
  }
  if (*joined_room_index >= rooms->room_count) {
    return false;
  }

  const MultiplexPlaybackSnapshot completed =
      multiplex_playback_session_snapshot(playback_session);
  const MultiplexTrpcRoom previous_room = rooms->rooms[*joined_room_index];
  multiplex_native_app_playback_position(completed.duration_ms);
  multiplex_playback_session_stop(playback_session);

  MultiplexGatewayItem next_episode;
  const MultiplexPlexNextEpisodeResult next_result =
      multiplex_plex_load_next_episode(credentials, completed.rating_key,
                                       &next_episode);
  if (next_result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    multiplex_native_app_playback_complete();
    multiplex_presentation_request_refresh(presentation, false);
    SYS_Report("REFERENCE GX: Watch Together playback complete rating-key=%u "
               "next=%s\n",
               completed.rating_key,
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
    multiplex_presentation_request_refresh(presentation, false);
    SYS_Report("REFERENCE GX: Watch Together autoplay room unavailable "
               "rating-key=%u\n",
               next_episode.rating_key);
    return true;
  }

  multiplex_syncplay_session_destroy(*session);
  *session = NULL;
  if (!start_joined_watch_together_playback(credentials, rooms, next_room_index,
                                            plex_user_id, 0, session)) {
    multiplex_native_app_playback_complete();
    multiplex_presentation_request_refresh(presentation, false);
    return true;
  }
  *joined_room_index = next_room_index;
  multiplex_native_app_watch_together_host(created ? 1u : 0u);
  if (!created) {
    hosted_room_id[0] = '\0';
  }
  const bool deleted = multiplex_trpc_delete_watch_together_room(
      MULTIPLEX_BASE_URL, credentials->session_token, previous_room.id);
  multiplex_presentation_request_refresh(presentation, false);
  *advanced = true;
  SYS_Report("REFERENCE GX: Watch Together autoplay-next previous=%u "
             "active=%u room=%s created=%u old-deleted=%u\n",
             completed.rating_key, next_episode.rating_key,
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
  snprintf(boot_diagnostic_operation, sizeof(boot_diagnostic_operation), "%s",
           "Presentation initialization");
  const MultiplexPresentationOpenResult presentation_open =
      multiplex_presentation_open(presentation);
  if (presentation_open == MULTIPLEX_PRESENTATION_OPEN_VIDEO_FAILED) {
    return (void *)(uintptr_t)APP_EXIT_VIDEO_INIT;
  }
  if (presentation_open != MULTIPLEX_PRESENTATION_OPEN_READY) {
    return (void *)(uintptr_t)APP_EXIT_BUFFER_INIT;
  }
  snprintf(boot_diagnostic_operation, sizeof(boot_diagnostic_operation), "%s",
           "JPEG initialization");
  if (!poster_jpeg_initialize()) {
    return (void *)(uintptr_t)APP_EXIT_JPEG_INIT;
  }
  multiplex_tls_client_prepare();
  NetworkWarmup network_warmup;
  memset(&network_warmup, 0, sizeof(network_warmup));
  network_warmup.thread = LWP_THREAD_NULL;
  bool network_ready = false;
  bool network_warmup_pending = MULTIPLEX_GATEWAY_URL[0] != '\0' &&
                                launch_network_warmup(&network_warmup);
  uint64_t network_retry_at_ms MULTIPLEX_PAIRING_ONLY = 0;
  uint32_t network_retry_delay_ms MULTIPLEX_PAIRING_ONLY =
      CATALOG_RETRY_INITIAL_DELAY_MS;
  bool offline_notice_presented MULTIPLEX_PAIRING_ONLY = false;

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
  bool catalog_refresh_pending = false;
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
  if (multiplex_native_app_pairing_status(MULTIPLEX_PAIRING_CONNECTING,
                                          (const uint8_t *)"", 0,
                                          (const uint8_t *)"", 0) == 0) {
    SYS_Report("REFERENCE GX: failed to bind network startup status\n");
    if (network_warmup_pending) {
      finish_network_warmup(&network_warmup);
    }
    return (void *)(uintptr_t)APP_EXIT_UI_BIND;
  }
  if (!bind_boot_diagnostics("Loading saved account")) {
    SYS_Report("REFERENCE GX: failed to bind boot diagnostics\n");
    if (network_warmup_pending) {
      finish_network_warmup(&network_warmup);
    }
    return (void *)(uintptr_t)APP_EXIT_UI_BIND;
  }
#endif
  if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_SYNCHRONOUS) ==
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    if (network_warmup_pending) {
      finish_network_warmup(&network_warmup);
    }
    return (void *)(uintptr_t)APP_EXIT_UI_RENDER;
  }

  if (network_warmup_pending && MULTIPLEX_GATEWAY_URL[0] != '\0') {
    network_ready = wait_network_warmup(&network_warmup);
    SYS_Report("REFERENCE GX: network warmup ready=%u\n",
               network_ready ? 1u : 0u);
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
      multiplex_memory_card_load_auth_with_cache(&auth_credentials,
                                                 &auth_location, cached_catalog,
                                                 sizeof(cached_catalog));
  MultiplexDeviceAuth device_auth;
  memset(&device_auth, 0, sizeof(device_auth));
  bool pairing_status_presented = false;
  if (stored_auth == MULTIPLEX_MEMORY_CARD_OK) {
    device_auth.status = MULTIPLEX_DEVICE_AUTH_LINKED;
    SYS_Report("REFERENCE GX: auth restored slot=%c generation=%u\n",
               auth_location.slot == 0 ? 'A' : 'B', auth_location.generation);
    if (multiplex_native_app_pairing_status(device_auth.status,
                                            (const uint8_t *)"", 0,
                                            (const uint8_t *)"", 0) == 0) {
      SYS_Report("REFERENCE GX: failed to bind restored authorization\n");
      return (void *)(uintptr_t)APP_EXIT_UI_BIND;
    }
    if (multiplex_catalog_cache_decode(cached_catalog, &catalog) &&
        bind_catalog_to_app(&catalog)) {
      has_catalog = true;
      catalog_refresh_pending = true;
      SYS_Report("REFERENCE GX: cached catalog ready rows=%u items=%u us=%u\n",
                 catalog.row_count, catalog.total_item_count,
                 elapsed_us(app_started));
    }
    multiplex_presentation_request_refresh(presentation, false);
    present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    if (!wait_reference_transition()) {
      return (void *)(uintptr_t)APP_EXIT_UI_RENDER;
    }
    pairing_status_presented = true;
    if (MULTIPLEX_GATEWAY_URL[0] == '\0') {
      bind_boot_diagnostics("Starting Broadband Adapter");
      network_warmup_pending = launch_network_warmup(&network_warmup);
      if (!network_warmup_pending) {
        network_retry_at_ms =
            ticks_to_millisecs(gettime()) + network_retry_delay_ms;
      }
    }
    if (network_warmup_pending) {
      if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
        network_ready = wait_network_warmup(&network_warmup);
        SYS_Report("REFERENCE GX: network warmup ready=%u\n",
                   network_ready ? 1u : 0u);
        network_warmup_pending = false;
      }
    }
    bool credentials_changed = false;
    if (network_ready && auth_credentials.plex_token[0] == '\0') {
      const bool credentials_refreshed =
          multiplex_device_auth_refresh_credentials(auth_credentials.origin,
                                                    &auth_credentials);
      SYS_Report("REFERENCE GX: Plex credential refresh=%u\n",
                 credentials_refreshed ? 1u : 0u);
      credentials_changed = credentials_refreshed;
    }
    if (network_ready && auth_credentials.plex_server_url[0] == '\0' &&
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
    if (MULTIPLEX_GATEWAY_URL[0] == '\0') {
      bind_boot_diagnostics("Starting Broadband Adapter");
      network_warmup_pending = launch_network_warmup(&network_warmup);
    }
    if (network_warmup_pending) {
      network_ready = wait_network_warmup(&network_warmup);
      SYS_Report("REFERENCE GX: network warmup ready=%u\n",
                 network_ready ? 1u : 0u);
      network_warmup_pending = false;
    }
    if (!multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &device_auth)) {
      device_auth.status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
      const char *tls_failure = multiplex_tls_client_failure_message();
      bind_boot_diagnostics(tls_failure != NULL
                                ? tls_failure
                                : "Multiplex pairing request failed");
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
    multiplex_presentation_request_refresh(presentation, false);
    if (!pairing_linked || has_catalog) {
      present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    }
  }
  bool auth_reset_latched = false;
  uint32_t pairing_poll_frames = 0;
  uint64_t pairing_retry_at_ms = 0;
  uint32_t pairing_retry_delay_ms = PAIRING_RETRY_INITIAL_DELAY_MS;
  if (!pairing_linked &&
      device_auth.status == MULTIPLEX_DEVICE_AUTH_UNAVAILABLE) {
    pairing_retry_at_ms =
        ticks_to_millisecs(gettime()) + pairing_retry_delay_ms;
  }
  if (pairing_linked && network_ready &&
      (!has_catalog || catalog_refresh_pending)) {
    if (launch_catalog_loader(&catalog_loader, &auth_credentials, &catalog)) {
      multiplex_presentation_set_network_activity(presentation, !has_catalog);
    } else {
      catalog_retry_at_ms =
          ticks_to_millisecs(gettime()) + CATALOG_RETRY_INITIAL_DELAY_MS;
      if (multiplex_native_app_pairing_status(MULTIPLEX_DEVICE_AUTH_UNAVAILABLE,
                                              (const uint8_t *)"", 0,
                                              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind network unavailable status\n");
        return (void *)(uintptr_t)APP_EXIT_UI_BIND;
      }
    }
    if (!has_catalog) {
      multiplex_presentation_request_refresh(presentation, false);
      present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    }
  }
#endif
  if (network_warmup_pending && MULTIPLEX_GATEWAY_URL[0] != '\0') {
    network_ready = wait_network_warmup(&network_warmup);
    SYS_Report("REFERENCE GX: network warmup ready=%u\n",
               network_ready ? 1u : 0u);
    network_warmup_pending = false;
  }
  MultiplexGatewayPlaybackManifest startup_manifest;
  const bool has_playback_manifest =
      MULTIPLEX_GATEWAY_URL[0] != '\0' &&
      multiplex_gateway_load_playback_manifest(MULTIPLEX_GATEWAY_URL, 0, 0,
                                               &startup_manifest);
  if (has_playback_manifest) {
    SYS_Report("REFERENCE GX: playback-session deferred rating-key=%u until "
               "selected\n",
               startup_manifest.rating_key);
  } else if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
    const MultiplexPlaybackProgramOpenRequest request = {
        .source_kind = MULTIPLEX_PLAYBACK_PROGRAM_HTTP,
        .source.http =
            {
                .url = MULTIPLEX_MEDIA_URL,
                .stream_info =
                    {
                        .has_stream_info = MULTIPLEX_MEDIA_HAS_INFO != 0,
                        .video_bytes = MULTIPLEX_MEDIA_VIDEO_BYTES,
                        .audio_bytes = MULTIPLEX_MEDIA_AUDIO_BYTES,
                        .video_packets = MULTIPLEX_MEDIA_VIDEO_PACKETS,
                        .audio_packets = MULTIPLEX_MEDIA_AUDIO_PACKETS,
                        .first_video_pts90k = MULTIPLEX_MEDIA_VIDEO_PTS90K,
                        .first_audio_pts90k = MULTIPLEX_MEDIA_AUDIO_PTS90K,
                    },
            },
    };
    if (multiplex_playback_session_open_program(playback_session, &request) !=
        MULTIPLEX_PLAYBACK_OPEN_READY) {
      return (void *)(uintptr_t)APP_EXIT_MEDIA_PRODUCER;
    }
  }

  uint32_t queued_transition_buttons = 0;
  uint32_t queued_transition_navigation = UINT32_MAX;
  AppExitCode exit_code = APP_EXIT_OK;
  multiplex_presentation_set_async_enabled(presentation, true);
  while (SYS_MainLoop()) {
    poll_direct_poster_loader(&direct_home_poster_loader);
    poll_direct_poster_loader(&direct_page_poster_loader);
#if MULTIPLEX_PAIRING_ENABLED
    retain_details_prefetch(&auth_credentials, &direct_details_cache,
                            multiplex_native_app_screen() ==
                                    MULTIPLEX_SCREEN_DETAILS &&
                                direct_details_cache_valid);
#endif
    const MultiplexPresentationFrameResult transition =
        multiplex_presentation_prepare_frame(
            presentation, MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    if (transition == MULTIPLEX_PRESENTATION_FRAME_FAILED) {
      exit_code = APP_EXIT_UI_RENDER;
      break;
    }
    if (transition == MULTIPLEX_PRESENTATION_FRAME_PENDING) {
      PAD_ScanPads();
      queued_transition_buttons |= PAD_ButtonsDown(0);
#if defined(HW_RVL)
      WPAD_ScanPads();
      queued_transition_buttons |= wii_buttons_as_gamecube(WPAD_ButtonsDown(0));
#endif
      const uint64_t transition_input_ms = ticks_to_millisecs(gettime());
      const uint32_t transition_navigation =
          navigation_action(multiplex_gui_navigation_poll(
              &gui_navigation, PAD_StickX(0), PAD_StickY(0),
              transition_input_ms * 1000u));
      if (queued_transition_navigation == UINT32_MAX &&
          transition_navigation != UINT32_MAX) {
        queued_transition_navigation = transition_navigation;
      }
      present_frame(MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
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
    if (MULTIPLEX_GATEWAY_URL[0] == '\0' && network_warmup_pending &&
        network_warmup.complete) {
      __sync_synchronize();
      network_ready = finish_network_warmup(&network_warmup);
      network_warmup_pending = false;
      if (network_ready) {
        bind_boot_diagnostics("Network ready");
        static const char connected[] = "Ethernet connected";
        multiplex_native_app_toast((const uint8_t *)connected,
                                   sizeof(connected) - 1u);
        toast_dismiss_at_ms = catalog_now_ms + 2500u;
        offline_notice_presented = false;
        network_retry_at_ms = 0;
        network_retry_delay_ms = CATALOG_RETRY_INITIAL_DELAY_MS;
        catalog_retry_at_ms = catalog_now_ms;
        bool credentials_changed = false;
        if (auth_credentials.plex_token[0] == '\0') {
          credentials_changed = multiplex_device_auth_refresh_credentials(
              auth_credentials.origin, &auth_credentials);
        }
        if (auth_credentials.plex_server_url[0] == '\0' &&
            multiplex_plex_bootstrap_credentials(&auth_credentials,
                                                 MULTIPLEX_PLEX_BASE_URL)) {
          credentials_changed = true;
        }
        if (credentials_changed) {
          const MultiplexMemoryCardResult refreshed =
              multiplex_memory_card_save_auth(&auth_credentials,
                                              &auth_location);
          SYS_Report("REFERENCE GX: recovered Plex credential persistence=%s\n",
                     multiplex_memory_card_result_message(refreshed));
        }
        SYS_Report("REFERENCE GX: Ethernet recovery ready=1\n");
      } else {
        bind_boot_diagnostics("Ethernet disconnected; retrying");
        if (!offline_notice_presented) {
          static const char disconnected[] =
              "Ethernet disconnected. Showing saved library.";
          multiplex_native_app_toast((const uint8_t *)disconnected,
                                     sizeof(disconnected) - 1u);
          toast_dismiss_at_ms = 0;
          offline_notice_presented = true;
        }
        network_retry_at_ms = catalog_now_ms + network_retry_delay_ms;
        if (network_retry_delay_ms < CATALOG_RETRY_MAX_DELAY_MS) {
          network_retry_delay_ms *= 2u;
          if (network_retry_delay_ms > CATALOG_RETRY_MAX_DELAY_MS) {
            network_retry_delay_ms = CATALOG_RETRY_MAX_DELAY_MS;
          }
        }
        SYS_Report("REFERENCE GX: Ethernet recovery ready=0 retry-ms=%u\n",
                   (uint32_t)(network_retry_at_ms - catalog_now_ms));
      }
      multiplex_presentation_request_refresh(presentation, false);
    }
    if (MULTIPLEX_GATEWAY_URL[0] == '\0' && !network_ready &&
        !network_warmup_pending && network_retry_at_ms != 0 &&
        catalog_now_ms >= network_retry_at_ms) {
      bind_boot_diagnostics("Retrying Ethernet");
      if (launch_network_warmup(&network_warmup)) {
        network_warmup_pending = true;
        network_retry_at_ms = 0;
      } else {
        network_retry_at_ms = catalog_now_ms + network_retry_delay_ms;
      }
    }
    if (!pairing_linked &&
        device_auth.status == MULTIPLEX_DEVICE_AUTH_UNAVAILABLE &&
        pairing_retry_at_ms != 0 && catalog_now_ms >= pairing_retry_at_ms) {
      bind_boot_diagnostics("Retrying Multiplex pairing");
      if (multiplex_native_app_pairing_status(MULTIPLEX_PAIRING_CONNECTING,
                                              (const uint8_t *)"", 0,
                                              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind pairing retry status\n");
        exit_code = APP_EXIT_UI_BIND;
        break;
      }
      if (multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &device_auth)) {
        pairing_retry_at_ms = 0;
        pairing_retry_delay_ms = PAIRING_RETRY_INITIAL_DELAY_MS;
        pairing_poll_frames = 0;
        bind_boot_diagnostics("Pairing code ready");
      } else {
        device_auth.status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
        const char *tls_failure = multiplex_tls_client_failure_message();
        bind_boot_diagnostics(tls_failure != NULL
                                  ? tls_failure
                                  : "Multiplex pairing request failed");
        pairing_retry_at_ms = catalog_now_ms + pairing_retry_delay_ms;
        if (pairing_retry_delay_ms < PAIRING_RETRY_MAX_DELAY_MS) {
          pairing_retry_delay_ms *= 2u;
          if (pairing_retry_delay_ms > PAIRING_RETRY_MAX_DELAY_MS) {
            pairing_retry_delay_ms = PAIRING_RETRY_MAX_DELAY_MS;
          }
        }
      }
      if (multiplex_native_app_pairing_status(
              device_auth.status, (const uint8_t *)device_auth.user_code,
              strlen(device_auth.user_code),
              (const uint8_t *)device_auth.link_url,
              strlen(device_auth.link_url)) == 0) {
        SYS_Report("REFERENCE GX: failed to bind pairing retry result\n");
        exit_code = APP_EXIT_UI_BIND;
        break;
      }
      multiplex_presentation_request_refresh(presentation, false);
    }
    const CatalogLoaderStatus catalog_loader_status =
        poll_catalog_loader(&catalog_loader);
    poll_catalog_cache_saver(&catalog_cache_saver);
    if (catalog_loader_status == CATALOG_LOADER_READY) {
      multiplex_presentation_set_network_activity(presentation, false);
      if (multiplex_native_app_pairing_status(MULTIPLEX_DEVICE_AUTH_LINKED,
                                              (const uint8_t *)"", 0,
                                              (const uint8_t *)"", 0) == 0 ||
          !bind_catalog_to_app(&catalog)) {
        SYS_Report("REFERENCE GX: recovered Plex catalog binding failed\n");
        exit_code = APP_EXIT_BACKGROUND_BIND;
        break;
      }
      has_catalog = true;
      catalog_refresh_pending = false;
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
      multiplex_presentation_request_refresh(presentation, false);
      SYS_Report("REFERENCE GX: Plex catalog ready after background load\n");
      SYS_Report("REFERENCE GX: interactive home ready us=%u\n",
                 elapsed_us(app_started));
    } else if (catalog_loader_status == CATALOG_LOADER_FAILED) {
      multiplex_presentation_set_network_activity(presentation, false);
      bind_boot_diagnostics("Plex catalog request failed");
      catalog_refresh_pending = true;
      if (!has_catalog) {
        if (multiplex_native_app_pairing_status(
                MULTIPLEX_DEVICE_AUTH_UNAVAILABLE, (const uint8_t *)"", 0,
                (const uint8_t *)"", 0) == 0) {
          SYS_Report(
              "REFERENCE GX: failed to bind network unavailable status\n");
          exit_code = APP_EXIT_UI_BIND;
          break;
        }
      } else {
        static const char unavailable[] =
            "Plex unavailable. Showing saved library.";
        multiplex_native_app_toast((const uint8_t *)unavailable,
                                   sizeof(unavailable) - 1u);
        toast_dismiss_at_ms = 0;
      }
      catalog_retry_at_ms = catalog_now_ms + catalog_retry_delay_ms;
      if (catalog_retry_delay_ms < CATALOG_RETRY_MAX_DELAY_MS) {
        catalog_retry_delay_ms *= 2u;
        if (catalog_retry_delay_ms > CATALOG_RETRY_MAX_DELAY_MS) {
          catalog_retry_delay_ms = CATALOG_RETRY_MAX_DELAY_MS;
        }
      }
      multiplex_presentation_request_refresh(presentation, false);
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
    if (pairing_linked && network_ready &&
        (!has_catalog || catalog_refresh_pending) && !catalog_loader.started &&
        catalog_retry_at_ms != 0 && catalog_now_ms >= catalog_retry_at_ms) {
      bind_boot_diagnostics("Retrying Plex catalog");
      if (multiplex_native_app_pairing_status(MULTIPLEX_PAIRING_CONNECTING,
                                              (const uint8_t *)"", 0,
                                              (const uint8_t *)"", 0) == 0) {
        SYS_Report("REFERENCE GX: failed to bind Plex retry status\n");
        exit_code = APP_EXIT_UI_BIND;
        break;
      }
      if (launch_catalog_loader(&catalog_loader, &auth_credentials, &catalog)) {
        multiplex_presentation_set_network_activity(presentation, true);
        catalog_retry_at_ms = 0;
      } else {
        catalog_retry_at_ms = catalog_now_ms + catalog_retry_delay_ms;
      }
      multiplex_presentation_request_refresh(presentation, false);
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
    const MultiplexPresentationStatus active_presentation =
        multiplex_presentation_status(presentation);
    const bool network_work_allowed =
        MULTIPLEX_GATEWAY_URL[0] != '\0' || network_ready;
    if (network_work_allowed && active_screen == MULTIPLEX_SCREEN_HOME &&
        active_presentation.screen == active_screen &&
        direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_home_poster_loader)) {
      launch_direct_poster_loader(&direct_home_poster_loader);
    } else if (network_work_allowed &&
               (active_screen == MULTIPLEX_SCREEN_BROWSE ||
                active_screen == MULTIPLEX_SCREEN_SEARCH_RESULTS) &&
               !direct_poster_loader_running(&direct_home_poster_loader) &&
               !direct_home_poster_loader.pending &&
               direct_page_poster_loader.pending &&
               !direct_poster_loader_running(&direct_page_poster_loader)) {
      launch_direct_poster_loader(&direct_page_poster_loader);
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
              multiplex_presentation_set_network_activity(presentation, true);
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
        multiplex_presentation_request_refresh(presentation, false);
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
      multiplex_presentation_request_refresh(presentation, true);
    }
    const MultiplexGuiNavigationDirection stick_direction =
        multiplex_gui_navigation_poll(&gui_navigation, PAD_StickX(0),
                                      PAD_StickY(0), input_now_ms * 1000u);
    const uint32_t stick_navigation = queued_transition_navigation != UINT32_MAX
                                          ? queued_transition_navigation
                                          : navigation_action(stick_direction);
    queued_transition_navigation = UINT32_MAX;
#if MULTIPLEX_PAIRING_ENABLED
    if (!startup_data_loader.started &&
        (pressed != 0 || stick_navigation != UINT32_MAX)) {
      startup_data_not_before_ms = input_now_ms + STARTUP_DATA_IDLE_DELAY_MS;
    }
    if (network_work_allowed && pairing_linked && has_catalog &&
        !startup_data_loader.started &&
        input_now_ms >= startup_data_not_before_ms &&
        multiplex_native_app_screen() == MULTIPLEX_SCREEN_HOME &&
        !direct_poster_loader_running(&direct_home_poster_loader) &&
        !direct_home_poster_loader.pending &&
        !direct_poster_loader_running(&direct_page_poster_loader) &&
        !direct_page_poster_loader.pending &&
        !playback_snapshot.prefetch_active && !direct_details_loader.started &&
        !direct_browse_loader.started && !direct_search_loader.started &&
        !catalog_loader.started) {
      if (!launch_startup_data_loader(&startup_data_loader,
                                      &auth_credentials)) {
        startup_data_not_before_ms = input_now_ms + STARTUP_DATA_IDLE_DELAY_MS;
        SYS_Report("REFERENCE GX: background account data unavailable\n");
      }
    }
#endif
    const bool controller_input =
        pressed != 0 || stick_navigation != UINT32_MAX;
    if (pressed != 0) {
      SYS_Report("REFERENCE GX: controller buttons %08x\n", pressed);
    }
    const MultiplexPresentationControlsInput controls_input = {
        .now_ms = input_now_ms,
        .active_input = controller_input,
        .a_pressed = (pressed & PAD_BUTTON_A) != 0,
        .settings_open = multiplex_native_app_player_settings_open() != 0,
    };
    const MultiplexPresentationControlsResult controls =
        multiplex_presentation_controls_update(presentation, &controls_input);
    if (controls.visibility_changed) {
      SYS_Report("REFERENCE GX: player controls visible=%u\n",
                 controls.visible ? 1u : 0u);
    }
    if (controls.consumed_a) {
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
      multiplex_playback_session_cancel_prefetch(playback_session);
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
        multiplex_playback_session_stop(playback_session);
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
        multiplex_presentation_set_network_activity(presentation, false);
        memset(&auth_credentials, 0, sizeof(auth_credentials));
        memset(&watch_together_rooms, 0, sizeof(watch_together_rooms));
        if (!bind_watch_together_rooms(&watch_together_rooms, false)) {
          exit_code = APP_EXIT_UI_BIND;
          break;
        }
        memset(&device_auth, 0, sizeof(device_auth));
        if (!multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &device_auth)) {
          device_auth.status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
          const char *tls_failure = multiplex_tls_client_failure_message();
          bind_boot_diagnostics(tls_failure != NULL
                                    ? tls_failure
                                    : "Multiplex pairing request failed");
          pairing_retry_delay_ms = PAIRING_RETRY_INITIAL_DELAY_MS;
          pairing_retry_at_ms =
              ticks_to_millisecs(gettime()) + pairing_retry_delay_ms;
        } else {
          pairing_retry_at_ms = 0;
          pairing_retry_delay_ms = PAIRING_RETRY_INITIAL_DELAY_MS;
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
        multiplex_presentation_request_refresh(presentation, false);
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
    pause_audio_for_player_input(pressed);
    bool app_changed = false;
    if (stick_navigation != UINT32_MAX) {
      const uint32_t home_view_before = multiplex_native_app_home_view_state();
      if (multiplex_native_app_input(stick_navigation) != 0) {
        const uint32_t home_view_after = multiplex_native_app_home_view_state();
        multiplex_presentation_begin_home_motion(presentation, home_view_before,
                                                 home_view_after);
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
      if (!present_pending_page_transition()) {
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
          multiplex_presentation_request_refresh(presentation, true);
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
        multiplex_playback_session_stop(playback_session);
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
              MULTIPLEX_BASE_URL, auth_credentials.session_token, left_room_id);
          if (deleted) {
            hosted_watch_together_room_id[0] = '\0';
          }
        }
        if (disband_watch_together) {
          multiplex_native_app_watch_together_disband_commit(deleted ? 1u : 0u);
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
          !load_direct_search_page(&auth_credentials, &direct_search_loader)) {
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
        multiplex_presentation_set_blocking_activity(presentation, true);
        present_frame(MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_selected_playback(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: playback-session load failed\n");
      }
#if MULTIPLEX_PAIRING_ENABLED
      if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked) {
        stop_direct_playback_if_hidden();
        if (syncplay_session == NULL &&
            !navigate_direct_playback_if_requested(&auth_credentials)) {
          SYS_Report("REFERENCE GX: direct playback navigation failed\n");
        }
      }
      const uint32_t local_playback_request =
          multiplex_native_app_playback_request();
      const uint32_t local_playback_offset =
          multiplex_native_app_playback_offset_request();
      playback_snapshot = multiplex_playback_session_snapshot(playback_session);
      const bool local_syncplay_seek =
          syncplay_session != NULL &&
          local_playback_request == playback_snapshot.rating_key &&
          local_playback_offset != playback_snapshot.segment_start_ms;
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
          !load_selected_direct_playback(&auth_credentials)) {
        SYS_Report("REFERENCE GX: direct playback-session load failed\n");
      }
      playback_snapshot = multiplex_playback_session_snapshot(playback_session);
      if (local_syncplay_seek &&
          playback_snapshot.segment_start_ms == local_playback_offset) {
        if (local_seek_room < watch_together_rooms.room_count) {
          syncplay_session = multiplex_syncplay_session_connect(
              &watch_together_rooms.rooms[local_seek_room],
              auth_credentials.plex_client_id, plex_user_id, false);
        }
        if (syncplay_session != NULL) {
          multiplex_syncplay_session_set_playback(
              syncplay_session,
              !multiplex_presentation_status(presentation).video_playing,
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
      multiplex_presentation_set_blocking_activity(presentation, false);
      multiplex_presentation_request_refresh(presentation, false);
    }
#if MULTIPLEX_PAIRING_ENABLED
    const uint32_t selected_item_rating_key =
        multiplex_presentation_status(presentation).focused_rating_key;
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
        !direct_page_poster_loader.pending &&
        !playback_snapshot.prefetch_active && !direct_browse_loader.started &&
        !direct_search_loader.started &&
        (!startup_data_loader.started || startup_data_loader.complete)) {
      if (launch_direct_details_loader(&direct_details_loader,
                                       &auth_credentials,
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
        multiplex_presentation_request_refresh(presentation, false);
      } else if (joined_watch_together_room < watch_together_rooms.room_count) {
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
                  plex_user_id, room_position_ms, &syncplay_session)) {
            joined_watch_together_room = UINT32_MAX;
            multiplex_native_app_watch_together_join_commit(0);
            SYS_Report("REFERENCE GX: Watch Together auto-start failed "
                       "room=%u\n",
                       room_index);
          } else {
            SYS_Report("REFERENCE GX: Watch Together auto-start room=%u "
                       "position=%u paused=%u\n",
                       room_index, room_position_ms, room_paused ? 1u : 0u);
          }
          multiplex_presentation_request_refresh(presentation, false);
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
            syncplay_session,
            !multiplex_presentation_status(presentation).video_playing,
            playback_position_ms());
        multiplex_native_app_watch_together_presence(1, 1);
        SYS_Report("REFERENCE GX: Syncplay reconnected room=%u\n",
                   joined_watch_together_room);
      }
    }
    if (!watch_together_lobby && syncplay_session != NULL) {
      multiplex_syncplay_session_set_playback(
          syncplay_session,
          !multiplex_presentation_status(presentation).video_playing,
          playback_position_ms());
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
            playback_snapshot =
                multiplex_playback_session_snapshot(playback_session);
            applied = load_direct_playback(&auth_credentials,
                                           playback_snapshot.rating_key,
                                           remote_position_ms, true) &&
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
          if (applied && multiplex_native_app_playback_set_paused(
                             remote_paused ? 1u : 0u) != 0) {
            if (syncplay_session != NULL) {
              multiplex_syncplay_session_adopt_playback(
                  syncplay_session, remote_paused, remote_position_ms);
            }
            multiplex_presentation_request_refresh(presentation, false);
            SYS_Report("REFERENCE GX: Syncplay remote playback paused=%u "
                       "position=%u seek=%u\n",
                       remote_paused ? 1u : 0u, remote_position_ms,
                       remote_seek ? 1u : 0u);
          }
        }
      }
    }
#endif
    present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    const MultiplexPresentationStatus post_present =
        multiplex_presentation_status(presentation);
    multiplex_playback_session_update_timeline(playback_session,
                                               post_present.video_visible);
    MultiplexPlaybackEvent playback_event;
    const bool has_playback_event = multiplex_playback_session_poll_event(
        playback_session, &playback_event);
    bool hls_completion_pending MULTIPLEX_PAIRING_ONLY = false;
    if (has_playback_event) {
      switch (playback_event.kind) {
      case MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED:
        exit_code = APP_EXIT_MEDIA_PRODUCER;
        break;
      case MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED:
        exit_code = APP_EXIT_MEDIA_RECOVERY;
        break;
      case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_CONTINUE:
        if (multiplex_native_app_playback_continue(
                playback_event.next_offset_ms) == 0 ||
            multiplex_playback_session_continue_program(playback_session) !=
                MULTIPLEX_PLAYBACK_OPEN_READY ||
            multiplex_native_app_playback_commit() == 0) {
          exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        } else {
          multiplex_presentation_request_refresh(presentation, false);
        }
        break;
      case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_COMPLETE:
        multiplex_native_app_playback_position(playback_event.duration_ms);
        if (multiplex_native_app_playback_complete() == 0) {
          exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        } else {
          multiplex_presentation_request_refresh(presentation, false);
        }
        break;
      case MULTIPLEX_PLAYBACK_EVENT_HLS_COMPLETE:
        hls_completion_pending = true;
        break;
      case MULTIPLEX_PLAYBACK_EVENT_NONE:
        break;
      }
    }
    if (exit_code != APP_EXIT_OK) {
      break;
    }
#if MULTIPLEX_PAIRING_ENABLED
    bool autoplay_advanced = false;
    if (MULTIPLEX_GATEWAY_URL[0] == '\0' && pairing_linked) {
      if (syncplay_session == NULL &&
          !advance_direct_playback_if_complete(
              &auth_credentials, hls_completion_pending, &autoplay_advanced)) {
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
              hosted_watch_together_invitee_user_id, hls_completion_pending,
              &autoplay_advanced)) {
        SYS_Report("REFERENCE GX: Watch Together playback completion "
                   "failed\n");
        exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        break;
      }
    }
    if (autoplay_advanced) {
      const MultiplexPresentationControlsInput autoplay_controls = {
          .now_ms = ticks_to_millisecs(gettime()),
          .active_input = true,
      };
      multiplex_presentation_controls_update(presentation, &autoplay_controls);
    }
#endif
  }

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
  multiplex_playback_session_cancel_prefetch(playback_session);
  multiplex_playback_session_stop(playback_session);
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

static void show_app_failure(AppExitCode code,
                             MultiplexPresentationBorrowedFatalVideo video) {
  SYS_Report("REFERENCE GX: stopped with diagnostic code MGC-%u\n",
             (unsigned)code);
  if (video.mode == NULL || video.framebuffer == NULL) {
    return;
  }

  void *framebuffer = video.framebuffer;
  const uint32_t framebuffer_bytes = VIDEO_GetFrameBufferSize(video.mode);
  memset(framebuffer, 0, framebuffer_bytes);
  CON_Init(framebuffer, 32, 32, video.mode->fbWidth - 64,
           video.mode->xfbHeight - 64, video.mode->fbWidth * VI_DISPLAY_PIX_SZ);
  VIDEO_Configure(video.mode);
  VIDEO_SetNextFramebuffer(framebuffer);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();

  const struct mallinfo heap = mallinfo();
  char boot_diagnostics[256];
  const int boot_diagnostics_length =
      format_boot_diagnostics(boot_diagnostics, sizeof(boot_diagnostics));
  printf("\nMultiplex stopped safely\n");
  printf("========================\n\n");
  printf("Diagnostic code: MGC-%u\n\n", (unsigned)code);
  printf("%s\n\n", app_exit_message(code));
  printf("Heap: %lu KiB free, %lu KiB used\n\n",
         (unsigned long)heap.fordblks / 1024ul,
         (unsigned long)heap.uordblks / 1024ul);
  if (boot_diagnostics_length > 0 &&
      (size_t)boot_diagnostics_length < sizeof(boot_diagnostics)) {
    printf("%s\n\n", boot_diagnostics);
  }
  printf("Photograph this screen so the exact failure can be fixed.\n");
  printf("Press A, START, or Z to restart without a power cycle.\n");

  while (true) {
    PAD_ScanPads();
    if ((PAD_ButtonsDown(0) &
         (PAD_BUTTON_A | PAD_BUTTON_START | PAD_TRIGGER_Z)) != 0 ||
        SYS_ResetButtonDown()) {
      SYS_ResetSystem(SYS_RESTART, 0, FALSE);
    }
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

  presentation = multiplex_presentation_create();
  if (presentation == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate presentation context\n");
    free(app_stack);
    return APP_EXIT_BUFFER_INIT;
  }
  playback_session = multiplex_playback_session_create();
  if (playback_session == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate playback context\n");
    multiplex_presentation_destroy(&presentation);
    free(app_stack);
    return APP_EXIT_MEDIA_PRODUCER;
  }

  lwp_t app_thread = LWP_THREAD_NULL;
  if (LWP_CreateThread(&app_thread, run_app, NULL, app_stack, APP_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    SYS_Report("REFERENCE GX: failed to create app thread\n");
    multiplex_presentation_destroy(&presentation);
    multiplex_playback_session_destroy(&playback_session);
    free(app_stack);
    return 1;
  }

  void *result = NULL;
  const int join_status = LWP_JoinThread(app_thread, &result);
  free(app_stack);
  if (join_status != 0) {
    SYS_Report("REFERENCE GX: failed to join app thread\n");
    multiplex_presentation_destroy(&presentation);
    multiplex_playback_session_destroy(&playback_session);
    return 1;
  }
  const AppExitCode exit_code = (AppExitCode)(uintptr_t)result;
  if (exit_code != APP_EXIT_OK) {
    const MultiplexPresentationBorrowedFatalVideo fatal_video =
        multiplex_presentation_finalize_for_fatal(presentation);
    multiplex_playback_session_destroy(&playback_session);
    show_app_failure(exit_code, fatal_video);
  }
  multiplex_presentation_destroy(&presentation);
  multiplex_playback_session_destroy(&playback_session);
  return (int)exit_code;
}
