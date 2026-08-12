#include "app_job_slot.h"

#include <string.h>

void multiplex_app_job_slot_init(MultiplexAppJobSlot *slot,
                                 MultiplexAppJobOps ops) {
  if (slot == NULL) {
    return;
  }
  memset(slot, 0, sizeof(*slot));
  slot->ops = ops;
  slot->state = MULTIPLEX_APP_JOB_EMPTY;
}

bool multiplex_app_job_slot_launch(MultiplexAppJobSlot *slot,
                                   size_t allocation_size,
                                   uint64_t deadline_ms) {
  if (slot == NULL || slot->state != MULTIPLEX_APP_JOB_EMPTY ||
      slot->ops.allocate == NULL || slot->ops.launch == NULL ||
      slot->ops.complete == NULL || slot->ops.cancel == NULL ||
      slot->ops.join == NULL || slot->ops.free == NULL ||
      slot->ops.now_ms == NULL || allocation_size == 0) {
    return false;
  }
  void *handle = slot->ops.allocate(slot->ops.context, allocation_size);
  if (handle == NULL) {
    return false;
  }
  if (!slot->ops.launch(slot->ops.context, handle)) {
    slot->ops.free(slot->ops.context, handle);
    return false;
  }
  slot->handle = handle;
  slot->started_ms = slot->ops.now_ms(slot->ops.context);
  slot->deadline_ms = deadline_ms;
  slot->cancelled = false;
  slot->state = MULTIPLEX_APP_JOB_RUNNING;
  return true;
}

MultiplexAppJobPollResult
multiplex_app_job_slot_poll(MultiplexAppJobSlot *slot) {
  if (slot == NULL || slot->state != MULTIPLEX_APP_JOB_RUNNING) {
    return slot != NULL && slot->state == MULTIPLEX_APP_JOB_COMPLETED
               ? MULTIPLEX_APP_JOB_POLL_COMPLETED
               : MULTIPLEX_APP_JOB_POLL_INACTIVE;
  }
  if (slot->ops.complete(slot->ops.context, slot->handle)) {
    slot->state = MULTIPLEX_APP_JOB_COMPLETED;
    return MULTIPLEX_APP_JOB_POLL_COMPLETED;
  }
  if (slot->deadline_ms != 0 && slot->ops.now_ms != NULL &&
      slot->ops.now_ms(slot->ops.context) - slot->started_ms >=
          slot->deadline_ms) {
    if (!multiplex_app_job_slot_cancel(slot)) {
      return MULTIPLEX_APP_JOB_POLL_CANCEL_FAILED;
    }
    return MULTIPLEX_APP_JOB_POLL_TIMED_OUT;
  }
  return MULTIPLEX_APP_JOB_POLL_PENDING;
}

bool multiplex_app_job_slot_cancel(MultiplexAppJobSlot *slot) {
  if (slot == NULL || slot->state != MULTIPLEX_APP_JOB_RUNNING) {
    return slot != NULL && slot->cancelled;
  }
  if (slot->cancelled) {
    return true;
  }
  if (!slot->ops.cancel(slot->ops.context, slot->handle)) {
    return false;
  }
  slot->cancelled = true;
  return true;
}

bool multiplex_app_job_slot_join(MultiplexAppJobSlot *slot) {
  if (slot == NULL || slot->handle == NULL) {
    return false;
  }
  if (slot->state == MULTIPLEX_APP_JOB_JOINED) {
    return true;
  }
  if (slot->state != MULTIPLEX_APP_JOB_RUNNING &&
      slot->state != MULTIPLEX_APP_JOB_COMPLETED) {
    return false;
  }
  if (!slot->ops.join(slot->ops.context, slot->handle)) {
    return false;
  }
  slot->state = MULTIPLEX_APP_JOB_JOINED;
  return true;
}

bool multiplex_app_job_slot_cleanup(MultiplexAppJobSlot *slot) {
  if (slot == NULL) {
    return false;
  }
  if (slot->state == MULTIPLEX_APP_JOB_EMPTY) {
    return true;
  }
  if (slot->state != MULTIPLEX_APP_JOB_JOINED) {
    return false;
  }
  slot->ops.free(slot->ops.context, slot->handle);
  slot->handle = NULL;
  slot->started_ms = 0;
  slot->deadline_ms = 0;
  slot->cancelled = false;
  slot->state = MULTIPLEX_APP_JOB_EMPTY;
  return true;
}

MultiplexAppJobState
multiplex_app_job_slot_state(const MultiplexAppJobSlot *slot) {
  return slot == NULL ? MULTIPLEX_APP_JOB_EMPTY : slot->state;
}
