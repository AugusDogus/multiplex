#include "app_services.h"
#include "catalog_cache.h"
#include "gateway_client.h"
#include "gui_navigation.h"
#include "http_client.h"
#include "media-source.h"
#include "memory_card_auth.h"
#include "native_ui.h"
#include "playback_session.h"
#include "plex_catalog.h"
#include "poster_jpeg.h"
#include "presentation.h"
#include "reference_frame.h"
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
#define NETWORK_RETRY_INITIAL_DELAY_MS 1000u
#define NETWORK_RETRY_MAX_DELAY_MS 8000u
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

static MultiplexPresentation *presentation;
static MultiplexPlaybackSession *playback_session;
static MultiplexAppServices *app_services;
static MultiplexPlaybackSnapshot playback_snapshot;
static MultiplexGuiNavigation gui_navigation;
static bool controller_status_reported;
static char boot_diagnostic_operation[64] = "Process startup";

#if MULTIPLEX_PAIRING_ENABLED
typedef struct DirectPosterLoader DirectPosterLoader;

typedef struct {
  DirectPosterLoader *loader;
  uint16_t lane;
} DirectPosterWorker;

struct DirectPosterLoader {
  uint32_t token;
  MultiplexAuthCredentials credentials;
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
  volatile bool failed;
};
#endif

static void join_worker_thread(lwp_t *thread) {
  if (thread == NULL || *thread == LWP_THREAD_NULL) {
    return;
  }
  /* Let libogc2 finish destroying the context before its stack is freed. */
  LWP_SetThreadPriority(*thread, LWP_PRIO_NORMAL + 1u);
  LWP_JoinThread(*thread, NULL);
  *thread = LWP_THREAD_NULL;
}

#if MULTIPLEX_PAIRING_ENABLED
static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}
#endif

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

#if !MULTIPLEX_PAIRING_ENABLED
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

