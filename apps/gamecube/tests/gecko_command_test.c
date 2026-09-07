#include "gecko_command.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static unsigned feed(MultiplexGeckoCommand *command, const char *bytes) {
  unsigned accepted = 0;
  for (size_t index = 0; index < strlen(bytes); ++index) {
    accepted += multiplex_gecko_command_feed(command, (uint8_t)bytes[index]);
  }
  return accepted;
}

int main(void) {
  MultiplexGeckoCommand command = {0};
  assert(feed(&command, "MULTIPLEX:") == 0);
  assert(feed(&command, "EXIT") == 0);
  assert(feed(&command, "\n") == 1);
  assert(feed(&command, "\nhello\nMULTIPLEX:EXIT-extra\n") == 0);
  assert(feed(&command, "prefix-MULTIPLEX:EXIT\n") == 0);
  assert(feed(&command, "MULTIPLEX:EXIT\nMULTIPLEX:EXIT\n") == 2);
  assert(feed(&command, "MULTIPLEX:") == 0);
  assert(!multiplex_gecko_command_feed(&command, 0));
  assert(feed(&command, "EXIT\nMULTIPLEX:EXIT\n") == 1);
  puts("GameCube Gecko command tests passed.");
  return 0;
}
