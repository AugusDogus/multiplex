#include "gecko_command.h"

#include <string.h>

static bool hex_number(const char *text, size_t digits, uint32_t *result) {
  uint32_t value = 0;
  for (size_t index = 0; index < digits; ++index) {
    const unsigned char ch = (unsigned char)text[index];
    unsigned digit;
    if (ch >= '0' && ch <= '9') {
      digit = ch - '0';
    } else if (ch >= 'a' && ch <= 'f') {
      digit = ch - 'a' + 10u;
    } else if (ch >= 'A' && ch <= 'F') {
      digit = ch - 'A' + 10u;
    } else {
      return false;
    }
    value = (value << 4) | digit;
  }
  *result = value;
  return true;
}

static MultiplexGeckoRequest parse(const char *line, size_t length) {
  MultiplexGeckoRequest result = {.kind = MULTIPLEX_GECKO_NONE};
  if (length == 14 && memcmp(line, "MULTIPLEX:EXIT", 14) == 0) {
    result.kind = MULTIPLEX_GECKO_EXIT;
  } else if (length == 14 && memcmp(line, "MULTIPLEX:SHOT", 14) == 0) {
    result.kind = MULTIPLEX_GECKO_SCREENSHOT;
  } else if (length == 23 && memcmp(line, "MULTIPLEX:READ ", 15) == 0 &&
             hex_number(line + 15, 8, &result.payload.offset)) {
    result.kind = MULTIPLEX_GECKO_READ;
  } else if (length == 28 && memcmp(line, "MULTIPLEX:PAD ", 14) == 0 &&
             line[18] == ' ' && line[21] == ' ' && line[24] == ' ') {
    uint32_t buttons, x, y, duration;
    if (hex_number(line + 14, 4, &buttons) && hex_number(line + 19, 2, &x) &&
        hex_number(line + 22, 2, &y) && hex_number(line + 25, 3, &duration) &&
        (buttons & ~0x1f7fu) == 0) {
      result.kind = MULTIPLEX_GECKO_PAD;
      result.payload.pad = (MultiplexGeckoPad){
          .buttons = (uint16_t)buttons,
          .stick_x = (int8_t)(x <= 127 ? (int)x : (int)x - 256),
          .stick_y = (int8_t)(y <= 127 ? (int)y : (int)y - 256),
          .duration_ms = (uint16_t)duration,
      };
    }
  }
  return result;
}

MultiplexGeckoRequest
multiplex_gecko_command_feed(MultiplexGeckoCommand *command, uint8_t byte) {
  if (byte == '\n') {
    MultiplexGeckoRequest result = {.kind = MULTIPLEX_GECKO_NONE};
    if (command->length < sizeof(command->line)) {
      result = parse(command->line, command->length);
    }
    command->length = 0;
    return result;
  }
  if (command->length < sizeof(command->line)) {
    command->line[command->length++] = (char)byte;
  }
  return (MultiplexGeckoRequest){.kind = MULTIPLEX_GECKO_NONE};
}

void multiplex_gecko_input_set(MultiplexGeckoInput *input,
                               MultiplexGeckoPad pad, uint64_t now_ms) {
  if (now_ms >= input->expires_at_ms) {
    input->previous_buttons = 0;
  }
  input->pad = pad;
  input->expires_at_ms = now_ms + pad.duration_ms;
}

MultiplexGeckoInputSample multiplex_gecko_input_poll(MultiplexGeckoInput *input,
                                                     uint64_t now_ms) {
  const MultiplexGeckoPad pad =
      now_ms < input->expires_at_ms ? input->pad : (MultiplexGeckoPad){0};
  const MultiplexGeckoInputSample result = {
      .pressed = pad.buttons & ~input->previous_buttons,
      .held = pad.buttons,
      .stick_x = pad.stick_x,
      .stick_y = pad.stick_y,
  };
  input->previous_buttons = pad.buttons;
  return result;
}
