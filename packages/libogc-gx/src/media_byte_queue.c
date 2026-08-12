/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Bounded, interrupt-safe byte queue shared by container producers and codec
 * consumers.
 */

#include "media_byte_queue.h"

#include <ogc/cond.h>
#include <ogc/mutex.h>
#include <stdlib.h>
#include <string.h>

struct MediaByteQueue {
  uint8_t *data;
  size_t capacity;
  size_t read_offset;
  size_t write_offset;
  size_t size;
  mutex_t mutex;
  cond_t can_read;
  cond_t can_write;
  bool mutex_ready;
  bool read_condition_ready;
  bool write_condition_ready;
  bool closed;
};

MediaByteQueue *media_byte_queue_create(size_t capacity) {
  if (capacity == 0) {
    return NULL;
  }
  MediaByteQueue *queue = calloc(1, sizeof(*queue));
  if (queue == NULL) {
    return NULL;
  }
  queue->data = malloc(capacity);
  queue->capacity = capacity;
  if (queue->data == NULL || LWP_MutexInit(&queue->mutex, false) != 0) {
    media_byte_queue_destroy(queue);
    return NULL;
  }
  queue->mutex_ready = true;
  if (LWP_CondInit(&queue->can_read) != 0) {
    media_byte_queue_destroy(queue);
    return NULL;
  }
  queue->read_condition_ready = true;
  if (LWP_CondInit(&queue->can_write) != 0) {
    media_byte_queue_destroy(queue);
    return NULL;
  }
  queue->write_condition_ready = true;
  return queue;
}

void media_byte_queue_close(MediaByteQueue *queue) {
  if (queue == NULL || !queue->mutex_ready) {
    return;
  }
  LWP_MutexLock(queue->mutex);
  queue->closed = true;
  if (queue->read_condition_ready) {
    LWP_CondBroadcast(queue->can_read);
  }
  if (queue->write_condition_ready) {
    LWP_CondBroadcast(queue->can_write);
  }
  LWP_MutexUnlock(queue->mutex);
}

void media_byte_queue_destroy(MediaByteQueue *queue) {
  if (queue == NULL) {
    return;
  }
  media_byte_queue_close(queue);
  if (queue->write_condition_ready) {
    LWP_CondDestroy(queue->can_write);
  }
  if (queue->read_condition_ready) {
    LWP_CondDestroy(queue->can_read);
  }
  if (queue->mutex_ready) {
    LWP_MutexDestroy(queue->mutex);
  }
  free(queue->data);
  free(queue);
}

size_t media_byte_queue_write_available(MediaByteQueue *queue,
                                        const uint8_t *source, size_t size) {
  if (queue == NULL || source == NULL || size == 0 || !queue->mutex_ready) {
    return 0;
  }
  LWP_MutexLock(queue->mutex);
  if (queue->closed || queue->size == queue->capacity) {
    LWP_MutexUnlock(queue->mutex);
    return 0;
  }
  size_t chunk = size;
  const size_t free_space = queue->capacity - queue->size;
  const size_t contiguous = queue->capacity - queue->write_offset;
  if (chunk > free_space) {
    chunk = free_space;
  }
  if (chunk > contiguous) {
    chunk = contiguous;
  }
  memcpy(queue->data + queue->write_offset, source, chunk);
  queue->write_offset = (queue->write_offset + chunk) % queue->capacity;
  queue->size += chunk;
  LWP_CondSignal(queue->can_read);
  LWP_MutexUnlock(queue->mutex);
  return chunk;
}

size_t media_byte_queue_contiguous_space(MediaByteQueue *queue) {
  if (queue == NULL || !queue->mutex_ready) {
    return 0;
  }
  LWP_MutexLock(queue->mutex);
  size_t space = 0;
  if (!queue->closed) {
    space = queue->capacity - queue->size;
    const size_t contiguous = queue->capacity - queue->write_offset;
    if (space > contiguous) {
      space = contiguous;
    }
  }
  LWP_MutexUnlock(queue->mutex);
  return space;
}

bool media_byte_queue_write(MediaByteQueue *queue, const uint8_t *source,
                            size_t size) {
  if (queue == NULL || source == NULL || size == 0 || !queue->mutex_ready) {
    return false;
  }
  size_t written = 0;
  while (written < size) {
    LWP_MutexLock(queue->mutex);
    while (queue->size == queue->capacity && !queue->closed) {
      LWP_CondWait(queue->can_write, queue->mutex);
    }
    const bool closed = queue->closed;
    LWP_MutexUnlock(queue->mutex);
    if (closed) {
      return false;
    }
    const size_t chunk = media_byte_queue_write_available(
        queue, source + written, size - written);
    if (chunk == 0) {
      continue;
    }
    written += chunk;
  }
  return true;
}

size_t media_byte_queue_read(MediaByteQueue *queue, uint8_t *destination,
                             size_t size) {
  if (queue == NULL || destination == NULL || size == 0 ||
      !queue->mutex_ready) {
    return 0;
  }
  LWP_MutexLock(queue->mutex);
  while (queue->size == 0 && !queue->closed) {
    LWP_CondWait(queue->can_read, queue->mutex);
  }
  if (queue->size == 0) {
    LWP_MutexUnlock(queue->mutex);
    return 0;
  }

  size_t copied = 0;
  while (copied < size && queue->size != 0) {
    size_t chunk = size - copied;
    const size_t contiguous = queue->capacity - queue->read_offset;
    if (chunk > queue->size) {
      chunk = queue->size;
    }
    if (chunk > contiguous) {
      chunk = contiguous;
    }
    memcpy(destination + copied, queue->data + queue->read_offset, chunk);
    queue->read_offset = (queue->read_offset + chunk) % queue->capacity;
    queue->size -= chunk;
    copied += chunk;
  }
  LWP_CondSignal(queue->can_write);
  LWP_MutexUnlock(queue->mutex);
  return copied;
}

size_t media_byte_queue_size(MediaByteQueue *queue) {
  if (queue == NULL || !queue->mutex_ready) {
    return 0;
  }
  LWP_MutexLock(queue->mutex);
  const size_t size = queue->size;
  LWP_MutexUnlock(queue->mutex);
  return size;
}
