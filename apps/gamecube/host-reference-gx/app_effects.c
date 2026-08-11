#include "app_internal.h"

#include "media-source.h"
#include "native_ui.h"

#include <gccore.h>

#include <stdint.h>
#include <stdio.h>

MultiplexAppServicesPlaybackView
multiplex_app_playback_view(MultiplexApp *app) {
  app->playback_snapshot =
      multiplex_playback_session_snapshot(app->playback_session);
  return (MultiplexAppServicesPlaybackView){
      .playing = multiplex_presentation_status(app->presentation).video_playing,
      .rating_key = app->playback_snapshot.rating_key,
      .position_ms = app->playback_snapshot.position_ms,
      .duration_ms = app->playback_snapshot.duration_ms,
      .segment_start_ms = app->playback_snapshot.segment_start_ms,
      .burn_subtitles = app->playback_snapshot.burn_subtitles,
      .subtitle_stream_index = app->playback_snapshot.subtitle_stream_index,
      .subtitle_selection = multiplex_native_app_subtitle_selection(),
      .prefetch_active = app->playback_snapshot.prefetch_active,
  };
}

bool multiplex_app_dispatch_services(MultiplexApp *app,
                                     const MultiplexAppServicesInput *input) {
  const MultiplexAppServicesDispatchResult result =
      multiplex_app_services_dispatch(app->services, input);
  if (result == MULTIPLEX_APP_SERVICES_DISPATCH_READY) {
    return true;
  }
  SYS_Report("REFERENCE GX: app services dispatch failed result=%u input=%u\n",
             (unsigned)result, (unsigned)input->kind);
  return false;
}

static bool apply_presentation_effect(
    MultiplexApp *app, const MultiplexAppServicesPresentationEffect *effect) {
  switch (effect->kind) {
  case MULTIPLEX_APP_SERVICES_PRESENTATION_REFRESH:
    multiplex_presentation_request_refresh(
        app->presentation, effect->payload.refresh.asynchronous);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY:
    multiplex_presentation_set_network_activity(
        app->presentation, effect->payload.activity.visible);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY:
    multiplex_presentation_set_blocking_activity(
        app->presentation, effect->payload.activity.visible);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_BROWSE_MOTION:
    multiplex_presentation_queue_browse_motion(
        app->presentation, effect->payload.browse_motion.before,
        effect->payload.browse_motion.after);
    return true;
  case MULTIPLEX_APP_SERVICES_PRESENTATION_CONTROLS_ACTIVE: {
    const MultiplexPresentationControlsInput input = {
        .now_ms = effect->payload.controls_active.now_ms,
        .active_input = true,
    };
    multiplex_presentation_controls_update(app->presentation, &input);
    return true;
  }
  }
  return false;
}

static uint32_t
playback_start_offset(MultiplexApp *app,
                      const MultiplexAppServicesPlaybackEffect *effect,
                      uint32_t requested_offset) {
  if (!app->playback_start_offset_pending ||
      (effect->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY &&
       effect->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS)) {
    return requested_offset;
  }
  app->playback_start_offset_pending = false;
  SYS_Report("REFERENCE GX: playback start override offset=%u\n",
             MULTIPLEX_PLAYBACK_START_OFFSET_MS);
  return effect->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS &&
                 MULTIPLEX_PLAYBACK_START_OFFSET_MS >=
                     effect->payload.hls_open.duration_ms
             ? 0
             : MULTIPLEX_PLAYBACK_START_OFFSET_MS;
}

static bool present_blocking_playback_frame(MultiplexApp *app,
                                            bool *render_failed) {
  if (multiplex_app_present_frame(app,
                                  MULTIPLEX_PRESENTATION_PREPARE_DEFERRED) !=
      MULTIPLEX_PRESENTATION_FRAME_FAILED) {
    return true;
  }
  *render_failed = true;
  return false;
}

