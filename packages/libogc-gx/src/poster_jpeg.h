#ifndef MULTIPLEX_POSTER_JPEG_H
#define MULTIPLEX_POSTER_JPEG_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/*
 * Decodes a gateway JPEG contact sheet and writes each cell
 * as a separate GX_TF_RGB565 4x4-tiled texture.
 */
bool poster_jpeg_initialize(void);
void poster_jpeg_shutdown(void);
bool poster_jpeg_decode(const uint8_t *encoded, size_t encoded_size,
                        uint16_t item_count, uint8_t *texture_pixels,
                        size_t texture_capacity);
bool poster_jpeg_decode_columns(const uint8_t *encoded, size_t encoded_size,
                                uint16_t item_count, unsigned columns,
                                uint8_t *texture_pixels,
                                size_t texture_capacity);
bool poster_jpeg_decode_single(const uint8_t *encoded, size_t encoded_size,
                               uint8_t *texture_pixels,
                               size_t texture_capacity);

#endif
