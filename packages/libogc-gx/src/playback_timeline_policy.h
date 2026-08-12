#ifndef MULTIPLEX_PLAYBACK_TIMELINE_POLICY_H
#define MULTIPLEX_PLAYBACK_TIMELINE_POLICY_H

#include <stdbool.h>
#include <stdint.h>

#define PLAYBACK_TIMELINE_INTERVAL_MS 10000u

typedef enum {
  PLAYBACK_TIMELINE_STATE_STOPPED = 0,
  PLAYBACK_TIMELINE_STATE_PAUSED = 1,
  PLAYBACK_TIMELINE_STATE_PLAYING = 2,
} PlaybackTimelineState;

typedef enum {
  PLAYBACK_TIMELINE_DUE_NONE = 0,
  PLAYBACK_TIMELINE_DUE_INITIAL = 1,
  PLAYBACK_TIMELINE_DUE_ITEM_CHANGE = 2,
  PLAYBACK_TIMELINE_DUE_STATE_CHANGE = 3,
  PLAYBACK_TIMELINE_DUE_BACKWARD_SEEK = 4,
  PLAYBACK_TIMELINE_DUE_INTERVAL = 5,
  PLAYBACK_TIMELINE_DUE_FINAL_FORCE = 6,
} PlaybackTimelineDue;

typedef enum {
  PLAYBACK_TIMELINE_HLS_NONE = 0,
  PLAYBACK_TIMELINE_HLS_REPORT_NOW = 1,
  PLAYBACK_TIMELINE_HLS_QUEUE = 2,
} PlaybackTimelineHlsAction;

typedef struct {
  bool has_report;
  uint32_t rating_key;
  uint32_t position_ms;
  PlaybackTimelineState state;
} PlaybackTimelineCursor;

PlaybackTimelineDue playback_timeline_due(const PlaybackTimelineCursor *cursor,
                                          uint32_t rating_key,
                                          uint32_t position_ms,
                                          PlaybackTimelineState state,
                                          bool final_force);
PlaybackTimelineHlsAction playback_timeline_hls_action(PlaybackTimelineDue due);

#endif
