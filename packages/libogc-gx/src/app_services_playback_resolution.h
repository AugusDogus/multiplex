#ifndef MULTIPLEX_APP_SERVICES_PLAYBACK_RESOLUTION_H
#define MULTIPLEX_APP_SERVICES_PLAYBACK_RESOLUTION_H

#include "app_services_internal.h"

typedef struct {
  uint32_t duration_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexAppServicesHlsPreparation;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_READY = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE = 1,
  MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED = 2,
} MultiplexAppServicesPlaybackTargetKind;

typedef struct {
  MultiplexAppServicesPlaybackTargetKind kind;
  union {
    struct {
      uint32_t rating_key;
    } ready;
    struct {
      bool refresh;
    } complete;
  } state;
} MultiplexAppServicesPlaybackTarget;

bool multiplex_app_services_playback_resolution_bind_subtitles(
    const MultiplexGatewayDetails *details);
bool multiplex_app_services_playback_resolution_format_episode(
    const MultiplexGatewayDetails *details, uint16_t *secondary_length,
    char *hierarchy, size_t hierarchy_capacity, uint32_t *hierarchy_length);
bool multiplex_app_services_playback_resolution_prepare_hls(
    MultiplexAppServices *services, const MultiplexAuthCredentials *credentials,
    uint32_t rating_key, uint32_t subtitle_selection,
    const MultiplexAppServicesPlaybackView *source,
    MultiplexAppServicesHlsPreparation *preparation);
MultiplexAppServicesPlaybackTarget
multiplex_app_services_playback_resolution_navigate(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackCommand *command);
MultiplexAppServicesPlaybackTarget
multiplex_app_services_playback_resolution_autoplay(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackCommand *command);

#endif
