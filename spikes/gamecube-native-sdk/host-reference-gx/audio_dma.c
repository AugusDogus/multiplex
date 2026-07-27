/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Direct Audio Interface DMA structure adapted from WiiMC-GCN's
 * source/mplayer/libao2/ao_gekko.c. WiiMC-GCN is GPL-2.0-or-later; see
 * ../LICENSE.md for attribution.
 */

#include "audio_dma.h"
#include "mp2_decoder.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/irq.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

#define AUDIO_BURST_SIZE 5760
#define AUDIO_BUFFER_COUNT 18
#define AUDIO_DECODER_STACK_SIZE (128 * 1024)
#define AUDIO_CHANNELS 2
#define AUDIO_BYTES_PER_SAMPLE 2
#define AUDIO_SAMPLE_RATE 48000
#define AUDIO_SAMPLES_PER_BUFFER \
  (AUDIO_BURST_SIZE / (AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE))

typedef enum {
  AUDIO_BUFFER_FREE,
  AUDIO_BUFFER_DECODING,
  AUDIO_BUFFER_READY,
  AUDIO_BUFFER_ACTIVE,
  AUDIO_BUFFER_QUEUED,
} AudioBufferState;

struct AudioDma {
  Mp2Decoder *decoder;
  void *buffers[AUDIO_BUFFER_COUNT];
  volatile AudioBufferState buffer_states[AUDIO_BUFFER_COUNT];
  lwp_t decoder_thread;
  void *decoder_stack;
  bool dma_initialized;
  volatile bool stopping;
  volatile bool playing;
  volatile int current_buffer;
  volatile int queued_buffer;
  volatile uint32_t current_buffer_started;
  volatile uint32_t paused_partial_samples;
  volatile uint32_t queued_partial_samples;
  volatile uint32_t completed_buffers;
  volatile uint32_t underruns;
};

static AudioDma *active_audio;

static int find_buffer_with_state(const AudioDma *audio,
                                  AudioBufferState state) {
  for (unsigned index = 0; index < AUDIO_BUFFER_COUNT; ++index) {
    if (audio->buffer_states[index] == state) {
      return (int)index;
    }
  }
  return -1;
}

static void audio_dma_callback(void) {
  AudioDma *audio = active_audio;
  if (audio == NULL) {
    return;
  }

  /*
   * AI DMA is internally double-buffered. The first callback happens as soon
   * as the initial buffer becomes current and asks software to queue the next
   * one; only a buffer that was current at the previous callback is complete.
   */
  if (audio->current_buffer >= 0) {
    audio->buffer_states[audio->current_buffer] = AUDIO_BUFFER_FREE;
    audio->completed_buffers += 1;
  }

  audio->current_buffer = audio->queued_buffer;
  audio->queued_buffer = -1;
  if (!audio->playing || audio->current_buffer < 0) {
    AUDIO_StopDMA();
    if (audio->playing) {
      audio->underruns += 1;
    }
    return;
  }

  audio->buffer_states[audio->current_buffer] = AUDIO_BUFFER_ACTIVE;
  audio->current_buffer_started = gettick();
  audio->paused_partial_samples = audio->queued_partial_samples;
  audio->queued_partial_samples = 0;

  const int ready_buffer =
      find_buffer_with_state(audio, AUDIO_BUFFER_READY);
  if (ready_buffer >= 0) {
    audio->buffer_states[ready_buffer] = AUDIO_BUFFER_QUEUED;
    audio->queued_buffer = ready_buffer;
    audio->queued_partial_samples = 0;
    AUDIO_InitDMA((uint32_t)audio->buffers[ready_buffer], AUDIO_BURST_SIZE);
  }
}

static void swap_stereo_channels(int16_t *samples, size_t byte_count) {
  const size_t sample_count = byte_count / sizeof(*samples);
  for (size_t index = 0; index + 1 < sample_count; index += 2) {
    const int16_t left = samples[index];
    samples[index] = samples[index + 1];
    samples[index + 1] = left;
  }
}