static bool
apply_playback_effect(MultiplexApp *app,
                      const MultiplexAppServicesPlaybackEffect *effect,
                      bool *render_failed) {
  MultiplexAppServicesPlaybackResult result = {
      .token = effect->token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED,
  };
  switch (effect->kind) {
  case MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY: {
    if (!present_blocking_playback_frame(app, render_failed)) {
      break;
    }
    const MultiplexPlaybackGatewayOpenRequest request = {
        .rating_key = effect->payload.gateway.rating_key,
        .offset_ms = playback_start_offset(app, effect,
                                           effect->payload.gateway.offset_ms),
    };
    MultiplexPlaybackGatewayOpenRequest copied = request;
    snprintf(copied.gateway_url, sizeof(copied.gateway_url), "%s",
             effect->payload.gateway.gateway_url);
    result.kind = multiplex_playback_session_open_gateway(app->playback_session,
                                                          &copied) ==
                          MULTIPLEX_PLAYBACK_OPEN_READY
                      ? MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED
                      : MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED;
    break;
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS: {
    if (!present_blocking_playback_frame(app, render_failed)) {
      break;
    }
#if MULTIPLEX_PAIRING_ENABLED
    const MultiplexPlaybackHlsOpenRequest request = {
        .credentials = effect->payload.hls_open.credentials,
        .rating_key = effect->payload.hls_open.rating_key,
        .offset_ms = playback_start_offset(app, effect,
                                           effect->payload.hls_open.offset_ms),
        .duration_ms = effect->payload.hls_open.duration_ms,
        .resume_current_session =
            effect->payload.hls_open.resume_current_session,
        .burn_subtitles = effect->payload.hls_open.burn_subtitles,
        .subtitle_stream_index = effect->payload.hls_open.subtitle_stream_index,
    };
    result.kind =
        multiplex_playback_session_open_hls(app->playback_session, &request) ==
                MULTIPLEX_PLAYBACK_OPEN_READY
            ? MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED
            : MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED;
#endif
    break;
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS:
  case MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS:
    return false;
  case MULTIPLEX_APP_SERVICES_PLAYBACK_STOP:
    multiplex_playback_session_stop(app->playback_session);
    result.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED;
    break;
  }
  result.playback = multiplex_app_playback_view(app);
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result = result,
  };
  return multiplex_app_dispatch_services(app, &input);
}

MultiplexAppEffectDrainResult multiplex_app_drain_effects(MultiplexApp *app) {
  MultiplexAppServicesEffect effect;
  MultiplexAppEffectDrainResult result = {
      .failure = MULTIPLEX_APP_FAILURE_NONE,
      .ready = true,
  };
  while (multiplex_app_services_poll_effect(app->services, &effect)) {
    switch (effect.kind) {
    case MULTIPLEX_APP_SERVICES_EFFECT_WORK_REQUEST:
      if (!multiplex_app_jobs_start_work(app->jobs, &effect.payload.work)) {
        result.failure = MULTIPLEX_APP_FAILURE_BACKGROUND_BIND;
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START:
      if (!multiplex_app_jobs_start_posters(app->jobs,
                                            &effect.payload.poster_start)) {
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE:
      if (!multiplex_app_jobs_quiesce_posters(
              app->jobs, effect.payload.poster_quiesce.token)) {
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE:
      if (!multiplex_app_jobs_quiesce_storage(
              app->jobs, effect.payload.storage_quiesce.token)) {
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_RUNTIME_QUIESCE:
      if (!multiplex_app_jobs_quiesce_runtime(
              app->jobs, effect.payload.runtime_quiesce.token)) {
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK: {
      bool render_failed = false;
      bool applied = false;
      if (effect.payload.playback.kind ==
          MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS) {
        applied = multiplex_app_jobs_retain_prefetch(
            app->jobs, effect.payload.playback.token,
            &effect.payload.playback.payload.hls_prefetch);
      } else if (effect.payload.playback.kind ==
                 MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS) {
        applied = multiplex_app_jobs_release_prefetch(
            app->jobs, effect.payload.playback.token);
      } else {
        applied = apply_playback_effect(app, &effect.payload.playback,
                                        &render_failed);
      }
      if (!applied) {
        result.failure = MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION;
        result.ready = false;
      }
      if (render_failed) {
        result.failure = MULTIPLEX_APP_FAILURE_UI_RENDER;
        result.ready = false;
      }
      break;
    }
    case MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION:
      if (!apply_presentation_effect(app, &effect.payload.presentation)) {
        result.failure = MULTIPLEX_APP_FAILURE_UI_BIND;
        result.ready = false;
      }
      break;
    case MULTIPLEX_APP_SERVICES_EFFECT_FAILED:
      switch (effect.payload.failure) {
      case MULTIPLEX_APP_SERVICES_FAILURE_UI_BIND:
        result.failure = MULTIPLEX_APP_FAILURE_UI_BIND;
        break;
      case MULTIPLEX_APP_SERVICES_FAILURE_BACKGROUND_BIND:
        result.failure = MULTIPLEX_APP_FAILURE_BACKGROUND_BIND;
        break;
      case MULTIPLEX_APP_SERVICES_FAILURE_PLAYBACK_CONTINUATION:
        result.failure = MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION;
        break;
      }
      result.ready = false;
    }
  }
  return result;
}

static bool dispatch_model(MultiplexApp *app,
                           const MultiplexAppServicesModelRequest *request) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request = *request,
  };
  return multiplex_app_dispatch_services(app, &input);
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

MultiplexAppFailure
multiplex_app_collect_model_requests(MultiplexApp *app, uint64_t now_ms,
                                     const MultiplexAppInputFrame *input) {
  uint32_t section_id = 0;
  uint32_t start = 0;
  if (multiplex_native_app_browse_request(&section_id, &start) != 0) {
    if (section_id > UINT16_MAX || start > UINT16_MAX ||
        !dispatch_model(
            app,
            &(MultiplexAppServicesModelRequest){
                .kind = MULTIPLEX_APP_SERVICES_MODEL_BROWSE,
                .payload.browse =
                    {
                        .section_id = (uint16_t)section_id,
                        .start = (uint16_t)start,
                        .previous_start =
                            (uint16_t)multiplex_native_app_browse_view_start(),
                    },
            })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
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
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
    search.payload.search.query[query_length] = '\0';
    search.payload.search.query_length = (uint16_t)query_length;
    if (!dispatch_model(app, &search)) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }

  const uint32_t details_key = multiplex_native_app_details_request();
  if (details_key != 0) {
    if (!dispatch_model(app, &(MultiplexAppServicesModelRequest){
                                 .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS,
                                 .payload.details = {.rating_key = details_key},
                             })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }

  uint32_t children_key = 0;
  uint32_t children_start = 0;
  if (multiplex_native_app_details_children_request(&children_key,
                                                    &children_start) != 0) {
    if (children_start > UINT16_MAX) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
    if (!dispatch_model(
            app, &(MultiplexAppServicesModelRequest){
                     .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN,
                     .payload.details_children =
                         {
                             .rating_key = children_key,
                             .start = (uint16_t)children_start,
                         },
                 })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }

  const uint32_t playback_key = multiplex_native_app_playback_request();
  if (playback_key != 0) {
    if (!dispatch_model(
            app, &(MultiplexAppServicesModelRequest){
                     .kind = MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK,
                     .payload.playback =
                         {
                             .rating_key = playback_key,
                             .offset_ms =
                                 multiplex_native_app_playback_offset_request(),
                         },
                 })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }

  const int32_t playback_direction =
      multiplex_native_app_playback_navigation_request();
  if (playback_direction != 0) {
    if (!dispatch_model(
            app, &(MultiplexAppServicesModelRequest){
                     .kind = MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK_NAVIGATION,
                     .payload.playback_navigation = {.direction =
                                                         playback_direction},
                 })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }

  const uint32_t watched_key = multiplex_native_app_mark_watched_request();
  if (watched_key != 0) {
    if (!dispatch_model(app,
                        &(MultiplexAppServicesModelRequest){
                            .kind = MULTIPLEX_APP_SERVICES_MODEL_MARK_WATCHED,
                            .payload.mark_watched = {.rating_key = watched_key},
                        })) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
    app->toast_dismiss_at_ms = now_ms + 2500u;
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
       !dispatch_model(app, &create))) {
    return MULTIPLEX_APP_FAILURE_UI_BIND;
  }

  const uint32_t join = multiplex_native_app_watch_together_join_request();
  if (join != 0 &&
      !dispatch_model(app, &(MultiplexAppServicesModelRequest){
                               .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_JOIN,
                               .payload.watch_join = {.room_index = join - 1u},
                           })) {
    return MULTIPLEX_APP_FAILURE_UI_BIND;
  }

  const bool disband =
      multiplex_native_app_watch_together_disband_request() != 0;
  const bool leave = multiplex_native_app_watch_together_leave_request() != 0;
  if ((disband || leave) &&
      !dispatch_model(app, &(MultiplexAppServicesModelRequest){
                               .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_EXIT,
                               .payload.watch_exit = {.disband = disband},
                           })) {
    return MULTIPLEX_APP_FAILURE_UI_BIND;
  }
  if (input->screen == MULTIPLEX_SCREEN_WATCH_TOGETHER_ROOM &&
      (input->pressed & PAD_BUTTON_B) != 0 &&
      !dispatch_model(
          app, &(MultiplexAppServicesModelRequest){
                   .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_LOBBY_LEAVE,
               })) {
    return MULTIPLEX_APP_FAILURE_UI_BIND;
  }
  if (multiplex_native_app_watch_together_reconnect_request() != 0 &&
      !dispatch_model(app,
                      &(MultiplexAppServicesModelRequest){
                          .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_RECONNECT,
                          .payload.watch_reconnect = {.now_ms = now_ms},
                      })) {
    return MULTIPLEX_APP_FAILURE_UI_BIND;
  }

  const MultiplexPresentationStatus status =
      multiplex_presentation_status(app->presentation);
  return dispatch_model(app,
                        &(MultiplexAppServicesModelRequest){
                            .kind = MULTIPLEX_APP_SERVICES_MODEL_FOCUS,
                            .payload.focus =
                                {
                                    .screen = app_services_screen(
                                        multiplex_native_app_screen()),
                                    .rating_key = status.focused_rating_key,
                                    .now_ms = now_ms,
                                    .active_input = input->active,
                                },
                        })
             ? MULTIPLEX_APP_FAILURE_NONE
             : MULTIPLEX_APP_FAILURE_UI_BIND;
}

bool multiplex_app_dispatch_local_playback(MultiplexApp *app, uint64_t now_ms) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT,
      .payload.playback_event =
          {
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE,
              .now_ms = now_ms,
              .playback = multiplex_app_playback_view(app),
          },
  };
  return multiplex_app_dispatch_services(app, &input);
}

void multiplex_app_stop_playback_if_hidden(MultiplexApp *app) {
  const MultiplexAppServicesPlaybackView current =
      multiplex_app_playback_view(app);
  if (current.rating_key != 0 && (multiplex_native_app_playback_state() &
                                  MULTIPLEX_APP_PLAYBACK_STATE_PLAYER) == 0) {
    multiplex_playback_session_stop(app->playback_session);
    SYS_Report("REFERENCE GX: playback stopped while player hidden key=%u "
               "position=%u\n",
               current.rating_key, current.position_ms);
  }
}

void multiplex_app_pause_audio_for_player_input(MultiplexApp *app,
                                                uint32_t pressed) {
  if ((pressed &
       (PAD_BUTTON_A | PAD_BUTTON_B | PAD_TRIGGER_L | PAD_TRIGGER_R)) != 0 &&
      multiplex_presentation_status(app->presentation).video_visible) {
    app->playback_snapshot =
        multiplex_playback_session_snapshot(app->playback_session);
    multiplex_native_app_playback_position(app->playback_snapshot.position_ms);
    multiplex_playback_session_pause(app->playback_session);
    SYS_Report("REFERENCE GX: timeline synced for input position=%u\n",
               app->playback_snapshot.position_ms);
  }
}

MultiplexAppFailure multiplex_app_handle_playback_events(MultiplexApp *app,
                                                         uint64_t now_ms) {
  MultiplexPlaybackEvent event;
  while (multiplex_playback_session_poll_event(app->playback_session, &event)) {
    switch (event.kind) {
    case MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED:
      return MULTIPLEX_APP_FAILURE_MEDIA_PRODUCER;
    case MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED:
      return MULTIPLEX_APP_FAILURE_MEDIA_RECOVERY;
    case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_CONTINUE:
      if (multiplex_native_app_playback_continue(event.next_offset_ms) == 0 ||
          multiplex_playback_session_continue_program(app->playback_session) !=
              MULTIPLEX_PLAYBACK_OPEN_READY ||
          multiplex_native_app_playback_commit() == 0) {
        return MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION;
      }
      multiplex_presentation_request_refresh(app->presentation, false);
      break;
    case MULTIPLEX_PLAYBACK_EVENT_PROGRAM_COMPLETE:
      if (multiplex_native_app_playback_position(event.duration_ms) == 0 ||
          multiplex_native_app_playback_complete() == 0) {
        return MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION;
      }
      multiplex_presentation_request_refresh(app->presentation, false);
      break;
    case MULTIPLEX_PLAYBACK_EVENT_HLS_COMPLETE: {
      const MultiplexAppServicesInput input = {
          .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT,
          .payload.playback_event =
              {
                  .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE,
                  .now_ms = now_ms,
                  .playback = multiplex_app_playback_view(app),
              },
      };
      if (!multiplex_app_dispatch_services(app, &input)) {
        return MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION;
      }
      break;
    }
    case MULTIPLEX_PLAYBACK_EVENT_NONE:
      break;
    }
  }
  return MULTIPLEX_APP_FAILURE_NONE;
}
