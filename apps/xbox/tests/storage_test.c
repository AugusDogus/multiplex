#include "storage.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static MultiplexAuthCredentials credentials(const char *token) {
  MultiplexAuthCredentials value = {0};
  strcpy(value.origin, "https://multiplex.example");
  strcpy(value.session_token, token);
  strcpy(value.plex_client_id, "multiplex-xbox-test");
  value.session_expires_at_unix = 42;
  return value;
}

int main(void) {
  char directory[] = "/tmp/multiplex-xbox-storage-XXXXXX";
  assert(mkdtemp(directory) != NULL);

  MultiplexAuthCredentials loaded;
  uint32_t generation = 0;
  assert(multiplex_xbox_storage_load(directory, &loaded, &generation) ==
         MULTIPLEX_XBOX_STORAGE_NOT_FOUND);

  MultiplexAuthCredentials first = credentials("first-token");
  assert(multiplex_xbox_storage_save(directory, &first, &generation) ==
         MULTIPLEX_XBOX_STORAGE_OK);
  assert(generation == 1);
  assert(multiplex_xbox_storage_load(directory, &loaded, &generation) ==
         MULTIPLEX_XBOX_STORAGE_OK);
  assert(strcmp(loaded.session_token, "first-token") == 0);

  MultiplexAuthCredentials second = credentials("second-token");
  assert(multiplex_xbox_storage_save(directory, &second, &generation) ==
         MULTIPLEX_XBOX_STORAGE_OK);
  assert(generation == 2);
  assert(multiplex_xbox_storage_load(directory, &loaded, &generation) ==
         MULTIPLEX_XBOX_STORAGE_OK);
  assert(strcmp(loaded.session_token, "second-token") == 0);

  char newest_path[512];
  assert(snprintf(newest_path, sizeof(newest_path), "%s/auth-b.dat",
                  directory) > 0);
  FILE *newest = fopen(newest_path, "r+b");
  assert(newest != NULL);
  assert(fputc('X', newest) != EOF);
  assert(fclose(newest) == 0);
  assert(multiplex_xbox_storage_load(directory, &loaded, &generation) ==
         MULTIPLEX_XBOX_STORAGE_OK);
  assert(strcmp(loaded.session_token, "first-token") == 0);

  char first_path[512];
  assert(snprintf(first_path, sizeof(first_path), "%s/auth-a.dat", directory) >
         0);
  assert(remove(first_path) == 0);
  assert(remove(newest_path) == 0);
  assert(rmdir(directory) == 0);
  return 0;
}
