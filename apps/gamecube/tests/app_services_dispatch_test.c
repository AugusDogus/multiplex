#include "app_services_dispatch_test_support.h"

#include <assert.h>
#include <string.h>

static AppServicesDispatchTestState *test_state;

static void dispatches_tagged_startup_data(void) {
  test_state->watch_startup_results = 0u;
  test_state->last_watch_startup =
      (MultiplexAppServicesStartupDataResultView){0};
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  const MultiplexTrpcRoomList rooms = {0};
  const MultiplexTrpcInviteeList invitees = {0};
  const MultiplexAppServicesInput present = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW,
      .payload.work_result =
          {
              .kind = MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA,
              .succeeded = true,
              .payload.startup_data =
                  {
                      .user =
                          {
                              .kind =
                                  MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT,
                              .value.id = 41u,
                          },
                      .rooms = &rooms,
                      .invitees = &invitees,
                  },
          },
  };
  assert(multiplex_app_services_dispatch(services, &present) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->watch_startup_results == 1u);
  assert(test_state->last_watch_startup.user.kind ==
         MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT);
  assert(test_state->last_watch_startup.user.value.id == 41u);
  assert(test_state->last_watch_startup.rooms == &rooms);
  assert(test_state->last_watch_startup.invitees == &invitees);

  const MultiplexAppServicesInput absent = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW,
      .payload.work_result =
          {
              .kind = MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA,
              .succeeded = true,
              .payload.startup_data =
                  {
                      .user =
                          {
                              .kind = MULTIPLEX_APP_SERVICES_STARTUP_USER_NONE,
                          },
                      .rooms = NULL,
                      .invitees = NULL,
                  },
          },
  };
  assert(multiplex_app_services_dispatch(services, &absent) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->watch_startup_results == 2u);
  assert(test_state->last_watch_startup.user.kind ==
         MULTIPLEX_APP_SERVICES_STARTUP_USER_NONE);
  assert(test_state->last_watch_startup.rooms == NULL);
  assert(test_state->last_watch_startup.invitees == NULL);

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
}

static MultiplexAppServicesInput reset_request(uint64_t now_ms) {
  return (MultiplexAppServicesInput){
      .kind = MULTIPLEX_APP_SERVICES_INPUT_AUTH_RESET_REQUESTED,
      .payload.auth_reset = {.now_ms = now_ms},
  };
}

static void reset_delete_failure_preserves_linked_runtime(void) {
  test_state->auth_delete_succeeds = false;
  test_state->auth_delete_attempts = 0u;
  test_state->auth_pairing_begins = 0u;
  test_state->watch_resets = 0u;
  test_state->details_action_queued = true;
  test_state->details_network_calls = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  services->content.catalog.available = true;
  services->content.playback = (MultiplexAppServicesPlaybackState){
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN,
      .value.view = {.rating_key = 44u, .playing = true},
  };
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available.phase.kind =
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST;
  services->scheduler.foreground = (MultiplexAppServicesForegroundScheduler){
      .kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE,
      .state.active = {.domain = MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS},
  };
  const MultiplexAppServicesAuthState auth_before = services->auth;
  const MultiplexAppServicesContentState content_before = services->content;
  const MultiplexAppServicesWatchState watch_before = services->watch;
  const MultiplexAppServicesScheduler scheduler_before = services->scheduler;
  const uint32_t next_token_before = services->next_token;

  const MultiplexAppServicesInput reset = reset_request(9000u);
  assert(multiplex_app_services_dispatch(services, &reset) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 0u);
  assert(test_state->auth_pairing_begins == 0u);
  assert(test_state->watch_resets == 0u);
  assert(test_state->details_network_calls == 0u);
  assert(test_state->details_action_queued);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE);
  assert(services->next_token != next_token_before);
  assert(memcmp(&services->auth, &auth_before, sizeof(auth_before)) == 0);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE);
  const uint32_t quiesce_token = effect.payload.storage_quiesce.token;
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
      .payload.reset_storage_quiesced = {.token = quiesce_token},
  };
  assert(multiplex_app_services_dispatch(services, &quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 1u);
  assert(test_state->auth_pairing_begins == 0u);
  assert(test_state->catalog_boots == 0u);
  assert(test_state->watch_resets == 0u);
  assert(test_state->details_action_queued);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_IDLE);
  assert(memcmp(&services->auth, &auth_before, sizeof(auth_before)) == 0);
  assert(memcmp(&services->content, &content_before, sizeof(content_before)) ==
         0);
  assert(memcmp(&services->watch, &watch_before, sizeof(watch_before)) == 0);
  assert(memcmp(&services->scheduler, &scheduler_before,
                sizeof(scheduler_before)) == 0);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  assert(multiplex_app_services_dispatch(services, &quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 1u);
  assert(test_state->watch_resets == 0u);

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
  test_state->details_action_queued = false;
}

