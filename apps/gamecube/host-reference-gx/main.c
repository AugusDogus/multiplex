#include "app.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/consol.h>
#include <ogc/lwp.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define APP_STACK_SIZE (512 * 1024)

typedef enum {
  APP_EXIT_OK = 0,
  APP_EXIT_VIDEO_INIT = 10,
  APP_EXIT_JPEG_INIT = 11,
  APP_EXIT_BUFFER_INIT = 12,
  APP_EXIT_UI_BIND = 20,
  APP_EXIT_UI_RENDER = 21,
  APP_EXIT_BACKGROUND_BIND = 22,
  APP_EXIT_MEDIA_PRODUCER = 30,
  APP_EXIT_MEDIA_RECOVERY = 31,
  APP_EXIT_PLAYBACK_CONTINUATION = 32,
} AppExitCode;

static AppExitCode open_exit_code(MultiplexAppOpenResult result) {
  switch (result) {
  case MULTIPLEX_APP_OPEN_READY:
  case MULTIPLEX_APP_OPEN_STOPPED:
    return APP_EXIT_OK;
  case MULTIPLEX_APP_OPEN_VIDEO_FAILED:
    return APP_EXIT_VIDEO_INIT;
  case MULTIPLEX_APP_OPEN_JPEG_FAILED:
    return APP_EXIT_JPEG_INIT;
  case MULTIPLEX_APP_OPEN_BUFFER_FAILED:
    return APP_EXIT_BUFFER_INIT;
  case MULTIPLEX_APP_OPEN_UI_BIND_FAILED:
    return APP_EXIT_UI_BIND;
  case MULTIPLEX_APP_OPEN_UI_RENDER_FAILED:
    return APP_EXIT_UI_RENDER;
  case MULTIPLEX_APP_OPEN_BACKGROUND_BIND_FAILED:
    return APP_EXIT_BACKGROUND_BIND;
  case MULTIPLEX_APP_OPEN_MEDIA_PRODUCER_FAILED:
    return APP_EXIT_MEDIA_PRODUCER;
  case MULTIPLEX_APP_OPEN_PLAYBACK_CONTINUATION_FAILED:
    return APP_EXIT_PLAYBACK_CONTINUATION;
  }
  return APP_EXIT_UI_BIND;
}

static AppExitCode step_exit_code(MultiplexAppStepResult result) {
  switch (result) {
  case MULTIPLEX_APP_STEP_CONTINUE:
    return APP_EXIT_OK;
  case MULTIPLEX_APP_STEP_UI_BIND_FAILED:
    return APP_EXIT_UI_BIND;
  case MULTIPLEX_APP_STEP_UI_RENDER_FAILED:
    return APP_EXIT_UI_RENDER;
  case MULTIPLEX_APP_STEP_BACKGROUND_BIND_FAILED:
    return APP_EXIT_BACKGROUND_BIND;
  case MULTIPLEX_APP_STEP_MEDIA_PRODUCER_FAILED:
    return APP_EXIT_MEDIA_PRODUCER;
  case MULTIPLEX_APP_STEP_MEDIA_RECOVERY_FAILED:
    return APP_EXIT_MEDIA_RECOVERY;
  case MULTIPLEX_APP_STEP_PLAYBACK_CONTINUATION_FAILED:
    return APP_EXIT_PLAYBACK_CONTINUATION;
  }
  return APP_EXIT_UI_BIND;
}

static void *run_app(void *context) {
  MultiplexApp *app = context;
  const MultiplexAppOpenResult opened = multiplex_app_open(app);
  AppExitCode exit_code = open_exit_code(opened);
  while (opened == MULTIPLEX_APP_OPEN_READY && exit_code == APP_EXIT_OK &&
         SYS_MainLoop()) {
    exit_code = step_exit_code(multiplex_app_step(app));
  }
  multiplex_app_close(app);
  return (void *)(uintptr_t)exit_code;
}

static const char *app_exit_message(AppExitCode code) {
  switch (code) {
  case APP_EXIT_VIDEO_INIT:
    return "Video or GX initialization failed.";
  case APP_EXIT_JPEG_INIT:
    return "JPEG decoder initialization failed.";
  case APP_EXIT_BUFFER_INIT:
    return "UI framebuffer allocation failed.";
  case APP_EXIT_UI_BIND:
    return "Native UI state binding failed.";
  case APP_EXIT_UI_RENDER:
    return "Native UI rendering failed.";
  case APP_EXIT_BACKGROUND_BIND:
    return "Background Plex data binding failed.";
  case APP_EXIT_MEDIA_PRODUCER:
    return "The network media producer stopped.";
  case APP_EXIT_MEDIA_RECOVERY:
    return "Playback could not recover from a stall.";
  case APP_EXIT_PLAYBACK_CONTINUATION:
    return "Playback could not continue to the next segment.";
  case APP_EXIT_OK:
    return "The application exited normally.";
  }
  return "An unknown application failure occurred.";
}