static bool
initialize_gateway_page_posters(const MultiplexAppServicesPosterPlan *plan) {
  if (plan == NULL || plan->item_count == 0 ||
      plan->item_count > MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS) {
    return false;
  }
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  MultiplexPresentationPosterWrite write = {0};
  const bool write_started = multiplex_presentation_posters_begin(
      presentation, plan->texture_offset, plan->item_count,
      MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write);
  size_t encoded_size = 0;
  bool loaded = false;
  if (encoded != NULL && write_started &&
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_BROWSE) {
    loaded =
        multiplex_gateway_load_browse_artwork(
            MULTIPLEX_GATEWAY_URL, plan->payload.browse.section_id,
            plan->payload.browse.start, encoded, POSTER_JPEG_CAPACITY,
            &encoded_size) &&
        poster_jpeg_decode_columns(
            encoded, encoded_size, plan->item_count,
            MULTIPLEX_GATEWAY_BROWSE_COLUMNS, write.pixels,
            (size_t)plan->item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  } else if (encoded != NULL && write_started &&
             plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_SEARCH) {
    loaded = multiplex_gateway_load_search_artwork(
                 MULTIPLEX_GATEWAY_URL, plan->payload.search.query,
                 plan->payload.search.query_length, encoded,
                 POSTER_JPEG_CAPACITY, &encoded_size) &&
             poster_jpeg_decode(encoded, encoded_size, plan->item_count,
                                write.pixels,
                                (size_t)plan->item_count *
                                    MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  }
  free(encoded);
  if (!loaded) {
    if (write_started) {
      multiplex_presentation_posters_cancel(presentation, &write);
    }
    return false;
  }
  const uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS] = {0};
  return multiplex_presentation_posters_commit(presentation, &write,
                                               rating_keys);
}
#endif

#if MULTIPLEX_PAIRING_ENABLED
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
    loader->failed = true;
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
        multiplex_plex_load_artwork(&loader->credentials, item->artwork_path,
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

static void clear_poster_credentials(MultiplexAuthCredentials *credentials) {
  volatile unsigned char *bytes = (volatile unsigned char *)credentials;
  for (size_t index = 0; index < sizeof(*credentials); ++index) {
    bytes[index] = 0;
  }
}

static void release_direct_poster_workers(DirectPosterLoader *loader) {
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    join_worker_thread(&loader->threads[lane]);
    free(loader->decoded_pixels[lane]);
    loader->decoded_pixels[lane] = NULL;
    free(loader->stacks[lane]);
    loader->stacks[lane] = NULL;
  }
  loader->lane_count = 0;
  clear_poster_credentials(&loader->credentials);
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
  loader->credentials = *credentials;
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

static bool
poll_direct_poster_loader(DirectPosterLoader *loader,
                          MultiplexAppServicesPosterResultKind *result_kind) {
  if (loader == NULL || !direct_poster_loader_running(loader)) {
    return false;
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
          loader->failed = true;
        } else {
          memcpy(write.pixels, loader->decoded_pixels[lane],
                 MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
          loader->item_decoded[lane] = multiplex_presentation_posters_commit(
              presentation, &write, &rating_key);
          loader->failed = loader->failed || !loader->item_decoded[lane];
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
    return false;
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
  *result_kind = loader->failed ? MULTIPLEX_APP_SERVICES_POSTER_FAILED
                                : MULTIPLEX_APP_SERVICES_POSTER_COMPLETED;
  return true;
}

static void stop_direct_poster_loader(DirectPosterLoader *loader) {
  if (loader == NULL) {
    return;
  }
  loader->stopping = true;
  loader->pending = false;
  release_direct_poster_workers(loader);
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
          multiplex_app_services_startup_rating_key(app_services),
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

#if MULTIPLEX_PAIRING_ENABLED
typedef struct {
  MultiplexTrpcRoomList rooms;
  MultiplexTrpcInviteeList invitees;
  uint32_t user_id;
  bool user_available;
  bool rooms_available;
  bool invitees_available;
} StartupDataResult;
#endif

typedef struct {
  MultiplexAppServicesWorkRequest request;
  MultiplexMemoryCardLocation cache_location;
  lwp_t thread;
  void *stack;
  void *output;
  volatile bool complete;
  bool started;
  bool succeeded;
} AppWorkWorker;

typedef enum {
  APP_PREFETCH_ADAPTER_IDLE = 0,
  APP_PREFETCH_ADAPTER_RETAINING = 1,
  APP_PREFETCH_ADAPTER_RELEASING = 2,
} AppPrefetchAdapterKind;

typedef struct {
  AppPrefetchAdapterKind kind;
  union {
    struct {
      uint32_t token;
    } retaining;
    struct {
      uint32_t token;
    } releasing;
  } payload;
} AppPrefetchAdapter;

typedef struct {
  AppWorkWorker workers[MULTIPLEX_APP_SERVICES_WORK_COUNT];
#if MULTIPLEX_PAIRING_ENABLED
  DirectPosterLoader posters;
#endif
  AppPrefetchAdapter prefetch;
  uint64_t toast_dismiss_at_ms;
  bool playback_start_offset_pending;
} AppRuntime;

static MultiplexAppServicesPlaybackView playback_view(void) {
  playback_snapshot = multiplex_playback_session_snapshot(playback_session);
  return (MultiplexAppServicesPlaybackView){
      .playing = multiplex_presentation_status(presentation).video_playing,
      .rating_key = playback_snapshot.rating_key,
      .position_ms = playback_snapshot.position_ms,
      .duration_ms = playback_snapshot.duration_ms,
      .segment_start_ms = playback_snapshot.segment_start_ms,
      .burn_subtitles = playback_snapshot.burn_subtitles,
      .subtitle_stream_index = playback_snapshot.subtitle_stream_index,
      .subtitle_selection = multiplex_native_app_subtitle_selection(),
      .prefetch_active = playback_snapshot.prefetch_active,
  };
}

static size_t work_output_size(MultiplexAppServicesWorkKind kind) {
  switch (kind) {
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
    return sizeof(MultiplexGatewayCatalog);
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
#if MULTIPLEX_PAIRING_ENABLED
    return MULTIPLEX_CATALOG_CACHE_SIZE;
#else
    return 0;
#endif
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA:
#if MULTIPLEX_PAIRING_ENABLED
    return sizeof(StartupDataResult);
#else
    return 0;
#endif
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
    return sizeof(MultiplexGatewayBrowsePage);
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
    return sizeof(MultiplexGatewaySearchPage);
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
    return sizeof(MultiplexGatewayDetails);
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    return 0;
  }
  return 0;
}

static size_t work_stack_size(MultiplexAppServicesWorkKind kind) {
  switch (kind) {
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
    return CATALOG_LOADER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
    return CATALOG_CACHE_SAVER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA:
    return STARTUP_DATA_LOADER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
    return DIRECT_BROWSE_LOADER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
    return DIRECT_SEARCH_LOADER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
    return DIRECT_DETAILS_LOADER_STACK_SIZE;
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    return 0;
  }
  return 0;
}

static void *run_app_work(void *context) {
  AppWorkWorker *worker = context;
  const MultiplexAppServicesWorkRequest *request = &worker->request;
  switch (request->kind) {
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG: {
    MultiplexGatewayCatalog *catalog = worker->output;
#if MULTIPLEX_PAIRING_ENABLED
    worker->succeeded = multiplex_plex_load_catalog(
        &request->payload.catalog.credentials, catalog);
#else
    worker->succeeded =
        multiplex_gateway_load_catalog(MULTIPLEX_GATEWAY_URL, catalog);
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
#if MULTIPLEX_PAIRING_ENABLED
    worker->succeeded =
        multiplex_memory_card_save_cache(
            &worker->cache_location, worker->output,
            MULTIPLEX_CATALOG_CACHE_SIZE) == MULTIPLEX_MEMORY_CARD_OK;
#else
    worker->succeeded = false;
#endif
    break;
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA: {
#if MULTIPLEX_PAIRING_ENABLED
    StartupDataResult *result = worker->output;
    const MultiplexAuthCredentials *credentials =
        &request->payload.startup_data.credentials;
    result->user_available = multiplex_trpc_load_user_id(
        credentials->origin, credentials->session_token, &result->user_id);
    result->rooms_available = multiplex_trpc_load_watch_together_rooms(
        MULTIPLEX_BASE_URL, credentials->session_token, &result->rooms);
    result->invitees_available = multiplex_trpc_load_watch_together_invitees(
        MULTIPLEX_BASE_URL, credentials->session_token, &result->invitees);
    worker->succeeded = true;
#else
    worker->succeeded = false;
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE: {
    MultiplexGatewayBrowsePage *page = worker->output;
#if MULTIPLEX_PAIRING_ENABLED
    worker->succeeded = multiplex_plex_load_browse(
        &request->payload.browse.credentials, &request->payload.browse.library,
        request->payload.browse.start, page);
#else
    worker->succeeded = multiplex_gateway_load_browse(
        MULTIPLEX_GATEWAY_URL, request->payload.browse.library.section_id,
        request->payload.browse.start, page);
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH: {
    MultiplexGatewaySearchPage *page = worker->output;
#if MULTIPLEX_PAIRING_ENABLED
    worker->succeeded = multiplex_plex_load_search(
        &request->payload.search.credentials, request->payload.search.query,
        request->payload.search.query_length, page);
#else
    worker->succeeded = multiplex_gateway_load_search(
        MULTIPLEX_GATEWAY_URL, request->payload.search.query,
        request->payload.search.query_length, page);
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS: {
    MultiplexGatewayDetails *details = worker->output;
#if MULTIPLEX_PAIRING_ENABLED
    worker->succeeded = multiplex_plex_load_details(
        &request->payload.details.credentials,
        request->payload.details.rating_key, details);
#else
    worker->succeeded = multiplex_gateway_load_details(
        MULTIPLEX_GATEWAY_URL, request->payload.details.rating_key, details);
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    worker->succeeded = false;
    break;
  }
  __sync_synchronize();
  worker->complete = true;
  return NULL;
}

static void release_app_work(AppWorkWorker *worker) {
  join_worker_thread(&worker->thread);
  free(worker->stack);
  free(worker->output);
  memset(worker, 0, sizeof(*worker));
  worker->thread = LWP_THREAD_NULL;
}

static bool launch_app_work(AppRuntime *runtime,
                            const MultiplexAppServicesWorkRequest *request) {
  if ((unsigned)request->kind >= MULTIPLEX_APP_SERVICES_WORK_COUNT) {
    return false;
  }
  AppWorkWorker *worker = &runtime->workers[request->kind];
  if (worker->started) {
    return false;
  }
  const size_t output_size = work_output_size(request->kind);
  const size_t stack_size = work_stack_size(request->kind);
  worker->request = *request;
  worker->thread = LWP_THREAD_NULL;
  worker->output = calloc(1, output_size);
  worker->stack = malloc(stack_size);
  if (worker->output == NULL || worker->stack == NULL) {
    release_app_work(worker);
    return false;
  }
  if (request->kind == MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE &&
      !multiplex_app_services_copy_cache_save_plan(
          app_services, request, &worker->cache_location, worker->output,
          output_size)) {
    release_app_work(worker);
    return false;
  }
  if (LWP_CreateThread(&worker->thread, run_app_work, worker, worker->stack,
                       stack_size, LWP_PRIO_NORMAL / 2) != 0) {
    release_app_work(worker);
    return false;
  }
  worker->started = true;
  return true;
}

static bool dispatch_services(const MultiplexAppServicesInput *input) {
  const MultiplexAppServicesDispatchResult result =
      multiplex_app_services_dispatch(app_services, input);
  if (result == MULTIPLEX_APP_SERVICES_DISPATCH_READY) {
    return true;
  }
  SYS_Report("REFERENCE GX: app services dispatch failed result=%u input=%u\n",
             (unsigned)result, (unsigned)input->kind);
  return false;
}

static bool poll_app_work(AppRuntime *runtime, uint64_t now_ms) {
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    AppWorkWorker *worker = &runtime->workers[index];
    if (!worker->started || !worker->complete) {
      continue;
    }
    __sync_synchronize();
    join_worker_thread(&worker->thread);
    MultiplexAppServicesInput input = {
        .kind = MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW,
        .payload.work_result =
            {
                .token = worker->request.token,
                .kind = worker->request.kind,
                .succeeded = worker->succeeded,
                .now_ms = now_ms,
            },
    };
    switch (worker->request.kind) {
    case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
      input.payload.work_result.payload.catalog.catalog = worker->output;
      break;
    case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
      input.payload.work_result.payload.browse.page = worker->output;
      break;
    case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
      input.payload.work_result.payload.search.page = worker->output;
      break;
    case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
      input.payload.work_result.payload.details.details = worker->output;
      break;
    case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA: {
#if MULTIPLEX_PAIRING_ENABLED
      const StartupDataResult *result = worker->output;
      input.payload.work_result.payload.startup_data =
          (MultiplexAppServicesStartupDataResultView){
              .user =
                  {
                      .kind = result->user_available
                                  ? MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT
                                  : MULTIPLEX_APP_SERVICES_STARTUP_USER_NONE,
                      .value.id = result->user_id,
                  },
              .rooms = result->rooms_available ? &result->rooms : NULL,
              .invitees = result->invitees_available ? &result->invitees : NULL,
          };
#endif
      break;
    }
    case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
      break;
    case MULTIPLEX_APP_SERVICES_WORK_COUNT:
      release_app_work(worker);
      return false;
    }
    const bool dispatched = dispatch_services(&input);
    release_app_work(worker);
    if (!dispatched) {
      return false;
    }
  }
  return true;
}

static void stop_poster_lanes(AppRuntime *runtime) {
#if MULTIPLEX_PAIRING_ENABLED
  stop_direct_poster_loader(&runtime->posters);
  runtime->posters.token = 0;
#else
  (void)runtime;
#endif
}

static void join_app_workers(AppRuntime *runtime) {
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    release_app_work(&runtime->workers[index]);
  }
}

static void quiesce_catalog_cache_save(AppRuntime *runtime) {
  release_app_work(
      &runtime->workers[MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE]);
}

static bool apply_presentation_effect(
    const MultiplexAppServicesPresentationEffect *effect) {
  switch (effect->kind) {
  case MULTIPLEX_APP_SERVICES_PRESENTATION_REFRESH:
    multiplex_presentation_request_refresh(
        presentation, effect->payload.refresh.asynchronous);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY:
    multiplex_presentation_set_network_activity(
        presentation, effect->payload.activity.visible);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY:
    multiplex_presentation_set_blocking_activity(
        presentation, effect->payload.activity.visible);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_BROWSE_MOTION:
    multiplex_presentation_queue_browse_motion(
        presentation, effect->payload.browse_motion.before,
        effect->payload.browse_motion.after);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_CONTROLS_ACTIVE: {
    const MultiplexPresentationControlsInput input = {
        .now_ms = effect->payload.controls_active.now_ms,
        .active_input = true,
    };
    multiplex_presentation_controls_update(presentation, &input);
    return true;
  }
  }
  return false;
}

static uint32_t
playback_start_offset(AppRuntime *runtime,
                      const MultiplexAppServicesPlaybackEffect *effect,
                      uint32_t requested_offset) {
  if (!runtime->playback_start_offset_pending ||
      (effect->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY &&
       effect->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS)) {
    return requested_offset;
  }
  runtime->playback_start_offset_pending = false;
  SYS_Report("REFERENCE GX: playback start override offset=%u\n",
             MULTIPLEX_PLAYBACK_START_OFFSET_MS);
  return effect->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS &&
                 MULTIPLEX_PLAYBACK_START_OFFSET_MS >=
                     effect->payload.hls_open.duration_ms
             ? 0
             : MULTIPLEX_PLAYBACK_START_OFFSET_MS;
}

static bool present_blocking_playback_frame(bool *render_failed) {
  if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_DEFERRED) !=
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    return true;
  }
  *render_failed = true;
  return false;
}

static bool
dispatch_prefetch_result(uint32_t token,
                         MultiplexAppServicesPrefetchResultKind kind) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT,
      .payload.prefetch_result = {.token = token, .kind = kind},
  };
  return dispatch_services(&input);
}

static bool
apply_prefetch_retain(AppRuntime *runtime,
                      const MultiplexAppServicesPlaybackEffect *effect) {
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexPlaybackPrefetchRequest request = {
      .credentials = effect->payload.hls_prefetch.credentials,
      .rating_key = effect->payload.hls_prefetch.rating_key,
      .offset_ms = effect->payload.hls_prefetch.offset_ms,
      .burn_subtitles = effect->payload.hls_prefetch.burn_subtitles,
      .subtitle_stream_index =
          effect->payload.hls_prefetch.subtitle_stream_index,
  };
  if (multiplex_playback_session_retain_hls_prefetch(playback_session,
                                                     &request)) {
    runtime->prefetch = (AppPrefetchAdapter){
        .kind = APP_PREFETCH_ADAPTER_RETAINING,
        .payload.retaining = {.token = effect->token},
    };
    return true;
  }
#else
  (void)runtime;
#endif
  return dispatch_prefetch_result(effect->token,
                                  MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);
}

static bool
apply_prefetch_release(AppRuntime *runtime,
                       const MultiplexAppServicesPlaybackEffect *effect) {
#if MULTIPLEX_PAIRING_ENABLED
  if (multiplex_playback_session_release_hls_prefetch(playback_session)) {
    runtime->prefetch = (AppPrefetchAdapter){
        .kind = APP_PREFETCH_ADAPTER_RELEASING,
        .payload.releasing = {.token = effect->token},
    };
    return true;
  }
#else
  (void)runtime;
#endif
  return dispatch_prefetch_result(effect->token,
                                  MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);
}

static bool poll_prefetch_adapter(AppRuntime *runtime) {
  if (runtime->prefetch.kind == APP_PREFETCH_ADAPTER_IDLE) {
    return true;
  }
  const MultiplexPlaybackHlsPrefetchStatus native_status =
      multiplex_playback_session_hls_prefetch_status(playback_session);
  if (runtime->prefetch.kind == APP_PREFETCH_ADAPTER_RETAINING &&
      native_status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_RETAINING) {
    return true;
  }
  if (runtime->prefetch.kind == APP_PREFETCH_ADAPTER_RELEASING &&
      native_status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_RELEASING) {
    return true;
  }

  const uint32_t token =
      runtime->prefetch.kind == APP_PREFETCH_ADAPTER_RETAINING
          ? runtime->prefetch.payload.retaining.token
          : runtime->prefetch.payload.releasing.token;
  MultiplexAppServicesPrefetchResultKind result =
      MULTIPLEX_APP_SERVICES_PREFETCH_FAILED;
  if (runtime->prefetch.kind == APP_PREFETCH_ADAPTER_RETAINING &&
      native_status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_READY) {
    result = MULTIPLEX_APP_SERVICES_PREFETCH_READY;
  } else if (runtime->prefetch.kind == APP_PREFETCH_ADAPTER_RELEASING &&
             native_status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_IDLE) {
    result = MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED;
  }
  runtime->prefetch = (AppPrefetchAdapter){
      .kind = APP_PREFETCH_ADAPTER_IDLE,
  };
  return dispatch_prefetch_result(token, result);
}

static void discard_prefetch_adapter(AppRuntime *runtime) {
  multiplex_playback_session_discard_hls_prefetch(playback_session);
  memset(&runtime->prefetch, 0, sizeof(runtime->prefetch));
}

static bool
apply_playback_effect(AppRuntime *runtime,
                      const MultiplexAppServicesPlaybackEffect *effect,
                      bool *render_failed) {
  MultiplexAppServicesPlaybackResult result = {
      .token = effect->token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED,
  };
  switch (effect->kind) {
  case MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY: {
    if (!present_blocking_playback_frame(render_failed)) {
      break;
    }
    const MultiplexPlaybackGatewayOpenRequest request = {
        .rating_key = effect->payload.gateway.rating_key,
        .offset_ms = playback_start_offset(runtime, effect,
                                           effect->payload.gateway.offset_ms),
    };
    MultiplexPlaybackGatewayOpenRequest copied = request;
    snprintf(copied.gateway_url, sizeof(copied.gateway_url), "%s",
             effect->payload.gateway.gateway_url);
    result.kind =
        multiplex_playback_session_open_gateway(playback_session, &copied) ==
                MULTIPLEX_PLAYBACK_OPEN_READY
            ? MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED
            : MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED;
    break;
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS: {
    if (!present_blocking_playback_frame(render_failed)) {
      break;
    }
#if MULTIPLEX_PAIRING_ENABLED
    const MultiplexPlaybackHlsOpenRequest request = {
        .credentials = effect->payload.hls_open.credentials,
        .rating_key = effect->payload.hls_open.rating_key,
        .offset_ms = playback_start_offset(runtime, effect,
                                           effect->payload.hls_open.offset_ms),
        .duration_ms = effect->payload.hls_open.duration_ms,
        .resume_current_session =
            effect->payload.hls_open.resume_current_session,
        .burn_subtitles = effect->payload.hls_open.burn_subtitles,
        .subtitle_stream_index = effect->payload.hls_open.subtitle_stream_index,
    };
    result.kind =
        multiplex_playback_session_open_hls(playback_session, &request) ==
                MULTIPLEX_PLAYBACK_OPEN_READY
            ? MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED
            : MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED;
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS:
    return apply_prefetch_retain(runtime, effect);
  case MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS:
    return apply_prefetch_release(runtime, effect);
  case MULTIPLEX_APP_SERVICES_PLAYBACK_STOP:
    multiplex_playback_session_stop(playback_session);
    result.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED;
    break;
  }
  result.playback = playback_view();
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result = result,
  };
  return dispatch_services(&input);
}

static bool dispatch_poster_result(uint32_t token,
                                   MultiplexAppServicesPosterResultKind kind) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT,
      .payload.poster_result = {.token = token, .kind = kind},
  };
  return dispatch_services(&input);
}

static bool apply_poster_start(AppRuntime *runtime,
                               const MultiplexAppServicesPosterPlan *plan) {
#if MULTIPLEX_PAIRING_ENABLED
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  MultiplexAuthCredentials credentials;
  DirectPosterLoader *loader = &runtime->posters;
  if (plan->token == 0 || loader->token != 0 || loader->pending ||
      direct_poster_loader_running(loader) ||
      !multiplex_app_services_copy_poster_plan(app_services, plan, items,
                                               sizeof(items) / sizeof(items[0]),
                                               &credentials) ||
      !queue_direct_poster_loader(loader, &credentials, items, plan->item_count,
                                  plan->texture_offset, true)) {
    return dispatch_poster_result(plan->token,
                                  MULTIPLEX_APP_SERVICES_POSTER_FAILED);
  }
  loader->token = plan->token;
  if (!dispatch_poster_result(plan->token,
                              MULTIPLEX_APP_SERVICES_POSTER_STARTED)) {
    return false;
  }
  if (loader->pending || direct_poster_loader_running(loader)) {
    return true;
  }
  loader->token = 0;
  return dispatch_poster_result(plan->token,
                                MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);
#else
  (void)runtime;
  if (!dispatch_poster_result(plan->token,
                              MULTIPLEX_APP_SERVICES_POSTER_STARTED)) {
    return false;
  }
  const bool completed =
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG
          ? initialize_poster_textures(MULTIPLEX_GATEWAY_URL, plan->item_count)
          : initialize_gateway_page_posters(plan);
  return dispatch_poster_result(
      plan->token, completed ? MULTIPLEX_APP_SERVICES_POSTER_COMPLETED
                             : MULTIPLEX_APP_SERVICES_POSTER_FAILED);
#endif
}

static bool apply_poster_quiesce(AppRuntime *runtime, uint32_t token) {
#if MULTIPLEX_PAIRING_ENABLED
  stop_direct_poster_loader(&runtime->posters);
  runtime->posters.token = 0;
#else
  (void)runtime;
#endif
  return dispatch_poster_result(token, MULTIPLEX_APP_SERVICES_POSTER_QUIESCED);
}

static bool poll_poster_loader(AppRuntime *runtime) {
#if MULTIPLEX_PAIRING_ENABLED
  MultiplexAppServicesPosterResultKind result_kind;
  if (!poll_direct_poster_loader(&runtime->posters, &result_kind)) {
    return true;
  }
  const uint32_t token = runtime->posters.token;
  runtime->posters.token = 0;
  return dispatch_poster_result(token, result_kind);
#else
  (void)runtime;
  return true;
#endif
}

static bool drain_app_effects(AppRuntime *runtime, AppExitCode *exit_code) {
  MultiplexAppServicesEffect effect;
  bool ready = true;
  while (multiplex_app_services_poll_effect(app_services, &effect)) {
    switch (effect.kind) {
    case MULTIPLEX_APP_SERVICES_EFFECT_WORK_REQUEST:
      if (!launch_app_work(runtime, &effect.payload.work)) {
        *exit_code = APP_EXIT_BACKGROUND_BIND;
        ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START:
      if (!apply_poster_start(runtime, &effect.payload.poster_start)) {
        ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE:
      if (!apply_poster_quiesce(runtime, effect.payload.poster_quiesce.token)) {
        ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE: {
      quiesce_catalog_cache_save(runtime);
      const MultiplexAppServicesInput input = {
          .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
          .payload.reset_storage_quiesced =
              {
                  .token = effect.payload.storage_quiesce.token,
              },
      };
      if (!dispatch_services(&input)) {
        ready = false;
      }
      break;
    }
    case MULTIPLEX_APP_SERVICES_EFFECT_RUNTIME_QUIESCE: {
      stop_poster_lanes(runtime);
      discard_prefetch_adapter(runtime);
      join_app_workers(runtime);
      const MultiplexAppServicesInput input = {
          .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED,
          .payload.reset_runtime_quiesced =
              {
                  .token = effect.payload.runtime_quiesce.token,
              },
      };
      if (!dispatch_services(&input)) {
        ready = false;
      }
      break;
    }
    case MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK: {
      bool render_failed = false;
      if (!apply_playback_effect(runtime, &effect.payload.playback,
                                 &render_failed)) {
        *exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        ready = false;
      }
      if (render_failed) {
        *exit_code = APP_EXIT_UI_RENDER;
        ready = false;
      }
      break;
    }
    case MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION:
      if (!apply_presentation_effect(&effect.payload.presentation)) {
        *exit_code = APP_EXIT_UI_BIND;
        ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_FAILED:
      switch (effect.payload.failure) {
      case MULTIPLEX_APP_SERVICES_FAILURE_UI_BIND:
        *exit_code = APP_EXIT_UI_BIND;
        break;
      case MULTIPLEX_APP_SERVICES_FAILURE_BACKGROUND_BIND:
        *exit_code = APP_EXIT_BACKGROUND_BIND;
        break;
      case MULTIPLEX_APP_SERVICES_FAILURE_PLAYBACK_CONTINUATION:
        *exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        break;
      }
      ready = false;
    }
  }
  return ready;
}

static bool dispatch_model(const MultiplexAppServicesModelRequest *request) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request = *request,
  };
  return dispatch_services(&input);
}

static MultiplexAppServicesScreen app_services_screen(uint32_t screen) {
  switch (screen) {
  case MULTIPLEX_SCREEN_HOME:
    return MULTIPLEX_APP_SERVICES_SCREEN_HOME;
  case MULTIPLEX_SCREEN_BROWSE:
    return MULTIPLEX_APP_SERVICES_SCREEN_BROWSE;
  case MULTIPLEX_SCREEN_SEARCH:
  case MULTIPLEX_SCREEN_SEARCH_RESULTS:
    return MULTIPLEX_APP_SERVICES_SCREEN_SEARCH;
  case MULTIPLEX_SCREEN_DETAILS:
    return MULTIPLEX_APP_SERVICES_SCREEN_DETAILS;
  case MULTIPLEX_SCREEN_PLAYER:
    return MULTIPLEX_APP_SERVICES_SCREEN_PLAYER;
  case MULTIPLEX_SCREEN_WATCH_TOGETHER_INVITE:
  case MULTIPLEX_SCREEN_WATCH_TOGETHER:
  case MULTIPLEX_SCREEN_WATCH_TOGETHER_ROOM:
    return MULTIPLEX_APP_SERVICES_SCREEN_WATCH;
  case MULTIPLEX_SCREEN_PAIRING:
  case MULTIPLEX_SCREEN_LIBRARIES:
  default:
    return MULTIPLEX_APP_SERVICES_SCREEN_OTHER;
  }
}

static bool collect_model_requests(AppRuntime *runtime, uint64_t now_ms,
                                   uint32_t pressed, uint32_t input_screen,
                                   bool active_input) {
  uint32_t section_id = 0;
  uint32_t start = 0;
  if (multiplex_native_app_browse_request(&section_id, &start) != 0) {
    if (section_id > UINT16_MAX || start > UINT16_MAX ||
        !dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_BROWSE,
            .payload.browse =
                {
                    .section_id = (uint16_t)section_id,
                    .start = (uint16_t)start,
                    .previous_start =
                        (uint16_t)multiplex_native_app_browse_view_start(),
                },
        })) {
      return false;
    }
  }

  MultiplexAppServicesModelRequest search = {
      .kind = MULTIPLEX_APP_SERVICES_MODEL_SEARCH,
  };
  const uint32_t query_length = multiplex_native_app_search_request(
      (uint8_t *)search.payload.search.query,
      sizeof(search.payload.search.query) - 1u);
  if (query_length != 0) {
    if (query_length >= sizeof(search.payload.search.query)) {
      return false;
    }
    search.payload.search.query[query_length] = '\0';
    search.payload.search.query_length = (uint16_t)query_length;
    if (!dispatch_model(&search)) {
      return false;
    }
  }

  const uint32_t details_key = multiplex_native_app_details_request();
  if (details_key != 0) {
    if (!dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS,
            .payload.details = {.rating_key = details_key},
        })) {
      return false;
    }
  }

  uint32_t children_key = 0;
  uint32_t children_start = 0;
  if (multiplex_native_app_details_children_request(&children_key,
                                                    &children_start) != 0) {
    if (children_start > UINT16_MAX) {
      return false;
    }
    if (!dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN,
            .payload.details_children =
                {
                    .rating_key = children_key,
                    .start = (uint16_t)children_start,
                },
        })) {
      return false;
    }
  }

  const uint32_t playback_key = multiplex_native_app_playback_request();
  if (playback_key != 0) {
    if (!dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK,
            .payload.playback =
                {
                    .rating_key = playback_key,
                    .offset_ms = multiplex_native_app_playback_offset_request(),
                },
        })) {
      return false;
    }
  }

  const int32_t playback_direction =
      multiplex_native_app_playback_navigation_request();
  if (playback_direction != 0) {
    if (!dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK_NAVIGATION,
            .payload.playback_navigation = {.direction = playback_direction},
        })) {
      return false;
    }
  }

  const uint32_t watched_key = multiplex_native_app_mark_watched_request();
  if (watched_key != 0) {
    if (!dispatch_model(&(MultiplexAppServicesModelRequest){
            .kind = MULTIPLEX_APP_SERVICES_MODEL_MARK_WATCHED,
            .payload.mark_watched = {.rating_key = watched_key},
        })) {
      return false;
    }
    runtime->toast_dismiss_at_ms = now_ms + 2500u;
  }

  MultiplexAppServicesModelRequest create = {
      .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_CREATE,
  };
  const uint32_t title_length =
      multiplex_native_app_watch_together_create_request(
          &create.payload.watch_create.rating_key,
          &create.payload.watch_create.invitee_user_id,
          (uint8_t *)create.payload.watch_create.title,
          sizeof(create.payload.watch_create.title));
  if (title_length != 0 &&
      (title_length >= sizeof(create.payload.watch_create.title) ||
       !dispatch_model(&create))) {
    return false;
  }

  const uint32_t join = multiplex_native_app_watch_together_join_request();
  if (join != 0 && !dispatch_model(&(MultiplexAppServicesModelRequest){
                       .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_JOIN,
                       .payload.watch_join = {.room_index = join - 1u},
                   })) {
    return false;
  }

  const bool disband =
      multiplex_native_app_watch_together_disband_request() != 0;
  const bool leave = multiplex_native_app_watch_together_leave_request() != 0;
  if ((disband || leave) && !dispatch_model(&(MultiplexAppServicesModelRequest){
                                .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_EXIT,
                                .payload.watch_exit = {.disband = disband},
                            })) {
    return false;
  }
  if (input_screen == MULTIPLEX_SCREEN_WATCH_TOGETHER_ROOM &&
      (pressed & PAD_BUTTON_B) != 0 &&
      !dispatch_model(&(MultiplexAppServicesModelRequest){
          .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_LOBBY_LEAVE,
      })) {
    return false;
  }
  if (multiplex_native_app_watch_together_reconnect_request() != 0 &&
      !dispatch_model(&(MultiplexAppServicesModelRequest){
          .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_RECONNECT,
          .payload.watch_reconnect = {.now_ms = now_ms},
      })) {
    return false;
  }

  const MultiplexPresentationStatus status =
      multiplex_presentation_status(presentation);
  return dispatch_model(&(MultiplexAppServicesModelRequest){
      .kind = MULTIPLEX_APP_SERVICES_MODEL_FOCUS,
      .payload.focus =
          {
              .screen = app_services_screen(multiplex_native_app_screen()),
              .rating_key = status.focused_rating_key,
              .now_ms = now_ms,
              .active_input = active_input,
          },
  });
}

