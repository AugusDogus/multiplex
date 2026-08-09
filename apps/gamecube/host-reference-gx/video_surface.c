#include "video_surface.h"

#include "video_decoder.h"
#include "yuv420_gx.h"

#include <stdlib.h>

struct MultiplexPlaybackVideoSurface {
  bool configured;
};

MultiplexPlaybackVideoSurface *multiplex_video_surface_create(void) {
  return calloc(1, sizeof(MultiplexPlaybackVideoSurface));
}

void multiplex_video_surface_destroy(MultiplexPlaybackVideoSurface **surface) {
  if (surface == NULL || *surface == NULL) {
    return;
  }
  multiplex_video_surface_reset(*surface);
  free(*surface);
  *surface = NULL;
}

void multiplex_video_surface_reset(MultiplexPlaybackVideoSurface *surface) {
  if (surface != NULL && surface->configured) {
    yuv420_gx_destroy();
    surface->configured = false;
  }
}

bool multiplex_video_surface_configure(MultiplexPlaybackVideoSurface *surface,
                                       unsigned width, unsigned height) {
  if (surface == NULL || width == 0 || height == 0) {
    return false;
  }
  multiplex_video_surface_reset(surface);
  surface->configured = yuv420_gx_initialize(width, height);
  return surface->configured;
}

bool multiplex_video_surface_upload(MultiplexPlaybackVideoSurface *surface,
                                    const uint8_t *const planes[3],
                                    const int strides[3], unsigned width,
                                    unsigned height) {
  if (surface == NULL || !surface->configured || planes == NULL ||
      strides == NULL) {
    return false;
  }
  const VideoFrame frame = {
      .planes = {planes[0], planes[1], planes[2]},
      .strides = {strides[0], strides[1], strides[2]},
      .width = width,
      .height = height,
  };
  return yuv420_gx_upload_back(&frame);
}

void multiplex_video_surface_swap(MultiplexPlaybackVideoSurface *surface) {
  if (surface != NULL && surface->configured) {
    yuv420_gx_swap();
  }
}

void multiplex_video_surface_draw(const MultiplexPlaybackVideoSurface *surface,
                                  float left, float top, float right,
                                  float bottom) {
  if (surface != NULL && surface->configured) {
    yuv420_gx_draw(left, top, right, bottom);
  }
}
