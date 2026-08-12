#include "app_services_playback_resolution.h"

#include "app_services_request_slots.h"

#include "native_ui.h"
#include "plex_catalog.h"

#include <stdio.h>
#include <string.h>

bool multiplex_app_services_playback_resolution_bind_subtitles(
    const MultiplexGatewayDetails *details) {
  uint8_t subtitle_count = 0;
  uint32_t selected_subtitle = 0;
  char labels[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS]
             [MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY] = {{0}};
  uint8_t label_lengths[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS] = {0};
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (!subtitle->has_index ||
        subtitle_count >= MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      continue;
    }
    size_t length = strnlen(subtitle->label,
                            MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY - 1u);
    if (length == 0) {
      const int formatted = snprintf(labels[subtitle_count],
                                     MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY,
                                     "Subtitle %u", subtitle_count + 1u);
      if (formatted < 0 ||
          (size_t)formatted >= MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY) {
        return false;
      }
      length = (size_t)formatted;
    } else {
      memcpy(labels[subtitle_count], subtitle->label, length);
    }
    label_lengths[subtitle_count] = (uint8_t)length;
    ++subtitle_count;
    if (subtitle->selected) {
      selected_subtitle = subtitle_count;
    }
  }
  return multiplex_native_app_subtitles(
             subtitle_count, selected_subtitle, (const uint8_t *)labels,
             MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY, label_lengths) != 0;
}

bool multiplex_app_services_playback_resolution_format_episode(
    const MultiplexGatewayDetails *details, uint16_t *secondary_length,
    char *hierarchy, size_t hierarchy_capacity, uint32_t *hierarchy_length) {
  uint32_t season = details->parent_index;
  uint32_t episode = details->index;
  *secondary_length = details->secondary_length;
  const char *marker = strstr(details->secondary, " \xC2\xB7 S");
  if (marker != NULL) {
    unsigned parsed_season = 0;
    unsigned parsed_episode = 0;
    if (sscanf(marker + 4, "S%u E%u", &parsed_season, &parsed_episode) == 2) {
      season = parsed_season;
      episode = parsed_episode;
      *secondary_length = (uint16_t)(marker - details->secondary);
    }
  }
  int length = 0;
  if (strcmp(details->media_type, "Episode") == 0 && season != 0 &&
      episode != 0) {
    length = snprintf(hierarchy, hierarchy_capacity, "Season %u - Episode %u",
                      (unsigned)season, (unsigned)episode);
  }
  if (length < 0 || (size_t)length >= hierarchy_capacity) {
    return false;
  }
  *hierarchy_length = (uint32_t)length;
  return true;
}

#if MULTIPLEX_PAIRING_ENABLED
static void remember_subtitles(MultiplexAppServices *services,
                               const MultiplexGatewayDetails *details) {
  MultiplexAppServicesSubtitleMap map = {.rating_key = details->rating_key};
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    const MultiplexGatewaySubtitleStream *subtitle =
        &details->subtitle_streams[index];
    if (subtitle->has_index &&
        map.count < MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      map.stream_indices[map.count++] = subtitle->index;
    }
  }
  services->content.details.active_subtitles = map;
}

static void select_subtitle(const MultiplexGatewayDetails *details,
                            const MultiplexAppServicesSubtitleMap *active,
                            uint32_t rating_key, uint32_t selection, bool *burn,
                            uint32_t *stream_index) {
  *burn = false;
  *stream_index = 0;
  if (selection == 0) {
    return;
  }
  if (details != NULL) {
    uint32_t ordinal = 0;
    for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
      const MultiplexGatewaySubtitleStream *subtitle =
          &details->subtitle_streams[index];
      if (!subtitle->has_index) {
        continue;
      }
      if (++ordinal == selection) {
        *burn = true;
        *stream_index = subtitle->index;
        return;
      }
    }
  } else if (active->rating_key == rating_key && selection <= active->count) {
    *burn = true;
    *stream_index = active->stream_indices[selection - 1u];
  }
}
#endif

