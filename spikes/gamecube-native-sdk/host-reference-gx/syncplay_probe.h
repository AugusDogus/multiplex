#ifndef MULTIPLEX_SYNCPLAY_PROBE_H
#define MULTIPLEX_SYNCPLAY_PROBE_H

#include "trpc_client.h"

#include <stdbool.h>

typedef struct MultiplexSyncplaySession MultiplexSyncplaySession;

MultiplexSyncplaySession *
multiplex_syncplay_session_connect(const MultiplexTrpcRoom *room,
                                   const char *device_identifier);
bool multiplex_syncplay_session_poll(MultiplexSyncplaySession *session);
void multiplex_syncplay_session_set_playback(
    MultiplexSyncplaySession *session, bool paused, uint32_t position_ms);
bool multiplex_syncplay_session_take_remote_playback(
    MultiplexSyncplaySession *session, bool *paused, uint32_t *position_ms);
unsigned multiplex_syncplay_session_participant_count(
    const MultiplexSyncplaySession *session);
void multiplex_syncplay_session_destroy(MultiplexSyncplaySession *session);

#endif