static void reset_ignores_unlinked_auth(void) {
  test_state->auth_delete_succeeds = true;
  test_state->auth_delete_attempts = 0u;
  test_state->auth_pairing_begins = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_PAIRING;
  const MultiplexAppServicesAuthState auth_before = services->auth;

  const MultiplexAppServicesInput reset = reset_request(10000u);
  assert(multiplex_app_services_dispatch(services, &reset) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 0u);
  assert(test_state->auth_pairing_begins == 0u);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_IDLE);
  assert(memcmp(&services->auth, &auth_before, sizeof(auth_before)) == 0);
  MultiplexAppServicesEffect effect;
  assert(!multiplex_app_services_poll_effect(services, &effect));

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
}

static void reset_quiesces_cache_save_before_delete(void) {
  test_state->auth_delete_succeeds = false;
  test_state->auth_delete_attempts = 0u;
  test_state->auth_delete_observed_cache_save_idle = false;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  services->content.catalog.cache_save = (MultiplexAppServicesLoadState){
      .kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING,
      .token = 41u,
  };
  services->scheduler.foreground = (MultiplexAppServicesForegroundScheduler){
      .kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE,
      .state.active = {.domain = MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG},
  };

  const MultiplexAppServicesInput reset = reset_request(11000u);
  assert(multiplex_app_services_dispatch(services, &reset) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE);
  assert(test_state->auth_delete_attempts == 0u);

  const MultiplexAppServicesInput storage_quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
      .payload.reset_storage_quiesced =
          {.token = effect.payload.storage_quiesce.token},
  };
  assert(multiplex_app_services_dispatch(services, &storage_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 1u);
  assert(test_state->auth_delete_observed_cache_save_idle);
  assert(services->content.catalog.cache_save.kind ==
         MULTIPLEX_APP_SERVICES_LOAD_IDLE);
  assert(services->scheduler.foreground.kind ==
         MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_IDLE);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
}

