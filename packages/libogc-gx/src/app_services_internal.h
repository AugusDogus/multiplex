#ifndef MULTIPLEX_APP_SERVICES_INTERNAL_H
#define MULTIPLEX_APP_SERVICES_INTERNAL_H

#include "app_services.h"
#include "app_services_policy.h"
#include "app_services_scheduler.h"
#include "catalog_cache.h"
#include "device_auth.h"
#include "media-source.h"
#include "syncplay_probe.h"

#define MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY 8u
#define MULTIPLEX_APP_SERVICES_EFFECT_BYTES_MAX 4096u
#define MULTIPLEX_APP_SERVICES_EFFECT_QUEUE_BYTES_MAX (32u * 1024u)
#define MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS 1000u

typedef enum {
  MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY = 0,
  MULTIPLEX_APP_SERVICES_BACKEND_PLEX = 1,
} MultiplexAppServicesBackend;

#if MULTIPLEX_PAIRING_ENABLED
#define MULTIPLEX_APP_SERVICES_COMPILED_BACKEND                                \
  MULTIPLEX_APP_SERVICES_BACKEND_PLEX
#else
#define MULTIPLEX_APP_SERVICES_COMPILED_BACKEND                                \
  MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY
#endif

typedef enum {
  MULTIPLEX_APP_SERVICES_AUTH_RESTORING = 0,
  MULTIPLEX_APP_SERVICES_AUTH_PAIRING = 1,
  MULTIPLEX_APP_SERVICES_AUTH_LINKED = 2,
  MULTIPLEX_APP_SERVICES_AUTH_RETRY_WAIT = 3,
} MultiplexAppServicesAuthKind;

typedef struct {
  MultiplexMemoryCardLocation location;
} MultiplexAppServicesAuthRestoring;

typedef struct {
  MultiplexAuthCredentials credentials;
  MultiplexMemoryCardLocation location;
  MultiplexDeviceAuth device_auth;
  uint32_t pairing_poll_frames;
} MultiplexAppServicesAuthPairing;

typedef struct {
  MultiplexAuthCredentials credentials;
  MultiplexMemoryCardLocation location;
  bool cached_catalog_available;
  uint8_t cached_catalog[MULTIPLEX_CATALOG_CACHE_SIZE];
} MultiplexAppServicesAuthLinked;

typedef struct {
  MultiplexMemoryCardLocation location;
  MultiplexDeviceAuth device_auth;
  MultiplexAppServicesRetry retry;
} MultiplexAppServicesAuthRetryWait;

typedef struct {
  MultiplexAppServicesAuthKind kind;
  bool network_allowed;
  union {
    MultiplexAppServicesAuthRestoring restoring;
    MultiplexAppServicesAuthPairing pairing;
    MultiplexAppServicesAuthLinked linked;
    MultiplexAppServicesAuthRetryWait retry_wait;
  } state;
} MultiplexAppServicesAuthState;

typedef enum {
  MULTIPLEX_APP_SERVICES_FOCUS_NONE = 0,
  MULTIPLEX_APP_SERVICES_FOCUS_PRESENT = 1,
} MultiplexAppServicesFocusKind;

typedef struct {
  MultiplexAppServicesFocusKind kind;
  union {
    MultiplexAppServicesFocusView view;
  } value;
} MultiplexAppServicesFocusSnapshot;

typedef enum {
  MULTIPLEX_APP_SERVICES_RESET_IDLE = 0,
  MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE = 1,
  MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE = 2,
  MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP = 3,
} MultiplexAppServicesResetKind;

typedef struct {
  uint32_t quiesce_token;
  uint64_t requested_at_ms;
} MultiplexAppServicesResetWaitStorageQuiesce;

typedef struct {
  uint32_t quiesce_token;
  uint64_t requested_at_ms;
  MultiplexMemoryCardLocation location;
} MultiplexAppServicesResetWaitRuntimeQuiesce;

typedef struct {
  uint32_t stop_token;
  uint64_t requested_at_ms;
  MultiplexMemoryCardLocation location;
} MultiplexAppServicesResetWaitStop;

typedef struct {
  MultiplexAppServicesResetKind kind;
  uint32_t last_completed_stop_token;
  union {
    MultiplexAppServicesResetWaitStorageQuiesce wait_storage_quiesce;
    MultiplexAppServicesResetWaitRuntimeQuiesce wait_runtime_quiesce;
    MultiplexAppServicesResetWaitStop wait_stop;
  } state;
} MultiplexAppServicesResetState;

