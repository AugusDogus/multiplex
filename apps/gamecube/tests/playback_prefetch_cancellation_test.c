#include "playback_prefetch.h"

#include "plex_hls.h"

#include <assert.h>
#include <gccore.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  void *(*entry)(void *);
  void *context;
  bool joined;
} FakeThread;

static FakeThread threads[4];
static unsigned thread_count;
static unsigned join_count;
static unsigned hls_cancellation_count;
static unsigned hls_stop_count;
static unsigned program_cancellation_count;
static bool join_completed;

void SYS_Report(const char *message, ...) { (void)message; }
uint32_t gettick(void) { return 1u; }
uint32_t ticks_to_microsecs(uint32_t ticks) { return ticks; }

int LWP_CreateThread(lwp_t *thread, void *(*entry)(void *), void *context,
                     void *stack, size_t stack_size, int priority) {
  (void)stack;
  (void)stack_size;
  (void)priority;
  thread_count += 1u;
  assert(thread_count < sizeof(threads) / sizeof(threads[0]));
  threads[thread_count] = (FakeThread){.entry = entry, .context = context};
  *thread = thread_count;
  return 0;
}

int LWP_JoinThread(lwp_t thread, void **result) {
  (void)result;
  assert(thread != LWP_THREAD_NULL && thread <= thread_count);
  FakeThread *fake = &threads[thread];
  assert(!fake->joined);
  fake->joined = true;
  join_count += 1u;
  fake->entry(fake->context);
  join_completed = true;
  return 0;
}

bool multiplex_plex_hls_start_cancellable(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    uint32_t offset_ms, const char *session_id, bool burn_subtitles,
    uint32_t subtitle_stream_index, MultiplexPlexHlsSession *session,
    const MultiplexHttpCancellation *cancellation) {
  (void)credentials;
  (void)rating_key;
  (void)offset_ms;
  (void)session_id;
  (void)burn_subtitles;
  (void)subtitle_stream_index;
  assert(multiplex_http_cancellation_requested(cancellation));
  session->server_cleanup_required = true;
  strcpy(session->session_id, "fixture-session");
  hls_cancellation_count += 1u;
  return false;
}

bool multiplex_plex_hls_refresh_cancellable(
    const MultiplexAuthCredentials *credentials,
    MultiplexPlexHlsSession *session, HlsMediaPlaylist *playlist,
    const MultiplexHttpCancellation *cancellation) {
  (void)credentials;
  (void)session;
  (void)playlist;
  (void)cancellation;
  assert(false);
  return false;
}

void multiplex_plex_hls_stop_cancellable(
    const MultiplexAuthCredentials *credentials,
    MultiplexPlexHlsSession *session,
    const MultiplexHttpCancellation *cancellation) {
  (void)credentials;
  (void)session;
  assert(multiplex_http_cancellation_requested(cancellation));
}
void multiplex_plex_hls_stop(const MultiplexAuthCredentials *credentials,
                             MultiplexPlexHlsSession *session) {
  (void)credentials;
  assert(join_completed);
  assert(session != NULL && session->server_cleanup_required);
  assert(strcmp(session->session_id, "fixture-session") == 0);
  hls_stop_count += 1u;
  memset(session, 0, sizeof(*session));
}

bool multiplex_gateway_load_playback_manifest_cancellable(
    const char *base_url, uint32_t rating_key, uint32_t offset_ms,
    MultiplexGatewayPlaybackManifest *manifest,
    const MultiplexHttpCancellation *cancellation) {
  (void)base_url;
  (void)rating_key;
  (void)offset_ms;
  (void)manifest;
  assert(multiplex_http_cancellation_requested(cancellation));
  program_cancellation_count += 1u;
  return false;
}

HttpClient *
http_client_open_cancellable(const char *url,
                             const MultiplexHttpCancellation *cancellation) {
  (void)url;
  (void)cancellation;
  assert(false);
  return NULL;
}
void http_client_request_stop(HttpClient *client) { (void)client; }
void http_client_destroy(HttpClient *client) { (void)client; }
void http_client_begin_stream(HttpClient *client) { (void)client; }
size_t http_client_size(const HttpClient *client) {
  (void)client;
  return 0;
}
const char *http_client_host(const HttpClient *client) {
  (void)client;
  return "";
}
uint16_t http_client_port(const HttpClient *client) {
  (void)client;
  return 0;
}
unsigned http_client_range_count(const HttpClient *client) {
  (void)client;
  return 0;
}
bool http_client_read_at(HttpClient *client, size_t offset,
                         uint8_t *destination, size_t size) {
  (void)client;
  (void)offset;
  (void)destination;
  (void)size;
  return false;
}

MpegPsDemux *mpeg_ps_demux_create_reader_with_info(void *context,
                                                   size_t program_size,
                                                   MpegPsReadAt read_at,
                                                   const MpegPsInfo *info) {
  (void)context;
  (void)program_size;
  (void)read_at;
  (void)info;
  return NULL;
}
bool mpeg_ps_demux_start(MpegPsDemux *demux) {
  (void)demux;
  return false;
}
void mpeg_ps_demux_stop(MpegPsDemux *demux) { (void)demux; }
void mpeg_ps_demux_destroy(MpegPsDemux *demux) { (void)demux; }

PlexHlsDemux *plex_hls_demux_create_prepared(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    const MultiplexPlexHlsSession *session, const HlsMediaPlaylist *playlist) {
  (void)credentials;
  (void)rating_key;
  (void)session;
  (void)playlist;
  return NULL;
}
PlexHlsDemux *plex_hls_demux_create(const MultiplexAuthCredentials *credentials,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    const char *session_id, bool burn_subtitles,
                                    uint32_t subtitle_stream_index) {
  (void)credentials;
  (void)rating_key;
  (void)offset_ms;
  (void)session_id;
  (void)burn_subtitles;
  (void)subtitle_stream_index;
  return NULL;
}

static void test_hls_cancel_before_join(void) {
  PlaybackPrefetch *prefetch = playback_prefetch_create();
  assert(prefetch != NULL);
  const MultiplexPlaybackPrefetchRequest request = {.rating_key = 42};
  assert(playback_prefetch_retain_hls(prefetch, &request));
  playback_prefetch_cancel_background(prefetch);
  playback_prefetch_discard_hls(prefetch);
  assert(hls_cancellation_count == 1u);
  assert(hls_stop_count == 1u);
  assert(join_count == 1u);
  playback_prefetch_discard_hls(prefetch);
  assert(hls_stop_count == 1u);
  playback_prefetch_destroy(&prefetch);
  assert(prefetch == NULL);
}

static void test_program_cancel_before_join(void) {
  PlaybackPrefetch *prefetch = playback_prefetch_create();
  assert(prefetch != NULL);
  PlaybackProgramStageRequest request = {.rating_key = 42, .offset_ms = 1000};
  strcpy(request.gateway_url, "http://fixture.test");
  assert(playback_prefetch_stage_program(prefetch, &request));
  playback_prefetch_cancel_background(prefetch);
  playback_prefetch_discard_program(prefetch);
  assert(program_cancellation_count == 1u);
  assert(join_count == 2u);
  playback_prefetch_destroy(&prefetch);
  assert(prefetch == NULL);
}

int main(void) {
  test_hls_cancel_before_join();
  test_program_cancel_before_join();
  puts("GameCube playback prefetch cancellation tests passed.");
  return 0;
}
