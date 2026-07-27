#ifndef MULTIPLEX_AUDIO_AESND_H
#define MULTIPLEX_AUDIO_AESND_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct AudioAesnd AudioAesnd;

AudioAesnd *audio_aesnd_create(const uint8_t *stream, size_t stream_size);
void audio_aesnd_destroy(AudioAesnd *audio);

/* Call once per presentation frame with the Native SDK playback state. */
void audio_aesnd_update(AudioAesnd *audio, bool playing);

/*
 * Number of stereo PCM sample frames completed by AESND. This advances from
 * the audio callback and remains frozen while playback is paused.
 */
uint64_t audio_aesnd_samples_played(const AudioAesnd *audio);
uint32_t audio_aesnd_underruns(const AudioAesnd *audio);

#endif
