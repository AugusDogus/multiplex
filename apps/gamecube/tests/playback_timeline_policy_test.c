#include "playback_timeline_policy.h"

#include <assert.h>
#include <stdio.h>

static void checks_due_policy(void) {
  const PlaybackTimelineCursor stopped = {
      .has_report = true,
      .rating_key = 93,
      .position_ms = 40000,
      .state = PLAYBACK_TIMELINE_STATE_STOPPED,
  };
  assert(playback_timeline_due(&stopped, 93, 40000,
                               PLAYBACK_TIMELINE_STATE_STOPPED,
                               false) == PLAYBACK_TIMELINE_DUE_NONE);
  assert(playback_timeline_due(&stopped, 94, 40000,
                               PLAYBACK_TIMELINE_STATE_STOPPED,
                               false) == PLAYBACK_TIMELINE_DUE_ITEM_CHANGE);
  assert(playback_timeline_due(&stopped, 93, 40000,
                               PLAYBACK_TIMELINE_STATE_PAUSED,
                               false) == PLAYBACK_TIMELINE_DUE_STATE_CHANGE);

  const PlaybackTimelineCursor playing = {
      .has_report = true,
      .rating_key = 93,
      .position_ms = 40000,
      .state = PLAYBACK_TIMELINE_STATE_PLAYING,
  };
  assert(playback_timeline_due(&playing, 93, 39999,
                               PLAYBACK_TIMELINE_STATE_PLAYING,
                               false) == PLAYBACK_TIMELINE_DUE_BACKWARD_SEEK);
  assert(playback_timeline_due(&playing, 93, 49999,
                               PLAYBACK_TIMELINE_STATE_PLAYING,
                               false) == PLAYBACK_TIMELINE_DUE_NONE);
  assert(playback_timeline_due(&playing, 93, 50000,
                               PLAYBACK_TIMELINE_STATE_PLAYING,
                               false) == PLAYBACK_TIMELINE_DUE_INTERVAL);
  assert(playback_timeline_due(&playing, 93, 40000,
                               PLAYBACK_TIMELINE_STATE_PLAYING,
                               true) == PLAYBACK_TIMELINE_DUE_FINAL_FORCE);

  const PlaybackTimelineCursor empty = {0};
  assert(playback_timeline_due(&empty, 93, 0, PLAYBACK_TIMELINE_STATE_PAUSED,
                               false) == PLAYBACK_TIMELINE_DUE_INITIAL);
}

static void creation_defers_to_first_observed_state(void) {
  const PlaybackTimelineCursor created = {0};
  const PlaybackTimelineDue paused = playback_timeline_due(
      &created, 93, 0, PLAYBACK_TIMELINE_STATE_PAUSED, false);
  const PlaybackTimelineDue stopped = playback_timeline_due(
      &created, 93, 0, PLAYBACK_TIMELINE_STATE_STOPPED, false);
  assert(paused == PLAYBACK_TIMELINE_DUE_INITIAL);
  assert(stopped == PLAYBACK_TIMELINE_DUE_INITIAL);
  assert(playback_timeline_hls_action(paused) ==
         PLAYBACK_TIMELINE_HLS_REPORT_NOW);
  assert(playback_timeline_hls_action(stopped) ==
         PLAYBACK_TIMELINE_HLS_REPORT_NOW);
}

int main(void) {
  checks_due_policy();
  creation_defers_to_first_observed_state();
  puts("GameCube playback timeline policy tests passed.");
  return 0;
}
