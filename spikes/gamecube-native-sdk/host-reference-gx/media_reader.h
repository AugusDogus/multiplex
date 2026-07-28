#ifndef MULTIPLEX_MEDIA_READER_H
#define MULTIPLEX_MEDIA_READER_H

#include <stddef.h>
#include <stdint.h>

/*
 * Blocking sequential byte reader used between the bounded MPEG-PS queues and
 * the codec adapters. A zero result means the producer stopped or failed.
 */
typedef size_t (*MediaRead)(void *context, uint8_t *destination, size_t size);

#endif
