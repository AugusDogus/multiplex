/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * AESND streaming structure adapted from MPlayer CE's libao2/ao_aesnd.c.
 * MPlayer CE is GPL-2.0-or-later; see ../LICENSE.md for attribution.
 */

#include "audio_aesnd.h"
#include "mp2_decoder.h"

#include <aesndlib.h>
#include <gccore.h>
#include <malloc.h>
#include <ogc/lwp.h>
#include <ogc/message.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

#define AUDIO_BURST_SIZE 5760
#define AUDIO_BUFFER_COUNT 18
#define AUDIO_DECODER_STACK_SIZE (128 * 1024)
#define AUDIO_CHANNELS 2
#define AUDIO_BYTES_PER_SAMPLE 2

struct AudioAesnd {
  Mp2Decoder *decoder;
  AESNDPB *voice;
  void *buffers[AUDIO_BUFFER_COUNT];
  mqbox_t free_buffers;
  mqbox_t ready_buffers;
  bool free_queue_ready;
  bool ready_queue_ready;
  lwp_t decoder_thread;
  void *decoder_stack;
  volatile bool stopping;
  volatile bool active;
  bool playing;
  void *active_buffer;
  volatile uint32_t completed_buffers;
  volatile uint32_t underruns;
};

static AudioAesnd *active_audio;

static void audio_callback(AESNDPB *voice, u32 state) {
  AudioAesnd *audio = active_audio;
  if (audio == NULL) {
    return;
  }

  if (state == VOICE_STATE_STOPPED) {
    audio->active = false;
    return;
  }
  if (state == VOICE_STATE_RUNNING) {
    audio->active = true;
    return;
  }
  if (state != VOICE_STATE_STREAM) {
    return;
  }

  if (audio->active_buffer != NULL) {
    MQ_Send(audio->free_buffers, audio->active_buffer, MQ_MSG_NOBLOCK);
    audio->active_buffer = NULL;
    audio->completed_buffers += 1;
  }

  mqmsg_t ready = NULL;
  if (MQ_Receive(audio->ready_buffers, &ready, MQ_MSG_NOBLOCK) &&
      ready != NULL) {
    audio->active_buffer = ready;
    AESND_SetVoiceBuffer(voice, ready, AUDIO_BURST_SIZE);
    return;
  }

  audio->underruns += 1;
  audio->active = false;
  AESND_SetVoiceStop(voice, true);
}

static void *run_audio_decoder(void *argument) {
  AudioAesnd *audio = argument;

  while (!audio->stopping) {
    mqmsg_t buffer = NULL;
    if (!MQ_Receive(audio->free_buffers, &buffer, MQ_MSG_NOBLOCK)) {
      usleep(1000);
      continue;
    }
    if (buffer == NULL) {
      continue;
    }
    if (!mp2_decoder_read_pcm(audio->decoder, buffer, AUDIO_BURST_SIZE)) {
      SYS_Report("REFERENCE GX: audio decoder failure\n");
      audio->stopping = true;
      break;
    }
    DCFlushRange(buffer, AUDIO_BURST_SIZE);
    while (!audio->stopping &&
           !MQ_Send(audio->ready_buffers, buffer, MQ_MSG_NOBLOCK)) {
      usleep(1000);
    }
  }
  return NULL;
}

static bool start_voice_if_ready(AudioAesnd *audio) {
  if (audio->active) {
    return true;
  }

  mqmsg_t ready = NULL;
  if (!MQ_Receive(audio->ready_buffers, &ready, MQ_MSG_NOBLOCK) ||
      ready == NULL) {
    return false;
  }
  audio->active_buffer = ready;
  AESND_SetVoiceBuffer(audio->voice, ready, AUDIO_BURST_SIZE);
  AESND_SetVoiceStop(audio->voice, false);
  audio->active = true;
  return true;
}