static void reset_waits_for_correlated_quiesce_and_stop(void) {
  test_state->auth_delete_succeeds = true;
  test_state->auth_delete_attempts = 0u;
  test_state->auth_pairing_begins = 0u;
  test_state->auth_ticks = 0u;
  test_state->catalog_ticks = 0u;
  test_state->watch_resets = 0u;
  test_state->details_action_queued = false;
  test_state->details_network_calls = 0u;
  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);
  services->content.catalog.available = true;
  services->content.playback = (MultiplexAppServicesPlaybackState){
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN,
      .value.view = {.rating_key = 55u, .playing = true},
  };
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available.phase.kind =
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST;
  services->scheduler.foreground = (MultiplexAppServicesForegroundScheduler){
      .kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE,
      .state.active = {.domain = MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS},
  };
  const MultiplexAppServicesAuthState auth_before = services->auth;
  const MultiplexAppServicesContentState content_before = services->content;
  const MultiplexAppServicesWatchState watch_before = services->watch;
  const MultiplexAppServicesScheduler scheduler_before = services->scheduler;
  const MultiplexAppServicesInput reset = reset_request(12000u);
  assert(multiplex_app_services_dispatch(services, &reset) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 0u);
  assert(test_state->auth_pairing_begins == 0u);
  assert(test_state->watch_resets == 0u);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE);
  assert(memcmp(&services->auth, &auth_before, sizeof(auth_before)) == 0);
  assert(memcmp(&services->content, &content_before, sizeof(content_before)) ==
         0);
  assert(memcmp(&services->watch, &watch_before, sizeof(watch_before)) == 0);
  assert(memcmp(&services->scheduler, &scheduler_before,
                sizeof(scheduler_before)) == 0);

  assert(multiplex_app_services_dispatch(services, &reset) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 0u);

  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE);
  const uint32_t storage_token = effect.payload.storage_quiesce.token;
  assert(storage_token != 0u);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput stale_storage_quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
      .payload.reset_storage_quiesced = {.token = storage_token + 1u},
  };
  assert(multiplex_app_services_dispatch(services, &stale_storage_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  test_state->details_action_queued = true;
  const MultiplexAppServicesInput unrelated = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN,
              .payload.details_children = {.rating_key = 88u},
          },
  };
  assert(multiplex_app_services_dispatch(services, &unrelated) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->details_network_calls == 0u);
  assert(test_state->details_action_queued);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput storage_quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
      .payload.reset_storage_quiesced = {.token = storage_token},
  };
  assert(multiplex_app_services_dispatch(services, &storage_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_delete_attempts == 1u);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION);
  assert(effect.payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY);
  assert(!effect.payload.presentation.payload.activity.visible);
  assert(multiplex_app_services_poll_effect(services, &effect));
  app_services_dispatch_test_assert_blocking(&effect, false);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_RUNTIME_QUIESCE);
  const uint32_t runtime_token = effect.payload.runtime_quiesce.token;
  assert(runtime_token != 0u && runtime_token != storage_token);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  assert(multiplex_app_services_dispatch(services, &storage_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput stale_runtime_quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED,
      .payload.reset_runtime_quiesced = {.token = runtime_token + 1u},
  };
  assert(multiplex_app_services_dispatch(services, &stale_runtime_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind ==
         MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput runtime_quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED,
      .payload.reset_runtime_quiesced = {.token = runtime_token},
  };
  assert(multiplex_app_services_dispatch(services, &runtime_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK);
  assert(effect.payload.playback.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_STOP);
  const uint32_t stop_token = effect.payload.playback.token;
  assert(stop_token != 0u && stop_token != runtime_token);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  assert(multiplex_app_services_dispatch(services, &runtime_quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput tick = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_TICK,
      .payload.tick = {.now_ms = 13000u, .network_allowed = true},
  };
  assert(multiplex_app_services_dispatch(services, &tick) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->auth_ticks == 0u);
  assert(test_state->catalog_ticks == 0u);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput stale_stopped = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result =
          {
              .token = stop_token + 1u,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &stale_stopped) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP);
  assert(test_state->watch_resets == 0u);
  assert(test_state->auth_pairing_begins == 0u);

  const MultiplexAppServicesInput wrong_result = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result =
          {
              .token = stop_token,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &wrong_result) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_FAILED);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_FAILED);
  assert(effect.payload.failure ==
         MULTIPLEX_APP_SERVICES_FAILURE_PLAYBACK_CONTINUATION);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput stopped = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result =
          {
              .token = stop_token,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &stopped) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_IDLE);
  assert(test_state->watch_resets == 1u);
  assert(test_state->auth_pairing_begins == 1u);
  assert(services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_PAIRING);
  assert(test_state->last_pairing_now_ms == 12000u);
  assert(test_state->last_pairing_retry_delay_ms ==
         MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS);
  assert(test_state->last_pairing_location.slot ==
         auth_before.state.linked.location.slot);
  assert(test_state->last_pairing_location.generation ==
         auth_before.state.linked.location.generation);
  assert(test_state->last_pairing_location.needs_presentation ==
         auth_before.state.linked.location.needs_presentation);
  assert(services->content.catalog.available == false);
  assert(services->content.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_UNKNOWN);
  assert(services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE);
  assert(services->scheduler.foreground.kind ==
         MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE);
  assert(services->scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE);

  assert(multiplex_app_services_dispatch(services, &stopped) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->watch_resets == 1u);
  assert(test_state->auth_pairing_begins == 1u);

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
  test_state->details_action_queued = false;
}