typedef struct {
  MultiplexGatewayCatalog catalog;
  bool available;
  MultiplexAppServicesLoadState load;
  MultiplexAppServicesRetry retry;
  MultiplexAppServicesLoadState cache_save;
} MultiplexAppServicesCatalogState;

typedef struct {
  uint16_t section_id;
  uint16_t start;
  uint16_t previous_start;
} MultiplexAppServicesBrowseRequest;

typedef enum {
  MULTIPLEX_APP_SERVICES_BROWSE_RESULT_NONE = 0,
  MULTIPLEX_APP_SERVICES_BROWSE_RESULT_PRESENT = 1,
} MultiplexAppServicesBrowseResultKind;

typedef struct {
  MultiplexAppServicesBrowseResultKind kind;
  union {
    MultiplexGatewayBrowsePage page;
  } value;
} MultiplexAppServicesBrowseResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_BROWSE_LATEST_NONE = 0,
  MULTIPLEX_APP_SERVICES_BROWSE_LATEST_PRESENT = 1,
} MultiplexAppServicesBrowseLatestKind;

typedef struct {
  MultiplexAppServicesBrowseLatestKind kind;
  union {
    MultiplexAppServicesBrowseRequest request;
  } value;
} MultiplexAppServicesBrowseLatest;

typedef enum {
  MULTIPLEX_APP_SERVICES_BROWSE_IDLE = 0,
  MULTIPLEX_APP_SERVICES_BROWSE_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_BROWSE_ACTIVE = 2,
} MultiplexAppServicesBrowseSlotKind;

typedef struct {
  MultiplexAppServicesBrowseSlotKind kind;
  union {
    struct {
      MultiplexAppServicesBrowseResult result;
    } idle;
    struct {
      MultiplexAppServicesBrowseRequest request;
      MultiplexAppServicesBrowseResult result;
    } queued;
    struct {
      uint32_t token;
      MultiplexAppServicesBrowseRequest request;
      MultiplexAppServicesBrowseLatest latest;
      MultiplexAppServicesBrowseResult result;
    } active;
  } state;
} MultiplexAppServicesBrowseSlot;

typedef struct {
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
  uint16_t query_length;
} MultiplexAppServicesSearchRequest;

typedef enum {
  MULTIPLEX_APP_SERVICES_SEARCH_RESULT_NONE = 0,
  MULTIPLEX_APP_SERVICES_SEARCH_RESULT_PRESENT = 1,
} MultiplexAppServicesSearchResultKind;

typedef struct {
  MultiplexAppServicesSearchResultKind kind;
  union {
    MultiplexGatewaySearchPage page;
  } value;
} MultiplexAppServicesSearchResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_SEARCH_LATEST_NONE = 0,
  MULTIPLEX_APP_SERVICES_SEARCH_LATEST_PRESENT = 1,
} MultiplexAppServicesSearchLatestKind;

typedef struct {
  MultiplexAppServicesSearchLatestKind kind;
  union {
    MultiplexAppServicesSearchRequest request;
  } value;
} MultiplexAppServicesSearchLatest;

typedef enum {
  MULTIPLEX_APP_SERVICES_SEARCH_IDLE = 0,
  MULTIPLEX_APP_SERVICES_SEARCH_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_SEARCH_ACTIVE = 2,
} MultiplexAppServicesSearchSlotKind;

typedef struct {
  MultiplexAppServicesSearchSlotKind kind;
  union {
    struct {
      MultiplexAppServicesSearchResult result;
    } idle;
    struct {
      MultiplexAppServicesSearchRequest request;
      MultiplexAppServicesSearchResult result;
    } queued;
    struct {
      uint32_t token;
      MultiplexAppServicesSearchRequest request;
      MultiplexAppServicesSearchLatest latest;
      MultiplexAppServicesSearchResult result;
    } active;
  } state;
} MultiplexAppServicesSearchSlot;

typedef struct {
  uint32_t rating_key;
  uint32_t stream_indices[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS];
  uint8_t count;
} MultiplexAppServicesSubtitleMap;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH = 1,
} MultiplexAppServicesDetailsPurpose;

typedef struct {
  uint32_t rating_key;
  MultiplexAppServicesDetailsPurpose purpose;
} MultiplexAppServicesDetailsRequest;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_RESULT_NONE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT = 1,
} MultiplexAppServicesDetailsResultKind;