static bool dispatch_local_playback(uint64_t now_ms) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT,
      .payload.playback_event =
          {
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE,
              .now_ms = now_ms,
              .playback = playback_view(),
          },
  };
  return dispatch_services(&input);
}

static void stop_playback_if_hidden(void) {
  const MultiplexAppServicesPlaybackView current = playback_view();
  if (current.rating_key != 0 && (multiplex_native_app_playback_state() &
                                  MULTIPLEX_PLAYBACK_STATE_PLAYER) == 0) {
    multiplex_playback_session_stop(playback_session);
    SYS_Report("REFERENCE GX: playback stopped while player hidden key=%u "
               "position=%u\n",
               current.rating_key, current.position_ms);
  }
}

static void pause_audio_for_player_input(uint32_t pressed) {
  if ((pressed &
       (PAD_BUTTON_A | PAD_BUTTON_B | PAD_TRIGGER_L | PAD_TRIGGER_R)) != 0 &&
      multiplex_presentation_status(presentation).video_visible) {
    playback_snapshot = multiplex_playback_session_snapshot(playback_session);
    multiplex_native_app_playback_position(playback_snapshot.position_ms);
    multiplex_playback_session_pause(playback_session);
    SYS_Report("REFERENCE GX: timeline synced for input position=%u\n",
               playback_snapshot.position_ms);
  }
}

