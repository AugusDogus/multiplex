#include "gecko_command.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static MultiplexGeckoRequest feed(MultiplexGeckoCommand *command,
                                  const char *bytes) {
  MultiplexGeckoRequest result = {.kind = MULTIPLEX_GECKO_NONE};
  for (size_t index = 0; index < strlen(bytes); ++index) {
    result = multiplex_gecko_command_feed(command, (uint8_t)bytes[index]);
    if (index + 1 < strlen(bytes)) {
      assert(result.kind == MULTIPLEX_GECKO_NONE);
    }
  }
  return result;
}

int main(void) {
  MultiplexGeckoCommand command = {0};
  assert(feed(&command, "MULTIPLEX:").kind == MULTIPLEX_GECKO_NONE);
  assert(feed(&command, "EXIT").kind == MULTIPLEX_GECKO_NONE);
  assert(feed(&command, "\n").kind == MULTIPLEX_GECKO_EXIT);
  assert(feed(&command, "MULTIPLEX:SHOT\n").kind == MULTIPLEX_GECKO_SCREENSHOT);
  const MultiplexGeckoRequest read =
      feed(&command, "MULTIPLEX:READ 00000200\n");
  assert(read.kind == MULTIPLEX_GECKO_READ && read.payload.offset == 512);
  const MultiplexGeckoRequest pad =
      feed(&command, "MULTIPLEX:PAD 0100 80 7f 064\n");
  assert(pad.kind == MULTIPLEX_GECKO_PAD);
  assert(pad.payload.pad.buttons == 0x100);
  assert(pad.payload.pad.stick_x == -128 && pad.payload.pad.stick_y == 127);
  assert(pad.payload.pad.duration_ms == 100);
  const char *invalid[] = {"prefix-MULTIPLEX:EXIT\n",
                           "MULTIPLEX:EXIT-extra\n",
                           "MULTIPLEX:EXI\n",
                           "MULTIPLEX:EXIT\r\n",
                           "MULTIPLEX:READ ffffffff-extra\n",
                           "MULTIPLEX:READ 00000g00\n",
                           "MULTIPLEX:PAD 8000 00 00 001\n",
                           "MULTIPLEX:PAD 0100 00 00 1000\n",
                           "MULTIPLEX:PAD 0100 00 00 -01\n"};
  for (size_t index = 0; index < sizeof(invalid) / sizeof(invalid[0]);
       ++index) {
    assert(feed(&command, invalid[index]).kind == MULTIPLEX_GECKO_NONE);
  }
  assert(feed(&command, "MULTIPLEX:").kind == MULTIPLEX_GECKO_NONE);
  assert(multiplex_gecko_command_feed(&command, 0).kind ==
         MULTIPLEX_GECKO_NONE);
  assert(feed(&command, "EXIT\n").kind == MULTIPLEX_GECKO_NONE);
  for (unsigned index = 0; index < 1000; ++index) {
    assert(multiplex_gecko_command_feed(&command, 'x').kind ==
           MULTIPLEX_GECKO_NONE);
  }
  assert(feed(&command, "MULTIPLEX:EXIT\n").kind == MULTIPLEX_GECKO_NONE);
  assert(feed(&command, "MULTIPLEX:EXIT\n").kind == MULTIPLEX_GECKO_EXIT);

  MultiplexGeckoInput input = {0};
  multiplex_gecko_input_set(&input, pad.payload.pad, 1000);
  MultiplexGeckoInputSample sample = multiplex_gecko_input_poll(&input, 1000);
  assert(sample.pressed == 0x100 && sample.held == 0x100);
  assert(sample.stick_x == -128 && sample.stick_y == 127);
  sample = multiplex_gecko_input_poll(&input, 1050);
  assert(sample.pressed == 0 && sample.held == 0x100);
  sample = multiplex_gecko_input_poll(&input, 1100);
  assert(sample.held == 0 && sample.stick_x == 0 && sample.stick_y == 0);
  multiplex_gecko_input_set(&input, pad.payload.pad, 1200);
  assert(multiplex_gecko_input_poll(&input, 1200).pressed == 0x100);
  multiplex_gecko_input_set(&input, (MultiplexGeckoPad){0}, 1201);
  assert(multiplex_gecko_input_poll(&input, 1201).held == 0);
  puts("GameCube Gecko command and input tests passed.");
  return 0;
}