typedef struct {
  MultiplexAppServicesDetailsResultKind kind;
  union {
    MultiplexGatewayDetails details;
  } value;
} MultiplexAppServicesDetailsResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_LATEST_NONE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_LATEST_PRESENT = 1,
} MultiplexAppServicesDetailsLatestKind;

typedef struct {
  MultiplexAppServicesDetailsLatestKind kind;
  union {
    MultiplexAppServicesDetailsRequest request;
  } value;
} MultiplexAppServicesDetailsLatest;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_IDLE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_DETAILS_ACTIVE = 2,
} MultiplexAppServicesDetailsSlotKind;

typedef struct {
  MultiplexAppServicesDetailsSlotKind kind;
  union {
    struct {
      MultiplexAppServicesDetailsResult result;
    } idle;
    struct {
      MultiplexAppServicesDetailsRequest request;
      MultiplexAppServicesDetailsResult result;
    } queued;
    struct {
      uint32_t token;
      MultiplexAppServicesDetailsRequest request;
      MultiplexAppServicesDetailsLatest latest;
      MultiplexAppServicesDetailsResult result;
    } active;
  } state;
  uint32_t prefetch_candidate_key;
  uint64_t prefetch_at_ms;
  MultiplexAppServicesSubtitleMap active_subtitles;
} MultiplexAppServicesDetailsSlot;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_NONE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT = 1,
} MultiplexAppServicesDetailsPrefetchTargetKind;

typedef struct {
  uint32_t rating_key;
  uint32_t offset_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexAppServicesDetailsPrefetchRequest;

typedef struct {
  MultiplexAppServicesDetailsPrefetchTargetKind kind;
  union {
    MultiplexAppServicesDetailsPrefetchRequest prefetch;
  } value;
} MultiplexAppServicesDetailsPrefetchTarget;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINING = 2,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINED = 3,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED = 4,
  MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASING = 5,
} MultiplexAppServicesDetailsPrefetchKind;

typedef struct {
  MultiplexAppServicesDetailsPrefetchKind kind;
  union {
    struct {
      MultiplexAppServicesDetailsPrefetchRequest prefetch;
    } retain_queued;
    struct {
      uint32_t token;
      MultiplexAppServicesDetailsPrefetchRequest active;
      MultiplexAppServicesDetailsPrefetchTarget desired;
    } retaining;
    struct {
      MultiplexAppServicesDetailsPrefetchRequest active;
    } retained;
    struct {
      MultiplexAppServicesDetailsPrefetchTarget desired;
    } release_queued;
    struct {
      uint32_t token;
      MultiplexAppServicesDetailsPrefetchTarget desired;
    } releasing;
  } state;
} MultiplexAppServicesDetailsPrefetch;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_UNKNOWN = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN = 1,
} MultiplexAppServicesPlaybackStateKind;

typedef struct {
  MultiplexAppServicesPlaybackStateKind kind;
  union {
    MultiplexAppServicesPlaybackView view;
  } value;
} MultiplexAppServicesPlaybackState;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_OPEN = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_NAVIGATE = 1,
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_AUTOPLAY = 2,
} MultiplexAppServicesPlaybackCommandKind;

typedef struct {
  MultiplexAppServicesPlaybackCommandKind kind;
  union {
    MultiplexAppServicesPlaybackPayload open;
    struct {
      int32_t direction;
      MultiplexAppServicesPlaybackView source;
    } navigate;
    struct {
      MultiplexAppServicesPlaybackView completed;
      uint64_t now_ms;
    } autoplay;
  } payload;
} MultiplexAppServicesPlaybackCommand;

typedef enum {
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE = 0,
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_ACTIVE = 2,
} MultiplexAppServicesPlaybackCommandSlotKind;

typedef struct {
  MultiplexAppServicesPlaybackCommandSlotKind kind;
  union {
    struct {
      MultiplexAppServicesPlaybackCommand command;
    } queued;
    struct {
      uint32_t token;
      MultiplexAppServicesPlaybackCommand command;
    } active;
  } state;
} MultiplexAppServicesPlaybackCommandSlot;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_ACTION_CHILDREN = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_ACTION_MARK_WATCHED = 1,
} MultiplexAppServicesDetailsActionKind;

typedef struct {
  MultiplexAppServicesDetailsActionKind kind;
  union {
    struct {
      uint32_t rating_key;
      uint16_t start;
    } children;
    struct {
      uint32_t rating_key;
    } mark_watched;
  } payload;
} MultiplexAppServicesDetailsAction;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_ACTION_IDLE = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED = 1,
} MultiplexAppServicesDetailsActionSlotKind;

