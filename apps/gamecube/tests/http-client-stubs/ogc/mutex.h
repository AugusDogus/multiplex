#ifndef MULTIPLEX_TEST_MUTEX_H
#define MULTIPLEX_TEST_MUTEX_H

#include <stdbool.h>
#include <stdint.h>

typedef uintptr_t mutex_t;

int LWP_MutexInit(mutex_t *mutex, bool recursive);
int LWP_MutexLock(mutex_t mutex);
int LWP_MutexTryLock(mutex_t mutex);
int LWP_MutexUnlock(mutex_t mutex);

#endif
