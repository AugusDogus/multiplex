#ifndef MULTIPLEX_MEDIA_BYTE_QUEUE_H
#define MULTIPLEX_MEDIA_BYTE_QUEUE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MediaByteQueue MediaByteQueue;

MediaByteQueue *media_byte_queue_create(size_t capacity);
void media_byte_queue_close(MediaByteQueue *queue);
void media_byte_queue_destroy(MediaByteQueue *queue);

/* Blocks until every byte is queued or the queue is closed. */
bool media_byte_queue_write(MediaByteQueue *queue, const uint8_t *source,
                            size_t size);

/* Non-blocking producer operations used by the cooperative MPEG-PS pump. */
size_t media_byte_queue_write_available(MediaByteQueue *queue,
                                        const uint8_t *source, size_t size);
size_t media_byte_queue_contiguous_space(MediaByteQueue *queue);

/* Blocks only while the queue is empty; a closed and drained queue returns 0. */
size_t media_byte_queue_read(MediaByteQueue *queue, uint8_t *destination,
                             size_t size);
size_t media_byte_queue_size(MediaByteQueue *queue);

#endif