typedef struct {
  MultiplexAppServicesDetailsActionSlotKind kind;
  union {
    struct {
      MultiplexAppServicesDetailsAction action;
    } queued;
  } state;
} MultiplexAppServicesDetailsActionSlot;

typedef struct {
  MultiplexAppServicesCatalogState catalog;
  MultiplexAppServicesBrowseSlot browse;
  MultiplexAppServicesSearchSlot search;
  MultiplexAppServicesDetailsSlot details;
  MultiplexAppServicesDetailsPrefetch details_prefetch;
  MultiplexAppServicesDetailsActionSlot details_action;
  MultiplexAppServicesPlaybackState playback;
  MultiplexAppServicesPlaybackCommandSlot playback_command;
  uint64_t startup_data_not_before_ms;
  MultiplexAppServicesLoadState startup_data;
  uint32_t poster_plan_token;
} MultiplexAppServicesContentState;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE = 0,
  MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE = 1,
} MultiplexAppServicesWatchKind;

typedef enum {
  MULTIPLEX_APP_SERVICES_HOSTED_ROOM_NONE = 0,
  MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT = 1,
} MultiplexAppServicesHostedRoomKind;

typedef struct {
  MultiplexAppServicesHostedRoomKind kind;
  char id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY];
  uint32_t invitee_user_id;
} MultiplexAppServicesHostedRoom;

typedef struct {
  MultiplexTrpcRoomList rooms;
  MultiplexTrpcInviteeList invitees;
  uint32_t plex_user_id;
  MultiplexAppServicesHostedRoom hosted;
} MultiplexAppServicesWatchDirectory;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_ROTATION_COMPLETE = 0,
  MULTIPLEX_APP_SERVICES_WATCH_ROTATION_READY = 1,
} MultiplexAppServicesWatchRotationKind;

typedef struct {
  MultiplexAppServicesWatchRotationKind kind;
  uint32_t room_index;
  char previous_room_id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY];
  bool created;
} MultiplexAppServicesWatchRotation;

typedef struct {
  uint32_t joined_room_index;
  uint64_t all_present_since_ms;
  MultiplexSyncplaySession *syncplay;
} MultiplexAppServicesWatchLobby;

typedef struct {
  uint32_t joined_room_index;
  MultiplexSyncplaySession *syncplay;
} MultiplexAppServicesWatchActive;

typedef struct {
  uint32_t joined_room_index;
  MultiplexAppServicesRetry retry;
} MultiplexAppServicesWatchReconnectWait;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_START_LOBBY = 0,
  MULTIPLEX_APP_SERVICES_WATCH_START_LOCAL_SEEK = 1,
  MULTIPLEX_APP_SERVICES_WATCH_START_REMOTE_SEEK = 2,
  MULTIPLEX_APP_SERVICES_WATCH_START_ROTATION = 3,
} MultiplexAppServicesWatchStartPurpose;

typedef struct {
  MultiplexAppServicesWatchStartPurpose purpose;
  union {
    struct {
      bool paused;
    } remote_seek;
    struct {
      char previous_room_id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY];
      bool created;
    } rotation;
  } value;
} MultiplexAppServicesWatchPlaybackContext;

typedef struct {
  uint32_t joined_room_index;
  uint32_t position_ms;
  MultiplexAppServicesPlaybackView current;
  MultiplexSyncplaySession *syncplay;
  MultiplexAppServicesWatchPlaybackContext context;
} MultiplexAppServicesWatchQueuedPlayback;

typedef struct {
  uint32_t joined_room_index;
  uint32_t playback_token;
  MultiplexSyncplaySession *syncplay;
  MultiplexAppServicesWatchPlaybackContext context;
} MultiplexAppServicesWatchStartingPlayback;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_COMMAND_CREATE = 0,
  MULTIPLEX_APP_SERVICES_WATCH_COMMAND_JOIN = 1,
  MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT = 2,
  MULTIPLEX_APP_SERVICES_WATCH_COMMAND_ROTATION = 3,
} MultiplexAppServicesWatchCommandKind;

typedef struct {
  MultiplexAppServicesWatchCommandKind kind;
  union {
    MultiplexAppServicesWatchCreatePayload create;
    MultiplexAppServicesWatchJoinPayload join;
    struct {
      bool disband;
      uint32_t room_index;
      MultiplexSyncplaySession *syncplay;
    } exit;
    struct {
      MultiplexAppServicesPlaybackView completed;
      uint64_t now_ms;
      uint32_t room_index;
      MultiplexSyncplaySession *syncplay;
    } rotation;
  } payload;
} MultiplexAppServicesWatchQueuedCommand;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_STOP_EXIT = 0,
  MULTIPLEX_APP_SERVICES_WATCH_STOP_ROTATION = 1,
} MultiplexAppServicesWatchStopContinuationKind;

