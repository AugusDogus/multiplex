#ifndef MULTIPLEX_APP_JOB_SLOT_H
#define MULTIPLEX_APP_JOB_SLOT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
  MULTIPLEX_APP_JOB_EMPTY = 0,
  MULTIPLEX_APP_JOB_RUNNING,
  MULTIPLEX_APP_JOB_COMPLETED,
  MULTIPLEX_APP_JOB_JOINED,
} MultiplexAppJobState;

typedef enum {
  MULTIPLEX_APP_JOB_POLL_PENDING = 0,
  MULTIPLEX_APP_JOB_POLL_COMPLETED,
  MULTIPLEX_APP_JOB_POLL_TIMED_OUT,
  MULTIPLEX_APP_JOB_POLL_CANCEL_FAILED,
  MULTIPLEX_APP_JOB_POLL_INACTIVE,
} MultiplexAppJobPollResult;

typedef struct {
  void *(*allocate)(void *context, size_t size);
  bool (*launch)(void *context, void *handle);
  bool (*complete)(void *context, void *handle);
  bool (*cancel)(void *context, void *handle);
  bool (*join)(void *context, void *handle);
  void (*free)(void *context, void *handle);
  uint64_t (*now_ms)(void *context);
  void *context;
} MultiplexAppJobOps;

typedef struct {
  MultiplexAppJobOps ops;
  void *handle;
  uint64_t started_ms;
  uint64_t deadline_ms;
  MultiplexAppJobState state;
  bool cancelled;
} MultiplexAppJobSlot;

void multiplex_app_job_slot_init(MultiplexAppJobSlot *slot,
                                 MultiplexAppJobOps ops);
bool multiplex_app_job_slot_launch(MultiplexAppJobSlot *slot,
                                   size_t allocation_size,
                                   uint64_t deadline_ms);
MultiplexAppJobPollResult
multiplex_app_job_slot_poll(MultiplexAppJobSlot *slot);
bool multiplex_app_job_slot_cancel(MultiplexAppJobSlot *slot);
bool multiplex_app_job_slot_join(MultiplexAppJobSlot *slot);
bool multiplex_app_job_slot_cleanup(MultiplexAppJobSlot *slot);
MultiplexAppJobState
multiplex_app_job_slot_state(const MultiplexAppJobSlot *slot);

#endif
