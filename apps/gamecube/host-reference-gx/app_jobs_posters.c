#include "app_jobs_internal.h"

#include "gateway_client.h"
#include "media-source.h"
#include "plex_catalog.h"
#include "poster_jpeg.h"

#include <string.h>

void SYS_Report(const char *message, ...) __attribute__((format(printf, 1, 2)));

#define POSTER_LOADER_STACK_SIZE (256u * 1024u)
#define PLEX_POSTER_JPEG_CAPACITY (32u * 1024u)
#define POSTER_TEXTURE_COUNT                                                   \
  (MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS + MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS)

#if MULTIPLEX_PAIRING_ENABLED
static bool posters_running(const AppJobsPosters *posters) {
  for (uint16_t lane = 0; lane < APP_JOBS_POSTER_LOADER_LANE_COUNT; ++lane) {
    if (posters->threads[lane] != 0) {
      return true;
    }
  }
  return false;
}

static void scrub_poster_credentials(AppJobsPosters *posters) {
  if (!posters->credentials_held) {
    return;
  }
  MultiplexAppJobs *jobs = posters->owner;
  jobs->platform.memory.scrub(jobs->platform.memory.context,
                              &posters->credentials,
                              sizeof(posters->credentials));
  posters->credentials_held = false;
}

static void release_poster_lanes(AppJobsPosters *posters) {
  MultiplexAppJobs *jobs = posters->owner;
  for (uint16_t lane = 0; lane < APP_JOBS_POSTER_LOADER_LANE_COUNT; ++lane) {
    if (posters->threads[lane] != 0) {
      jobs->platform.threads.join(jobs->platform.threads.context,
                                  &posters->threads[lane]);
    }
    jobs->platform.memory.release(jobs->platform.memory.context,
                                  posters->decoded_pixels[lane]);
    posters->decoded_pixels[lane] = NULL;
    jobs->platform.memory.release(jobs->platform.memory.context,
                                  posters->encoded[lane]);
    posters->encoded[lane] = NULL;
    jobs->platform.memory.release(jobs->platform.memory.context,
                                  posters->stacks[lane]);
    posters->stacks[lane] = NULL;
  }
  posters->lane_count = 0;
  scrub_poster_credentials(posters);
}

static void *run_poster_lane(void *context) {
  AppJobsPosterWorker *worker = context;
  AppJobsPosters *posters = worker->posters;
  MultiplexAppJobs *jobs = posters->owner;
  const uint16_t lane = worker->lane;
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&posters->cancellation);
  posters->encoded[lane] = jobs->platform.memory.allocate(
      jobs->platform.memory.context, PLEX_POSTER_JPEG_CAPACITY + 64u, 1, true);
  if (posters->encoded[lane] == NULL) {
    posters->failed = true;
    posters->complete[lane] = true;
    return NULL;
  }
  for (uint16_t index = lane; index < posters->item_count;
       index += posters->lane_count) {
    while (posters->item_ready[lane] && !posters->stopping &&
           !multiplex_http_cancellation_requested(&cancellation)) {
      jobs->platform.threads.yield(jobs->platform.threads.context);
    }
    if (posters->stopping ||
        multiplex_http_cancellation_requested(&cancellation)) {
      break;
    }
    size_t encoded_size = 0;
    const bool decoded =
        posters->items[index].artwork_path[0] != '\0' &&
        multiplex_plex_load_artwork_cancellable(
            &posters->credentials, posters->items[index].artwork_path,
            posters->encoded[lane], PLEX_POSTER_JPEG_CAPACITY, &encoded_size,
            &cancellation) &&
        !multiplex_http_cancellation_requested(&cancellation) &&
        poster_jpeg_decode_single(posters->encoded[lane], encoded_size,
                                  posters->decoded_pixels[lane],
                                  MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
    if (decoded) {
      ++posters->decoded_count[lane];
    }
    posters->item_index[lane] = index;
    posters->item_decoded[lane] = decoded;
    jobs->platform.threads.barrier(jobs->platform.threads.context);
    posters->item_ready[lane] = true;
  }
  jobs->platform.memory.release(jobs->platform.memory.context,
                                posters->encoded[lane]);
  posters->encoded[lane] = NULL;
  jobs->platform.threads.barrier(jobs->platform.threads.context);
  posters->complete[lane] = true;
  return NULL;
}

