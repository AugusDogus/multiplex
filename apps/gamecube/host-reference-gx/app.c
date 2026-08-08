#include "app.h"
#include "app_internal.h"

#include "app_jobs.h"
#include "app_services.h"
#include "gateway_client.h"
#include "gui_navigation.h"
#include "http_client.h"
#include "media-source.h"
#include "multiplex-dvd-demo-program.h"
#include "native_ui.h"
#include "playback_session.h"
#include "poster_jpeg.h"
#include "presentation.h"
#include "reference_frame.h"
#include "tls_client.h"

#include <gccore.h>
#include <network.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NETWORK_WARMUP_STACK_SIZE (64 * 1024)
#define NETWORK_RETRY_INITIAL_DELAY_MS 1000u
#define NETWORK_RETRY_MAX_DELAY_MS 8000u

// The Native render callback has no context parameter. App create and destroy
// bind its one process-wide owner for the callback's lifetime.
static MultiplexApp *profile_app;

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
  if (profile_app != NULL) {
    multiplex_presentation_profile_mark(profile_app->presentation, stage);
  }
}

static void *run_network_warmup(void *context) {
  MultiplexAppNetworkWarmup *warmup = context;
  warmup->ready = http_client_initialize_network();
  __sync_synchronize();
  warmup->complete = true;
  return NULL;
}

static bool launch_network_warmup(MultiplexAppNetworkWarmup *warmup) {
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

static bool finish_network_warmup(MultiplexAppNetworkWarmup *warmup) {
  if (warmup->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(warmup->thread, NULL);
    warmup->thread = LWP_THREAD_NULL;
  }
  free(warmup->stack);
  warmup->stack = NULL;
  return warmup->ready;
}

static int format_boot_diagnostics(MultiplexApp *app, char *destination,
                                   size_t capacity) {
  const MultiplexPresentationRenderDiagnostic render_diagnostic =
      multiplex_presentation_render_diagnostic(app->presentation);
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
      app->boot_diagnostic_operation, http_client_diagnostic_stage_name(),
      (long)http_client_diagnostic_error(), (long)http_client_network_status(),
      (unsigned long)http_client_network_attempts(), local_ip,
      (unsigned long)http_client_dns_attempts(),
      (unsigned long)http_client_tls_verify_flags(),
      multiplex_reference_frame_status_name(render_diagnostic.status),
      (unsigned long)render_diagnostic.stage,
      render_diagnostic.asynchronous ? 1u : 0u);
}

static bool bind_boot_diagnostics(MultiplexApp *app, const char *operation) {
  snprintf(app->boot_diagnostic_operation,
           sizeof(app->boot_diagnostic_operation), "%s", operation);
  char diagnostics[256];
  const int length =
      format_boot_diagnostics(app, diagnostics, sizeof(diagnostics));
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
    multiplex_presentation_request_refresh(app->presentation, false);
  }
  return committed;
}

static MultiplexPlaybackSnapshot
step_presentation_playback(MultiplexApp *app, bool desired_playing) {
  const MultiplexPresentationStatus status =
      multiplex_presentation_status(app->presentation);
  const MultiplexPlaybackStepInput input = {
      .visible = status.video_visible,
      .playing = desired_playing,
      .collect_network_metrics =
          status.video_visible &&
          multiplex_native_app_stats_for_nerds_enabled() != 0,
  };
  app->playback_snapshot =
      multiplex_playback_session_step(app->playback_session, &input);
  return app->playback_snapshot;
}

