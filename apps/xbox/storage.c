#include "storage.h"

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define AUTH_RECORD_CAPACITY 4096u
#define AUTH_PATH_CAPACITY 512u

typedef struct {
  uint8_t bytes[AUTH_RECORD_CAPACITY];
  size_t size;
  bool found;
} StoredRecord;

static bool build_path(const char *directory, const char *name, char *path,
                       size_t capacity) {
  if (directory == NULL || directory[0] == '\0') {
    return false;
  }
  const size_t directory_length = strlen(directory);
  const char separator = strchr(directory, '\\') != NULL ? '\\' : '/';
  const bool has_separator = directory[directory_length - 1u] == '/' ||
                             directory[directory_length - 1u] == '\\';
  const int written =
      snprintf(path, capacity, "%s%s%s", directory,
               has_separator ? "" : (separator == '\\' ? "\\" : "/"), name);
  return written > 0 && (size_t)written < capacity;
}

static MultiplexXboxStorageResult read_record(const char *path,
                                              StoredRecord *record) {
  memset(record, 0, sizeof(*record));
  FILE *file = fopen(path, "rb");
  if (file == NULL) {
    return errno == ENOENT ? MULTIPLEX_XBOX_STORAGE_NOT_FOUND
                           : MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  record->size = fread(record->bytes, 1, sizeof(record->bytes), file);
  const bool read_failed = ferror(file) != 0;
  const int trailing = fgetc(file);
  const bool close_failed = fclose(file) != 0;
  if (read_failed || trailing != EOF || close_failed) {
    memset(record, 0, sizeof(*record));
    return read_failed || close_failed ? MULTIPLEX_XBOX_STORAGE_IO_ERROR
                                       : MULTIPLEX_XBOX_STORAGE_CORRUPT;
  }
  record->found = true;
  return MULTIPLEX_XBOX_STORAGE_OK;
}

static MultiplexXboxStorageResult
load_records(const char *directory, StoredRecord *first, StoredRecord *second,
             MultiplexAuthCredentials *credentials, uint32_t *generation,
             MultiplexAuthRecordSelection *selection) {
  char first_path[AUTH_PATH_CAPACITY];
  char second_path[AUTH_PATH_CAPACITY];
  if (!build_path(directory, "auth-a.dat", first_path, sizeof(first_path)) ||
      !build_path(directory, "auth-b.dat", second_path, sizeof(second_path))) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }

  const MultiplexXboxStorageResult first_result =
      read_record(first_path, first);
  const MultiplexXboxStorageResult second_result =
      read_record(second_path, second);
  if (first_result == MULTIPLEX_XBOX_STORAGE_IO_ERROR ||
      second_result == MULTIPLEX_XBOX_STORAGE_IO_ERROR) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  if (!first->found && !second->found) {
    return first_result == MULTIPLEX_XBOX_STORAGE_CORRUPT ||
                   second_result == MULTIPLEX_XBOX_STORAGE_CORRUPT
               ? MULTIPLEX_XBOX_STORAGE_CORRUPT
               : MULTIPLEX_XBOX_STORAGE_NOT_FOUND;
  }

  *selection = multiplex_auth_record_select(
      first->found ? first->bytes : NULL, first->size,
      second->found ? second->bytes : NULL, second->size, credentials,
      generation);
  return *selection == MULTIPLEX_AUTH_RECORD_NONE
             ? MULTIPLEX_XBOX_STORAGE_CORRUPT
             : MULTIPLEX_XBOX_STORAGE_OK;
}

MultiplexXboxStorageResult
multiplex_xbox_storage_load(const char *directory,
                            MultiplexAuthCredentials *credentials,
                            uint32_t *generation) {
  if (credentials == NULL || generation == NULL) {
    return MULTIPLEX_XBOX_STORAGE_INVALID_CREDENTIALS;
  }
  StoredRecord first;
  StoredRecord second;
  MultiplexAuthRecordSelection selection = MULTIPLEX_AUTH_RECORD_NONE;
  return load_records(directory, &first, &second, credentials, generation,
                      &selection);
}

