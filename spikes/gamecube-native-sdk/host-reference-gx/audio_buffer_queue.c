#include "audio_buffer_queue.h"

int audio_buffer_queue_find_state(const AudioBufferSlot *slots,
                                  size_t slot_count,
                                  AudioBufferState state) {
  for (size_t index = 0; index < slot_count; ++index) {
    if (slots[index].state == state) {
      return (int)index;
    }
  }
  return -1;
}

int audio_buffer_queue_find_oldest_ready(const AudioBufferSlot *slots,
                                         size_t slot_count) {
  int oldest = -1;
  uint64_t oldest_sequence = UINT64_MAX;
  for (size_t index = 0; index < slot_count; ++index) {
    if (slots[index].state == AUDIO_BUFFER_READY &&
        slots[index].ready_sequence < oldest_sequence) {
      oldest = (int)index;
      oldest_sequence = slots[index].ready_sequence;
    }
  }
  return oldest;
}
