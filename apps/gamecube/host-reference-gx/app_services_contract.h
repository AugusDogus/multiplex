#ifndef MULTIPLEX_APP_SERVICES_CONTRACT_H
#define MULTIPLEX_APP_SERVICES_CONTRACT_H

#include "auth_record.h"
#include "gateway_client.h"
#include "trpc_client.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  bool playing;
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  uint32_t segment_start_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
  uint32_t subtitle_selection;
  bool prefetch_active;
} MultiplexAppServicesPlaybackView;

typedef enum {
  MULTIPLEX_APP_SERVICES_WORK_CATALOG = 0,
  MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE = 1,
  MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA = 2,
  MULTIPLEX_APP_SERVICES_WORK_BROWSE = 3,
  MULTIPLEX_APP_SERVICES_WORK_SEARCH = 4,
  MULTIPLEX_APP_SERVICES_WORK_DETAILS = 5,
  MULTIPLEX_APP_SERVICES_WORK_COUNT = 6,
} MultiplexAppServicesWorkKind;

typedef struct {
  uint32_t token;
  MultiplexAppServicesWorkKind kind;
  union {
    struct {
      MultiplexAuthCredentials credentials;
    } catalog;
    struct {
      MultiplexAuthCredentials credentials;
    } startup_data;
    struct {
      MultiplexAuthCredentials credentials;
      MultiplexGatewayLibrary library;
      uint16_t start;
    } browse;
    struct {
      MultiplexAuthCredentials credentials;
      char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
      uint16_t query_length;
    } search;
    struct {
      MultiplexAuthCredentials credentials;
      uint32_t rating_key;
    } details;
  } payload;
} MultiplexAppServicesWorkRequest;

typedef struct {
  const MultiplexGatewayCatalog *catalog;
} MultiplexAppServicesCatalogResultView;

typedef struct {
  const MultiplexGatewayBrowsePage *page;
} MultiplexAppServicesBrowseResultView;

typedef struct {
  const MultiplexGatewaySearchPage *page;
} MultiplexAppServicesSearchResultView;

typedef struct {
  const MultiplexGatewayDetails *details;
} MultiplexAppServicesDetailsResultView;

typedef enum {
  MULTIPLEX_APP_SERVICES_STARTUP_USER_NONE = 0,
  MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT = 1,
} MultiplexAppServicesStartupUserIdKind;

typedef struct {
  MultiplexAppServicesStartupUserIdKind kind;
  union {
    uint32_t id;
  } value;
} MultiplexAppServicesStartupUserId;

typedef struct {
  MultiplexAppServicesStartupUserId user;
  const MultiplexTrpcRoomList *rooms;
  const MultiplexTrpcInviteeList *invitees;
} MultiplexAppServicesStartupDataResultView;

typedef struct {
  uint32_t token;
  MultiplexAppServicesWorkKind kind;
  bool succeeded;
  uint64_t now_ms;
  union {
    MultiplexAppServicesCatalogResultView catalog;
    MultiplexAppServicesBrowseResultView browse;
    MultiplexAppServicesSearchResultView search;
    MultiplexAppServicesDetailsResultView details;
    MultiplexAppServicesStartupDataResultView startup_data;
  } payload;
} MultiplexAppServicesWorkResultView;

typedef enum {
  MULTIPLEX_APP_SERVICES_MODEL_BROWSE = 0,
  MULTIPLEX_APP_SERVICES_MODEL_SEARCH = 1,
  MULTIPLEX_APP_SERVICES_MODEL_DETAILS = 2,
  MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN = 3,
  MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK = 4,
  MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK_NAVIGATION = 5,
  MULTIPLEX_APP_SERVICES_MODEL_WATCH_CREATE = 6,
  MULTIPLEX_APP_SERVICES_MODEL_WATCH_JOIN = 7,
  MULTIPLEX_APP_SERVICES_MODEL_WATCH_EXIT = 8,
  MULTIPLEX_APP_SERVICES_MODEL_WATCH_LOBBY_LEAVE = 9,
  MULTIPLEX_APP_SERVICES_MODEL_FOCUS = 10,
  MULTIPLEX_APP_SERVICES_MODEL_WATCH_RECONNECT = 11,
  MULTIPLEX_APP_SERVICES_MODEL_MARK_WATCHED = 12,
} MultiplexAppServicesModelRequestKind;

typedef enum {
  MULTIPLEX_APP_SERVICES_SCREEN_HOME = 0,
  MULTIPLEX_APP_SERVICES_SCREEN_BROWSE = 1,
  MULTIPLEX_APP_SERVICES_SCREEN_SEARCH = 2,
  MULTIPLEX_APP_SERVICES_SCREEN_DETAILS = 3,
  MULTIPLEX_APP_SERVICES_SCREEN_PLAYER = 4,
  MULTIPLEX_APP_SERVICES_SCREEN_WATCH = 5,
  MULTIPLEX_APP_SERVICES_SCREEN_OTHER = 6,
} MultiplexAppServicesScreen;

