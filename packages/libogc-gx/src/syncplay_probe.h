#ifndef MULTIPLEX_SYNCPLAY_PROBE_H
#define MULTIPLEX_SYNCPLAY_PROBE_H

#include "trpc_client.h"

#include <stdbool.h>

typedef struct MultiplexSyncplaySession MultiplexSyncplaySession;

MultiplexSyncplaySession *
multiplex_syncplay_session_connect(const MultiplexTrpcRoom *room,
                                   const char *device_identifier,
                                   uint32_t user_id, bool observer);
bool multiplex_syncplay_session_poll(MultiplexSyncplaySession *session);
void multiplex_syncplay_session_set_playback(MultiplexSyncplaySession *session,
                                             bool paused, uint32_t position_ms);
void multiplex_syncplay_session_adopt_playback(
    MultiplexSyncplaySession *session, bool paused, uint32_t position_ms);
void multiplex_syncplay_session_mark_local_seek(
    MultiplexSyncplaySession *session);
bool multiplex_syncplay_session_take_remote_playback(
    MultiplexSyncplaySession *session, bool *paused, uint32_t *position_ms,
    bool *seek);
unsigned multiplex_syncplay_session_participant_count(
    const MultiplexSyncplaySession *session);

bool multiplex_syncplay_session_has_web_participant(
    const MultiplexSyncplaySession *session);
bool multiplex_syncplay_session_room_position(
    const MultiplexSyncplaySession *session, uint32_t *position_ms,
    bool *paused);
void multiplex_syncplay_session_destroy(MultiplexSyncplaySession *session);

#endif