MultiplexPresentationFrameResult
multiplex_app_present_frame(MultiplexApp *app,
                            MultiplexPresentationPrepareMode mode) {
  const MultiplexPresentationFrameResult frame =
      multiplex_presentation_prepare_frame(app->presentation, mode);
  const uint32_t playback_state = multiplex_native_app_playback_state();
  const uint32_t active_playback_state = MULTIPLEX_APP_PLAYBACK_STATE_PLAYER |
                                         MULTIPLEX_APP_PLAYBACK_STATE_PLAYING;
  const bool desired_playing =
      frame == MULTIPLEX_PRESENTATION_FRAME_READY &&
      (playback_state & active_playback_state) == active_playback_state;
  const MultiplexPresentationFrameInput input = {
      .playback = step_presentation_playback(app, desired_playing),
      .startup_rating_key =
          multiplex_app_services_startup_rating_key(app->services),
  };
  if (!multiplex_presentation_present(app->presentation, &input)) {
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  return frame;
}

static bool wait_network_warmup(MultiplexApp *app) {
  MultiplexAppNetworkWarmup *warmup = &app->network.warmup;
  multiplex_presentation_set_network_activity(app->presentation, true);
  while (!warmup->complete && SYS_MainLoop()) {
    multiplex_app_present_frame(app, MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
  }
  __sync_synchronize();
  multiplex_presentation_set_network_activity(app->presentation, false);
  const bool ready = finish_network_warmup(warmup);
  bind_boot_diagnostics(app, ready ? "Network ready" : "Waiting for DHCP");
  return ready;
}

static MultiplexAppOpenResult open_failure(MultiplexAppFailure failure,
                                           MultiplexAppOpenResult fallback) {
  switch (failure) {
  case MULTIPLEX_APP_FAILURE_NONE:
    return fallback;
  case MULTIPLEX_APP_FAILURE_UI_BIND:
    return MULTIPLEX_APP_OPEN_UI_BIND_FAILED;
  case MULTIPLEX_APP_FAILURE_UI_RENDER:
    return MULTIPLEX_APP_OPEN_UI_RENDER_FAILED;
  case MULTIPLEX_APP_FAILURE_BACKGROUND_BIND:
    return MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED;
  case MULTIPLEX_APP_FAILURE_MEDIA_PRODUCER:
    return MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED;
  case MULTIPLEX_APP_FAILURE_MEDIA_RECOVERY:
    return MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED;
  case MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION:
    return MULTIPLEX_APP_OPEN_PLAYBACK_CONTINUATION_FAILED;
  }
  return fallback;
}

static MultiplexAppStepResult step_failure(MultiplexAppFailure failure,
                                           MultiplexAppStepResult fallback) {
  switch (failure) {
  case MULTIPLEX_APP_FAILURE_NONE:
    return fallback;
  case MULTIPLEX_APP_FAILURE_UI_BIND:
    return MULTIPLEX_APP_STEP_UI_BIND_FAILED;
  case MULTIPLEX_APP_FAILURE_UI_RENDER:
    return MULTIPLEX_APP_STEP_UI_RENDER_FAILED;
  case MULTIPLEX_APP_FAILURE_BACKGROUND_BIND:
    return MULTIPLEX_APP_STEP_BACKGROUND_BIND_FAILED;
  case MULTIPLEX_APP_FAILURE_MEDIA_PRODUCER:
    return MULTIPLEX_APP_STEP_MEDIA_PRODUCER_FAILED;
  case MULTIPLEX_APP_FAILURE_MEDIA_RECOVERY:
    return MULTIPLEX_APP_STEP_MEDIA_RECOVERY_FAILED;
  case MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION:
    return MULTIPLEX_APP_STEP_PLAYBACK_CONTINUATION_FAILED;
  }
  return fallback;
}

MultiplexAppCreateResult multiplex_app_create(void) {
  MultiplexApp *app = calloc(1, sizeof(*app));
  if (app == NULL) {
    return (MultiplexAppCreateResult){
        .status = MULTIPLEX_APP_CREATE_CONTEXT_FAILED,
    };
  }
  app->network.warmup.thread = LWP_THREAD_NULL;
  app->network.retry_delay_ms = NETWORK_RETRY_INITIAL_DELAY_MS;
  app->input.queued_navigation = UINT32_MAX;
  app->playback_start_offset_pending = MULTIPLEX_PLAYBACK_START_OFFSET_MS != 0;
  snprintf(app->boot_diagnostic_operation,
           sizeof(app->boot_diagnostic_operation), "%s", "Process startup");

  app->presentation = multiplex_presentation_create();
  if (app->presentation == NULL) {
    free(app);
    return (MultiplexAppCreateResult){
        .status = MULTIPLEX_APP_CREATE_PRESENTATION_FAILED,
    };
  }
  app->playback_session = multiplex_playback_session_create();
  if (app->playback_session == NULL) {
    multiplex_presentation_destroy(&app->presentation);
    free(app);
    return (MultiplexAppCreateResult){
        .status = MULTIPLEX_APP_CREATE_PLAYBACK_FAILED,
    };
  }
  app->services = multiplex_app_services_create();
  if (app->services == NULL) {
    multiplex_presentation_destroy(&app->presentation);
    multiplex_playback_session_destroy(&app->playback_session);
    free(app);
    return (MultiplexAppCreateResult){
        .status = MULTIPLEX_APP_CREATE_SERVICES_FAILED,
    };
  }

  profile_app = app;
  return (MultiplexAppCreateResult){
      .app = app,
      .status = MULTIPLEX_APP_CREATE_READY,
  };
}

MultiplexAppOpenResult multiplex_app_open(MultiplexApp *app) {
  if (app == NULL || app->lifecycle != MULTIPLEX_APP_LIFECYCLE_CREATED) {
    return MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED;
  }

  app->jobs = multiplex_app_jobs_create(app->services, app->presentation,
                                        app->playback_session);
  if (app->jobs == NULL) {
    return MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED;
  }

  snprintf(app->boot_diagnostic_operation,
           sizeof(app->boot_diagnostic_operation), "%s",
           "Presentation initialization");
  const MultiplexPresentationOpenResult presentation_open =
      multiplex_presentation_open(app->presentation);
  if (presentation_open != MULTIPLEX_PRESENTATION_OPEN_READY) {
    return presentation_open == MULTIPLEX_PRESENTATION_OPEN_VIDEO_FAILED
               ? MULTIPLEX_APP_OPEN_VIDEO_FAILED
               : MULTIPLEX_APP_OPEN_BUFFER_FAILED;
  }

  snprintf(app->boot_diagnostic_operation,
           sizeof(app->boot_diagnostic_operation), "%s", "JPEG initialization");
  if (!poster_jpeg_initialize()) {
    return MULTIPLEX_APP_OPEN_JPEG_FAILED;
  }
  app->jpeg_ready = true;
  multiplex_tls_client_prepare();
  multiplex_native_app_init();
  multiplex_native_reference_text_overlay(1);
  if (multiplex_native_app_pairing_status(MULTIPLEX_APP_PAIRING_CONNECTING,
                                          (const uint8_t *)"", 0,
                                          (const uint8_t *)"", 0) == 0 ||
      !bind_boot_diagnostics(app, "Starting Broadband Adapter")) {
    return MULTIPLEX_APP_OPEN_UI_BIND_FAILED;
  }
  if (multiplex_app_present_frame(app,
                                  MULTIPLEX_PRESENTATION_PREPARE_SYNCHRONOUS) ==
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    return MULTIPLEX_APP_OPEN_UI_RENDER_FAILED;
  }

  app->network.warmup_pending = launch_network_warmup(&app->network.warmup);
  if (MULTIPLEX_GATEWAY_URL[0] != '\0' && app->network.warmup_pending) {
    app->network.ready = wait_network_warmup(app);
    app->network.warmup_pending = false;
    if (!app->network.ready) {
      app->network.retry_at_ms =
          ticks_to_millisecs(gettime()) + app->network.retry_delay_ms;
      app->network.retry_delay_ms *= 2u;
    }
  } else if (!app->network.warmup_pending) {
    app->network.retry_at_ms =
        ticks_to_millisecs(gettime()) + app->network.retry_delay_ms;
    app->network.retry_delay_ms *= 2u;
  }

  const MultiplexAppServicesInput boot = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_BOOT,
      .payload.boot =
          {
              .now_ms = ticks_to_millisecs(gettime()),
              .network_allowed = app->network.ready,
          },
  };
  const bool boot_dispatched = multiplex_app_dispatch_services(app, &boot);
  const MultiplexAppEffectDrainResult boot_effects =
      multiplex_app_drain_effects(app);
  if (!boot_effects.ready || !boot_dispatched) {
    return open_failure(boot_effects.failure,
                        MULTIPLEX_APP_OPEN_UI_BIND_FAILED);
  }

  bool has_playback_manifest = false;
  if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
    while (multiplex_app_jobs_work_running(
        app->jobs, MULTIPLEX_APP_SERVICES_WORK_CATALOG)) {
      if (!SYS_MainLoop()) {
        return MULTIPLEX_APP_OPEN_STOPPED;
      }
      if (multiplex_app_present_frame(app,
                                      MULTIPLEX_PRESENTATION_PREPARE_NORMAL) ==
          MULTIPLEX_PRESENTATION_FRAME_FAILED) {
        return MULTIPLEX_APP_OPEN_UI_RENDER_FAILED;
      }
    }
    const bool catalog_dispatched =
        multiplex_app_jobs_poll_work(app->jobs, ticks_to_millisecs(gettime()));
    const MultiplexAppEffectDrainResult catalog_effects =
        multiplex_app_drain_effects(app);
    if (!catalog_effects.ready || !catalog_dispatched) {
      return open_failure(catalog_effects.failure,
                          MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED);
    }

    MultiplexGatewayPlaybackManifest manifest;
    has_playback_manifest = multiplex_gateway_load_playback_manifest(
        MULTIPLEX_GATEWAY_URL, 0, 0, &manifest);
  }

  const bool startup_media_deferred = MULTIPLEX_MEDIA_URL[0] == '\0' &&
                                      MULTIPLEX_GATEWAY_URL[0] == '\0' &&
                                      MULTIPLEX_PAIRING_ENABLED != 0;
  if (!has_playback_manifest && !startup_media_deferred) {
    MultiplexPlaybackProgramOpenRequest request;
    if (MULTIPLEX_MEDIA_URL[0] != '\0') {
      request = (MultiplexPlaybackProgramOpenRequest){
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
    } else {
      if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
        SYS_Report("REFERENCE GX: gateway playback manifest unavailable\n");
        return MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED;
      }
      request = (MultiplexPlaybackProgramOpenRequest){
          .source_kind = MULTIPLEX_PLAYBACK_PROGRAM_EMBEDDED,
          .source.embedded =
              {
                  .bytes = multiplex_dvd_demo_mpg,
                  .size = (size_t)multiplex_dvd_demo_mpg_size,
              },
      };
    }
    if (multiplex_playback_session_open_program(
            app->playback_session, &request) != MULTIPLEX_PLAYBACK_OPEN_READY) {
      return MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED;
    }
  }

  multiplex_presentation_set_async_enabled(app->presentation, true);
  app->lifecycle = MULTIPLEX_APP_LIFECYCLE_OPEN;
  return MULTIPLEX_APP_OPEN_READY;
}