static void
assert_quiesce_before_network(MultiplexAppServices *services,
                              const MultiplexAppServicesInput *request,
                              unsigned *network_calls, uint32_t poster_token) {
  app_services_dispatch_test_start_posters(services, poster_token);
  assert(multiplex_app_services_dispatch(services, request) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(*network_calls == 0u);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE);
  assert(effect.payload.poster_quiesce.token == poster_token);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput quiesced = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT,
      .payload.poster_result =
          {
              .token = poster_token,
              .kind = MULTIPLEX_APP_SERVICES_POSTER_QUIESCED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &quiesced) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(*network_calls == 1u);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START);
  assert(effect.payload.poster_start.token == poster_token);
  assert(!multiplex_app_services_poll_effect(services, &effect));
}

int main(void) {
  app_services_dispatch_test_reset();
  test_state = app_services_dispatch_test_state();
  dispatches_tagged_startup_data();
  reset_delete_failure_preserves_linked_runtime();
  reset_ignores_unlinked_auth();
  reset_quiesces_cache_save_before_delete();
  reset_waits_for_correlated_quiesce_and_stop();

  MultiplexAppServices *services = multiplex_app_services_create();
  assert(services != NULL);

  const MultiplexAppServicesInput browse = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_BROWSE,
              .payload.browse =
                  {
                      .section_id = 9u,
                      .start = 20u,
                      .previous_start = 10u,
                  },
          },
  };
  assert(multiplex_app_services_dispatch(services, &browse) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(test_state->browse_requests == 1u);
  assert(test_state->last_browse.section_id == 9u);
  assert(test_state->last_browse.start == 20u);

  const MultiplexAppServicesInput watch_create = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_WATCH_CREATE,
              .payload.watch_create = {.rating_key = 11u},
          },
  };
  assert_quiesce_before_network(services, &watch_create,
                                &test_state->watch_network_calls, 501u);

  const MultiplexAppServicesInput details_children = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN,
              .payload.details_children = {.rating_key = 12u, .start = 4u},
          },
  };
  assert_quiesce_before_network(services, &details_children,
                                &test_state->details_network_calls, 502u);

  const MultiplexAppServicesInput playback = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST,
      .payload.model_request =
          {
              .kind = MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK,
              .payload.playback = {.rating_key = 42u, .offset_ms = 1200u},
          },
  };
  assert(multiplex_app_services_dispatch(services, &playback) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  MultiplexAppServicesEffect effect;
  assert(multiplex_app_services_poll_effect(services, &effect));
  app_services_dispatch_test_assert_blocking(&effect, true);
  assert(multiplex_app_services_poll_effect(services, &effect));
  assert(effect.kind == MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK);
  assert(effect.payload.playback.token ==
         APP_SERVICES_DISPATCH_TEST_PLAYBACK_TOKEN);
  assert(effect.payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  const MultiplexAppServicesInput failed = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT,
      .payload.playback_result =
          {
              .token = APP_SERVICES_DISPATCH_TEST_PLAYBACK_TOKEN,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED,
          },
  };
  assert(multiplex_app_services_dispatch(services, &failed) ==
         MULTIPLEX_APP_SERVICES_DISPATCH_READY);
  assert(multiplex_app_services_poll_effect(services, &effect));
  app_services_dispatch_test_assert_blocking(&effect, false);
  assert(!multiplex_app_services_poll_effect(services, &effect));

  multiplex_app_services_destroy(&services);
  assert(services == NULL);
  return 0;
}
