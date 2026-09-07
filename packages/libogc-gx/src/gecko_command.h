#ifndef MULTIPLEX_GECKO_COMMAND_H
#define MULTIPLEX_GECKO_COMMAND_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  size_t matched;
} MultiplexGeckoCommand;

// Accept only a complete MULTIPLEX:EXIT line. Invalid lines are discarded.
bool multiplex_gecko_command_feed(MultiplexGeckoCommand *command, uint8_t byte);

#endif