typedef struct {
  uint32_t stop_token;
  MultiplexSyncplaySession *syncplay;
  MultiplexAppServicesWatchStopContinuationKind kind;
  union {
    struct {
      bool disband;
      uint32_t room_index;
    } exit;
    struct {
      MultiplexAppServicesPlaybackView completed;
      uint64_t now_ms;
      uint32_t room_index;
    } rotation;
  } continuation;
} MultiplexAppServicesWatchWaitStop;

typedef enum {
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST = 0,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY = 1,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE = 2,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT = 3,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND = 4,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK = 5,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK = 6,
  MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP = 7,
} MultiplexAppServicesWatchPhaseKind;

typedef struct {
  MultiplexAppServicesWatchPhaseKind kind;
  union {
    MultiplexAppServicesWatchLobby lobby;
    MultiplexAppServicesWatchActive active;
    MultiplexAppServicesWatchReconnectWait reconnect_wait;
    MultiplexAppServicesWatchQueuedCommand queued_command;
    MultiplexAppServicesWatchQueuedPlayback queued_playback;
    MultiplexAppServicesWatchStartingPlayback starting_playback;
    MultiplexAppServicesWatchWaitStop wait_stop;
  } state;
} MultiplexAppServicesWatchPhase;

typedef struct {
  MultiplexAppServicesWatchDirectory directory;
  MultiplexAppServicesWatchPhase phase;
} MultiplexAppServicesWatchAvailable;

typedef struct {
  MultiplexAppServicesWatchKind kind;
  union {
    MultiplexAppServicesWatchAvailable available;
  } state;
} MultiplexAppServicesWatchState;

struct MultiplexAppServices {
  MultiplexAppServicesAuthState auth;
  MultiplexAppServicesResetState reset;
  MultiplexAppServicesFocusSnapshot focus;
  MultiplexAppServicesContentState content;
  MultiplexAppServicesWatchState watch;
  MultiplexAppServicesScheduler scheduler;
  MultiplexAppServicesEffect effects[MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY];
  uint8_t effect_head;
  uint8_t effect_count;
  uint32_t next_token;
  MultiplexAppServicesDispatchResult dispatch_result;
};

_Static_assert(sizeof(MultiplexAppServicesEffect) <=
                   MULTIPLEX_APP_SERVICES_EFFECT_BYTES_MAX,
               "AppServices effects must remain small");
_Static_assert(sizeof(((MultiplexAppServices *)0)->effects) <=
                   MULTIPLEX_APP_SERVICES_EFFECT_QUEUE_BYTES_MAX,
               "AppServices effect queue exceeds its memory budget");
_Static_assert(sizeof(MultiplexAppServices) <= 64u * 1024u,
               "AppServices exceeds its heap budget");

uint32_t multiplex_app_services_next_token(MultiplexAppServices *services);

bool multiplex_app_services_queue(MultiplexAppServices *services,
                                  const MultiplexAppServicesEffect *effect);
bool multiplex_app_services_queue_presentation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPresentationEffect *effect);
bool multiplex_app_services_queue_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkRequest *request);
bool multiplex_app_services_queue_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEffect *playback);
bool multiplex_app_services_queue_refresh(MultiplexAppServices *services,
                                          bool asynchronous);
bool multiplex_app_services_queue_network_activity(
    MultiplexAppServices *services, bool visible);
bool multiplex_app_services_queue_blocking_activity(
    MultiplexAppServices *services, bool visible);
bool multiplex_app_services_queue_controls_active(
    MultiplexAppServices *services, uint64_t now_ms);
bool multiplex_app_services_queue_failure(MultiplexAppServices *services,
                                          MultiplexAppServicesFailure failure);

void multiplex_app_services_auth_initialize(MultiplexAppServices *services);
bool multiplex_app_services_auth_boot(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed);
bool multiplex_app_services_auth_tick(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed);
bool multiplex_app_services_auth_prepare_reset(
    const MultiplexAppServices *services, MultiplexMemoryCardLocation *location,
    bool *deleted);
bool multiplex_app_services_auth_begin_pairing(
    MultiplexAppServices *services, MultiplexMemoryCardLocation location,
    uint64_t now_ms, uint32_t retry_delay_ms);
