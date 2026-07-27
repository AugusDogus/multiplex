#ifndef MULTIPLEX_YUV420_GX_H
#define MULTIPLEX_YUV420_GX_H

#include "mpeg2_decoder.h"

#include <stdbool.h>

bool yuv420_gx_initialize(unsigned width, unsigned height);
void yuv420_gx_destroy(void);

/* May run on the decoder thread while GX presents the current front buffer. */
bool yuv420_gx_upload_back(const Mpeg2Frame *frame);

/* Called by the GX thread after upload_back has completed. */
void yuv420_gx_swap(void);
void yuv420_gx_draw(float left, float top, float right, float bottom);

#endif
