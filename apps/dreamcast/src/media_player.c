#include "media_player.h"

#include <dc/maple/controller.h>
#include <mpeg.h>

DreamcastMediaResult dreamcast_media_play_file(const char *path) {
  mpeg_player_t *player = mpeg_player_create(path);
  if (player == NULL) {
    return DREAMCAST_MEDIA_FAILED;
  }
  const int result = mpeg_play(player, CONT_B);
  mpeg_player_destroy(player);
  if (result < 0) {
    return DREAMCAST_MEDIA_FAILED;
  }
  return result == 0 ? DREAMCAST_MEDIA_FINISHED : DREAMCAST_MEDIA_CANCELLED;
}