static void *run_audio_decoder(void *argument) {
  AudioDma *audio = argument;

  while (!audio->stopping) {
    const uint32_t level = IRQ_Disable();
    const int free_buffer =
        find_buffer_with_state(audio, AUDIO_BUFFER_FREE);
    if (free_buffer >= 0) {
      audio->buffer_states[free_buffer] = AUDIO_BUFFER_DECODING;
    }
    IRQ_Restore(level);

    if (free_buffer < 0) {
      usleep(1000);
      continue;
    }

    void *buffer = audio->buffers[free_buffer];
    if (!mp2_decoder_read_pcm(audio->decoder, buffer, AUDIO_BURST_SIZE)) {
      SYS_Report("REFERENCE GX: audio decoder failure\n");
      audio->stopping = true;
      break;
    }

    /*
     * The GameCube AI DMA channel order is the reverse of FFmpeg's native
     * stereo PCM order. This is the same conversion used by WiiMC-GCN's
     * ao_gekko output driver.
     */
    swap_stereo_channels(buffer, AUDIO_BURST_SIZE);
    DCFlushRange(buffer, AUDIO_BURST_SIZE);

    const uint32_t publish_level = IRQ_Disable();
    audio->buffer_states[free_buffer] = AUDIO_BUFFER_READY;
    IRQ_Restore(publish_level);
  }
  return NULL;
}

static bool start_dma_if_ready(AudioDma *audio) {
  const uint32_t level = IRQ_Disable();
  if (audio->queued_buffer < 0) {
    const int ready_buffer =
        find_buffer_with_state(audio, AUDIO_BUFFER_READY);
    if (ready_buffer >= 0) {
      audio->buffer_states[ready_buffer] = AUDIO_BUFFER_QUEUED;
      audio->queued_buffer = ready_buffer;
      audio->queued_partial_samples = 0;
      AUDIO_InitDMA((uint32_t)audio->buffers[ready_buffer],
                    AUDIO_BURST_SIZE);
    }
  }
  const bool available =
      audio->current_buffer >= 0 || audio->queued_buffer >= 0;
  if (available && AUDIO_GetDMAEnableFlag() == 0) {
    AUDIO_StartDMA();
  }
  IRQ_Restore(level);
  return available;
}

static uint64_t samples_played_locked(const AudioDma *audio) {
  uint32_t partial_samples = audio->paused_partial_samples;
  if (audio->playing && audio->current_buffer >= 0) {
    const uint32_t elapsed_us = (uint32_t)ticks_to_microsecs(
        (uint32_t)(gettick() - audio->current_buffer_started));
    const uint32_t elapsed_samples =
        (elapsed_us * (AUDIO_SAMPLE_RATE / 1000u)) / 1000u;
    if (elapsed_samples <
        AUDIO_SAMPLES_PER_BUFFER - partial_samples) {
      partial_samples += elapsed_samples;
    } else {
      partial_samples = AUDIO_SAMPLES_PER_BUFFER - 1u;
    }
  }
  return (uint64_t)audio->completed_buffers * AUDIO_SAMPLES_PER_BUFFER +
         partial_samples;
}

