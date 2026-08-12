#ifndef MULTIPLEX_PLAYBACK_PROGRAM_POLICY_H
#define MULTIPLEX_PLAYBACK_PROGRAM_POLICY_H

#include "gateway_client.h"
#include "playback_timeline.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  PLAYBACK_PROGRAM_DECISION_NONE = 0,
  PLAYBACK_PROGRAM_DECISION_CONTINUE = 1,
  PLAYBACK_PROGRAM_DECISION_COMPLETE = 2,
} PlaybackProgramDecisionKind;

typedef struct {
  const PlaybackTimelineRoute *route;
  const MultiplexGatewayPlaybackManifest *manifest;
  bool video_playing;
  bool audio_ready;
  uint32_t position_ms;
  uint32_t handoff_margin_ms;
} PlaybackProgramDecisionInput;

typedef struct {
  PlaybackProgramDecisionKind kind;
  uint32_t next_offset_ms;
} PlaybackProgramDecision;

PlaybackProgramDecision
playback_program_decide(PlaybackProgramDecisionInput input);

#endif
