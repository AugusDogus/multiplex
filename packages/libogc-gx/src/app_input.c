#include "app_internal.h"

#include "native_ui.h"

#include <gccore.h>
#if defined(HW_RVL)
#include <wiiuse/wpad.h>
#endif

#include <stdint.h>

static uint32_t navigation_action(MultiplexGuiNavigationDirection direction) {
  switch (direction) {
  case MULTIPLEX_GUI_NAVIGATION_LEFT:
    return 0;
  case MULTIPLEX_GUI_NAVIGATION_RIGHT:
    return 1;
  case MULTIPLEX_GUI_NAVIGATION_UP:
    return 8;
  case MULTIPLEX_GUI_NAVIGATION_DOWN:
    return 9;
  case MULTIPLEX_GUI_NAVIGATION_NONE:
    return UINT32_MAX;
  }
  return UINT32_MAX;
}

#if defined(HW_RVL)
// Wii D-pads move focus. GameCube D-pads keep their search-cursor actions.
static uint32_t wii_dpad_navigation(uint32_t buttons) {
  if ((buttons & (WPAD_BUTTON_LEFT | WPAD_CLASSIC_BUTTON_LEFT)) != 0) {
    return 0;
  }
  if ((buttons & (WPAD_BUTTON_RIGHT | WPAD_CLASSIC_BUTTON_RIGHT)) != 0) {
    return 1;
  }
  if ((buttons & (WPAD_BUTTON_UP | WPAD_CLASSIC_BUTTON_UP)) != 0) {
    return 8;
  }
  if ((buttons & (WPAD_BUTTON_DOWN | WPAD_CLASSIC_BUTTON_DOWN)) != 0) {
    return 9;
  }
  return UINT32_MAX;
}

static uint32_t wii_buttons_as_gamecube(uint32_t buttons) {
  uint32_t mapped = 0;
  if ((buttons & (WPAD_BUTTON_A | WPAD_CLASSIC_BUTTON_A)) != 0) {
    mapped |= PAD_BUTTON_A;
  }
  if ((buttons & (WPAD_BUTTON_B | WPAD_CLASSIC_BUTTON_B)) != 0) {
    mapped |= PAD_BUTTON_B;
  }
  if ((buttons & (WPAD_BUTTON_2 | WPAD_CLASSIC_BUTTON_X)) != 0) {
    mapped |= PAD_BUTTON_X;
  }
  if ((buttons & (WPAD_BUTTON_1 | WPAD_CLASSIC_BUTTON_Y)) != 0) {
    mapped |= PAD_BUTTON_Y;
  }
  if ((buttons & (WPAD_BUTTON_MINUS | WPAD_CLASSIC_BUTTON_ZR)) != 0) {
    mapped |= PAD_TRIGGER_Z;
  }
  if ((buttons & (WPAD_BUTTON_HOME | WPAD_CLASSIC_BUTTON_FULL_L)) != 0) {
    mapped |= PAD_TRIGGER_L;
  }
  if ((buttons & (WPAD_BUTTON_PLUS | WPAD_CLASSIC_BUTTON_FULL_R)) != 0) {
    mapped |= PAD_TRIGGER_R;
  }
  if ((buttons & WPAD_CLASSIC_BUTTON_PLUS) != 0) {
    mapped |= PAD_BUTTON_START;
  }
  return mapped;
}
#endif

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message,
                                  uint32_t detail) {
  SYS_Report("REFERENCE GX: input action=%u focus=%u count=%u message=%u "
             "detail=%u\n",
             action, focus, count, message, detail);
}

static MultiplexAppFailure dispatch_auth_reset(MultiplexApp *app,
                                               uint64_t now_ms, uint32_t held) {
#if MULTIPLEX_PAIRING_ENABLED
  const uint32_t auth_reset_buttons =
      PAD_TRIGGER_L | PAD_TRIGGER_R | PAD_TRIGGER_Z;
  const bool auth_reset_held =
      (held & auth_reset_buttons) == auth_reset_buttons;
  if (auth_reset_held && !app->input.auth_reset_latched) {
    const MultiplexAppServicesInput reset = {
        .kind = MULTIPLEX_APP_SERVICES_INPUT_AUTH_RESET_REQUESTED,
        .payload.auth_reset = {.now_ms = now_ms},
    };
    const bool dispatched = multiplex_app_dispatch_services(app, &reset);
    const MultiplexAppEffectDrainResult effects =
        multiplex_app_drain_effects(app);
    if (!effects.ready) {
      return effects.failure != MULTIPLEX_APP_FAILURE_NONE
                 ? effects.failure
                 : MULTIPLEX_APP_FAILURE_UI_BIND;
    }
    if (!dispatched) {
      return MULTIPLEX_APP_FAILURE_UI_BIND;
    }
  }
  app->input.auth_reset_latched = auth_reset_held;
#else
  (void)app;
  (void)now_ms;
  (void)held;
#endif
  return MULTIPLEX_APP_FAILURE_NONE;
}