typedef struct {
  uint16_t section_id;
  uint16_t start;
  uint16_t previous_start;
} MultiplexAppServicesBrowsePayload;

typedef struct {
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
  uint16_t query_length;
} MultiplexAppServicesSearchPayload;

typedef struct {
  uint32_t rating_key;
} MultiplexAppServicesDetailsPayload;

typedef struct {
  uint32_t rating_key;
  uint16_t start;
} MultiplexAppServicesDetailsChildrenPayload;

typedef struct {
  uint32_t rating_key;
  uint32_t offset_ms;
} MultiplexAppServicesPlaybackPayload;

typedef struct {
  int32_t direction;
} MultiplexAppServicesPlaybackNavigationPayload;

typedef struct {
  uint32_t rating_key;
  uint32_t invitee_user_id;
  char title[MULTIPLEX_TRPC_ROOM_TITLE_CAPACITY];
} MultiplexAppServicesWatchCreatePayload;

typedef struct {
  uint32_t room_index;
} MultiplexAppServicesWatchJoinPayload;

typedef struct {
  bool disband;
} MultiplexAppServicesWatchExitPayload;

typedef struct {
  uint64_t now_ms;
} MultiplexAppServicesWatchReconnectPayload;

typedef struct {
  uint32_t rating_key;
} MultiplexAppServicesMarkWatchedPayload;

typedef struct {
  MultiplexAppServicesScreen screen;
  uint32_t rating_key;
  uint64_t now_ms;
  bool active_input;
} MultiplexAppServicesFocusView;

typedef struct {
  MultiplexAppServicesModelRequestKind kind;
  union {
    MultiplexAppServicesBrowsePayload browse;
    MultiplexAppServicesSearchPayload search;
    MultiplexAppServicesDetailsPayload details;
    MultiplexAppServicesDetailsChildrenPayload details_children;
    MultiplexAppServicesPlaybackPayload playback;
    MultiplexAppServicesPlaybackNavigationPayload playback_navigation;
    MultiplexAppServicesWatchCreatePayload watch_create;
    MultiplexAppServicesWatchJoinPayload watch_join;
    MultiplexAppServicesWatchExitPayload watch_exit;
    MultiplexAppServicesWatchReconnectPayload watch_reconnect;
    MultiplexAppServicesMarkWatchedPayload mark_watched;
    MultiplexAppServicesFocusView focus;
  } payload;
} MultiplexAppServicesModelRequest;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED = 1,
  MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED = 2,
} MultiplexAppServicesPlaybackResultKind;

typedef struct {
  uint32_t token;
  MultiplexAppServicesPlaybackResultKind kind;
  MultiplexAppServicesPlaybackView playback;
} MultiplexAppServicesPlaybackResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_PREFETCH_READY = 0,
  MULTIPLEX_APP_SERVICES_PREFETCH_FAILED = 1,
  MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED = 2,
} MultiplexAppServicesPrefetchResultKind;

typedef struct {
  uint32_t token;
  MultiplexAppServicesPrefetchResultKind kind;
} MultiplexAppServicesPrefetchResult;

typedef struct {
  uint32_t token;
} MultiplexAppServicesResetQuiesce;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE = 1,
} MultiplexAppServicesPlaybackEventKind;

typedef struct {
  MultiplexAppServicesPlaybackEventKind kind;
  uint64_t now_ms;
  MultiplexAppServicesPlaybackView playback;
} MultiplexAppServicesPlaybackEvent;

typedef enum {
  MULTIPLEX_APP_SERVICES_POSTER_STARTED = 0,
  MULTIPLEX_APP_SERVICES_POSTER_COMPLETED = 1,
  MULTIPLEX_APP_SERVICES_POSTER_QUIESCED = 2,
  MULTIPLEX_APP_SERVICES_POSTER_FAILED = 3,
} MultiplexAppServicesPosterResultKind;

typedef struct {
  uint32_t token;
  MultiplexAppServicesPosterResultKind kind;
} MultiplexAppServicesPosterResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_INPUT_BOOT = 0,
  MULTIPLEX_APP_SERVICES_INPUT_TICK = 1,
  MULTIPLEX_APP_SERVICES_INPUT_AUTH_RESET_REQUESTED = 2,
  MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST = 3,
  MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW = 4,
  MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT = 5,
  MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT = 6,
  MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT = 7,
  MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT = 8,
  MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED = 9,
  MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED = 10,
} MultiplexAppServicesInputKind;

