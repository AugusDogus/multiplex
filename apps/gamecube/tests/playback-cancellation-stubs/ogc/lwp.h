#ifndef MULTIPLEX_PLAYBACK_TEST_LWP_H
#define MULTIPLEX_PLAYBACK_TEST_LWP_H

#include <gccore.h>
#include <stddef.h>

int LWP_CreateThread(lwp_t *thread, void *(*entry)(void *), void *context,
                     void *stack, size_t stack_size, int priority);
int LWP_JoinThread(lwp_t thread, void **result);

#endif
