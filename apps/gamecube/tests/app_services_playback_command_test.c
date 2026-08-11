#include "app_services_content_test_support.h"
#include "app_services_request_slots.h"

#include <assert.h>
#include <stdio.h>

static AppServicesContentTestState *test_state;

static void preserves_playback_command_across_stop(void) {
  MultiplexAppServices services = {0};
  services.content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
  services.content.playback.value.view = (MultiplexAppServicesPlaybackView){
      .rating_key = 100,
      .duration_ms = 60000,
      .subtitle_selection = 2,
  };
  const MultiplexAppServicesPlaybackNavigationPayload request = {
      .direction = 1,
  };
  assert(
      multiplex_app_services_playback_request_navigation(&services, &request));
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 1);
  assert(services.effects[0].kind == MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK);
  assert(services.effects[0].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_STOP);
  const uint32_t stop_token =
      services.content.playback_command.state.active.token;
  assert(services.content.playback_command.state.active.command.payload.navigate
             .source.rating_key == 100);

  app_services_content_test_reset_effects(&services);
  const MultiplexAppServicesPlaybackResult stale = {
      .token = stop_token + 1,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED,
  };
  assert(multiplex_app_services_playback_apply_result(&services, &stale));
  assert(services.effect_count == 0);
  services.content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_UNKNOWN;
  const MultiplexAppServicesPlaybackResult stopped = {
      .token = stop_token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED,
  };
  assert(multiplex_app_services_playback_apply_result(&services, &stopped));
  assert(services.effect_count == 3);
  assert(services.effects[0].kind ==
         MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION);
  assert(services.effects[0].payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY);
  assert(services.effects[0].payload.presentation.payload.activity.visible);
  assert(services.effects[1].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS);
  const uint32_t open_token =
      services.content.playback_command.state.active.token;
  assert(open_token != stop_token);

  app_services_content_test_reset_effects(&services);
  const MultiplexAppServicesPlaybackResult opened = {
      .token = open_token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED,
  };
  assert(multiplex_app_services_playback_apply_result(&services, &opened));
  assert(!services.effects[0].payload.presentation.payload.activity.visible);
  assert(services.content.playback_command.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE);
  assert(test_state->playback_commit_count == 1);
  assert(test_state->playback_fail_count == 0);
  assert(test_state->playback_finish_count == 1);
}

static void opens_playback_without_stop(void) {
  MultiplexAppServices services = {0};
  services.content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
  services.content.playback.value.view = (MultiplexAppServicesPlaybackView){
      .rating_key = 100,
      .duration_ms = 60000,
  };
  const MultiplexAppServicesPlaybackPayload request = {
      .rating_key = 100,
      .offset_ms = 12000,
  };
  assert(multiplex_app_services_playback_request(&services, &request));
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 2);
  assert(services.effects[0].payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY);
  assert(services.effects[1].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS);
  const uint32_t token = services.content.playback_command.state.active.token;
  app_services_content_test_reset_effects(&services);
  const MultiplexAppServicesPlaybackResult failed = {
      .token = token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED,
  };
  assert(multiplex_app_services_playback_apply_result(&services, &failed));
  assert(services.effect_count == 1);
  assert(!services.effects[0].payload.presentation.payload.activity.visible);
  assert(services.content.playback_command.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE);
  assert(test_state->playback_fail_count == 1);
  assert(test_state->playback_finish_count == 2);
}

static void defers_details_actions_until_scheduled(void) {
  MultiplexAppServices services = {0};
  const MultiplexAppServicesDetailsChildrenPayload children = {
      .rating_key = 400,
      .start = 3,
  };
  assert(multiplex_app_services_details_request_children(&services, &children));
  assert(test_state->children_load_count == 0);
  assert(multiplex_app_services_details_has_queued(&services));
  assert(multiplex_app_services_details_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED);
  assert(test_state->children_load_count == 1);
  assert(services.content.details_action.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_ACTION_IDLE);

  const MultiplexAppServicesMarkWatchedPayload mark = {.rating_key = 500};
  assert(multiplex_app_services_details_request_mark_watched(&services, &mark));
  assert(test_state->mark_watched_count == 0);
  assert(multiplex_app_services_details_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED);
  assert(test_state->mark_watched_count == 1);
}

static MultiplexGatewayDetails prefetch_details(uint32_t rating_key) {
  return (MultiplexGatewayDetails){
      .rating_key = rating_key,
      .duration_ms = 60000u,
      .view_offset_ms = 5000u,
  };
}

static MultiplexAppServicesFocusView details_focus(uint32_t rating_key,
                                                   uint64_t now_ms) {
  return (MultiplexAppServicesFocusView){
      .screen = MULTIPLEX_APP_SERVICES_SCREEN_DETAILS,
      .rating_key = rating_key,
      .now_ms = now_ms,
  };
}

