#ifndef MULTIPLEX_APP_SERVICES_CONTENT_TEST_SUPPORT_H
#define MULTIPLEX_APP_SERVICES_CONTENT_TEST_SUPPORT_H

#include "app_services_playback_resolution.h"

typedef struct {
  unsigned playback_commit_count;
  unsigned playback_fail_count;
  unsigned playback_finish_count;
  unsigned details_finish_count;
  unsigned details_commit_count;
  unsigned browse_bind_count;
  unsigned children_load_count;
  unsigned mark_watched_count;
  bool details_load_succeeds;
} AppServicesContentTestState;

AppServicesContentTestState *app_services_content_test_state(void);
void app_services_content_test_reset(void);
void app_services_content_test_reset_effects(MultiplexAppServices *services);
const MultiplexAuthCredentials *app_services_content_test_credentials(void);

#endif