static void poll_network(MultiplexApp *app, uint64_t now_ms) {
  if (app->network.warmup_pending && app->network.warmup.complete) {
    __sync_synchronize();
    app->network.ready = finish_network_warmup(&app->network.warmup);
    app->network.warmup_pending = false;
    if (app->network.ready) {
      app->network.retry_at_ms = 0;
      app->network.retry_delay_ms = NETWORK_RETRY_INITIAL_DELAY_MS;
      bind_boot_diagnostics(app, "Network ready");
      static const char connected[] = "Ethernet connected";
      multiplex_native_app_toast((const uint8_t *)connected,
                                 sizeof(connected) - 1u);
      app->toast_dismiss_at_ms = now_ms + 2500u;
    } else {
      bind_boot_diagnostics(app, "Ethernet disconnected; retrying");
      app->network.retry_at_ms = now_ms + app->network.retry_delay_ms;
      if (app->network.retry_delay_ms < NETWORK_RETRY_MAX_DELAY_MS) {
        app->network.retry_delay_ms *= 2u;
        if (app->network.retry_delay_ms > NETWORK_RETRY_MAX_DELAY_MS) {
          app->network.retry_delay_ms = NETWORK_RETRY_MAX_DELAY_MS;
        }
      }
    }
    multiplex_presentation_request_refresh(app->presentation, false);
  }
  if (!app->network.ready && !app->network.warmup_pending &&
      app->network.retry_at_ms != 0 && now_ms >= app->network.retry_at_ms) {
    bind_boot_diagnostics(app, "Retrying Ethernet");
    app->network.warmup_pending = launch_network_warmup(&app->network.warmup);
    app->network.retry_at_ms =
        app->network.warmup_pending ? 0 : now_ms + app->network.retry_delay_ms;
  }
}

