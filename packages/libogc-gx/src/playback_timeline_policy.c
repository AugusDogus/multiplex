#include "playback_timeline_policy.h"

#include <stddef.h>

PlaybackTimelineDue playback_timeline_due(const PlaybackTimelineCursor *cursor,
                                          uint32_t rating_key,
                                          uint32_t position_ms,
                                          PlaybackTimelineState state,
                                          bool final_force) {
  if (final_force) {
    return PLAYBACK_TIMELINE_DUE_FINAL_FORCE;
  }
  if (cursor == NULL || !cursor->has_report) {
    return PLAYBACK_TIMELINE_DUE_INITIAL;
  }
  if (cursor->rating_key != rating_key) {
    return PLAYBACK_TIMELINE_DUE_ITEM_CHANGE;
  }
  if (cursor->state != state) {
    return PLAYBACK_TIMELINE_DUE_STATE_CHANGE;
  }
  if (position_ms < cursor->position_ms) {
    return PLAYBACK_TIMELINE_DUE_BACKWARD_SEEK;
  }
  if (state == PLAYBACK_TIMELINE_STATE_PLAYING &&
      position_ms - cursor->position_ms >= PLAYBACK_TIMELINE_INTERVAL_MS) {
    return PLAYBACK_TIMELINE_DUE_INTERVAL;
  }
  return PLAYBACK_TIMELINE_DUE_NONE;
}

PlaybackTimelineHlsAction
playback_timeline_hls_action(PlaybackTimelineDue due) {
  switch (due) {
  case PLAYBACK_TIMELINE_DUE_NONE:
  case PLAYBACK_TIMELINE_DUE_FINAL_FORCE:
    return PLAYBACK_TIMELINE_HLS_NONE;
  case PLAYBACK_TIMELINE_DUE_INITIAL:
  case PLAYBACK_TIMELINE_DUE_ITEM_CHANGE:
  case PLAYBACK_TIMELINE_DUE_STATE_CHANGE:
  case PLAYBACK_TIMELINE_DUE_BACKWARD_SEEK:
    return PLAYBACK_TIMELINE_HLS_REPORT_NOW;
  case PLAYBACK_TIMELINE_DUE_INTERVAL:
    return PLAYBACK_TIMELINE_HLS_QUEUE;
  }
  return PLAYBACK_TIMELINE_HLS_NONE;
}
