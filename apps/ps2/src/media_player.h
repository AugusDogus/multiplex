#ifndef MULTIPLEX_PS2_MEDIA_PLAYER_H
#define MULTIPLEX_PS2_MEDIA_PLAYER_H

#include <stddef.h>
#include <stdint.h>

int multiplex_ps2_play_media(const uint8_t *video, size_t video_size,
                             const uint8_t *audio, size_t audio_size);

#endif