static bool launch_posters(AppJobsPosters *posters) {
  MultiplexAppJobs *jobs = posters->owner;
  if (!posters->pending || posters_running(posters)) {
    return false;
  }
  posters->stopping = false;
  posters->cancellation.requested = false;
  posters->started_tick =
      jobs->platform.clock.tick(jobs->platform.clock.context);
  posters->lane_count = posters->item_count < APP_JOBS_POSTER_LOADER_LANE_COUNT
                            ? posters->item_count
                            : APP_JOBS_POSTER_LOADER_LANE_COUNT;
  for (uint16_t lane = 0; lane < posters->lane_count; ++lane) {
    posters->decoded_pixels[lane] = jobs->platform.memory.allocate(
        jobs->platform.memory.context, MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES, 32,
        false);
    posters->stacks[lane] = jobs->platform.memory.allocate(
        jobs->platform.memory.context, POSTER_LOADER_STACK_SIZE, 1, false);
    posters->workers[lane] =
        (AppJobsPosterWorker){.posters = posters, .lane = lane};
    if (posters->decoded_pixels[lane] == NULL ||
        posters->stacks[lane] == NULL ||
        !jobs->platform.threads.launch(
            jobs->platform.threads.context, &posters->threads[lane],
            run_poster_lane, &posters->workers[lane], posters->stacks[lane],
            POSTER_LOADER_STACK_SIZE)) {
      posters->stopping = true;
      multiplex_app_jobs_cancellation_request(&posters->cancellation);
      release_poster_lanes(posters);
      posters->pending = false;
      return false;
    }
  }
  posters->pending = false;
  SYS_Report(
      "REFERENCE GX: direct Plex poster loader started items=%u cached=%u "
      "requested=%u offset=%u lanes=%u\n",
      posters->item_count, posters->cache_hits, posters->requested_count,
      posters->texture_offset, posters->lane_count);
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

static bool queue_posters(AppJobsPosters *posters,
                          const MultiplexAuthCredentials *credentials,
                          const MultiplexGatewayItem *items,
                          uint16_t item_count, uint16_t texture_offset) {
  MultiplexAppJobs *jobs = posters->owner;
  if (posters_running(posters) || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS ||
      texture_offset > POSTER_TEXTURE_COUNT ||
      item_count > POSTER_TEXTURE_COUNT - texture_offset) {
    return false;
  }
  const uint32_t token = posters->token;
  memset(posters, 0, sizeof(*posters));
  posters->owner = jobs;
  posters->token = token;
  MultiplexPresentationPosterWrite write;
  if (!multiplex_presentation_posters_begin(
          jobs->presentation, texture_offset, item_count,
          MULTIPLEX_PRESENTATION_POSTERS_REUSE, &write)) {
    return false;
  }
  uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS] = {0};
  uint16_t download_count = 0;
  for (uint16_t index = 0; index < item_count; ++index) {
    const uint16_t target_slot = texture_offset + index;
    uint8_t *pixels =
        write.pixels + (size_t)index * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    if (multiplex_presentation_posters_reuse(jobs->presentation, &write, index,
                                             items[index].rating_key)) {
      rating_keys[index] = items[index].rating_key;
      ++posters->cache_hits;
    } else {
      fill_poster_fallback(pixels, items[index].rating_key);
      posters->items[download_count] = items[index];
      posters->texture_slots[download_count] = target_slot;
      ++download_count;
    }
  }
  if (!multiplex_presentation_posters_commit(jobs->presentation, &write,
                                             rating_keys)) {
    multiplex_presentation_posters_cancel(jobs->presentation, &write);
    return false;
  }
  posters->credentials = *credentials;
  posters->credentials_held = true;
  posters->item_count = download_count;
  posters->requested_count = item_count;
  posters->texture_offset = texture_offset;
  posters->pending = download_count != 0;
  if (download_count == 0) {
    SYS_Report("REFERENCE GX: direct Plex posters reused=%u/%u\n",
               posters->cache_hits, posters->requested_count);
    scrub_poster_credentials(posters);
    return true;
  }
  return launch_posters(posters);
}

void multiplex_app_jobs_posters_stop(MultiplexAppJobs *jobs) {
  multiplex_app_jobs_posters_cancel(jobs);
  release_poster_lanes(&jobs->posters);
  jobs->posters.token = 0;
}

