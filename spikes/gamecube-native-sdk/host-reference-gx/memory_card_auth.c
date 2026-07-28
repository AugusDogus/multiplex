#include "memory_card_auth.h"

#include <malloc.h>
#include <ogc/card.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MULTIPLEX_CARD_FILENAME "Multiplex"
#define MULTIPLEX_CARD_SECTORS 2u

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
  int result = CARD_ProbeEx(slot, &memory_size, &probed_sector_size);
  if (result < CARD_ERROR_READY) {
    return map_card_error(result);
  }
  if (probed_sector_size < (int)CARD_READSIZE ||
      probed_sector_size % (int)CARD_READSIZE != 0) {
    return MULTIPLEX_MEMORY_CARD_IO_ERROR;
  }
  result = CARD_Mount(slot, card_workarea, NULL);
  if (result < CARD_ERROR_READY) {
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
         strcmp(first->plex_client_id, second->plex_client_id) == 0;
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
    MultiplexMemoryCardLocation *location) {
  int sector_size = 0;
  MultiplexMemoryCardResult result = mount_slot(slot, &sector_size);
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }

  card_file file;
  bool is_open = false;
  int card_result = CARD_Open(slot, MULTIPLEX_CARD_FILENAME, &file);
  if (card_result < CARD_ERROR_READY) {
    CARD_Unmount(slot);
    return map_card_error(card_result);
  }
  is_open = true;

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
  if (result == MULTIPLEX_MEMORY_CARD_OK &&
      multiplex_auth_record_select(first, (size_t)sector_size, second,
                                   (size_t)sector_size, credentials,
                                   &generation) ==
          MULTIPLEX_AUTH_RECORD_NONE) {
    result = MULTIPLEX_MEMORY_CARD_CORRUPT;
  }

  free(first);
  free(second);
  close_and_unmount(&file, is_open, slot);
  if (result == MULTIPLEX_MEMORY_CARD_OK && location != NULL) {
    location->slot = slot;
    location->generation = generation;
  }
  return result;
}

MultiplexMemoryCardResult multiplex_memory_card_load_auth(
    MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location) {
  if (credentials == NULL) {
    return MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS;
  }
  MultiplexMemoryCardResult result = initialize_card_api();
  if (result != MULTIPLEX_MEMORY_CARD_OK) {
    return result;
  }

  MultiplexMemoryCardResult best_result = MULTIPLEX_MEMORY_CARD_NO_CARD;
  for (int slot = CARD_SLOTA; slot <= CARD_SLOTB; ++slot) {
    result = load_from_slot(slot, credentials, location);
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
  const MultiplexAuthRecordSelection selected = multiplex_auth_record_select(
      first, (size_t)sector_size, second, (size_t)sector_size,
      &existing_credentials, &current_generation);
  const unsigned target_index =
      selected == MULTIPLEX_AUTH_RECORD_FIRST ? 1u : 0u;
  const uint32_t next_generation =
      selected == MULTIPLEX_AUTH_RECORD_NONE ? 1u : current_generation + 1u;
  uint8_t *target = target_index == 0 ? first : second;
  if (!multiplex_auth_record_encode(target, (size_t)sector_size, credentials,
                                    next_generation)) {
    result = MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS;
  } else {
    card_result =
        CARD_Write(&file, target, (uint32_t)sector_size,
                   (uint32_t)(target_index * (unsigned)sector_size));
    if (card_result < CARD_ERROR_READY) {
      result = map_card_error(card_result);
    } else {
      card_result =
          CARD_Read(&file, verification, (uint32_t)sector_size,
                    (uint32_t)(target_index * (unsigned)sector_size));
      MultiplexAuthCredentials verified_credentials;
      uint32_t verified_generation = 0;
      if (card_result < CARD_ERROR_READY ||
          !multiplex_auth_record_decode(
              verification, (size_t)sector_size, &verified_credentials,
              &verified_generation) ||
          verified_generation != next_generation ||
          !credentials_equal(&verified_credentials, credentials)) {
        result = MULTIPLEX_MEMORY_CARD_IO_ERROR;
      } else {
        result = MULTIPLEX_MEMORY_CARD_OK;
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
