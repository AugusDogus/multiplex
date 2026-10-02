#ifndef MULTIPLEX_DREAMCAST_MEDIA_PLAYER_H
#define MULTIPLEX_DREAMCAST_MEDIA_PLAYER_H

#include <stdbool.h>

typedef enum {
  DREAMCAST_MEDIA_FINISHED = 0,
  DREAMCAST_MEDIA_CANCELLED,
  DREAMCAST_MEDIA_FAILED,
} DreamcastMediaResult;

DreamcastMediaResult dreamcast_media_play_file(const char *path);

#endif
