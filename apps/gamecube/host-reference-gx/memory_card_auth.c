#include "memory_card_auth.h"
#include "memory_card_presentation.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/card.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MULTIPLEX_CARD_FILENAME "Multiplex"
#define MULTIPLEX_CARD_SECTORS 2u
#define MULTIPLEX_CARD_READY_ATTEMPTS 50u
#define MULTIPLEX_CARD_READY_RETRY_US 20000u
#define MULTIPLEX_CARD_CACHE_OFFSET 6144u

typedef enum {
  MULTIPLEX_CARD_RECORD_NONE = 0,
  MULTIPLEX_CARD_RECORD_FIRST,
  MULTIPLEX_CARD_RECORD_SECOND,
  MULTIPLEX_CARD_RECORD_LEGACY_FIRST,
} MultiplexCardRecordSource;

static uint8_t card_workarea[CARD_WORKAREA] __attribute__((aligned(32)));
static bool card_initialized;

static MultiplexMemoryCardResult map_card_error(int result) {
  switch (result) {
    case CARD_ERROR_READY:
      return MULTIPLEX_MEMORY_CARD_OK;
    case CARD_ERROR_NOCARD:
    case CARD_ERROR_WRONGDEVICE:
      return MULTIPLEX_MEMORY_CARD_NO_CARD;
    case CARD_ERROR_NOFILE:
      return MULTIPLEX_MEMORY_CARD_NOT_FOUND;
    case CARD_ERROR_NOENT:
    case CARD_ERROR_INSSPACE:
    case CARD_ERROR_LIMIT:
      return MULTIPLEX_MEMORY_CARD_NO_SPACE;
    case CARD_ERROR_BROKEN:
    case CARD_ERROR_ENCODING:
      return MULTIPLEX_MEMORY_CARD_CORRUPT;
    default:
      return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
}

static MultiplexMemoryCardResult initialize_card_api(void) {
  if (card_initialized) {
    return MULTIPLEX_MEMORY_CARD_OK;
  }
  const int result = CARD_Init("MPLX", "MX");
  if (result < CARD_ERROR_READY) {
    return map_card_error(result);
  }
  card_initialized = true;
  return MULTIPLEX_MEMORY_CARD_OK;
}

static MultiplexMemoryCardResult mount_slot(int slot, int *sector_size) {
  int memory_size = 0;
  int probed_sector_size = 0;
  int result = CARD_ERROR_BUSY;
  for (unsigned attempt = 0;
       attempt < MULTIPLEX_CARD_READY_ATTEMPTS &&
       result == CARD_ERROR_BUSY;
       ++attempt) {
    result = CARD_ProbeEx(slot, &memory_size, &probed_sector_size);
    if (result == CARD_ERROR_BUSY) {
      usleep(MULTIPLEX_CARD_READY_RETRY_US);
    }
  }
  if (result < CARD_ERROR_READY) {
    SYS_Report("REFERENCE GX: memory-card probe slot=%c result=%d\n",
               slot == CARD_SLOTA ? 'A' : 'B', result);
    return map_card_error(result);
  }
  if (probed_sector_size < (int)CARD_READSIZE ||
      probed_sector_size % (int)CARD_READSIZE != 0) {
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
  result = CARD_Mount(slot, card_workarea, NULL);
  if (result < CARD_ERROR_READY) {
    SYS_Report(
        "REFERENCE GX: memory-card mount slot=%c result=%d size=%d "
        "sector=%d\n",
        slot == CARD_SLOTA ? 'A' : 'B', result, memory_size,
        probed_sector_size);
    return map_card_error(result);
  }
  *sector_size = probed_sector_size;
  return MULTIPLEX_MEMORY_CARD_OK;
}

static void close_and_unmount(card_file *file, bool is_open, int slot) {
  if (is_open) {
    CARD_Close(file);
  }
  CARD_Unmount(slot);
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

static bool generation_is_newer(uint32_t candidate, uint32_t current) {
  const uint32_t distance = candidate - current;
  return distance != 0 && distance < UINT32_C(0x80000000);
}

static MultiplexCardRecordSource select_records(
    const uint8_t *first, size_t first_size, const uint8_t *second,
    size_t second_size, MultiplexAuthCredentials *credentials,
    uint32_t *generation) {
  MultiplexCardRecordSource source = MULTIPLEX_CARD_RECORD_NONE;
  if (first_size > MULTIPLEX_CARD_AUTH_OFFSET) {
    const MultiplexAuthRecordSelection selected = multiplex_auth_record_select(
        first + MULTIPLEX_CARD_AUTH_OFFSET,
        first_size - MULTIPLEX_CARD_AUTH_OFFSET, second, second_size,
        credentials, generation);
    if (selected == MULTIPLEX_AUTH_RECORD_FIRST) {
      source = MULTIPLEX_CARD_RECORD_FIRST;
    } else if (selected == MULTIPLEX_AUTH_RECORD_SECOND) {
      source = MULTIPLEX_CARD_RECORD_SECOND;
    }
  }

  MultiplexAuthCredentials legacy_credentials;
  uint32_t legacy_generation = 0;
  if (multiplex_auth_record_decode(first, first_size, &legacy_credentials,
                                   &legacy_generation) &&
      (source == MULTIPLEX_CARD_RECORD_NONE ||
       generation_is_newer(legacy_generation, *generation))) {
    *credentials = legacy_credentials;
    *generation = legacy_generation;
    source = MULTIPLEX_CARD_RECORD_LEGACY_FIRST;
  }
  return source;
}

static MultiplexMemoryCardResult read_records(
    card_file *file, int sector_size, uint8_t *first, uint8_t *second) {
  if (file->len < sector_size * (int)MULTIPLEX_CARD_SECTORS) {
    return MULTIPLEX_MEMORY_CARD_CORRUPT;
  }
  int result = CARD_Read(file, first, (uint32_t)sector_size, 0);
  if (result < CARD_ERROR_READY) {
    return map_card_error(result);
  }
  result = CARD_Read(file, second, (uint32_t)sector_size,
                     (uint32_t)sector_size);
  return result < CARD_ERROR_READY ? map_card_error(result)
                                   : MULTIPLEX_MEMORY_CARD_OK;
}

static MultiplexMemoryCardResult load_from_slot(
    int slot, MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location, uint8_t *cache,
    size_t cache_capacity) {
  int sector_size = 0;
  MultiplexMemoryCardResult result = mount_slot(slot, &sector_size);
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    SYS_Report("REFERENCE GX: memory-card load slot=%c mount=%d\n",
               slot == CARD_SLOTA ? 'A' : 'B', result);
    return result;
  }

  card_file file;
  bool is_open = false;
  int card_result = CARD_Open(slot, MULTIPLEX_CARD_FILENAME, &file);
  if (card_result < CARD_ERROR_READY) {
    SYS_Report("REFERENCE GX: memory-card load slot=%c open=%d\n",
               slot == CARD_SLOTA ? 'A' : 'B', card_result);
    CARD_Unmount(slot);
    return map_card_error(card_result);
  }
  is_open = true;
  const int file_size = file.len;

  uint8_t *first = memalign(32, (size_t)sector_size);
  uint8_t *second = memalign(32, (size_t)sector_size);
  if (first == NULL || second == NULL) {
    free(first);
    free(second);
    close_and_unmount(&file, is_open, slot);
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }

  result = read_records(&file, sector_size, first, second);
  uint32_t generation = 0;
  if (result == MULTIPLEX_MEMORY_CARD_OK) {
    const MultiplexCardRecordSource selection = select_records(
        first, (size_t)sector_size, second, (size_t)sector_size, credentials,
        &generation);
    if (selection == MULTIPLEX_CARD_RECORD_NONE) {
      result = MULTIPLEX_MEMORY_CARD_CORRUPT;
    }
    SYS_Report(
        "REFERENCE GX: memory-card load slot=%c bytes=%d selection=%d "
        "generation=%u\n",
        slot == CARD_SLOTA ? 'A' : 'B', file_size, selection, generation);
  } else {
    SYS_Report("REFERENCE GX: memory-card load slot=%c read=%d bytes=%d\n",
               slot == CARD_SLOTA ? 'A' : 'B', result, file_size);
  }

  const bool needs_presentation =
      result == MULTIPLEX_MEMORY_CARD_OK &&
      !multiplex_memory_card_has_presentation(first, (size_t)sector_size);
  if (result == MULTIPLEX_MEMORY_CARD_OK && cache != NULL &&
      cache_capacity >= MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY &&
      (size_t)sector_size >=
          MULTIPLEX_CARD_CACHE_OFFSET + MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY) {
    memcpy(cache, first + MULTIPLEX_CARD_CACHE_OFFSET,
           MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY);
  }
  free(first);
  free(second);
  close_and_unmount(&file, is_open, slot);
  if (result == MULTIPLEX_MEMORY_CARD_OK && location != NULL) {
    location->slot = slot;
    location->generation = generation;
    location->needs_presentation = needs_presentation;
  }
  return result;
}

MultiplexMemoryCardResult multiplex_memory_card_load_auth(
    MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location) {
  return multiplex_memory_card_load_auth_with_cache(credentials, location,
                                                     NULL, 0);
}

MultiplexMemoryCardResult multiplex_memory_card_load_auth_with_cache(
    MultiplexAuthCredentials *credentials, MultiplexMemoryCardLocation *location,
    uint8_t *cache, size_t cache_capacity) {
  if (credentials == NULL) {
    return MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS;
  }
  MultiplexMemoryCardResult result = initialize_card_api();
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }

  MultiplexMemoryCardResult best_result = MULTIPLEX_MEMORY_CARD_NO_CARD;
  for (int slot = CARD_SLOTA; slot <= CARD_SLOTB; ++slot) {
    result = load_from_slot(slot, credentials, location, cache,
                            cache_capacity);
    if (result == MULTIPLEX_MEMORY_CARD_OK) {
      return result;
    }
    if (result == MULTIPLEX_MEMORY_CARD_CORRUPT) {
      best_result = result;
    } else if (result == MULTIPLEX_MEMORY_CARD_IO_ERROR &&
               best_result != MULTIPLEX_MEMORY_CARD_CORRUPT) {
      best_result = result;
    } else if (result == MULTIPLEX_MEMORY_CARD_NOT_FOUND &&
               best_result == MULTIPLEX_MEMORY_CARD_NO_CARD) {
      best_result = result;
    }
  }
  return best_result;
}

static MultiplexMemoryCardResult save_to_slot(
    int slot, const MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location) {
  int sector_size = 0;
  SYS_Report("REFERENCE GX: memory-card save slot=%c begin\n",
             slot == CARD_SLOTA ? 'A' : 'B');
  MultiplexMemoryCardResult result = mount_slot(slot, &sector_size);
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }

  card_file file;
  bool is_open = false;
  bool created = false;
  int card_result = CARD_Open(slot, MULTIPLEX_CARD_FILENAME, &file);
  if (card_result == CARD_ERROR_NOFILE) {
    card_result =
        CARD_Create(slot, MULTIPLEX_CARD_FILENAME,
                    (uint32_t)sector_size * MULTIPLEX_CARD_SECTORS, &file);
    created = card_result >= CARD_ERROR_READY;
  }
  if (card_result < CARD_ERROR_READY) {
    CARD_Unmount(slot);
    return map_card_error(card_result);
  }
  is_open = true;

  uint8_t *first = memalign(32, (size_t)sector_size);
  uint8_t *second = memalign(32, (size_t)sector_size);
  uint8_t *verification = memalign(32, (size_t)sector_size);
  if (first == NULL || second == NULL || verification == NULL) {
    free(first);
    free(second);
    free(verification);
    close_and_unmount(&file, is_open, slot);
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
  memset(first, 0, (size_t)sector_size);
  memset(second, 0, (size_t)sector_size);

  if (!created) {
    result = read_records(&file, sector_size, first, second);
    if (result != MULTIPLEX_MEMORY_CARD_OK) {
      free(first);
      free(second);
      free(verification);
      close_and_unmount(&file, is_open, slot);
      return result;
    }
  }

  MultiplexAuthCredentials existing_credentials;
  uint32_t current_generation = 0;
  const MultiplexCardRecordSource selected = select_records(
      first, (size_t)sector_size, second, (size_t)sector_size,
      &existing_credentials, &current_generation);
  const unsigned target_index = selected == MULTIPLEX_CARD_RECORD_FIRST ? 1u : 0u;
  const uint32_t next_generation =
      selected == MULTIPLEX_CARD_RECORD_NONE ? 1u : current_generation + 1u;
  SYS_Report(
      "REFERENCE GX: memory-card save slot=%c selected=%u generation=%u "
      "sector=%d\n",
      slot == CARD_SLOTA ? 'A' : 'B', selected, next_generation, sector_size);
  uint8_t *target = target_index == 0 ? first + MULTIPLEX_CARD_AUTH_OFFSET
                                     : second;
  const size_t target_capacity = target_index == 0
                                     ? MULTIPLEX_CARD_CACHE_OFFSET -
                                           MULTIPLEX_CARD_AUTH_OFFSET
                                     : (size_t)sector_size;
  if (!multiplex_memory_card_prepare_presentation(first,
                                                   (size_t)sector_size) ||
      !multiplex_auth_record_encode(target, target_capacity, credentials,
                                    next_generation)) {
    result = MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS;
  } else {
    card_result = CARD_Write(&file, first, (uint32_t)sector_size, 0);
    SYS_Report("REFERENCE GX: memory-card write slot=%c target=%u result=%d\n",
               slot == CARD_SLOTA ? 'A' : 'B', target_index, card_result);
    if (card_result >= CARD_ERROR_READY && target_index == 1u) {
      card_result = CARD_Write(&file, second, (uint32_t)sector_size,
                               (uint32_t)sector_size);
    }
    if (card_result < CARD_ERROR_READY) {
      result = map_card_error(card_result);
    } else {
      card_result =
          CARD_Read(&file, verification, (uint32_t)sector_size,
                    (uint32_t)(target_index * (unsigned)sector_size));
      MultiplexAuthCredentials verified_credentials;
      uint32_t verified_generation = 0;
      const uint8_t *verified_record =
          target_index == 0 ? verification + MULTIPLEX_CARD_AUTH_OFFSET
                            : verification;
      const size_t verified_capacity = target_index == 0
                                           ? (size_t)sector_size -
                                                 MULTIPLEX_CARD_AUTH_OFFSET
                                           : (size_t)sector_size;
      if (card_result < CARD_ERROR_READY ||
          !multiplex_auth_record_decode(
              verified_record, verified_capacity, &verified_credentials,
              &verified_generation) ||
          verified_generation != next_generation ||
          !credentials_equal(&verified_credentials, credentials)) {
        result = MULTIPLEX_MEMORY_CARD_IO_ERROR;
      } else {
        card_stat status;
        card_result = CARD_GetStatus(slot, file.filenum, &status);
        if (card_result >= CARD_ERROR_READY) {
          status.banner_fmt = CARD_BANNER_NONE;
          status.icon_addr = MULTIPLEX_CARD_ICON_OFFSET;
          status.icon_fmt = CARD_ICON_RGB;
          status.icon_speed = CARD_SPEED_SLOW;
          status.comment_addr = MULTIPLEX_CARD_COMMENT_OFFSET;
          card_result = CARD_SetStatus(slot, file.filenum, &status);
        }
        result = card_result < CARD_ERROR_READY ? map_card_error(card_result)
                                                : MULTIPLEX_MEMORY_CARD_OK;
      }
    }
  }

  free(first);
  free(second);
  free(verification);
  close_and_unmount(&file, is_open, slot);
  if (result == MULTIPLEX_MEMORY_CARD_OK && location != NULL) {
    location->slot = slot;
    location->generation = next_generation;
    location->needs_presentation = false;
  }
  return result;
}

MultiplexMemoryCardResult multiplex_memory_card_save_auth(
    const MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location) {
  if (credentials == NULL) {
    return MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS;
  }
  MultiplexMemoryCardResult result = initialize_card_api();
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }

  MultiplexMemoryCardResult fallback = MULTIPLEX_MEMORY_CARD_NO_CARD;
  if (location != NULL &&
      (location->slot == CARD_SLOTA || location->slot == CARD_SLOTB)) {
    result = save_to_slot(location->slot, credentials, location);
    if (result == MULTIPLEX_MEMORY_CARD_OK ||
        (result != MULTIPLEX_MEMORY_CARD_NO_CARD &&
         result != MULTIPLEX_MEMORY_CARD_NO_SPACE)) {
      return result;
    }
    fallback = result;
  }

  for (int slot = CARD_SLOTA; slot <= CARD_SLOTB; ++slot) {
    if (location != NULL && slot == location->slot) {
      continue;
    }
    result = save_to_slot(slot, credentials, location);
    if (result == MULTIPLEX_MEMORY_CARD_OK) {
      return result;
    }
    if (result != MULTIPLEX_MEMORY_CARD_NO_CARD) {
      fallback = result;
    }
  }
  return fallback;
}