void multiplex_app_jobs_posters_cancel(MultiplexAppJobs *jobs) {
  jobs->posters.stopping = true;
  jobs->posters.pending = false;
  multiplex_app_jobs_cancellation_request(&jobs->posters.cancellation);
}
#else
void multiplex_app_jobs_posters_stop(MultiplexAppJobs *jobs) { (void)jobs; }
void multiplex_app_jobs_posters_cancel(MultiplexAppJobs *jobs) { (void)jobs; }

static bool gateway_posters_load(MultiplexAppJobs *jobs,
                                 const MultiplexAppServicesPosterPlan *plan) {
  MultiplexPresentation *presentation = jobs->presentation;
  const uint16_t maximum =
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG
          ? MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS
          : MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS;
  if (plan->item_count == 0 || plan->item_count > maximum) {
    return false;
  }
  uint8_t *encoded = jobs->platform.memory.allocate(
      jobs->platform.memory.context, PLEX_POSTER_JPEG_CAPACITY * 8u + 64u, 1,
      true);
  MultiplexPresentationPosterWrite write = {0};
  const uint16_t offset =
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG
          ? 0
          : plan->texture_offset;
  const bool begun = multiplex_presentation_posters_begin(
      presentation, offset, plan->item_count,
      MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write);
  size_t encoded_size = 0;
  bool loaded = false;
  if (encoded != NULL && begun &&
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG) {
    loaded =
        multiplex_gateway_load_artwork(MULTIPLEX_GATEWAY_URL, encoded,
                                       PLEX_POSTER_JPEG_CAPACITY * 8u,
                                       &encoded_size) &&
        poster_jpeg_decode_columns(
            encoded, encoded_size, plan->item_count,
            MULTIPLEX_GATEWAY_MAX_HOME_ITEMS, write.pixels,
            (size_t)plan->item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  } else if (encoded != NULL && begun &&
             plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_BROWSE) {
    loaded =
        multiplex_gateway_load_browse_artwork(
            MULTIPLEX_GATEWAY_URL, plan->payload.browse.section_id,
            plan->payload.browse.start, encoded, PLEX_POSTER_JPEG_CAPACITY * 8u,
            &encoded_size) &&
        poster_jpeg_decode_columns(
            encoded, encoded_size, plan->item_count,
            MULTIPLEX_GATEWAY_BROWSE_COLUMNS, write.pixels,
            (size_t)plan->item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  } else if (encoded != NULL && begun &&
             plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_SEARCH) {
    loaded = multiplex_gateway_load_search_artwork(
                 MULTIPLEX_GATEWAY_URL, plan->payload.search.query,
                 plan->payload.search.query_length, encoded,
                 PLEX_POSTER_JPEG_CAPACITY * 8u, &encoded_size) &&
             poster_jpeg_decode(encoded, encoded_size, plan->item_count,
                                write.pixels,
                                (size_t)plan->item_count *
                                    MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  }
  jobs->platform.memory.release(jobs->platform.memory.context, encoded);
  if (!loaded) {
    if (begun) {
      multiplex_presentation_posters_cancel(presentation, &write);
    }
    return false;
  }
  const uint32_t rating_keys[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS] = {0};
  const bool committed =
      multiplex_presentation_posters_commit(presentation, &write, rating_keys);
  if (committed &&
      plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG) {
    SYS_Report("REFERENCE GX: poster-textures count=%u size=%ux%u\n",
               plan->item_count, MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
               MULTIPLEX_GATEWAY_ARTWORK_HEIGHT);
  }
  return committed;
}
#endif

static bool dispatch_poster(MultiplexAppJobs *jobs, uint32_t token,
                            MultiplexAppServicesPosterResultKind kind) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT,
      .payload.poster_result = {.token = token, .kind = kind},
  };
  return multiplex_app_jobs_report(jobs, &input);
}

bool multiplex_app_jobs_start_posters(
    MultiplexAppJobs *jobs, const MultiplexAppServicesPosterPlan *plan) {
  if (jobs == NULL || plan == NULL) {
    return false;
  }
#if MULTIPLEX_PAIRING_ENABLED
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  MultiplexAuthCredentials credentials;
  if (plan->token == 0 || jobs->posters.token != 0 || jobs->posters.pending ||
      posters_running(&jobs->posters) ||
      !multiplex_app_services_copy_poster_plan(jobs->services, plan, items,
                                               sizeof(items) / sizeof(items[0]),
                                               &credentials)) {
    return dispatch_poster(jobs, plan->token,
                           MULTIPLEX_APP_SERVICES_POSTER_FAILED);
  }
  jobs->posters.token = plan->token;
  if (!queue_posters(&jobs->posters, &credentials, items, plan->item_count,
                     plan->texture_offset)) {
    jobs->posters.token = 0;
    return dispatch_poster(jobs, plan->token,
                           MULTIPLEX_APP_SERVICES_POSTER_FAILED);
  }
  if (!dispatch_poster(jobs, plan->token,
                       MULTIPLEX_APP_SERVICES_POSTER_STARTED)) {
    return false;
  }
  if (jobs->posters.pending || posters_running(&jobs->posters)) {
    return true;
  }
  jobs->posters.token = 0;
  return dispatch_poster(jobs, plan->token,
                         MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);
#else
  if (!dispatch_poster(jobs, plan->token,
                       MULTIPLEX_APP_SERVICES_POSTER_STARTED)) {
    return false;
  }
  return dispatch_poster(jobs, plan->token,
                         gateway_posters_load(jobs, plan)
                             ? MULTIPLEX_APP_SERVICES_POSTER_COMPLETED
                             : MULTIPLEX_APP_SERVICES_POSTER_FAILED);
#endif
}

bool multiplex_app_jobs_poll_posters(MultiplexAppJobs *jobs) {
  if (jobs == NULL) {
    return false;
  }
#if MULTIPLEX_PAIRING_ENABLED
  AppJobsPosters *posters = &jobs->posters;
  if (!posters_running(posters)) {
    return true;
  }
  bool all_complete = true;
  for (uint16_t lane = 0; lane < posters->lane_count; ++lane) {
    if (posters->item_ready[lane]) {
      jobs->platform.threads.barrier(jobs->platform.threads.context);
      if (posters->item_decoded[lane]) {
        const uint16_t item_index = posters->item_index[lane];
        MultiplexPresentationPosterWrite write;
        const uint32_t rating_key = posters->items[item_index].rating_key;
        if (!multiplex_presentation_posters_begin(
                jobs->presentation, posters->texture_slots[item_index], 1,
                MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE, &write)) {
          posters->item_decoded[lane] = false;
          posters->failed = true;
        } else {
          memcpy(write.pixels, posters->decoded_pixels[lane],
                 MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
          posters->item_decoded[lane] = multiplex_presentation_posters_commit(
              jobs->presentation, &write, &rating_key);
          posters->failed = posters->failed || !posters->item_decoded[lane];
        }
      }
      if (posters->item_decoded[lane] && !posters->first_ready_reported) {
        SYS_Report("REFERENCE GX: direct Plex poster first-ready requested=%u "
                   "us=%u\n",
                   posters->requested_count,
                   jobs->platform.clock.elapsed_us(jobs->platform.clock.context,
                                                   posters->started_tick));
      }
      posters->first_ready_reported =
          posters->first_ready_reported || posters->item_decoded[lane];
      jobs->platform.threads.barrier(jobs->platform.threads.context);
      posters->item_ready[lane] = false;
    }
    all_complete =
        all_complete && posters->complete[lane] && !posters->item_ready[lane];
  }
  if (!all_complete) {
    return true;
  }
  const bool failed = posters->failed;
  const uint32_t token = posters->token;
  uint16_t decoded_count = 0;
  for (uint16_t lane = 0; lane < posters->lane_count; ++lane) {
    decoded_count += posters->decoded_count[lane];
  }
  SYS_Report(
      "REFERENCE GX: direct Plex posters decoded=%u downloaded=%u cached=%u "
      "requested=%u us=%u\n",
      decoded_count, posters->item_count, posters->cache_hits,
      posters->requested_count,
      jobs->platform.clock.elapsed_us(jobs->platform.clock.context,
                                      posters->started_tick));
  release_poster_lanes(posters);
  posters->token = 0;
  return dispatch_poster(jobs, token,
                         failed ? MULTIPLEX_APP_SERVICES_POSTER_FAILED
                                : MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);
#else
  return true;
#endif
}

bool multiplex_app_jobs_quiesce_posters(MultiplexAppJobs *jobs,
                                        uint32_t token) {
  if (jobs == NULL) {
    return false;
  }
  multiplex_app_jobs_posters_stop(jobs);
  return dispatch_poster(jobs, token, MULTIPLEX_APP_SERVICES_POSTER_QUIESCED);
}