bool multiplex_app_services_playback_resolution_prepare_hls(
    MultiplexAppServices *services, const MultiplexAuthCredentials *credentials,
    uint32_t rating_key, uint32_t subtitle_selection,
    const MultiplexAppServicesPlaybackView *source,
    MultiplexAppServicesHlsPreparation *preparation) {
#if MULTIPLEX_PAIRING_ENABLED
  if (services == NULL || credentials == NULL || source == NULL ||
      preparation == NULL || rating_key == 0) {
    return false;
  }
  MultiplexGatewayDetails loaded;
  const MultiplexGatewayDetails *details =
      multiplex_app_services_details_slot_retained_result(
          &services->content.details);
  if (details != NULL && details->rating_key != rating_key) {
    details = NULL;
  }
  uint32_t duration_ms =
      source->rating_key == rating_key ? source->duration_ms : 0;
  if (duration_ms == 0) {
    if (details == NULL) {
      if (!multiplex_plex_load_details(credentials, rating_key, &loaded) ||
          loaded.duration_ms == 0) {
        return false;
      }
      multiplex_app_services_details_slot_store_result(
          &services->content.details, &loaded);
      details = &loaded;
    }
    duration_ms = details->duration_ms;
  }
  if (source->rating_key != rating_key && details != NULL &&
      !multiplex_app_services_playback_resolution_bind_subtitles(details)) {
    return false;
  }
  bool burn = source->rating_key == rating_key && source->burn_subtitles;
  uint32_t stream_index =
      source->rating_key == rating_key ? source->subtitle_stream_index : 0;
  select_subtitle(details, &services->content.details.active_subtitles,
                  rating_key, subtitle_selection, &burn, &stream_index);
  if (details != NULL) {
    remember_subtitles(services, details);
  }
  *preparation = (MultiplexAppServicesHlsPreparation){
      .duration_ms = duration_ms,
      .burn_subtitles = burn,
      .subtitle_stream_index = stream_index,
  };
  return true;
#else
  (void)services;
  (void)credentials;
  (void)rating_key;
  (void)subtitle_selection;
  (void)source;
  (void)preparation;
  return false;
#endif
}

MultiplexAppServicesPlaybackTarget
multiplex_app_services_playback_resolution_navigate(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackCommand *command) {
  MultiplexAppServicesPlaybackTarget target = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED,
  };
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  const MultiplexAppServicesPlaybackView *source =
      &command->payload.navigate.source;
  if (credentials == NULL || source->rating_key == 0) {
    target.kind = multiplex_native_app_playback_navigation_clear() != 0
                      ? MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE
                      : MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED;
    return target;
  }
  MultiplexGatewayItem item;
  const MultiplexPlexNextEpisodeResult result =
      command->payload.navigate.direction < 0
          ? multiplex_plex_load_previous_episode(credentials,
                                                 source->rating_key, &item)
          : multiplex_plex_load_next_episode(credentials, source->rating_key,
                                             &item);
  if (result != MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    target.kind = multiplex_native_app_playback_navigation_clear() != 0
                      ? MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE
                      : MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED;
    target.state.complete.refresh = true;
    return target;
  }
  MultiplexGatewayDetails details;
  char hierarchy[48] = {0};
  uint16_t secondary_length = 0;
  uint32_t hierarchy_length = 0;
  if (!multiplex_plex_load_details(credentials, item.rating_key, &details) ||
      !multiplex_app_services_playback_resolution_format_episode(
          &details, &secondary_length, hierarchy, sizeof(hierarchy),
          &hierarchy_length)) {
    target.kind = multiplex_native_app_playback_navigation_clear() != 0
                      ? MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE
                      : MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED;
    return target;
  }
  if (multiplex_native_app_playback_navigate(
          item.rating_key, (const uint8_t *)details.title, details.title_length,
          (const uint8_t *)details.secondary, secondary_length,
          (const uint8_t *)hierarchy, hierarchy_length,
          details.duration_ms) == 0) {
    return target;
  }
  multiplex_app_services_details_slot_store_result(&services->content.details,
                                                   &details);
  target.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_READY;
  target.state.ready.rating_key = item.rating_key;
#else
  (void)services;
  (void)command;
#endif
  return target;
}

MultiplexAppServicesPlaybackTarget
multiplex_app_services_playback_resolution_autoplay(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackCommand *command) {
  MultiplexAppServicesPlaybackTarget target = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED,
  };
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  const MultiplexAppServicesPlaybackView *completed =
      &command->payload.autoplay.completed;
  if (credentials == NULL || completed->rating_key == 0) {
    return target;
  }
  MultiplexGatewayItem next;
  if (multiplex_plex_load_next_episode(credentials, completed->rating_key,
                                       &next) !=
      MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    target.kind = multiplex_native_app_playback_complete() != 0
                      ? MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE
                      : MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED;
    target.state.complete.refresh = true;
    return target;
  }
  if (multiplex_native_app_playback_advance(
          next.rating_key, (const uint8_t *)next.title, next.title_length,
          next.duration_ms) == 0) {
    return target;
  }
  target.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_READY;
  target.state.ready.rating_key = next.rating_key;
#else
  (void)services;
  (void)command;
#endif
  return target;
}