MultiplexMemoryCardResult multiplex_memory_card_delete_auth(
    MultiplexMemoryCardLocation *location) {
  if (location == NULL ||
      (location->slot != CARD_SLOTA && location->slot != CARD_SLOTB)) {
    return MULTIPLEX_MEMORY_CARD_NOT_FOUND;
  }
  MultiplexMemoryCardResult result = initialize_card_api();
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }
  int sector_size = 0;
  result = mount_slot(location->slot, &sector_size);
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }
  (void)sector_size;
  const int card_result =
      CARD_Delete(location->slot, MULTIPLEX_CARD_FILENAME);
  CARD_Unmount(location->slot);
  result = map_card_error(card_result);
  if (result == MULTIPLEX_MEMORY_CARD_OK ||
      result == MULTIPLEX_MEMORY_CARD_NOT_FOUND) {
    SYS_Report("REFERENCE GX: memory-card auth deleted slot=%c result=%d\n",
               location->slot == CARD_SLOTA ? 'A' : 'B', card_result);
    location->slot = -1;
    location->generation = 0;
    location->needs_presentation = false;
    return MULTIPLEX_MEMORY_CARD_OK;
  }
  SYS_Report("REFERENCE GX: memory-card auth delete failed slot=%c result=%d\n",
             location->slot == CARD_SLOTA ? 'A' : 'B', card_result);
  return result;
}