AudioAesnd *audio_aesnd_create(const uint8_t *stream, size_t stream_size) {
  if (active_audio != NULL) {
    return NULL;
  }

  AudioAesnd *audio = calloc(1, sizeof(*audio));
  if (audio == NULL) {
    return NULL;
  }
  audio->decoder_thread = LWP_THREAD_NULL;
  audio->decoder = mp2_decoder_create(stream, stream_size);
  if (audio->decoder == NULL) {
    audio_aesnd_destroy(audio);
    return NULL;
  }

  if (MQ_Init(&audio->free_buffers, AUDIO_BUFFER_COUNT) != 0) {
    SYS_Report("REFERENCE GX: audio queue initialization failed\n");
    audio_aesnd_destroy(audio);
    return NULL;
  }
  audio->free_queue_ready = true;
  if (MQ_Init(&audio->ready_buffers, AUDIO_BUFFER_COUNT) != 0) {
    SYS_Report("REFERENCE GX: audio queue initialization failed\n");
    audio_aesnd_destroy(audio);
    return NULL;
  }
  audio->ready_queue_ready = true;

  for (unsigned index = 0; index < AUDIO_BUFFER_COUNT; ++index) {
    audio->buffers[index] = memalign(32, AUDIO_BURST_SIZE);
    if (audio->buffers[index] == NULL ||
        !MQ_Send(audio->free_buffers, audio->buffers[index], MQ_MSG_NOBLOCK)) {
      SYS_Report("REFERENCE GX: audio buffer allocation failed\n");
      audio_aesnd_destroy(audio);
      return NULL;
    }
  }

  AESND_Init();
  AESND_Pause(true);
  audio->voice = AESND_AllocateVoice(audio_callback);
  if (audio->voice == NULL) {
    SYS_Report("REFERENCE GX: AESND voice allocation failed\n");
    audio_aesnd_destroy(audio);
    return NULL;
  }
  AESND_SetVoiceFormat(audio->voice, VOICE_STEREO16);
  AESND_SetVoiceFrequency(audio->voice, 48000);
  AESND_SetVoiceVolume(audio->voice, 0xff, 0xff);
  AESND_SetVoiceStream(audio->voice, true);
  AESND_SetVoiceStop(audio->voice, true);
  active_audio = audio;

  audio->decoder_stack = malloc(AUDIO_DECODER_STACK_SIZE);
  if (audio->decoder_stack == NULL ||
      LWP_CreateThread(&audio->decoder_thread, run_audio_decoder, audio,
                       audio->decoder_stack, AUDIO_DECODER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: audio decoder thread creation failed\n");
    audio_aesnd_destroy(audio);
    return NULL;
  }

  SYS_Report(
      "REFERENCE GX: audio=ffmpeg-mplayer-ce codec=mp2 output=aesnd "
      "rate=48000 channels=2 format=s16 buffers=%u burst=%u bytes\n",
      AUDIO_BUFFER_COUNT, AUDIO_BURST_SIZE);
  return audio;
}

void audio_aesnd_destroy(AudioAesnd *audio) {
  if (audio == NULL) {
    return;
  }

  audio->stopping = true;
  if (audio->decoder_thread != LWP_THREAD_NULL) {
    LWP_JoinThread(audio->decoder_thread, NULL);
  }
  if (audio->voice != NULL) {
    AESND_Pause(true);
    AESND_SetVoiceStop(audio->voice, true);
    if (active_audio == audio) {
      active_audio = NULL;
    }
    AESND_FreeVoice(audio->voice);
  }
  if (audio->ready_queue_ready) {
    MQ_Close(audio->ready_buffers);
  }
  if (audio->free_queue_ready) {
    MQ_Close(audio->free_buffers);
  }
  for (unsigned index = 0; index < AUDIO_BUFFER_COUNT; ++index) {
    free(audio->buffers[index]);
  }
  free(audio->decoder_stack);
  mp2_decoder_destroy(audio->decoder);
  free(audio);
}

void audio_aesnd_update(AudioAesnd *audio, bool playing) {
  if (audio == NULL) {
    return;
  }

  if (playing != audio->playing) {
    audio->playing = playing;
    if (!playing) {
      AESND_Pause(true);
      SYS_Report(
          "REFERENCE GX: audio=paused samples=%llu buffers=%u underruns=%u\n",
          audio_aesnd_samples_played(audio), audio->completed_buffers,
          audio->underruns);
    } else {
      start_voice_if_ready(audio);
      AESND_Pause(false);
      SYS_Report(
          "REFERENCE GX: audio=playing samples=%llu buffers=%u underruns=%u\n",
          audio_aesnd_samples_played(audio), audio->completed_buffers,
          audio->underruns);
    }
  } else if (playing && !audio->active && start_voice_if_ready(audio)) {
    AESND_Pause(false);
  }

  if (audio->completed_buffers != 0 &&
      audio->completed_buffers % 100u == 0u) {
    static uint32_t reported_buffers;
    if (audio->completed_buffers != reported_buffers) {
      reported_buffers = audio->completed_buffers;
      SYS_Report(
          "REFERENCE GX: audio-progress buffers=%u samples=%llu "
          "decoder-frames=%u loops=%u underruns=%u\n",
          audio->completed_buffers, audio_aesnd_samples_played(audio),
          mp2_decoder_frame_count(audio->decoder),
          mp2_decoder_loop_count(audio->decoder), audio->underruns);
    }
  }
}

uint64_t audio_aesnd_samples_played(const AudioAesnd *audio) {
  if (audio == NULL) {
    return 0;
  }
  return ((uint64_t)audio->completed_buffers * AUDIO_BURST_SIZE) /
         (AUDIO_CHANNELS * AUDIO_BYTES_PER_SAMPLE);
}

uint32_t audio_aesnd_underruns(const AudioAesnd *audio) {
  return audio == NULL ? 0 : audio->underruns;
}
