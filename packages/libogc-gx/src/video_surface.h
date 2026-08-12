#ifndef MULTIPLEX_VIDEO_SURFACE_H
#define MULTIPLEX_VIDEO_SURFACE_H

#include <stdbool.h>
#include <stdint.h>

typedef struct MultiplexPlaybackVideoSurface MultiplexPlaybackVideoSurface;

MultiplexPlaybackVideoSurface *multiplex_video_surface_create(void);
void multiplex_video_surface_destroy(MultiplexPlaybackVideoSurface **surface);
void multiplex_video_surface_reset(MultiplexPlaybackVideoSurface *surface);
bool multiplex_video_surface_configure(MultiplexPlaybackVideoSurface *surface,
                                       unsigned width, unsigned height);
bool multiplex_video_surface_upload(MultiplexPlaybackVideoSurface *surface,
                                    const uint8_t *const planes[3],
                                    const int strides[3], unsigned width,
                                    unsigned height);
void multiplex_video_surface_swap(MultiplexPlaybackVideoSurface *surface);
void multiplex_video_surface_draw(const MultiplexPlaybackVideoSurface *surface,
                                  float left, float top, float right,
                                  float bottom);

#endif
