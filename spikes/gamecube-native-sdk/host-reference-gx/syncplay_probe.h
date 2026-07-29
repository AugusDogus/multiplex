#ifndef MULTIPLEX_SYNCPLAY_PROBE_H
#define MULTIPLEX_SYNCPLAY_PROBE_H

#include "trpc_client.h"

#include <stdbool.h>

bool multiplex_syncplay_probe_room(const MultiplexTrpcRoom *room,
                                   const char *device_identifier);

#endif
