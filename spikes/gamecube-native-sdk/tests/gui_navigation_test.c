#include "gui_navigation.h"

#include <assert.h>
#include <stdio.h>

int main(void) {
  MultiplexGuiNavigation navigation;
  multiplex_gui_navigation_reset(&navigation);

  assert(multiplex_gui_navigation_poll(&navigation, 30, 0, 0) ==
         MULTIPLEX_GUI_NAVIGATION_NONE);
  assert(multiplex_gui_navigation_poll(&navigation, 31, 0, 1000) ==
         MULTIPLEX_GUI_NAVIGATION_RIGHT);
  assert(multiplex_gui_navigation_poll(&navigation, 31, 0, 200000) ==
         MULTIPLEX_GUI_NAVIGATION_NONE);
  assert(multiplex_gui_navigation_poll(&navigation, 31, 0, 201000) ==
         MULTIPLEX_GUI_NAVIGATION_RIGHT);
  assert(multiplex_gui_navigation_poll(&navigation, 31, 0, 230999) ==
         MULTIPLEX_GUI_NAVIGATION_NONE);
  assert(multiplex_gui_navigation_poll(&navigation, 31, 0, 231000) ==
         MULTIPLEX_GUI_NAVIGATION_RIGHT);

  assert(multiplex_gui_navigation_poll(&navigation, -80, 70, 240000) ==
         MULTIPLEX_GUI_NAVIGATION_LEFT);
  assert(multiplex_gui_navigation_poll(&navigation, 20, -80, 250000) ==
         MULTIPLEX_GUI_NAVIGATION_DOWN);
  assert(multiplex_gui_navigation_poll(&navigation, 0, 0, 260000) ==
         MULTIPLEX_GUI_NAVIGATION_NONE);
  assert(multiplex_gui_navigation_poll(&navigation, 0, 80, 270000) ==
         MULTIPLEX_GUI_NAVIGATION_UP);

  puts("GUI navigation tests passed.");
  return 0;
}
