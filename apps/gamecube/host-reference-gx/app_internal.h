#ifndef MULTIPLEX_APP_INTERNAL_H
#define MULTIPLEX_APP_INTERNAL_H

#include "app.h"
#include "app_jobs.h"
#include "app_services.h"
#include "gui_navigation.h"
#include "media-source.h"
#include "playback_session.h"

#include <ogc/lwp.h>

#include <stdbool.h>
#include <stdint.h>

#define MULTIPLEX_APP_PAIRING_CONNECTING 4u
#define MULTIPLEX_APP_PLAYBACK_STATE_PLAYER 0x1u
#define MULTIPLEX_APP_PLAYBACK_STATE_PLAYING 0x4u

typedef enum {
  MULTIPLEX_APP_FAILURE_NONE = 0,
  MULTIPLEX_APP_FAILURE_UI_BIND = 1,
  MULTIPLEX_APP_FAILURE_UI_RENDER = 2,
  MULTIPLEX_APP_FAILURE_BACKGROUND_BIND = 3,
  MULTIPLEX_APP_FAILURE_MEDIA_PRODUCER = 4,
  MULTIPLEX_APP_FAILURE_MEDIA_RECOVERY = 5,
  MULTIPLEX_APP_FAILURE_PLAYBACK_CONTINUATION = 6,
} MultiplexAppFailure;

typedef struct {
  MultiplexAppFailure failure;
  bool ready;
} MultiplexAppEffectDrainResult;

typedef struct {
  lwp_t thread;
  void *stack;
  bool ready;
  volatile bool complete;
} MultiplexAppNetworkWarmup;

typedef struct {
  MultiplexAppNetworkWarmup warmup;
  uint64_t retry_at_ms;
  uint32_t retry_delay_ms;
  bool warmup_pending;
  bool ready;
} MultiplexAppNetwork;

typedef struct {
  MultiplexGuiNavigation navigation;
  uint32_t queued_buttons;
  uint32_t queued_navigation;
  bool controller_status_reported;
#if MULTIPLEX_PAIRING_ENABLED
  bool auth_reset_latched;
#endif
} MultiplexAppInput;

typedef enum {
  MULTIPLEX_APP_LIFECYCLE_CREATED = 0,
  MULTIPLEX_APP_LIFECYCLE_OPEN = 1,
  MULTIPLEX_APP_LIFECYCLE_CLOSED = 2,
  MULTIPLEX_APP_LIFECYCLE_FAILURE_PREPARED = 3,
} MultiplexAppLifecycle;

struct MultiplexApp {
  MultiplexPresentation *presentation;
  MultiplexPlaybackSession *playback_session;
  MultiplexAppServices *services;
  MultiplexAppJobs *jobs;
  MultiplexPlaybackSnapshot playback_snapshot;
  MultiplexAppNetwork network;
  MultiplexAppInput input;
  MultiplexAppLifecycle lifecycle;
  uint64_t toast_dismiss_at_ms;
  bool playback_start_offset_pending;
  bool startup_media_pending;
  bool jpeg_ready;
  char boot_diagnostic_operation[64];
  char failure_diagnostics[256];
  MultiplexAppBorrowedFailure borrowed_failure;
};

typedef struct {
  uint32_t pressed;
  uint32_t screen;
  bool active;
  bool transition_pending;
} MultiplexAppInputFrame;

MultiplexPresentationFrameResult
multiplex_app_present_frame(MultiplexApp *app,
                            MultiplexPresentationPrepareMode mode);
MultiplexAppServicesPlaybackView multiplex_app_playback_view(MultiplexApp *app);
bool multiplex_app_dispatch_services(MultiplexApp *app,
                                     const MultiplexAppServicesInput *input);
MultiplexAppEffectDrainResult multiplex_app_drain_effects(MultiplexApp *app);
MultiplexAppFailure
multiplex_app_collect_model_requests(MultiplexApp *app, uint64_t now_ms,
                                     const MultiplexAppInputFrame *input);
bool multiplex_app_dispatch_local_playback(MultiplexApp *app, uint64_t now_ms);
MultiplexAppFailure multiplex_app_handle_playback_events(MultiplexApp *app,
                                                         uint64_t now_ms);
void multiplex_app_stop_playback_if_hidden(MultiplexApp *app);
void multiplex_app_pause_audio_for_player_input(MultiplexApp *app,
                                                uint32_t pressed);

MultiplexAppFailure
multiplex_app_collect_input(MultiplexApp *app, uint64_t now_ms,
                            MultiplexPresentationFrameResult transition,
                            MultiplexAppInputFrame *frame);

#endif