typedef struct {
  MultiplexAppServicesInputKind kind;
  union {
    struct {
      uint64_t now_ms;
      bool network_allowed;
    } boot;
    struct {
      uint64_t now_ms;
      bool network_allowed;
    } tick;
    struct {
      uint64_t now_ms;
    } auth_reset;
    MultiplexAppServicesModelRequest model_request;
    MultiplexAppServicesWorkResultView work_result;
    MultiplexAppServicesPlaybackResult playback_result;
    MultiplexAppServicesPlaybackEvent playback_event;
    MultiplexAppServicesPosterResult poster_result;
    MultiplexAppServicesPrefetchResult prefetch_result;
    MultiplexAppServicesResetQuiesce reset_storage_quiesced;
    MultiplexAppServicesResetQuiesce reset_runtime_quiesced;
  } payload;
} MultiplexAppServicesInput;

typedef enum {
  MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG = 0,
  MULTIPLEX_APP_SERVICES_POSTER_SOURCE_BROWSE = 1,
  MULTIPLEX_APP_SERVICES_POSTER_SOURCE_SEARCH = 2,
} MultiplexAppServicesPosterSource;

typedef struct {
  uint32_t token;
  MultiplexAppServicesPosterSource source;
  uint16_t texture_offset;
  uint16_t item_count;
  union {
    struct {
      uint16_t section_id;
      uint16_t start;
    } browse;
    struct {
      char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
      uint16_t query_length;
    } search;
  } payload;
} MultiplexAppServicesPosterPlan;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS = 1,
  MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS = 2,
  MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS = 3,
  MULTIPLEX_APP_SERVICES_PLAYBACK_STOP = 4,
} MultiplexAppServicesPlaybackEffectKind;

typedef struct {
  MultiplexAuthCredentials credentials;
  uint32_t rating_key;
  uint32_t offset_ms;
  uint32_t duration_ms;
  bool resume_current_session;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexAppServicesHlsOpen;

typedef struct {
  MultiplexAuthCredentials credentials;
  uint32_t rating_key;
  uint32_t offset_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexAppServicesHlsPrefetch;

typedef struct {
  uint32_t token;
  MultiplexAppServicesPlaybackEffectKind kind;
  union {
    struct {
      char gateway_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
      uint32_t rating_key;
      uint32_t offset_ms;
    } gateway;
    MultiplexAppServicesHlsOpen hls_open;
    MultiplexAppServicesHlsPrefetch hls_prefetch;
  } payload;
} MultiplexAppServicesPlaybackEffect;

typedef enum {
  MULTIPLEX_APP_SERVICES_PRESENTATION_REFRESH = 0,
  MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY = 1,
  MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY = 2,
  MULTIPLEX_APP_SERVICES_PRESENTATION_BROWSE_MOTION = 3,
  MULTIPLEX_APP_SERVICES_PRESENTATION_CONTROLS_ACTIVE = 4,
} MultiplexAppServicesPresentationEffectKind;

typedef struct {
  MultiplexAppServicesPresentationEffectKind kind;
  union {
    struct {
      bool asynchronous;
    } refresh;
    struct {
      bool visible;
    } activity;
    struct {
      uint16_t before;
      uint16_t after;
    } browse_motion;
    struct {
      uint64_t now_ms;
    } controls_active;
  } payload;
} MultiplexAppServicesPresentationEffect;

typedef enum {
  MULTIPLEX_APP_SERVICES_FAILURE_UI_BIND = 0,
  MULTIPLEX_APP_SERVICES_FAILURE_BACKGROUND_BIND = 1,
  MULTIPLEX_APP_SERVICES_FAILURE_PLAYBACK_CONTINUATION = 2,
} MultiplexAppServicesFailure;

typedef enum {
  MULTIPLEX_APP_SERVICES_EFFECT_WORK_REQUEST = 0,
  MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START = 1,
  MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK = 2,
  MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION = 3,
  MULTIPLEX_APP_SERVICES_EFFECT_FAILED = 4,
  MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE = 5,
  MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE = 6,
  MULTIPLEX_APP_SERVICES_EFFECT_RUNTIME_QUIESCE = 7,
} MultiplexAppServicesEffectKind;

typedef struct {
  uint32_t token;
} MultiplexAppServicesPosterQuiesce;

typedef struct {
  MultiplexAppServicesEffectKind kind;
  union {
    MultiplexAppServicesWorkRequest work;
    MultiplexAppServicesPosterPlan poster_start;
    MultiplexAppServicesPosterQuiesce poster_quiesce;
    MultiplexAppServicesPlaybackEffect playback;
    MultiplexAppServicesPresentationEffect presentation;
    MultiplexAppServicesFailure failure;
    MultiplexAppServicesResetQuiesce storage_quiesce;
    MultiplexAppServicesResetQuiesce runtime_quiesce;
  } payload;
} MultiplexAppServicesEffect;

typedef enum {
  MULTIPLEX_APP_SERVICES_DISPATCH_READY = 0,
  MULTIPLEX_APP_SERVICES_DISPATCH_INVALID_INPUT = 1,
  MULTIPLEX_APP_SERVICES_DISPATCH_EFFECT_OVERFLOW = 2,
  MULTIPLEX_APP_SERVICES_DISPATCH_FAILED = 3,
} MultiplexAppServicesDispatchResult;

#endif