static bool handle_playback_events(uint64_t now_ms, AppExitCode *exit_code) {
  MultiplexPlaybackEvent event;
  while (multiplex_playback_session_poll_event(playback_session, &event)) {
    switch (event.kind) {
    case MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED:
      *exit_code = APP_EXIT_MEDIA_PRODUCER;
      return false;
    case MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED:
      *exit_code = APP_EXIT_MEDIA_RECOVERY;
      return false;
    case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_CONTINUE:
      if (multiplex_native_app_playback_continue(event.next_offset_ms) == 0 ||
          multiplex_playback_session_continue_program(playback_session) !=
              MULTIPLEX_PLAYBACK_OPEN_READY ||
          multiplex_native_app_playback_commit() == 0) {
        *exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        return false;
      }
      multiplex_presentation_request_refresh(presentation, false);
      break;
    case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_COMPLETE:
      if (multiplex_native_app_playback_position(event.duration_ms) == 0 ||
          multiplex_native_app_playback_complete() == 0) {
        *exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        return false;
      }
      multiplex_presentation_request_refresh(presentation, false);
      break;
    case MULTIPLEX_PLAYBACK_EVENT_HLS_COMPLETE: {
      const MultiplexAppServicesInput input = {
          .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT,
          .payload.playback_event =
              {
                  .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE,
                  .now_ms = now_ms,
                  .playback = playback_view(),
              },
      };
      if (!dispatch_services(&input)) {
        *exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
        return false;
      }
      break;
    }
    case MULTIPLEX_PLAYBACK_EVENT_NONE:
      break;
    }
  }
  return true;
}

