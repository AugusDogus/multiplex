#ifndef MULTIPLEX_PRESENTATION_H
#define MULTIPLEX_PRESENTATION_H

#include "reference_frame.h"
#include <gccore.h>

#include <stdbool.h>
#include <stdint.h>

typedef struct MultiplexPresentation MultiplexPresentation;

typedef enum {
  MULTIPLEX_PRESENTATION_OPEN_READY = 0,
  MULTIPLEX_PRESENTATION_OPEN_VIDEO_FAILED = 1,
  MULTIPLEX_PRESENTATION_OPEN_RESOURCES_FAILED = 2,
} MultiplexPresentationOpenResult;

typedef enum {
  MULTIPLEX_PRESENTATION_FRAME_FAILED = 0,
  MULTIPLEX_PRESENTATION_FRAME_PENDING = 1,
  MULTIPLEX_PRESENTATION_FRAME_READY = 2,
} MultiplexPresentationFrameResult;

typedef enum {
  MULTIPLEX_PRESENTATION_PREPARE_NORMAL = 0,
  MULTIPLEX_PRESENTATION_PREPARE_SYNCHRONOUS = 1,
  MULTIPLEX_PRESENTATION_PREPARE_DEFERRED = 2,
} MultiplexPresentationPrepareMode;

typedef enum {
  MULTIPLEX_PRESENTATION_STREAM_NONE = 0,
  MULTIPLEX_PRESENTATION_STREAM_PROGRAM = 1,
  MULTIPLEX_PRESENTATION_STREAM_HLS = 2,
} MultiplexPresentationStream;

typedef struct {
  MultiplexPresentationStream stream;
  uint32_t decoder_fps_tenths;
  uint32_t codec_average_us;
  uint32_t codec_max_us;
  uint32_t upload_average_us;
  uint32_t network_kib_per_second;
  uint32_t queued_video_bytes;
  uint32_t queued_audio_bytes;
  uint32_t audio_ready_buffers;
  uint32_t audio_underruns;
  uint32_t stream_video_bytes;
  uint32_t stream_audio_bytes;
  uint32_t producer_units;
} MultiplexPresentationPlaybackMetrics;

typedef struct {
  bool frame_ready;
  bool playback_failed;
  uint32_t content_width;
  uint32_t content_height;
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  uint32_t segment_start_ms;
  uint32_t segment_duration_ms;
  MultiplexPresentationPlaybackMetrics metrics;
} MultiplexPresentationPlaybackSnapshot;

typedef struct {
  MultiplexPresentationPlaybackSnapshot playback;
  uint32_t startup_rating_key;
} MultiplexPresentationFrameInput;

typedef struct {
  uint32_t screen;
  bool video_visible;
  bool video_playing;
  uint32_t focused_rating_key;
} MultiplexPresentationStatus;

typedef struct {
  MultiplexReferenceFrameStatus status;
  uint32_t stage;
  bool asynchronous;
} MultiplexPresentationRenderDiagnostic;

typedef struct {
  GXRModeObj *mode;
  void *framebuffer;
} MultiplexPresentationBorrowedFatalVideo;

typedef enum {
  MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE = 0,
  MULTIPLEX_PRESENTATION_POSTERS_REUSE = 1,
} MultiplexPresentationPosterWriteMode;

typedef struct {
  uint8_t *pixels;
  uint32_t token;
} MultiplexPresentationPosterWrite;

typedef struct {
  uint64_t now_ms;
  bool active_input;
  bool a_pressed;
  bool settings_open;
} MultiplexPresentationControlsInput;

typedef struct {
  bool consumed_a;
  bool visibility_changed;
  bool visible;
} MultiplexPresentationControlsResult;

MultiplexPresentation *multiplex_presentation_create(void);
MultiplexPresentationOpenResult
multiplex_presentation_open(MultiplexPresentation *presentation);
void multiplex_presentation_destroy(MultiplexPresentation **presentation);
MultiplexPresentationBorrowedFatalVideo
multiplex_presentation_finalize_for_fatal(MultiplexPresentation *presentation);

void multiplex_presentation_profile_mark(MultiplexPresentation *presentation,
                                         uint32_t stage);
MultiplexPresentationFrameResult
multiplex_presentation_prepare_frame(MultiplexPresentation *presentation,
                                     MultiplexPresentationPrepareMode mode);
bool multiplex_presentation_present(
    MultiplexPresentation *presentation,
    const MultiplexPresentationFrameInput *input);
void multiplex_presentation_request_refresh(MultiplexPresentation *presentation,
                                            bool asynchronous);
void multiplex_presentation_set_async_enabled(
    MultiplexPresentation *presentation, bool enabled);
void multiplex_presentation_set_network_activity(
    MultiplexPresentation *presentation, bool visible);
void multiplex_presentation_set_blocking_activity(
    MultiplexPresentation *presentation, bool visible);
MultiplexPresentationControlsResult multiplex_presentation_controls_update(
    MultiplexPresentation *presentation,
    const MultiplexPresentationControlsInput *input);
void multiplex_presentation_begin_home_motion(
    MultiplexPresentation *presentation, uint32_t before, uint32_t after);
void multiplex_presentation_queue_browse_motion(
    MultiplexPresentation *presentation, uint32_t before, uint32_t after);
MultiplexPresentationStatus
multiplex_presentation_status(const MultiplexPresentation *presentation);
MultiplexPresentationRenderDiagnostic multiplex_presentation_render_diagnostic(
    const MultiplexPresentation *presentation);

bool multiplex_presentation_posters_begin(
    MultiplexPresentation *presentation, uint16_t offset, uint16_t count,
    MultiplexPresentationPosterWriteMode mode,
    MultiplexPresentationPosterWrite *write);
bool multiplex_presentation_posters_reuse(
    MultiplexPresentation *presentation,
    const MultiplexPresentationPosterWrite *write, uint16_t index,
    uint32_t rating_key);
bool multiplex_presentation_posters_commit(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write, const uint32_t *rating_keys);
void multiplex_presentation_posters_cancel(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write);
bool multiplex_presentation_poster_matches(
    const MultiplexPresentation *presentation, uint16_t slot,
    uint32_t rating_key);

#endif
