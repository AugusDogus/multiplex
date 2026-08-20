#include "app_state.h"

#include <stdio.h>
#include <string.h>

static void set_message(DreamcastAppState *state, const char *message) {
  snprintf(state->message, sizeof(state->message), "%s",
           message == NULL ? "" : message);
}

void dreamcast_app_init(DreamcastAppState *state) {
  if (state == NULL) {
    return;
  }
  memset(state, 0, sizeof(*state));
  state->screen = DREAMCAST_APP_SCREEN_PAIRING;
}

const DreamcastGatewayItem *
dreamcast_app_selected_item(const DreamcastAppState *state) {
  if (state == NULL || state->selected_item >= state->catalog.item_count) {
    return NULL;
  }
  return &state->catalog.items[state->selected_item];
}

bool dreamcast_app_receive_catalog(DreamcastAppState *state,
                                   const DreamcastGatewayCatalog *catalog) {
  if (state == NULL || catalog == NULL || catalog->item_count == 0 ||
      catalog->item_count > DREAMCAST_GATEWAY_MAX_ITEMS) {
    return false;
  }
  state->catalog = *catalog;
  state->selected_item = 0;
  state->screen = DREAMCAST_APP_SCREEN_HOME;
  set_message(state, "Catalog loaded");
  return true;
}

void dreamcast_app_receive_error(DreamcastAppState *state,
                                 const char *message) {
  if (state == NULL) {
    return;
  }
  state->screen = DREAMCAST_APP_SCREEN_ERROR;
  set_message(state, message == NULL ? "The request failed" : message);
}

void dreamcast_app_finish_playback(DreamcastAppState *state,
                                   const char *message) {
  if (state == NULL) {
    return;
  }
  state->screen = DREAMCAST_APP_SCREEN_DETAILS;
  set_message(state, message);
}

DreamcastAppEvent dreamcast_app_dispatch(DreamcastAppState *state,
                                         DreamcastAppAction action) {
  if (state == NULL) {
    return DREAMCAST_APP_EVENT_NONE;
  }

  switch (state->screen) {
  case DREAMCAST_APP_SCREEN_PAIRING:
  case DREAMCAST_APP_SCREEN_ERROR:
    if (action == DREAMCAST_APP_ACTION_ACTIVATE) {
      state->screen = DREAMCAST_APP_SCREEN_CONNECTING;
      set_message(state, "Loading catalog");
      return DREAMCAST_APP_EVENT_CONNECT_REQUEST;
    }
    if (state->screen == DREAMCAST_APP_SCREEN_ERROR &&
        action == DREAMCAST_APP_ACTION_BACK) {
      state->screen = DREAMCAST_APP_SCREEN_PAIRING;
      set_message(state, "");
      return DREAMCAST_APP_EVENT_RENDER;
    }
    return DREAMCAST_APP_EVENT_NONE;

  case DREAMCAST_APP_SCREEN_CONNECTING:
  case DREAMCAST_APP_SCREEN_PREPARING_PLAYBACK:
    return DREAMCAST_APP_EVENT_NONE;

  case DREAMCAST_APP_SCREEN_HOME:
    if (action == DREAMCAST_APP_ACTION_PREVIOUS) {
      state->selected_item =
          (uint16_t)((state->selected_item + state->catalog.item_count - 1u) %
                     state->catalog.item_count);
      return DREAMCAST_APP_EVENT_RENDER;
    }
    if (action == DREAMCAST_APP_ACTION_NEXT) {
      state->selected_item =
          (uint16_t)((state->selected_item + 1u) % state->catalog.item_count);
      return DREAMCAST_APP_EVENT_RENDER;
    }
    if (action == DREAMCAST_APP_ACTION_ACTIVATE) {
      state->screen = DREAMCAST_APP_SCREEN_DETAILS;
      set_message(state, "");
      return DREAMCAST_APP_EVENT_RENDER;
    }
    if (action == DREAMCAST_APP_ACTION_BACK) {
      state->screen = DREAMCAST_APP_SCREEN_PAIRING;
      memset(&state->catalog, 0, sizeof(state->catalog));
      state->selected_item = 0;
      set_message(state, "");
      return DREAMCAST_APP_EVENT_RENDER;
    }
    return DREAMCAST_APP_EVENT_NONE;

  case DREAMCAST_APP_SCREEN_DETAILS:
    if (action == DREAMCAST_APP_ACTION_ACTIVATE) {
      state->screen = DREAMCAST_APP_SCREEN_PREPARING_PLAYBACK;
      set_message(state, "Preparing MPEG-1 stream");
      return DREAMCAST_APP_EVENT_PLAY_REQUEST;
    }
    if (action == DREAMCAST_APP_ACTION_BACK) {
      state->screen = DREAMCAST_APP_SCREEN_HOME;
      set_message(state, "");
      return DREAMCAST_APP_EVENT_RENDER;
    }
    return DREAMCAST_APP_EVENT_NONE;
  }

  return DREAMCAST_APP_EVENT_NONE;
}
