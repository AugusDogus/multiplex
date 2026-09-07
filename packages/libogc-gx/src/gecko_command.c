#include "gecko_command.h"

bool multiplex_gecko_command_feed(MultiplexGeckoCommand *command,
                                  uint8_t byte) {
  static const char exit_command[] = "MULTIPLEX:EXIT";
  const size_t length = sizeof(exit_command) - 1u;
  if (byte == '\n') {
    const bool accepted = command->matched == length;
    command->matched = 0;
    return accepted;
  }
  if (command->matched < length && byte == exit_command[command->matched]) {
    command->matched += 1u;
  } else {
    command->matched = length + 1u;
  }
  return false;
}