AudioDma *audio_dma_create(const uint8_t *stream, size_t stream_size) {
  if (active_audio != NULL) {
    return NULL;
  }

  AudioDma *audio = calloc(1, sizeof(*audio));
  if (audio == NULL) {
    return NULL;
  }
  audio->decoder_thread = LWP_THREAD_NULL;
  audio->current_buffer = -1;
  audio->queued_buffer = -1;
  audio->decoder = mp2_decoder_create(stream, stream_size);
  if (audio->decoder == NULL) {
    audio_dma_destroy(audio);
    return NULL;
  }

  for (unsigned index = 0; index < AUDIO_BUFFER_COUNT; ++index) {
    audio->buffers[index] = memalign(32, AUDIO_BURST_SIZE);
    if (audio->buffers[index] == NULL) {
      SYS_Report("REFERENCE GX: audio buffer allocation failed\n");
      audio_dma_destroy(audio);
      return NULL;
    }
    audio->buffer_states[index] = AUDIO_BUFFER_FREE;
  }

  AUDIO_Init(NULL);
  AUDIO_StopDMA();
  AUDIO_SetDSPSampleRate(AI_SAMPLERATE_48KHZ);
  active_audio = audio;
  AUDIO_RegisterDMACallback(audio_dma_callback);
  audio->dma_initialized = true;

  audio->decoder_stack = malloc(AUDIO_DECODER_STACK_SIZE);
  if (audio->decoder_stack == NULL ||
      LWP_CreateThread(&audio->decoder_thread, run_audio_decoder, audio,
                       audio->decoder_stack, AUDIO_DECODER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: audio decoder thread creation failed\n");
    audio_dma_destroy(audio);
    return NULL;
  }

  SYS_Report(
      "REFERENCE GX: audio=ffmpeg-mplayer-ce codec=mp2 output=ai-dma "
      "rate=48000 channels=2 format=s16 buffers=%u burst=%u bytes\n",
      AUDIO_BUFFER_COUNT, AUDIO_BURST_SIZE);
  return audio;
}

void audio_dma_destroy(AudioDma *audio) {
  if (audio == NULL) {
    return;
  }

  audio->stopping = true;
  if (audio->decoder_thread != LWP_THREAD_NULL) {
    LWP_JoinThread(audio->decoder_thread, NULL);
  }

  if (audio->dma_initialized) {
    const uint32_t level = IRQ_Disable();
    audio->playing = false;
    AUDIO_StopDMA();
    AUDIO_RegisterDMACallback(NULL);
    if (active_audio == audio) {
      active_audio = NULL;
    }
    IRQ_Restore(level);
  }

  for (unsigned index = 0; index < AUDIO_BUFFER_COUNT; ++index) {
    free(audio->buffers[index]);
  }
  free(audio->decoder_stack);
  mp2_decoder_destroy(audio->decoder);
  free(audio);
}

void audio_dma_update(AudioDma *audio, bool playing) {
  if (audio == NULL) {
    return;
  }

  if (playing != audio->playing) {
    if (!playing) {
      const uint32_t level = IRQ_Disable();
      const uint64_t transition_samples = samples_played_locked(audio);
      audio->paused_partial_samples =
          (uint32_t)(transition_samples % AUDIO_SAMPLES_PER_BUFFER);
      audio->playing = false;
      AUDIO_StopDMA();
      IRQ_Restore(level);
      SYS_Report(
          "REFERENCE GX: audio=paused samples=%llu buffers=%u underruns=%u\n",
          transition_samples, audio->completed_buffers, audio->underruns);
    } else {
      const uint32_t level = IRQ_Disable();
      const uint64_t transition_samples = samples_played_locked(audio);
      audio->playing = true;
      if (audio->current_buffer >= 0) {
        /*
         * Starting a stopped AI DMA transfer asks for its second buffer
         * immediately instead of resuming the old internal pipeline. Rebuild
         * that pipeline from the current block's aligned PCM offset, then let
         * the normal first callback promote it to current again.
         */
        if (audio->queued_buffer >= 0) {
          audio->buffer_states[audio->queued_buffer] = AUDIO_BUFFER_READY;
          audio->queued_buffer = -1;
        }
        const uint32_t resume_bytes =
            (audio->paused_partial_samples *
             AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE) &
            ~31u;
        audio->buffer_states[audio->current_buffer] =
            AUDIO_BUFFER_QUEUED;
        audio->queued_buffer = audio->current_buffer;
        audio->queued_partial_samples = audio->paused_partial_samples;
        audio->current_buffer = -1;
        AUDIO_InitDMA(
            (uint32_t)audio->buffers[audio->queued_buffer] + resume_bytes,
            AUDIO_BURST_SIZE - resume_bytes);
        AUDIO_StartDMA();
      } else {
        start_dma_if_ready(audio);
      }
      IRQ_Restore(level);
      SYS_Report(
          "REFERENCE GX: audio=playing samples=%llu buffers=%u underruns=%u\n",
          transition_samples, audio->completed_buffers, audio->underruns);
    }
  } else if (playing) {
    start_dma_if_ready(audio);
  }

  if (audio->completed_buffers != 0 &&
      audio->completed_buffers % 100u == 0u) {
    static uint32_t reported_buffers;
    if (audio->completed_buffers != reported_buffers) {
      reported_buffers = audio->completed_buffers;
      SYS_Report(
          "REFERENCE GX: audio-progress buffers=%u samples=%llu "
          "decoder-frames=%u loops=%u underruns=%u\n",
          audio->completed_buffers, audio_dma_samples_played(audio),
          mp2_decoder_frame_count(audio->decoder),
          mp2_decoder_loop_count(audio->decoder), audio->underruns);
    }
  }
}

uint64_t audio_dma_samples_played(const AudioDma *audio) {
  if (audio == NULL) {
    return 0;
  }

  const uint32_t level = IRQ_Disable();
  const uint64_t samples = samples_played_locked(audio);
  IRQ_Restore(level);
  return samples;
}

uint32_t audio_dma_underruns(const AudioDma *audio) {
  return audio == NULL ? 0 : audio->underruns;
}
