#ifndef MULTIPLEX_AUDIO_BUFFER_QUEUE_H
#define MULTIPLEX_AUDIO_BUFFER_QUEUE_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
  AUDIO_BUFFER_FREE,
  AUDIO_BUFFER_DECODING,
  AUDIO_BUFFER_READY,
  AUDIO_BUFFER_ACTIVE,
  AUDIO_BUFFER_QUEUED,
} AudioBufferState;

typedef struct {
  volatile AudioBufferState state;
  volatile uint64_t ready_sequence;
} AudioBufferSlot;

int audio_buffer_queue_find_state(const AudioBufferSlot *slots,
                                  size_t slot_count, AudioBufferState state);
int audio_buffer_queue_find_oldest_ready(const AudioBufferSlot *slots,
                                         size_t slot_count);

#endif
