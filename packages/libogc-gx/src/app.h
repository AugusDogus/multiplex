#ifndef MULTIPLEX_APP_H
#define MULTIPLEX_APP_H

#include "presentation.h"

#include <stddef.h>

typedef struct MultiplexApp MultiplexApp;

typedef enum {
  MULTIPLEX_APP_CREATE_READY = 0,
  MULTIPLEX_APP_CREATE_CONTEXT_FAILED = 1,
  MULTIPLEX_APP_CREATE_PRESENTATION_FAILED = 2,
  MULTIPLEX_APP_CREATE_PLAYBACK_FAILED = 3,
  MULTIPLEX_APP_CREATE_SERVICES_FAILED = 4,
} MultiplexAppCreateStatus;

typedef struct {
  MultiplexApp *app;
  MultiplexAppCreateStatus status;
} MultiplexAppCreateResult;

typedef enum {
  MULTIPLEX_APP_OPEN_READY = 0,
  MULTIPLEX_APP_OPEN_STOPPED = 1,
  MULTIPLEX_APP_OPEN_VIDEO_FAILED = 2,
  MULTIPLEX_APP_OPEN_JPEG_FAILED = 3,
  MULTIPLEX_APP_OPEN_BUFFER_FAILED = 4,
  MULTIPLEX_APP_OPEN_UI_BIND_FAILED = 5,
  MULTIPLEX_APP_OPEN_UI_RENDER_FAILED = 6,
  MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED = 7,
  MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED = 8,
  MULTIPLEX_APP_OPEN_PLAYBACK_CONTINUATION_FAILED = 9,
} MultiplexAppOpenResult;

typedef enum {
  MULTIPLEX_APP_STEP_CONTINUE = 0,
  MULTIPLEX_APP_STEP_UI_BIND_FAILED = 1,
  MULTIPLEX_APP_STEP_UI_RENDER_FAILED = 2,
  MULTIPLEX_APP_STEP_BACKGROUND_BIND_FAILED = 3,
  MULTIPLEX_APP_STEP_MEDIA_PRODUCER_FAILED = 4,
  MULTIPLEX_APP_STEP_MEDIA_RECOVERY_FAILED = 5,
  MULTIPLEX_APP_STEP_PLAYBACK_CONTINUATION_FAILED = 6,
} MultiplexAppStepResult;

typedef struct {
  MultiplexPresentationBorrowedFatalVideo video;
  const char *diagnostics;
  size_t diagnostics_length;
} MultiplexAppBorrowedFailure;

MultiplexAppCreateResult multiplex_app_create(void);
MultiplexAppOpenResult multiplex_app_open(MultiplexApp *app);
MultiplexAppStepResult multiplex_app_step(MultiplexApp *app);
void multiplex_app_close(MultiplexApp *app);
// The returned video and diagnostic views remain valid until app destruction.
const MultiplexAppBorrowedFailure *
multiplex_app_prepare_failure(MultiplexApp *app);
void multiplex_app_destroy(MultiplexApp **app);

#endif
