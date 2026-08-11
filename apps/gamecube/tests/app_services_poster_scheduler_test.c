#include "app_services_dispatch_test_support.h"

#include <assert.h>

static MultiplexAppServicesPosterPlan poster_plan(uint32_t token,
                                                  uint16_t texture_offset) {
  return (MultiplexAppServicesPosterPlan){
      .token = token,
      .source = MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG,
      .texture_offset = texture_offset,
      .item_count = 3u,
  };
}

static void
start_running_poster_plan(MultiplexAppServices *services,
                          const MultiplexAppServicesPosterPlan *plan) {
  app_services_dispatch_test_set_focus(services,
                                       MULTIPLEX_APP_SERVICES_SCREEN_HOME);
  services->scheduler.posters = (MultiplexAppServicesPosterSlot){
      .kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING,
      .state.running =
          {
              .plan = *plan,
              .latest = {.kind = MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE},
          },
  };
}

static void assert_poster_plan(const MultiplexAppServicesPosterPlan *actual,
                               const MultiplexAppServicesPosterPlan *expected) {
  assert(actual->token == expected->token);
  assert(actual->source == expected->source);
  assert(actual->texture_offset == expected->texture_offset);
  assert(actual->item_count == expected->item_count);
}

static void queue_held_details_foreground(MultiplexAppServices *services) {
  const MultiplexAppServicesInput request = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN,
              .payload.details_children = {.rating_key = 12u, .start = 4u},
          },
  };
  assert(multiplex_app_services_dispatch(services, &request) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
}

static void apply_quiesced(MultiplexAppServices *services, uint32_t token) {
  const MultiplexAppServicesInput result = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT,
      .payload.poster_result =
          {
              .token = token,
              .kind = MULTIPLEX_APP_SERVICES_POSTER_QUIESCED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &result) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
}

static void finish_details_and_assert_poster_restart(
    MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *expected) {
  MultiplexAppServicesEffect effect;
  assert(!multiplex_app_services_poll_effect(services, &effect));
  assert(services->scheduler.foreground.kind ==
         MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE);
  assert(services->scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED);
  assert_poster_plan(&services->scheduler.posters.state.queued.plan, expected);

  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS);
  assert(!multiplex_app_services_poll_effect(services, &effect));
  assert(multiplex_app_services_scheduler_run(services));
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START);
  assert_poster_plan(&effect.payload.poster_start, expected);
  assert(!multiplex_app_services_poll_effect(services, &effect));
}

static void retains_quiesced_plan_until_foreground_finishes(void) {
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  state->details_action_queued = false;
  state->details_schedule_starts = true;
  state->details_network_calls = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  const MultiplexAppServicesPosterPlan active = poster_plan(601u, 4u);
  start_running_poster_plan(services, &active);

  queue_held_details_foreground(services);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE);
  assert(effect.payload.poster_quiesce.token == active.token);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  apply_quiesced(services, active.token);
  assert(state->details_network_calls == 1u);
  finish_details_and_assert_poster_restart(services, &active);

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
  state->details_schedule_starts = false;
  state->details_network_calls = 0u;
}

static void holds_posters_until_prefetch_ready(void) {
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  state->details_action_queued = false;
  state->details_prefetch_queued = false;
  state->details_prefetch_token = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  const MultiplexAppServicesPosterPlan queued = poster_plan(604u, 16u);
  services->scheduler.posters = (MultiplexAppServicesPosterSlot){
      .kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED,
      .state.queued.plan = queued,
  };
  const MultiplexAppServicesInput focus = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_FOCUS,
              .payload.focus =
                  {
                      .screen = MULTIPLEX_APP_SERVICES_SCREEN_DETAILS,
                      .rating_key = 88u,
                  },
          },
  };
  assert(multiplex_app_services_dispatch(services, &focus) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->scheduler.foreground.kind ==
         MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE);
  assert(services->scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED);
  MultiplexAppServicesEffect effect;
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput stale = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT,
      .payload.prefetch_result =
          {
              .token = state->details_prefetch_token + 1u,
              .kind = MULTIPLEX_APP_SERVICES_PREFETCH_READY,
          },
  };
  assert(multiplex_app_services_dispatch(services, &stale) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(!multiplex_app_services_poll_effect(services, &effect));
  assert(services->scheduler.foreground.kind ==
         MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE);

  const MultiplexAppServicesInput ready = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT,
      .payload.prefetch_result =
          {
              .token = state->details_prefetch_token,
              .kind = MULTIPLEX_APP_SERVICES_PREFETCH_READY,
          },
  };
  assert(multiplex_app_services_dispatch(services, &ready) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(!multiplex_app_services_poll_effect(services, &effect));
  assert(services->scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED);

  const MultiplexAppServicesInput home = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_FOCUS,
              .payload.focus = {.screen = MULTIPLEX_APP_SERVICES_SCREEN_HOME},
          },
  };
  assert(multiplex_app_services_dispatch(services, &home) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START);
  assert_poster_plan(&effect.payload.poster_start, &queued);
  assert(!multiplex_app_services_poll_effect(services, &effect));
  multiplex_app_services_destroy(&services);
}

static void prefers_latest_plan_after_quiesce(void) {
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  state->details_action_queued = false;
  state->details_schedule_starts = true;
  state->details_network_calls = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  const MultiplexAppServicesPosterPlan active = poster_plan(602u, 8u);
  const MultiplexAppServicesPosterPlan latest = poster_plan(603u, 12u);
  start_running_poster_plan(services, &active);
  assert(multiplex_app_services_scheduler_start_posters(services, &latest));

  queue_held_details_foreground(services);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE);
  assert(effect.payload.poster_quiesce.token == active.token);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  apply_quiesced(services, active.token);
  assert(state->details_network_calls == 1u);
  finish_details_and_assert_poster_restart(services, &latest);

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
  state->details_schedule_starts = false;
  state->details_network_calls = 0u;
}

static void hls_open_holds_posters_until_playback_stops(void) {
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  app_services_dispatch_test_set_focus(services,
                                       MULTIPLEX_APP_SERVICES_SCREEN_HOME);
  const MultiplexAppServicesPosterPlan queued = poster_plan(605u, 20u);
  services->scheduler.posters = (MultiplexAppServicesPosterSlot){
      .kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED,
      .state.queued.plan = queued,
  };

  const MultiplexAppServicesInput opened = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result =
          {
              .token = 808u,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED,
              .playback = {.rating_key = 91u, .playing = true},
          },
  };
  assert(multiplex_app_services_dispatch(services, &opened) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  MultiplexAppServicesEffect effect;
  assert(!multiplex_app_services_poll_effect(services, &effect));
  assert(services->scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED);

  const MultiplexAppServicesInput stopped = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT,
      .payload.playback_event =
          {
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE,
              .playback = {0},
          },
  };
  assert(multiplex_app_services_dispatch(services, &stopped) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START);
  assert_poster_plan(&effect.payload.poster_start, &queued);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  multiplex_app_services_destroy(&services);
}

int main(void) {
  app_services_dispatch_test_reset();
  retains_quiesced_plan_until_foreground_finishes();
  holds_posters_until_prefetch_ready();
  prefers_latest_plan_after_quiesce();
  hls_open_holds_posters_until_playback_stops();
  return 0;
}