static void initialize_runtime(AppRuntime *runtime) {
  memset(runtime, 0, sizeof(*runtime));
  runtime->playback_start_offset_pending =
      MULTIPLEX_PLAYBACK_START_OFFSET_MS != 0;
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    runtime->workers[index].thread = LWP_THREAD_NULL;
  }
#if MULTIPLEX_PAIRING_ENABLED
  for (uint16_t lane = 0; lane < POSTER_LOADER_LANE_COUNT; ++lane) {
    runtime->posters.threads[lane] = LWP_THREAD_NULL;
  }
#endif
}

static void cleanup_runtime(AppRuntime *runtime) {
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    release_app_work(&runtime->workers[index]);
  }
  stop_poster_lanes(runtime);
}

static void *run_app(void *unused) {
  (void)unused;
  AppExitCode exit_code = APP_EXIT_OK;
  AppRuntime runtime;
  initialize_runtime(&runtime);
  NetworkWarmup warmup = {.thread = LWP_THREAD_NULL};
  bool warmup_pending = false;
  bool network_ready = false;
  uint64_t network_retry_at_ms = 0;
  uint32_t network_retry_delay_ms = NETWORK_RETRY_INITIAL_DELAY_MS;
  bool jpeg_ready = false;

  snprintf(boot_diagnostic_operation, sizeof(boot_diagnostic_operation), "%s",
           "Presentation initialization");
  const MultiplexPresentationOpenResult presentation_open =
      multiplex_presentation_open(presentation);
  if (presentation_open != MULTIPLEX_PRESENTATION_OPEN_READY) {
    exit_code = presentation_open == MULTIPLEX_PRESENTATION_OPEN_VIDEO_FAILED
                    ? APP_EXIT_VIDEO_INIT
                    : APP_EXIT_BUFFER_INIT;
    goto cleanup;
  }
  snprintf(boot_diagnostic_operation, sizeof(boot_diagnostic_operation), "%s",
           "JPEG initialization");
  if (!poster_jpeg_initialize()) {
    exit_code = APP_EXIT_JPEG_INIT;
    goto cleanup;
  }
  jpeg_ready = true;
  multiplex_tls_client_prepare();
  multiplex_native_app_init();
  multiplex_native_reference_text_overlay(1);
  if (multiplex_native_app_pairing_status(MULTIPLEX_PAIRING_CONNECTING,
                                          (const uint8_t *)"", 0,
                                          (const uint8_t *)"", 0) == 0 ||
      !bind_boot_diagnostics("Starting Broadband Adapter")) {
    exit_code = APP_EXIT_UI_BIND;
    goto cleanup;
  }
  if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_SYNCHRONOUS) ==
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    exit_code = APP_EXIT_UI_RENDER;
    goto cleanup;
  }

  warmup_pending = launch_network_warmup(&warmup);
  if (MULTIPLEX_GATEWAY_URL[0] != '\0' && warmup_pending) {
    network_ready = wait_network_warmup(&warmup);
    warmup_pending = false;
    if (!network_ready) {
      network_retry_at_ms =
          ticks_to_millisecs(gettime()) + network_retry_delay_ms;
      network_retry_delay_ms *= 2u;
    }
  } else if (!warmup_pending) {
    network_retry_at_ms =
        ticks_to_millisecs(gettime()) + network_retry_delay_ms;
    network_retry_delay_ms *= 2u;
  }
  const uint64_t boot_now_ms = ticks_to_millisecs(gettime());
  const MultiplexAppServicesInput boot = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_BOOT,
      .payload.boot =
          {
              .now_ms = boot_now_ms,
              .network_allowed = network_ready,
          },
  };
  const bool boot_dispatched = dispatch_services(&boot);
  if (!drain_app_effects(&runtime, &exit_code) || !boot_dispatched) {
    if (exit_code == APP_EXIT_OK) {
      exit_code = APP_EXIT_UI_BIND;
    }
    goto cleanup;
  }

  if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
    AppWorkWorker *catalog_worker =
        &runtime.workers[MULTIPLEX_APP_SERVICES_WORK_CATALOG];
    while (catalog_worker->started && !catalog_worker->complete) {
      if (!SYS_MainLoop()) {
        goto cleanup;
      }
      if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL) ==
          MULTIPLEX_PRESENTATION_FRAME_FAILED) {
        exit_code = APP_EXIT_UI_RENDER;
        goto cleanup;
      }
    }
    const uint64_t catalog_now_ms = ticks_to_millisecs(gettime());
    const bool catalog_dispatched = poll_app_work(&runtime, catalog_now_ms);
    const bool catalog_effects_ready = drain_app_effects(&runtime, &exit_code);
    if (!catalog_dispatched || !catalog_effects_ready) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_BACKGROUND_BIND;
      }
      goto cleanup;
    }

    MultiplexGatewayPlaybackManifest manifest;
    if (!multiplex_gateway_load_playback_manifest(MULTIPLEX_GATEWAY_URL, 0, 0,
                                                  &manifest)) {
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
        exit_code = APP_EXIT_MEDIA_PRODUCER;
        goto cleanup;
      }
    }
  }

  uint32_t queued_buttons = 0;
  uint32_t queued_navigation = UINT32_MAX;
