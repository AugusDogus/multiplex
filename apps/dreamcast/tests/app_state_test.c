#include "app_state.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static DreamcastGatewayCatalog catalog(void) {
  DreamcastGatewayCatalog result = {.item_count = 2};
  snprintf(result.server_name, sizeof(result.server_name), "Living Room");
  result.items[0].rating_key = 41;
  snprintf(result.items[0].title, sizeof(result.items[0].title), "Alien");
  result.items[1].rating_key = 42;
  snprintf(result.items[1].title, sizeof(result.items[1].title), "Arrival");
  return result;
}

int main(void) {
  DreamcastAppState state;
  dreamcast_app_init(&state);
  assert(state.screen == DREAMCAST_APP_SCREEN_PAIRING);
  assert(dreamcast_app_selected_item(&state) == NULL);

  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_NEXT) ==
         DREAMCAST_APP_EVENT_NONE);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_ACTIVATE) ==
         DREAMCAST_APP_EVENT_CONNECT_REQUEST);
  assert(state.screen == DREAMCAST_APP_SCREEN_CONNECTING);

  const DreamcastGatewayCatalog loaded = catalog();
  assert(dreamcast_app_receive_catalog(&state, &loaded));
  assert(state.screen == DREAMCAST_APP_SCREEN_HOME);
  assert(dreamcast_app_selected_item(&state)->rating_key == 41u);

  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_PREVIOUS) ==
         DREAMCAST_APP_EVENT_RENDER);
  assert(dreamcast_app_selected_item(&state)->rating_key == 42u);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_NEXT) ==
         DREAMCAST_APP_EVENT_RENDER);
  assert(dreamcast_app_selected_item(&state)->rating_key == 41u);

  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_ACTIVATE) ==
         DREAMCAST_APP_EVENT_RENDER);
  assert(state.screen == DREAMCAST_APP_SCREEN_DETAILS);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_ACTIVATE) ==
         DREAMCAST_APP_EVENT_PLAY_REQUEST);
  assert(state.screen == DREAMCAST_APP_SCREEN_PREPARING_PLAYBACK);

  dreamcast_app_finish_playback(&state, "Playback ended");
  assert(state.screen == DREAMCAST_APP_SCREEN_DETAILS);
  assert(strcmp(state.message, "Playback ended") == 0);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_BACK) ==
         DREAMCAST_APP_EVENT_RENDER);
  assert(state.screen == DREAMCAST_APP_SCREEN_HOME);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_BACK) ==
         DREAMCAST_APP_EVENT_RENDER);
  assert(state.screen == DREAMCAST_APP_SCREEN_PAIRING);
  assert(dreamcast_app_selected_item(&state) == NULL);

  dreamcast_app_receive_error(&state, "Network unavailable");
  assert(state.screen == DREAMCAST_APP_SCREEN_ERROR);
  assert(strcmp(state.message, "Network unavailable") == 0);
  assert(dreamcast_app_dispatch(&state, DREAMCAST_APP_ACTION_ACTIVATE) ==
         DREAMCAST_APP_EVENT_CONNECT_REQUEST);
  return 0;
}
