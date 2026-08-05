#include "audio_buffer_queue.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#define SLOT_COUNT 18u

static void plays_ready_buffers_in_decode_order(void) {
  AudioBufferSlot slots[SLOT_COUNT];
  for (uint64_t index = 0; index < SLOT_COUNT; ++index) {
    slots[index].state = AUDIO_BUFFER_READY;
    slots[index].ready_sequence = index;
  }

  uint64_t next_sequence = SLOT_COUNT;
  for (uint64_t expected = 0; expected < SLOT_COUNT + 8u; ++expected) {
    const int selected =
        audio_buffer_queue_find_oldest_ready(slots, SLOT_COUNT);
    assert(selected >= 0);
    assert(slots[selected].ready_sequence == expected);

    slots[selected].state = AUDIO_BUFFER_DECODING;
    slots[selected].ready_sequence = next_sequence++;
    slots[selected].state = AUDIO_BUFFER_READY;
  }
}

int main(void) {
  plays_ready_buffers_in_decode_order();
  puts("GameCube audio buffer queue tests passed.");
  return 0;
}