static void show_app_failure(AppExitCode code,
                             const MultiplexAppBorrowedFailure *failure) {
  SYS_Report("REFERENCE GX: stopped with diagnostic code MGC-%u\n",
             (unsigned)code);
  if (failure == NULL || failure->video.mode == NULL ||
      failure->video.framebuffer == NULL) {
    return;
  }

  void *framebuffer = failure->video.framebuffer;
  const uint32_t framebuffer_bytes =
      VIDEO_GetFrameBufferSize(failure->video.mode);
  memset(framebuffer, 0, framebuffer_bytes);
  CON_Init(framebuffer, 32, 32, failure->video.mode->fbWidth - 64,
           failure->video.mode->xfbHeight - 64,
           failure->video.mode->fbWidth * VI_DISPLAY_PIX_SZ);
  VIDEO_Configure(failure->video.mode);
  VIDEO_SetNextFramebuffer(framebuffer);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();

  const struct mallinfo heap = mallinfo();
  printf("\nMultiplex stopped safely\n");
  printf("========================\n\n");
  printf("Diagnostic code: MGC-%u\n\n", (unsigned)code);
  printf("%s\n\n", app_exit_message(code));
  printf("Heap: %lu KiB free, %lu KiB used\n\n",
         (unsigned long)heap.fordblks / 1024ul,
         (unsigned long)heap.uordblks / 1024ul);
  if (failure->diagnostics_length != 0) {
    printf("%s\n\n", failure->diagnostics);
  }
  printf("Photograph this screen so the exact failure can be fixed.\n");
  printf("Press A, START, or Z to restart without a power cycle.\n");

  while (true) {
    PAD_ScanPads();
    if ((PAD_ButtonsDown(0) &
         (PAD_BUTTON_A | PAD_BUTTON_START | PAD_TRIGGER_Z)) != 0 ||
        SYS_ResetButtonDown()) {
      SYS_ResetSystem(SYS_RESTART, 0, FALSE);
    }
    VIDEO_WaitVSync();
  }
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  void *app_stack = malloc(APP_STACK_SIZE);
  if (app_stack == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate %u-byte app stack\n",
               APP_STACK_SIZE);
    return 1;
  }

  const MultiplexAppCreateResult created = multiplex_app_create();
  if (created.status != MULTIPLEX_APP_CREATE_READY) {
    const char *allocation = "app context";
    if (created.status == MULTIPLEX_APP_CREATE_PRESENTATION_FAILED) {
      allocation = "presentation context";
    } else if (created.status == MULTIPLEX_APP_CREATE_PLAYBACK_FAILED) {
      allocation = "playback context";
    } else if (created.status == MULTIPLEX_APP_CREATE_SERVICES_FAILED) {
      allocation = "app services";
    }
    SYS_Report("REFERENCE GX: failed to allocate %s\n", allocation);
    free(app_stack);
    return created.status == MULTIPLEX_APP_CREATE_PLAYBACK_FAILED
               ? APP_EXIT_MEDIA_PRODUCER
               : APP_EXIT_BUFFER_INIT;
  }

  MultiplexApp *app = created.app;
  lwp_t app_thread = LWP_THREAD_NULL;
  if (LWP_CreateThread(&app_thread, run_app, app, app_stack, APP_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    SYS_Report("REFERENCE GX: failed to create app thread\n");
    multiplex_app_destroy(&app);
    free(app_stack);
    return 1;
  }

  void *result = NULL;
  const int join_status = LWP_JoinThread(app_thread, &result);
  free(app_stack);
  if (join_status != 0) {
    SYS_Report("REFERENCE GX: failed to join app thread\n");
    multiplex_app_destroy(&app);
    return 1;
  }

  const AppExitCode exit_code = (AppExitCode)(uintptr_t)result;
  if (exit_code != APP_EXIT_OK) {
    const MultiplexAppBorrowedFailure *failure =
        multiplex_app_prepare_failure(app);
    show_app_failure(exit_code, failure);
  }
  multiplex_app_destroy(&app);
  return (int)exit_code;
}