MultiplexAppFailure
multiplex_app_collect_input(MultiplexApp *app, uint64_t now_ms,
                            MultiplexPresentationFrameResult transition,
                            MultiplexAppInputFrame *frame) {
  *frame = (MultiplexAppInputFrame){0};
  PAD_ScanPads();
#if defined(HW_RVL)
  WPAD_ScanPads();
#endif
  if (!app->input.controller_status_reported) {
    uint32_t controller_type = 0;
    SYS_Report("REFERENCE GX: controller scan=%u type=%08x\n",
               PAD_GetType(0, &controller_type), controller_type);
    app->input.controller_status_reported = true;
  }

  uint32_t pressed = PAD_ButtonsDown(0);
  uint32_t held = 0;
#if defined(HW_RVL)
  const uint32_t wii_buttons = WPAD_ButtonsDown(0);
  const uint32_t wii_navigation = wii_dpad_navigation(wii_buttons);
#endif
#if MULTIPLEX_PAIRING_ENABLED
  held = PAD_ButtonsHeld(0);
#endif
#if defined(HW_RVL)
  pressed |= wii_buttons_as_gamecube(wii_buttons);
#if MULTIPLEX_PAIRING_ENABLED
  held |= wii_buttons_as_gamecube(WPAD_ButtonsHeld(0));
#endif
#endif

  if (transition == MULTIPLEX_PRESENTATION_FRAME_PENDING) {
    app->input.queued_buttons |= pressed;
    uint32_t navigation = navigation_action(multiplex_gui_navigation_poll(
        &app->input.navigation, PAD_StickX(0), PAD_StickY(0), now_ms * 1000u));
#if defined(HW_RVL)
    if (navigation == UINT32_MAX) {
      navigation = wii_navigation;
    }
#endif
    if (app->input.queued_navigation == UINT32_MAX &&
        navigation != UINT32_MAX) {
      app->input.queued_navigation = navigation;
    }
    multiplex_app_present_frame(app, MULTIPLEX_PRESENTATION_PREPARE_DEFERRED);
    frame->transition_pending = true;
    return MULTIPLEX_APP_FAILURE_NONE;
  }

  pressed |= app->input.queued_buttons;
  app->input.queued_buttons = 0;
  uint32_t focus_navigation =
      app->input.queued_navigation != UINT32_MAX
          ? app->input.queued_navigation
          : navigation_action(multiplex_gui_navigation_poll(
                &app->input.navigation, PAD_StickX(0), PAD_StickY(0),
                now_ms * 1000u));
  app->input.queued_navigation = UINT32_MAX;
#if defined(HW_RVL)
  if (focus_navigation == UINT32_MAX) {
    focus_navigation = wii_navigation;
  }
#endif

  const bool active_input = pressed != 0 || focus_navigation != UINT32_MAX;
  const MultiplexPresentationControlsInput controls_input = {
      .now_ms = now_ms,
      .active_input = active_input,
      .a_pressed = (pressed & PAD_BUTTON_A) != 0,
      .settings_open = multiplex_native_app_player_settings_open() != 0,
  };
  const MultiplexPresentationControlsResult controls =
      multiplex_presentation_controls_update(app->presentation,
                                             &controls_input);
  if (controls.visibility_changed) {
    multiplex_presentation_request_refresh(app->presentation, true);
  }
  if (controls.consumed_a) {
    pressed &= ~PAD_BUTTON_A;
  }

  const uint32_t input_screen = multiplex_native_app_screen();
  multiplex_app_pause_audio_for_player_input(app, pressed);
  bool app_changed = false;
  if (focus_navigation != UINT32_MAX) {
    const uint32_t before = multiplex_native_app_home_view_state();
    if (multiplex_native_app_input(focus_navigation) != 0) {
      multiplex_presentation_begin_home_motion(
          app->presentation, before, multiplex_native_app_home_view_state());
      app_changed = true;
    }
  }
  const struct {
    uint32_t button;
    uint32_t action;
  } actions[] = {
      {PAD_BUTTON_LEFT, 12},  {PAD_BUTTON_RIGHT, 13}, {PAD_BUTTON_A, 2},
      {PAD_BUTTON_B, 3},      {PAD_BUTTON_Y, 4},      {PAD_BUTTON_X, 5},
      {PAD_TRIGGER_R, 6},     {PAD_TRIGGER_L, 7},     {PAD_TRIGGER_Z, 10},
      {PAD_BUTTON_START, 11},
  };
  for (unsigned index = 0; index < sizeof(actions) / sizeof(actions[0]);
       ++index) {
    if ((pressed & actions[index].button) != 0 &&
        multiplex_native_app_input(actions[index].action) != 0) {
      app_changed = true;
    }
  }
  if (app_changed) {
    multiplex_presentation_request_refresh(app->presentation, false);
  }

  const MultiplexAppFailure reset_failure =
      dispatch_auth_reset(app, now_ms, held);
  if (reset_failure != MULTIPLEX_APP_FAILURE_NONE) {
    return reset_failure;
  }

  *frame = (MultiplexAppInputFrame){
      .pressed = pressed,
      .screen = input_screen,
      .active = active_input,
  };
  return MULTIPLEX_APP_FAILURE_NONE;
}
