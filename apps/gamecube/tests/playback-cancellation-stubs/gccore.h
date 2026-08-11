#ifndef MULTIPLEX_PLAYBACK_TEST_GCCORE_H
#define MULTIPLEX_PLAYBACK_TEST_GCCORE_H

#include <stdint.h>

typedef uintptr_t lwp_t;

#define LWP_THREAD_NULL 0
#define LWP_PRIO_NORMAL 64

uint32_t gettick(void);
uint32_t ticks_to_microsecs(uint32_t ticks);
void SYS_Report(const char *message, ...);

#endif
