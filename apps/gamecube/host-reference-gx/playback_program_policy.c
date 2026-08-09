#include "playback_program_policy.h"

PlaybackProgramDecision
playback_program_decide(PlaybackProgramDecisionInput input) {
  const PlaybackProgramDecision none = {0};
  if (input.route == NULL || input.manifest == NULL || !input.video_playing ||
      !input.audio_ready ||
      input.route->kind != PLAYBACK_TIMELINE_ROUTE_GATEWAY ||
      input.route->value.gateway_url[0] == '\0' ||
      input.manifest->rating_key == 0 ||
      input.manifest->media_duration_ms == 0 ||
      input.manifest->segment_duration_ms == 0 ||
      input.manifest->segment_start_ms >= input.manifest->media_duration_ms) {
    return none;
  }

  const uint64_t segment_end = (uint64_t)input.manifest->segment_start_ms +
                               input.manifest->segment_duration_ms;
  const uint32_t next_offset_ms =
      segment_end >= input.manifest->media_duration_ms
          ? input.manifest->media_duration_ms
          : (uint32_t)segment_end;
  if ((uint64_t)input.position_ms + input.handoff_margin_ms < next_offset_ms) {
    return none;
  }
  return (PlaybackProgramDecision){
      .kind = segment_end >= input.manifest->media_duration_ms
                  ? PLAYBACK_PROGRAM_DECISION_COMPLETE
                  : PLAYBACK_PROGRAM_DECISION_CONTINUE,
      .next_offset_ms = next_offset_ms,
  };
}
