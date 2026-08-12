#ifndef MULTIPLEX_GUI_NAVIGATION_H
#define MULTIPLEX_GUI_NAVIGATION_H

#include <stdint.h>

typedef enum {
  MULTIPLEX_GUI_NAVIGATION_NONE = 0,
  MULTIPLEX_GUI_NAVIGATION_LEFT,
  MULTIPLEX_GUI_NAVIGATION_RIGHT,
  MULTIPLEX_GUI_NAVIGATION_UP,
  MULTIPLEX_GUI_NAVIGATION_DOWN,
} MultiplexGuiNavigationDirection;

typedef struct {
  MultiplexGuiNavigationDirection direction;
  uint64_t repeat_at_us;
  uint32_t repeat_delay_us;
} MultiplexGuiNavigation;

void multiplex_gui_navigation_reset(MultiplexGuiNavigation *navigation);

MultiplexGuiNavigationDirection
multiplex_gui_navigation_poll(MultiplexGuiNavigation *navigation, int stick_x,
                              int stick_y, uint64_t now_us);

#endif