MultiplexAppStepResult multiplex_app_step(MultiplexApp *app) {
  if (app == NULL || app->lifecycle != MULTIPLEX_APP_LIFECYCLE_OPEN) {
    return MULTIPLEX_APP_STEP_BACKGROUND_BIND_FAILED;
  }

  if (!multiplex_app_jobs_poll_prefetch(app->jobs)) {
    return MULTIPLEX_APP_STEP_PLAYBACK_CONTINUATION_FAILED;
  }

  const bool poster_dispatched = multiplex_app_jobs_poll_posters(app->jobs);
  const MultiplexAppEffectDrainResult poster_effects =
      multiplex_app_drain_effects(app);
  if (!poster_effects.ready || !poster_dispatched) {
    return step_failure(poster_effects.failure,
                        MULTIPLEX_APP_STEP_UI_BIND_FAILED);
  }

  const uint64_t now_ms = ticks_to_millisecs(gettime());
  poll_network(app, now_ms);

  const bool work_dispatched = multiplex_app_jobs_poll_work(app->jobs, now_ms);
  const MultiplexAppEffectDrainResult work_effects =
      multiplex_app_drain_effects(app);
  if (!work_effects.ready || !work_dispatched) {
    return step_failure(work_effects.failure,
                        MULTIPLEX_APP_STEP_BACKGROUND_BIND_FAILED);
  }

  const MultiplexAppServicesInput tick = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_TICK,
      .payload.tick =
          {
              .now_ms = now_ms,
              .network_allowed = app->network.ready,
          },
  };
  const bool tick_dispatched = multiplex_app_dispatch_services(app, &tick);
  const MultiplexAppEffectDrainResult tick_effects =
      multiplex_app_drain_effects(app);
  if (!tick_effects.ready || !tick_dispatched) {
    return step_failure(tick_effects.failure,
                        MULTIPLEX_APP_STEP_UI_BIND_FAILED);
  }

  const MultiplexPresentationFrameResult transition =
      multiplex_presentation_prepare_frame(
          app->presentation, MULTIPLEX_PRESENTATION_PREPARE_NORMAL);
  if (transition == MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    return MULTIPLEX_APP_STEP_UI_RENDER_FAILED;
  }

  MultiplexAppInputFrame input;
  const MultiplexAppFailure input_failure =
      multiplex_app_collect_input(app, now_ms, transition, &input);
  if (input_failure != MULTIPLEX_APP_FAILURE_NONE) {
    return step_failure(input_failure, MULTIPLEX_APP_STEP_UI_BIND_FAILED);
  }
  if (input.transition_pending) {
    return MULTIPLEX_APP_STEP_CONTINUE;
  }

  multiplex_app_stop_playback_if_hidden(app);
  const MultiplexAppFailure model_failure =
      multiplex_app_collect_model_requests(app, now_ms, &input);
  const MultiplexAppEffectDrainResult model_effects =
      multiplex_app_drain_effects(app);
  if (!model_effects.ready || model_failure != MULTIPLEX_APP_FAILURE_NONE) {
    return step_failure(model_effects.failure != MULTIPLEX_APP_FAILURE_NONE
                            ? model_effects.failure
                            : model_failure,
                        MULTIPLEX_APP_STEP_UI_BIND_FAILED);
  }

  if (app->toast_dismiss_at_ms != 0 && now_ms >= app->toast_dismiss_at_ms &&
      multiplex_native_app_toast_dismiss() != 0) {
    app->toast_dismiss_at_ms = 0;
    multiplex_presentation_request_refresh(app->presentation, true);
  }

  if (multiplex_app_present_frame(app, MULTIPLEX_PRESENTATION_PREPARE_NORMAL) ==
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    return MULTIPLEX_APP_STEP_UI_RENDER_FAILED;
  }
  const MultiplexPresentationStatus status =
      multiplex_presentation_status(app->presentation);
  multiplex_playback_session_update_timeline(app->playback_session,
                                             status.video_visible);

  const bool local_dispatched =
      multiplex_app_dispatch_local_playback(app, now_ms);
  bool playback_ready = local_dispatched;
  MultiplexAppFailure playback_failure = MULTIPLEX_APP_FAILURE_NONE;
  const MultiplexAppEffectDrainResult local_effects =
      multiplex_app_drain_effects(app);
  if (!local_effects.ready) {
    playback_ready = false;
  }
  if (local_effects.failure != MULTIPLEX_APP_FAILURE_NONE) {
    playback_failure = local_effects.failure;
  }
  const MultiplexAppFailure event_failure =
      multiplex_app_handle_playback_events(app, now_ms);
  if (event_failure != MULTIPLEX_APP_FAILURE_NONE) {
    playback_ready = false;
    playback_failure = event_failure;
  }
  const MultiplexAppEffectDrainResult event_effects =
      multiplex_app_drain_effects(app);
  if (!event_effects.ready) {
    playback_ready = false;
  }
  if (event_effects.failure != MULTIPLEX_APP_FAILURE_NONE) {
    playback_failure = event_effects.failure;
  }
  return playback_ready
             ? MULTIPLEX_APP_STEP_CONTINUE
             : step_failure(playback_failure,
                            MULTIPLEX_APP_STEP_PLAYBACK_CONTINUATION_FAILED);
}