MultiplexMemoryCardResult multiplex_memory_card_save_cache(
    const MultiplexMemoryCardLocation *location, const uint8_t *source,
    size_t size) {
  if (location == NULL || source == NULL ||
      size != MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY ||
      (location->slot != CARD_SLOTA && location->slot != CARD_SLOTB)) {
    return MULTIPLEX_MEMORY_CARD_NOT_FOUND;
  }
  MultiplexMemoryCardResult result = initialize_card_api();
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }
  int sector_size = 0;
  result = mount_slot(location->slot, &sector_size);
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }
  if ((size_t)sector_size <
      MULTIPLEX_CARD_CACHE_OFFSET + MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY) {
    CARD_Unmount(location->slot);
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
  card_file file;
  const int open_result =
      CARD_Open(location->slot, MULTIPLEX_CARD_FILENAME, &file);
  if (open_result < CARD_ERROR_READY) {
    CARD_Unmount(location->slot);
    return map_card_error(open_result);
  }
  uint8_t *block = memalign(32, (size_t)sector_size);
  uint8_t *verification = memalign(32, (size_t)sector_size);
  if (block == NULL || verification == NULL) {
    free(block);
    free(verification);
    close_and_unmount(&file, true, location->slot);
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
  int card_result = CARD_Read(&file, block, (uint32_t)sector_size, 0);
  if (card_result >= CARD_ERROR_READY) {
    memcpy(block + MULTIPLEX_CARD_CACHE_OFFSET, source, size);
    card_result = CARD_Write(&file, block, (uint32_t)sector_size, 0);
  }
  if (card_result >= CARD_ERROR_READY) {
    card_result = CARD_Read(&file, verification, (uint32_t)sector_size, 0);
  }
  const bool verified =
      card_result >= CARD_ERROR_READY &&
      memcmp(verification + MULTIPLEX_CARD_CACHE_OFFSET, source, size) == 0;
  free(block);
  free(verification);
  close_and_unmount(&file, true, location->slot);
  SYS_Report("REFERENCE GX: memory-card catalog cache save slot=%c result=%d "
             "verified=%u\n",
             location->slot == CARD_SLOTA ? 'A' : 'B', card_result,
             verified ? 1u : 0u);
  return card_result < CARD_ERROR_READY
             ? map_card_error(card_result)
             : (verified ? MULTIPLEX_MEMORY_CARD_OK
                         : MULTIPLEX_MEMORY_CARD_IO_ERROR);
}

const char *multiplex_memory_card_result_message(
    MultiplexMemoryCardResult result) {
  switch (result) {
    case MULTIPLEX_MEMORY_CARD_OK:
      return "Sign-in saved to memory card.";
    case MULTIPLEX_MEMORY_CARD_NOT_FOUND:
      return "No Multiplex save was found.";
    case MULTIPLEX_MEMORY_CARD_NO_CARD:
      return "Insert a memory card to save sign-in.";
    case MULTIPLEX_MEMORY_CARD_NO_SPACE:
      return "The memory card needs two free blocks.";
    case MULTIPLEX_MEMORY_CARD_CORRUPT:
      return "The Multiplex save could not be read.";
    case MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS:
      return "The sign-in data is too large to save.";
    case MULTIPLEX_MEMORY_CARD_IO_ERROR:
    default:
      return "The memory card could not be accessed.";
  }
}