static void retains_then_releases_prefetch_once(void) {
  MultiplexAppServices services = {0};
  const MultiplexGatewayDetails details = prefetch_details(700u);
  multiplex_app_services_details_slot_store_result(&services.content.details,
                                                   &details);
  const MultiplexAppServicesFocusView focused = details_focus(700u, 1000u);
  assert(multiplex_app_services_details_focus(&services, &focused));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED);
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS);
  const uint32_t retain_token =
      services.content.details_prefetch.state.retaining.token;

  const MultiplexAppServicesPrefetchResult stale_ready = {
      .token = retain_token + 1u,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_READY,
  };
  assert(multiplex_app_services_details_apply_prefetch_result(&services,
                                                              &stale_ready));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINING);
  assert(test_state->details_finish_count == 0u);

  const MultiplexAppServicesPrefetchResult ready = {
      .token = retain_token,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_READY,
  };
  assert(
      multiplex_app_services_details_apply_prefetch_result(&services, &ready));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINED);
  assert(test_state->details_finish_count == 1u);

  app_services_content_test_reset_effects(&services);
  const MultiplexAppServicesFocusView left = {
      .screen = MULTIPLEX_APP_SERVICES_SCREEN_HOME,
      .now_ms = 1100u,
  };
  assert(multiplex_app_services_details_focus(&services, &left));
  assert(multiplex_app_services_details_focus(&services, &left));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED);
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS);
  const uint32_t release_token =
      services.content.details_prefetch.state.releasing.token;
  assert(multiplex_app_services_details_focus(&services, &left));
  assert(services.effect_count == 1u);

  const MultiplexAppServicesPrefetchResult stale_released = {
      .token = release_token + 1u,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED,
  };
  assert(multiplex_app_services_details_apply_prefetch_result(&services,
                                                              &stale_released));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASING);
  const MultiplexAppServicesPrefetchResult released = {
      .token = release_token,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED,
  };
  assert(multiplex_app_services_details_apply_prefetch_result(&services,
                                                              &released));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE);
  assert(test_state->details_finish_count == 2u);
}

static void releases_before_retaining_replacement(void) {
  MultiplexAppServices services = {0};
  const MultiplexGatewayDetails first = prefetch_details(701u);
  multiplex_app_services_details_slot_store_result(&services.content.details,
                                                   &first);
  const MultiplexAppServicesFocusView first_focus = details_focus(701u, 1000u);
  assert(multiplex_app_services_details_focus(&services, &first_focus));
  assert(multiplex_app_services_scheduler_run(&services));
  const uint32_t first_token =
      services.content.details_prefetch.state.retaining.token;
  const MultiplexAppServicesPrefetchResult first_ready = {
      .token = first_token,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_READY,
  };
  assert(multiplex_app_services_details_apply_prefetch_result(&services,
                                                              &first_ready));

  app_services_content_test_reset_effects(&services);
  const MultiplexGatewayDetails replacement = prefetch_details(702u);
  multiplex_app_services_details_slot_store_result(&services.content.details,
                                                   &replacement);
  const MultiplexAppServicesFocusView replacement_focus =
      details_focus(702u, 1200u);
  assert(multiplex_app_services_details_focus(&services, &replacement_focus));
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS);
  const uint32_t release_token =
      services.content.details_prefetch.state.releasing.token;
  const MultiplexAppServicesPrefetchResult released = {
      .token = release_token,
      .kind = MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED,
  };
  assert(multiplex_app_services_details_apply_prefetch_result(&services,
                                                              &released));
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED);

  app_services_content_test_reset_effects(&services);
  assert(multiplex_app_services_scheduler_run(&services));
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.playback.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS);
  assert(services.effects[0].payload.playback.payload.hls_prefetch.rating_key ==
         702u);
}

static void handles_recoverable_playback_preparation_rejection(void) {
  MultiplexAppServices services = {0};
  services.content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
  services.content.playback.value.view = (MultiplexAppServicesPlaybackView){
      .rating_key = 100u,
      .duration_ms = 60000u,
  };
  const MultiplexAppServicesPlaybackPayload request = {
      .rating_key = 900u,
  };
  const unsigned failures_before = test_state->playback_fail_count;
  test_state->details_load_succeeds = false;
  assert(multiplex_app_services_playback_request(&services, &request));
  assert(multiplex_app_services_playback_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED);
  test_state->details_load_succeeds = true;
  assert(services.content.playback_command.kind ==
         MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE);
  assert(test_state->playback_fail_count == failures_before + 1u);
  assert(services.effect_count == 2u);
  assert(services.effects[0].payload.presentation.payload.activity.visible);
  assert(!services.effects[1].payload.presentation.payload.activity.visible);
}

static void resolves_subtitle_ordinals_without_details_cache(void) {
  MultiplexAppServices services = {0};
  MultiplexGatewayDetails details = {
      .rating_key = 600,
      .duration_ms = 60000,
      .subtitle_stream_count = 2,
  };
  details.subtitle_streams[0].has_index = true;
  details.subtitle_streams[0].index = 5;
  details.subtitle_streams[1].has_index = true;
  details.subtitle_streams[1].index = 9;
  multiplex_app_services_details_slot_store_result(&services.content.details,
                                                   &details);
  const MultiplexAppServicesPlaybackView new_item = {0};
  MultiplexAppServicesHlsPreparation preparation;
  assert(multiplex_app_services_playback_resolution_prepare_hls(
      &services, app_services_content_test_credentials(), 600, 2, &new_item,
      &preparation));
  assert(preparation.duration_ms == 60000);
  assert(preparation.burn_subtitles);
  assert(preparation.subtitle_stream_index == 9);

  const MultiplexGatewayDetails replacement = {.rating_key = 700};
  multiplex_app_services_details_slot_store_result(&services.content.details,
                                                   &replacement);
  const MultiplexAppServicesPlaybackView active = {
      .rating_key = 600,
      .duration_ms = 60000,
  };
  assert(multiplex_app_services_playback_resolution_prepare_hls(
      &services, app_services_content_test_credentials(), 600, 1, &active,
      &preparation));
  assert(preparation.burn_subtitles);
  assert(preparation.subtitle_stream_index == 5);
}

int main(void) {
  app_services_content_test_reset();
  test_state = app_services_content_test_state();
  preserves_playback_command_across_stop();
  opens_playback_without_stop();
  defers_details_actions_until_scheduled();
  resolves_subtitle_ordinals_without_details_cache();
  retains_then_releases_prefetch_once();
  releases_before_retaining_replacement();
  handles_recoverable_playback_preparation_rejection();
  puts("GameCube AppServices playback-command tests passed.");
  return 0;
}