void multiplex_app_close(MultiplexApp *app) {
  if (app == NULL || app->lifecycle == MULTIPLEX_APP_LIFECYCLE_CLOSED ||
      app->lifecycle == MULTIPLEX_APP_LIFECYCLE_FAILURE_PREPARED) {
    return;
  }
  if (app->network.warmup_pending) {
    finish_network_warmup(&app->network.warmup);
    app->network.warmup_pending = false;
  }
  multiplex_app_jobs_destroy(&app->jobs);
  multiplex_playback_session_stop(app->playback_session);
  if (app->jpeg_ready) {
    poster_jpeg_shutdown();
    app->jpeg_ready = false;
  }
  app->lifecycle = MULTIPLEX_APP_LIFECYCLE_CLOSED;
}

const MultiplexAppBorrowedFailure *
multiplex_app_prepare_failure(MultiplexApp *app) {
  if (app == NULL) {
    return NULL;
  }
  if (app->lifecycle == MULTIPLEX_APP_LIFECYCLE_FAILURE_PREPARED) {
    return &app->borrowed_failure;
  }
  multiplex_app_close(app);
  multiplex_app_services_destroy(&app->services);
  app->borrowed_failure.video =
      multiplex_presentation_finalize_for_fatal(app->presentation);
  multiplex_playback_session_destroy(&app->playback_session);

  const int diagnostics_length = format_boot_diagnostics(
      app, app->failure_diagnostics, sizeof(app->failure_diagnostics));
  app->borrowed_failure.diagnostics = app->failure_diagnostics;
  app->borrowed_failure.diagnostics_length =
      diagnostics_length > 0 &&
              (size_t)diagnostics_length < sizeof(app->failure_diagnostics)
          ? (size_t)diagnostics_length
          : 0;
  app->lifecycle = MULTIPLEX_APP_LIFECYCLE_FAILURE_PREPARED;
  return &app->borrowed_failure;
}

void multiplex_app_destroy(MultiplexApp **app) {
  if (app == NULL || *app == NULL) {
    return;
  }
  MultiplexApp *owned = *app;
  const MultiplexAppLifecycle lifecycle = owned->lifecycle;
  if (lifecycle == MULTIPLEX_APP_LIFECYCLE_CREATED &&
      (owned->jobs != NULL || owned->network.warmup_pending ||
       owned->jpeg_ready)) {
    multiplex_app_close(owned);
  }
  if (lifecycle == MULTIPLEX_APP_LIFECYCLE_CREATED) {
    multiplex_presentation_destroy(&owned->presentation);
    multiplex_playback_session_destroy(&owned->playback_session);
    multiplex_app_services_destroy(&owned->services);
  } else {
    multiplex_app_close(owned);
    multiplex_app_services_destroy(&owned->services);
    multiplex_presentation_destroy(&owned->presentation);
    multiplex_playback_session_destroy(&owned->playback_session);
  }
  if (profile_app == owned) {
    profile_app = NULL;
  }
  free(owned);
  *app = NULL;
}
