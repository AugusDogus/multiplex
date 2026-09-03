#ifndef MULTIPLEX_DREAMCAST_APP_STATE_H
#define MULTIPLEX_DREAMCAST_APP_STATE_H

#include "gateway_protocol.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  DREAMCAST_APP_SCREEN_PAIRING = 0,
  DREAMCAST_APP_SCREEN_CONNECTING,
  DREAMCAST_APP_SCREEN_HOME,
  DREAMCAST_APP_SCREEN_DETAILS,
  DREAMCAST_APP_SCREEN_PREPARING_PLAYBACK,
  DREAMCAST_APP_SCREEN_ERROR,
} DreamcastAppScreen;

typedef enum {
  DREAMCAST_APP_ACTION_PREVIOUS = 0,
  DREAMCAST_APP_ACTION_NEXT,
  DREAMCAST_APP_ACTION_ACTIVATE,
  DREAMCAST_APP_ACTION_BACK,
} DreamcastAppAction;

typedef enum {
  DREAMCAST_APP_EVENT_NONE = 0,
  DREAMCAST_APP_EVENT_RENDER,
  DREAMCAST_APP_EVENT_CONNECT_REQUEST,
  DREAMCAST_APP_EVENT_PLAY_REQUEST,
} DreamcastAppEvent;

typedef struct {
  DreamcastAppScreen screen;
  DreamcastGatewayCatalog catalog;
  uint16_t selected_item;
  char message[DREAMCAST_GATEWAY_MESSAGE_CAPACITY];
} DreamcastAppState;

void dreamcast_app_init(DreamcastAppState *state);
DreamcastAppEvent dreamcast_app_dispatch(DreamcastAppState *state,
                                         DreamcastAppAction action);
bool dreamcast_app_receive_catalog(DreamcastAppState *state,
                                   const DreamcastGatewayCatalog *catalog);
void dreamcast_app_receive_error(DreamcastAppState *state, const char *message);
void dreamcast_app_finish_playback(DreamcastAppState *state,
                                   const char *message);
const DreamcastGatewayItem *
dreamcast_app_selected_item(const DreamcastAppState *state);

#endif
