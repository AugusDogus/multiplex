#include "playback_program_policy.h"

#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

static PlaybackTimelineRoute gateway_route(void) {
  PlaybackTimelineRoute route = {.kind = PLAYBACK_TIMELINE_ROUTE_GATEWAY};
  memcpy(route.value.gateway_url, "http://gateway.test",
         sizeof("http://gateway.test"));
  return route;
}

static MultiplexGatewayPlaybackManifest
manifest(uint32_t start_ms, uint32_t segment_ms, uint32_t duration_ms) {
  return (MultiplexGatewayPlaybackManifest){
      .rating_key = 93,
      .media_duration_ms = duration_ms,
      .segment_start_ms = start_ms,
      .segment_duration_ms = segment_ms,
  };
}

static PlaybackProgramDecision
decide(const PlaybackTimelineRoute *route,
       const MultiplexGatewayPlaybackManifest *playback_manifest,
       uint32_t position_ms) {
  return playback_program_decide((PlaybackProgramDecisionInput){
      .route = route,
      .manifest = playback_manifest,
      .video_playing = true,
      .audio_ready = true,
      .position_ms = position_ms,
      .handoff_margin_ms = 64,
  });
}

static void ignores_program_sources_without_gateway_manifest(void) {
  const PlaybackTimelineRoute embedded_or_http = {0};
  const MultiplexGatewayPlaybackManifest empty = {0};
  const MultiplexGatewayPlaybackManifest valid = manifest(0, 30000, 120000);
  assert(decide(&embedded_or_http, &valid, 30000).kind ==
         PLAYBACK_PROGRAM_DECISION_NONE);
  const PlaybackTimelineRoute gateway = gateway_route();
  assert(decide(&gateway, &empty, 30000).kind ==
         PLAYBACK_PROGRAM_DECISION_NONE);
}

static void waits_until_the_handoff_margin(void) {
  const PlaybackTimelineRoute gateway = gateway_route();
  const MultiplexGatewayPlaybackManifest current = manifest(0, 30000, 120000);
  assert(decide(&gateway, &current, 29935).kind ==
         PLAYBACK_PROGRAM_DECISION_NONE);
}

static void requires_ready_playback(void) {
  const PlaybackTimelineRoute gateway = gateway_route();
  const MultiplexGatewayPlaybackManifest current = manifest(0, 30000, 120000);
  PlaybackProgramDecisionInput input = {
      .route = &gateway,
      .manifest = &current,
      .video_playing = false,
      .audio_ready = true,
      .position_ms = 30000,
      .handoff_margin_ms = 64,
  };
  assert(playback_program_decide(input).kind == PLAYBACK_PROGRAM_DECISION_NONE);
  input.video_playing = true;
  input.audio_ready = false;
  assert(playback_program_decide(input).kind == PLAYBACK_PROGRAM_DECISION_NONE);
}

static void continues_at_the_next_segment(void) {
  const PlaybackTimelineRoute gateway = gateway_route();
  const MultiplexGatewayPlaybackManifest current =
      manifest(30000, 30000, 120000);
  const PlaybackProgramDecision decision = decide(&gateway, &current, 59936);
  assert(decision.kind == PLAYBACK_PROGRAM_DECISION_CONTINUE);
  assert(decision.next_offset_ms == 60000);
}

static void completes_at_the_media_bound(void) {
  const PlaybackTimelineRoute gateway = gateway_route();
  const MultiplexGatewayPlaybackManifest current =
      manifest(90000, 30000, 120000);
  const PlaybackProgramDecision decision = decide(&gateway, &current, 119936);
  assert(decision.kind == PLAYBACK_PROGRAM_DECISION_COMPLETE);
  assert(decision.next_offset_ms == 120000);
}

static void clamps_overflow_and_partial_final_segments(void) {
  const PlaybackTimelineRoute gateway = gateway_route();
  const MultiplexGatewayPlaybackManifest partial_final =
      manifest(110000, 30000, 120000);
  const PlaybackProgramDecision partial_final_decision =
      decide(&gateway, &partial_final, 119936);
  assert(partial_final_decision.kind == PLAYBACK_PROGRAM_DECISION_COMPLETE);
  assert(partial_final_decision.next_offset_ms == 120000);

  const MultiplexGatewayPlaybackManifest overflow =
      manifest(UINT32_MAX - 20u, 100u, UINT32_MAX);
  const PlaybackProgramDecision decision =
      decide(&gateway, &overflow, UINT32_MAX - 64u);
  assert(decision.kind == PLAYBACK_PROGRAM_DECISION_COMPLETE);
  assert(decision.next_offset_ms == UINT32_MAX);

  const MultiplexGatewayPlaybackManifest out_of_bounds =
      manifest(120000, 1, 120000);
  assert(decide(&gateway, &out_of_bounds, 120000).kind ==
         PLAYBACK_PROGRAM_DECISION_NONE);
}

int main(void) {
  ignores_program_sources_without_gateway_manifest();
  waits_until_the_handoff_margin();
  requires_ready_playback();
  continues_at_the_next_segment();
  completes_at_the_media_bound();
  clamps_overflow_and_partial_final_segments();
  puts("GameCube playback program policy tests passed.");
  return 0;
}
