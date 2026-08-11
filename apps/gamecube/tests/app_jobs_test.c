#include <stdio.h>

void app_jobs_test_run_work(void);
void app_jobs_test_run_posters(void);
void app_jobs_test_run_prefetch(void);
void app_jobs_test_run_lifecycle(void);

int main(void) {
  app_jobs_test_run_work();
  app_jobs_test_run_posters();
  app_jobs_test_run_prefetch();
  app_jobs_test_run_lifecycle();
  puts("GameCube app jobs tests passed.");
  return 0;
}