static bool credentials_equal(const MultiplexAuthCredentials *first,
                              const MultiplexAuthCredentials *second) {
  return first->session_expires_at_unix == second->session_expires_at_unix &&
         strcmp(first->origin, second->origin) == 0 &&
         strcmp(first->session_token, second->session_token) == 0 &&
         strcmp(first->plex_token, second->plex_token) == 0 &&
         strcmp(first->plex_client_id, second->plex_client_id) == 0 &&
         strcmp(first->plex_server_url, second->plex_server_url) == 0 &&
         strcmp(first->plex_server_token, second->plex_server_token) == 0 &&
         strcmp(first->plex_server_id, second->plex_server_id) == 0 &&
         strcmp(first->plex_server_name, second->plex_server_name) == 0;
}

static MultiplexXboxStorageResult
write_record(const char *path, const MultiplexAuthCredentials *credentials,
             uint32_t generation) {
  uint8_t bytes[AUTH_RECORD_CAPACITY];
  if (!multiplex_auth_record_encode(bytes, sizeof(bytes), credentials,
                                    generation)) {
    return MULTIPLEX_XBOX_STORAGE_INVALID_CREDENTIALS;
  }

  char temporary_path[AUTH_PATH_CAPACITY];
  const int temporary_length =
      snprintf(temporary_path, sizeof(temporary_path), "%s.tmp", path);
  if (temporary_length <= 0 ||
      (size_t)temporary_length >= sizeof(temporary_path)) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  FILE *file = fopen(temporary_path, "wb");
  if (file == NULL) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  const bool written = fwrite(bytes, 1, sizeof(bytes), file) == sizeof(bytes);
  const bool flushed = written && fflush(file) == 0;
  const bool closed = fclose(file) == 0;
  if (!written || !flushed || !closed) {
    remove(temporary_path);
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }

  remove(path);
  if (rename(temporary_path, path) != 0) {
    remove(temporary_path);
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }

  StoredRecord verified;
  if (read_record(path, &verified) != MULTIPLEX_XBOX_STORAGE_OK) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  MultiplexAuthCredentials decoded;
  uint32_t decoded_generation = 0;
  if (!multiplex_auth_record_decode(verified.bytes, verified.size, &decoded,
                                    &decoded_generation) ||
      decoded_generation != generation ||
      !credentials_equal(credentials, &decoded)) {
    return MULTIPLEX_XBOX_STORAGE_CORRUPT;
  }
  return MULTIPLEX_XBOX_STORAGE_OK;
}

MultiplexXboxStorageResult
multiplex_xbox_storage_save(const char *directory,
                            const MultiplexAuthCredentials *credentials,
                            uint32_t *generation) {
  if (credentials == NULL || generation == NULL) {
    return MULTIPLEX_XBOX_STORAGE_INVALID_CREDENTIALS;
  }

  StoredRecord first;
  StoredRecord second;
  MultiplexAuthCredentials stored_credentials;
  uint32_t stored_generation = 0;
  MultiplexAuthRecordSelection selection = MULTIPLEX_AUTH_RECORD_NONE;
  const MultiplexXboxStorageResult loaded =
      load_records(directory, &first, &second, &stored_credentials,
                   &stored_generation, &selection);
  if (loaded == MULTIPLEX_XBOX_STORAGE_IO_ERROR) {
    return loaded;
  }
  if (loaded != MULTIPLEX_XBOX_STORAGE_OK) {
    stored_generation = *generation;
    selection = MULTIPLEX_AUTH_RECORD_NONE;
  }

  const uint32_t next_generation = stored_generation + 1u;
  const char *target_name =
      selection == MULTIPLEX_AUTH_RECORD_FIRST ? "auth-b.dat" : "auth-a.dat";
  char target_path[AUTH_PATH_CAPACITY];
  if (!build_path(directory, target_name, target_path, sizeof(target_path))) {
    return MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  }
  const MultiplexXboxStorageResult saved =
      write_record(target_path, credentials, next_generation);
  if (saved == MULTIPLEX_XBOX_STORAGE_OK) {
    *generation = next_generation;
  }
  return saved;
}

const char *
multiplex_xbox_storage_result_message(MultiplexXboxStorageResult result) {
  switch (result) {
  case MULTIPLEX_XBOX_STORAGE_OK:
    return "ready";
  case MULTIPLEX_XBOX_STORAGE_NOT_FOUND:
    return "no saved authorization";
  case MULTIPLEX_XBOX_STORAGE_CORRUPT:
    return "saved authorization is corrupt";
  case MULTIPLEX_XBOX_STORAGE_IO_ERROR:
    return "storage is unavailable";
  case MULTIPLEX_XBOX_STORAGE_INVALID_CREDENTIALS:
    return "authorization data is invalid";
  }
  return "unknown storage error";
}