#if MULTIPLEX_PAIRING_ENABLED
  bool auth_reset_latched = false;
#endif
  multiplex_presentation_set_async_enabled(presentation, true);
  while (SYS_MainLoop()) {
    if (!poll_prefetch_adapter(&runtime)) {
      exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
      break;
    }
    const bool poster_dispatched = poll_poster_loader(&runtime);
    const bool poster_effects_ready = drain_app_effects(&runtime, &exit_code);
    if (!poster_dispatched || !poster_effects_ready) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_UI_BIND;
      }
      break;
    }
    const uint64_t now_ms = ticks_to_millisecs(gettime());
    if (warmup_pending && warmup.complete) {
      __sync_synchronize();
      network_ready = finish_network_warmup(&warmup);
      warmup_pending = false;
      if (network_ready) {
        network_retry_at_ms = 0;
        network_retry_delay_ms = NETWORK_RETRY_INITIAL_DELAY_MS;
        bind_boot_diagnostics("Network ready");
        static const char connected[] = "Ethernet connected";
        multiplex_native_app_toast((const uint8_t *)connected,
                                   sizeof(connected) - 1u);
        runtime.toast_dismiss_at_ms = now_ms + 2500u;
      } else {
        bind_boot_diagnostics("Ethernet disconnected; retrying");
        network_retry_at_ms = now_ms + network_retry_delay_ms;
        if (network_retry_delay_ms < NETWORK_RETRY_MAX_DELAY_MS) {
          network_retry_delay_ms *= 2u;
          if (network_retry_delay_ms > NETWORK_RETRY_MAX_DELAY_MS) {
            network_retry_delay_ms = NETWORK_RETRY_MAX_DELAY_MS;
          }
        }
      }
      multiplex_presentation_request_refresh(presentation, false);
    }
    if (!network_ready && !warmup_pending && network_retry_at_ms != 0 &&
        now_ms >= network_retry_at_ms) {
      bind_boot_diagnostics("Retrying Ethernet");
      warmup_pending = launch_network_warmup(&warmup);
      network_retry_at_ms =
          warmup_pending ? 0 : now_ms + network_retry_delay_ms;
    }
    const bool work_dispatched = poll_app_work(&runtime, now_ms);
    const bool work_effects_ready = drain_app_effects(&runtime, &exit_code);
    if (!work_dispatched || !work_effects_ready) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_BACKGROUND_BIND;
      }
      break;
    }
    const MultiplexAppServicesInput tick = {
        .kind = MULTIPLEX_APP_SERVICES_INPUT_TICK,
        .payload.tick =
            {
                .now_ms = now_ms,
                .network_allowed = network_ready,
            },
    };
    const bool tick_dispatched = dispatch_services(&tick);
    if (!drain_app_effects(&runtime, &exit_code) || !tick_dispatched) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_UI_BIND;
      }
      break;
    }

    const MultiplexPresentationFrameResult transition =
        multiplex_presentation_prepare_frame(
            presentation, MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
    if (transition == MULTIPLEX_PRESENTATION_FRAME_FAILED) {
      exit_code = APP_EXIT_UI_RENDER;
      break;
    }
    PAD_ScanPads();
#if defined(HW_RVL)
    WPAD_ScanPads();
#endif
    if (!controller_status_reported) {
      uint32_t controller_type = 0;
      SYS_Report("REFERENCE GX: controller scan=%u type=%08x\n",
                 PAD_GetType(0, &controller_type), controller_type);
      controller_status_reported = true;
    }
    uint32_t pressed = PAD_ButtonsDown(0);
#if MULTIPLEX_PAIRING_ENABLED
    uint32_t held = PAD_ButtonsHeld(0);
#endif
#if defined(HW_RVL)
    pressed |= wii_buttons_as_gamecube(WPAD_ButtonsDown(0));
#if MULTIPLEX_PAIRING_ENABLED
    held |= wii_buttons_as_gamecube(WPAD_ButtonsHeld(0));
#endif
#endif
    if (transition == MULTIPLEX_PRESENTATION_FRAME_PENDING) {
      queued_buttons |= pressed;
      const uint32_t navigation =
          navigation_action(multiplex_gui_navigation_poll(
              &gui_navigation, PAD_StickX(0), PAD_StickY(0), now_ms * 1000u));
      if (queued_navigation == UINT32_MAX && navigation != UINT32_MAX) {
        queued_navigation = navigation;
      }
      present_frame(MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
      continue;
    }
    pressed |= queued_buttons;
    queued_buttons = 0;
    const uint32_t stick_navigation =
        queued_navigation != UINT32_MAX
            ? queued_navigation
            : navigation_action(
                  multiplex_gui_navigation_poll(&gui_navigation, PAD_StickX(0),
                                                PAD_StickY(0), now_ms * 1000u));
    queued_navigation = UINT32_MAX;

    const bool active_input = pressed != 0 || stick_navigation != UINT32_MAX;
    const MultiplexPresentationControlsInput controls_input = {
        .now_ms = now_ms,
        .active_input = active_input,
        .a_pressed = (pressed & PAD_BUTTON_A) != 0,
        .settings_open = multiplex_native_app_player_settings_open() != 0,
    };
    const MultiplexPresentationControlsResult controls =
        multiplex_presentation_controls_update(presentation, &controls_input);
    if (controls.visibility_changed) {
      multiplex_presentation_request_refresh(presentation, true);
    }
    if (controls.consumed_a) {
      pressed &= ~PAD_BUTTON_A;
    }

    const uint32_t input_screen = multiplex_native_app_screen();
    pause_audio_for_player_input(pressed);
    bool app_changed = false;
    if (stick_navigation != UINT32_MAX) {
      const uint32_t before = multiplex_native_app_home_view_state();
      if (multiplex_native_app_input(stick_navigation) != 0) {
        multiplex_presentation_begin_home_motion(
            presentation, before, multiplex_native_app_home_view_state());
        app_changed = true;
      }
    }
    const struct {
      uint32_t button;
      uint32_t action;
    } actions[] = {
        {PAD_BUTTON_LEFT, 12},  {PAD_BUTTON_RIGHT, 13}, {PAD_BUTTON_A, 2},
        {PAD_BUTTON_B, 3},      {PAD_BUTTON_Y, 4},      {PAD_BUTTON_X, 5},
        {PAD_TRIGGER_R, 6},     {PAD_TRIGGER_L, 7},     {PAD_TRIGGER_Z, 10},
        {PAD_BUTTON_START, 11},
    };
    for (unsigned index = 0; index < sizeof(actions) / sizeof(actions[0]);
         ++index) {
      if ((pressed & actions[index].button) != 0 &&
          multiplex_native_app_input(actions[index].action) != 0) {
        app_changed = true;
      }
    }
    if (app_changed) {
      multiplex_presentation_request_refresh(presentation, false);
    }

#if MULTIPLEX_PAIRING_ENABLED
    const uint32_t auth_reset_buttons =
        PAD_TRIGGER_L | PAD_TRIGGER_R | PAD_TRIGGER_Z;
    const bool auth_reset_held =
        (held & auth_reset_buttons) == auth_reset_buttons;
    if (auth_reset_held && !auth_reset_latched) {
      const MultiplexAppServicesInput reset = {
          .kind = MULTIPLEX_APP_SERVICES_INPUT_AUTH_RESET_REQUESTED,
          .payload.auth_reset = {.now_ms = now_ms},
      };
      const bool reset_dispatched = dispatch_services(&reset);
      if (!drain_app_effects(&runtime, &exit_code) || !reset_dispatched) {
        if (exit_code == APP_EXIT_OK) {
          exit_code = APP_EXIT_UI_BIND;
        }
        break;
      }
    }
    auth_reset_latched = auth_reset_held;
#endif

    stop_playback_if_hidden();
    const bool models_dispatched = collect_model_requests(
        &runtime, now_ms, pressed, input_screen, active_input);
    if (!drain_app_effects(&runtime, &exit_code) || !models_dispatched) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_UI_BIND;
      }
      break;
    }
    if (runtime.toast_dismiss_at_ms != 0 &&
        now_ms >= runtime.toast_dismiss_at_ms &&
        multiplex_native_app_toast_dismiss() != 0) {
      runtime.toast_dismiss_at_ms = 0;
      multiplex_presentation_request_refresh(presentation, true);
    }

    if (present_frame(MULTIPLEX_PRESENTATION_PREPARE_NORMAL) ==
        MULTIPLEX_PRESENTATION_FRAME_FAILED) {
      exit_code = APP_EXIT_UI_RENDER;
      break;
    }
    const MultiplexPresentationStatus status =
        multiplex_presentation_status(presentation);
    multiplex_playback_session_update_timeline(playback_session,
                                               status.video_visible);
    const bool local_dispatched = dispatch_local_playback(now_ms);
    const bool local_effects_ready = drain_app_effects(&runtime, &exit_code);
    const bool events_ready = handle_playback_events(now_ms, &exit_code);
    const bool event_effects_ready = drain_app_effects(&runtime, &exit_code);
    if (!local_dispatched || !local_effects_ready || !events_ready ||
        !event_effects_ready) {
      if (exit_code == APP_EXIT_OK) {
        exit_code = APP_EXIT_PLAYBACK_CONTINUATION;
      }
      break;
    }
  }

cleanup:
  if (warmup_pending) {
    finish_network_warmup(&warmup);
  }
  discard_prefetch_adapter(&runtime);
  cleanup_runtime(&runtime);
  multiplex_playback_session_stop(playback_session);
  if (jpeg_ready) {
    poster_jpeg_shutdown();
  }
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
  app_services = multiplex_app_services_create();
  if (app_services == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate app services\n");
    multiplex_presentation_destroy(&presentation);
    multiplex_playback_session_destroy(&playback_session);
    free(app_stack);
    return APP_EXIT_BUFFER_INIT;
  }

  lwp_t app_thread = LWP_THREAD_NULL;
  if (LWP_CreateThread(&app_thread, run_app, NULL, app_stack, APP_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    SYS_Report("REFERENCE GX: failed to create app thread\n");
    multiplex_presentation_destroy(&presentation);
    multiplex_playback_session_destroy(&playback_session);
    multiplex_app_services_destroy(&app_services);
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
    multiplex_app_services_destroy(&app_services);
    return 1;
  }
  const AppExitCode exit_code = (AppExitCode)(uintptr_t)result;
  multiplex_app_services_destroy(&app_services);
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
