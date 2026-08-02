/*
 * Analog navigation semantics adapted from libwiigui's GuiTrigger.
 *
 * libwiigui copyright Tantric 2009-2012.
 * WiiMC-GCN source:
 * https://github.com/SuperrSonic/WiiMC-GCN/blob/b2783831f5bb31cfaffef67f807e7e3c819bf321/source/libwiigui/gui_trigger.cpp
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#include "gui_navigation.h"

#include <stdlib.h>

#define GUI_NAVIGATION_DEAD_ZONE 30
#define GUI_NAVIGATION_INITIAL_REPEAT_US 200000u
#define GUI_NAVIGATION_REPEAT_US 30000u
#define GUI_NAVIGATION_REPEAT_DECREASE_US 300u

static MultiplexGuiNavigationDirection direction_for_stick(int stick_x,
                                                            int stick_y) {
  if (abs(stick_x) >= abs(stick_y)) {
    if (stick_x < -GUI_NAVIGATION_DEAD_ZONE) {
      return MULTIPLEX_GUI_NAVIGATION_LEFT;
    }
    if (stick_x > GUI_NAVIGATION_DEAD_ZONE) {
      return MULTIPLEX_GUI_NAVIGATION_RIGHT;
    }
  } else {
    if (stick_y > GUI_NAVIGATION_DEAD_ZONE) {
      return MULTIPLEX_GUI_NAVIGATION_UP;
    }
    if (stick_y < -GUI_NAVIGATION_DEAD_ZONE) {
      return MULTIPLEX_GUI_NAVIGATION_DOWN;
    }
  }
  return MULTIPLEX_GUI_NAVIGATION_NONE;
}

void multiplex_gui_navigation_reset(MultiplexGuiNavigation *navigation) {
  navigation->direction = MULTIPLEX_GUI_NAVIGATION_NONE;
  navigation->repeat_at_us = 0;
  navigation->repeat_delay_us = GUI_NAVIGATION_INITIAL_REPEAT_US;
}

MultiplexGuiNavigationDirection multiplex_gui_navigation_poll(
    MultiplexGuiNavigation *navigation, int stick_x, int stick_y,
    uint64_t now_us) {
  const MultiplexGuiNavigationDirection direction =
      direction_for_stick(stick_x, stick_y);
  if (direction == MULTIPLEX_GUI_NAVIGATION_NONE) {
    multiplex_gui_navigation_reset(navigation);
    return MULTIPLEX_GUI_NAVIGATION_NONE;
  }
  if (direction != navigation->direction) {
    navigation->direction = direction;
    navigation->repeat_delay_us = GUI_NAVIGATION_INITIAL_REPEAT_US;
    navigation->repeat_at_us = now_us + navigation->repeat_delay_us;
    return direction;
  }
  if (now_us < navigation->repeat_at_us) {
    return MULTIPLEX_GUI_NAVIGATION_NONE;
  }
  if (navigation->repeat_delay_us == GUI_NAVIGATION_INITIAL_REPEAT_US) {
    navigation->repeat_delay_us = GUI_NAVIGATION_REPEAT_US;
  } else if (navigation->repeat_delay_us > GUI_NAVIGATION_REPEAT_DECREASE_US) {
    navigation->repeat_delay_us -= GUI_NAVIGATION_REPEAT_DECREASE_US;
  }
  navigation->repeat_at_us = now_us + navigation->repeat_delay_us;
  return direction;
}