bool multiplex_app_services_auth_linked(const MultiplexAppServices *services);
const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services);

bool multiplex_app_services_content_open_hls(
    MultiplexAppServices *services, uint32_t rating_key,
    uint32_t requested_offset, uint32_t subtitle_selection,
    const MultiplexAppServicesPlaybackView *current, bool from_watch,
    uint32_t *token);

void multiplex_app_services_catalog_initialize(MultiplexAppServices *services);
bool multiplex_app_services_catalog_boot(MultiplexAppServices *services,
                                         uint64_t now_ms);
bool multiplex_app_services_catalog_tick(MultiplexAppServices *services,
                                         uint64_t now_ms, bool network_allowed);
bool multiplex_app_services_catalog_focus(
    MultiplexAppServices *services, const MultiplexAppServicesFocusView *focus);
bool multiplex_app_services_catalog_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result);

bool multiplex_app_services_discovery_request_browse(
    MultiplexAppServices *services,
    const MultiplexAppServicesBrowsePayload *request);
bool multiplex_app_services_discovery_request_search(
    MultiplexAppServices *services,
    const MultiplexAppServicesSearchPayload *request);
bool multiplex_app_services_discovery_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result);

bool multiplex_app_services_details_request_details(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsPayload *request);
bool multiplex_app_services_details_request_children(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsChildrenPayload *request);
bool multiplex_app_services_playback_request(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request);
bool multiplex_app_services_playback_request_navigation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackNavigationPayload *request);
bool multiplex_app_services_details_request_mark_watched(
    MultiplexAppServices *services,
    const MultiplexAppServicesMarkWatchedPayload *request);
bool multiplex_app_services_details_focus(
    MultiplexAppServices *services, const MultiplexAppServicesFocusView *focus);
bool multiplex_app_services_details_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result);
bool multiplex_app_services_details_apply_prefetch_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPrefetchResult *result);
bool multiplex_app_services_playback_apply_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result);
bool multiplex_app_services_playback_apply_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event);

void multiplex_app_services_watch_initialize(MultiplexAppServices *services);
void multiplex_app_services_watch_destroy(MultiplexAppServices *services);
MultiplexSyncplaySession *multiplex_app_services_watch_take_current_syncplay(
    MultiplexAppServicesWatchState *watch);
void multiplex_app_services_watch_enter_room_list(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory directory);
bool multiplex_app_services_watch_begin_playback(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory directory, uint32_t room_index,
    uint32_t position_ms, const MultiplexAppServicesPlaybackView *current,
    MultiplexAppServicesWatchPlaybackContext context);
bool multiplex_app_services_watch_reset(MultiplexAppServices *services);
bool multiplex_app_services_watch_tick(
    MultiplexAppServices *services, uint64_t now_ms,
    const MultiplexAppServicesPlaybackView *playback);
bool multiplex_app_services_watch_request_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request);
bool multiplex_app_services_watch_request_create(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchCreatePayload *request);
bool multiplex_app_services_watch_request_join(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchJoinPayload *request);
bool multiplex_app_services_watch_request_exit(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchExitPayload *request);
bool multiplex_app_services_watch_request_lobby_leave(
    MultiplexAppServices *services);
bool multiplex_app_services_watch_request_reconnect(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchReconnectPayload *request);
bool multiplex_app_services_watch_has_session(
    const MultiplexAppServices *services);
bool multiplex_app_services_watch_apply_startup(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result);
bool multiplex_app_services_watch_apply_playback_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result);
bool multiplex_app_services_watch_apply_playback_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event);

bool multiplex_app_services_watch_directory_bind_rooms(
    const MultiplexTrpcRoomList *rooms, bool available);
bool multiplex_app_services_watch_directory_bind_invitees(
    const MultiplexTrpcInviteeList *invitees, bool available);
uint32_t multiplex_app_services_watch_directory_rating_key(
    const MultiplexTrpcRoom *room);
bool multiplex_app_services_watch_directory_refresh(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory);
bool multiplex_app_services_watch_directory_create(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesWatchCreatePayload *request);
bool multiplex_app_services_watch_directory_delete_hosted(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory, uint32_t room_index,
    bool *deleted);
bool multiplex_app_services_watch_directory_plan_rotation(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesPlaybackView *completed,
    uint32_t joined_room_index, bool wait_for_web_creator,
    MultiplexAppServicesWatchRotation *rotation);

#endif
