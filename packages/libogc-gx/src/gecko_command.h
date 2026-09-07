#ifndef MULTIPLEX_GECKO_COMMAND_H
#define MULTIPLEX_GECKO_COMMAND_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint16_t buttons;
  int8_t stick_x;
  int8_t stick_y;
  uint16_t duration_ms;
} MultiplexGeckoPad;

typedef enum {
  MULTIPLEX_GECKO_NONE,
  MULTIPLEX_GECKO_EXIT,
  MULTIPLEX_GECKO_SCREENSHOT,
  MULTIPLEX_GECKO_READ,
  MULTIPLEX_GECKO_PAD,
} MultiplexGeckoCommandKind;

typedef struct {
  MultiplexGeckoCommandKind kind;
  union {
    uint32_t offset;
    MultiplexGeckoPad pad;
  } payload;
} MultiplexGeckoRequest;

typedef struct {
  char line[64];
  size_t length;
} MultiplexGeckoCommand;

typedef struct {
  MultiplexGeckoPad pad;
  uint64_t expires_at_ms;
  uint16_t previous_buttons;
} MultiplexGeckoInput;

typedef struct {
  uint16_t pressed;
  uint16_t held;
  int8_t stick_x;
  int8_t stick_y;
} MultiplexGeckoInputSample;

// Only complete, strictly validated lines produce requests. Overlong lines
// are discarded through the next newline, without interpreting their suffix.
MultiplexGeckoRequest
multiplex_gecko_command_feed(MultiplexGeckoCommand *command, uint8_t byte);
void multiplex_gecko_input_set(MultiplexGeckoInput *input,
                               MultiplexGeckoPad pad, uint64_t now_ms);
MultiplexGeckoInputSample multiplex_gecko_input_poll(MultiplexGeckoInput *input,
                                                     uint64_t now_ms);

#endif
