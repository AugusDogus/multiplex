#ifndef MULTIPLEX_PLEX_HLS_DEMUX_H
#define MULTIPLEX_PLEX_HLS_DEMUX_H

#include "auth_record.h"
#include "media_reader.h"
#include "playback_timeline_policy.h"
#include "plex_hls.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct PlexHlsDemux PlexHlsDemux;

PlexHlsDemux *plex_hls_demux_create(const MultiplexAuthCredentials *credentials,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    const char *session_id, bool burn_subtitles,
                                    uint32_t subtitle_stream_index);
PlexHlsDemux *plex_hls_demux_create_prepared(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    const MultiplexPlexHlsSession *session, const HlsMediaPlaylist *playlist);
bool plex_hls_demux_start(PlexHlsDemux *demux);
void plex_hls_demux_request_stop(PlexHlsDemux *demux);
bool plex_hls_demux_wait_ready(PlexHlsDemux *demux, size_t video_bytes,
                               size_t audio_bytes, uint32_t timeout_ms);
void plex_hls_demux_stop(PlexHlsDemux *demux);
void plex_hls_demux_destroy(PlexHlsDemux *demux);

size_t plex_hls_demux_read_video(void *context, uint8_t *destination,
                                 size_t size);
size_t plex_hls_demux_read_audio(void *context, uint8_t *destination,
                                 size_t size);
unsigned plex_hls_demux_width(const PlexHlsDemux *demux);
unsigned plex_hls_demux_height(const PlexHlsDemux *demux);
uint32_t plex_hls_demux_frame_rate_millihertz(const PlexHlsDemux *demux);
int64_t plex_hls_demux_first_video_pts90k(const PlexHlsDemux *demux);
int64_t plex_hls_demux_first_audio_pts90k(const PlexHlsDemux *demux);
uint32_t plex_hls_demux_segment_count(const PlexHlsDemux *demux);
uint32_t plex_hls_demux_video_bytes(const PlexHlsDemux *demux);
uint32_t plex_hls_demux_audio_bytes(const PlexHlsDemux *demux);
size_t plex_hls_demux_queued_video_bytes(PlexHlsDemux *demux);
size_t plex_hls_demux_queued_audio_bytes(PlexHlsDemux *demux);
bool plex_hls_demux_failed(const PlexHlsDemux *demux);
bool plex_hls_demux_complete(const PlexHlsDemux *demux);
const char *plex_hls_demux_session_id(const PlexHlsDemux *demux);
bool plex_hls_demux_report_timeline_now(PlexHlsDemux *demux,
                                        uint32_t position_ms,
                                        uint32_t duration_ms,
                                        PlaybackTimelineState state);
bool plex_hls_demux_request_timeline(PlexHlsDemux *demux, uint32_t position_ms,
                                     uint32_t duration_ms,
                                     PlaybackTimelineState state);

#endif
