#ifndef MULTIPLEX_AUDIO_DMA_H
#define MULTIPLEX_AUDIO_DMA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct AudioDma AudioDma;

AudioDma *audio_dma_create(const uint8_t *stream, size_t stream_size);
void audio_dma_destroy(AudioDma *audio);

/* Call once per presentation frame with the Native SDK playback state. */
void audio_dma_update(AudioDma *audio, bool playing);

/*
 * Number of stereo PCM sample frames consumed by the Audio Interface DMA.
 * DMA-request boundaries plus the 48 kHz tick interval provide sub-buffer
 * precision, and the value remains frozen while playback is paused.
 */
uint64_t audio_dma_samples_played(const AudioDma *audio);
uint32_t audio_dma_underruns(const AudioDma *audio);

#endif
