#include "memory_card_entropy.h"

#include <gccore.h>
#include <malloc.h>
#include <mbedtls/md.h>
#include <ogc/card.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MULTIPLEX_ENTROPY_CARD_FILENAME "Multiplex TLS Entropy"
#define MULTIPLEX_ENTROPY_CARD_SECTORS 2u
#define MULTIPLEX_ENTROPY_CARD_READY_ATTEMPTS 50u
#define MULTIPLEX_ENTROPY_CARD_READY_RETRY_US 20000u

typedef struct {
  card_file *file;
  uint8_t *sector;
  size_t sector_size;
} MemoryCardEntropyStore;

typedef struct {
  const uint8_t *additional;
} MemoryCardEntropyDerivation;

static uint8_t card_workarea[CARD_WORKAREA] __attribute__((aligned(32)));
static bool card_initialized;

static void clear_bytes(void *bytes, size_t size) {
  volatile uint8_t *cursor = bytes;
  while (size-- > 0) {
    *cursor++ = 0;
  }
}

static bool read_record(void *context, unsigned index, uint8_t *record,
                        size_t size) {
  MemoryCardEntropyStore *store = context;
  if (store == NULL || record == NULL || index >= 2u ||
      size != MULTIPLEX_ENTROPY_RECORD_SIZE ||
      CARD_Read(store->file, store->sector, (uint32_t)store->sector_size,
                (uint32_t)(index * store->sector_size)) < CARD_ERROR_READY) {
    return false;
  }
  memcpy(record, store->sector, size);
  return true;
}

static bool write_record(void *context, unsigned index, const uint8_t *record,
                         size_t size) {
  MemoryCardEntropyStore *store = context;
  if (store == NULL || record == NULL || index >= 2u ||
      size != MULTIPLEX_ENTROPY_RECORD_SIZE) {
    return false;
  }
  memset(store->sector, 0, store->sector_size);
  memcpy(store->sector, record, size);
  return CARD_Write(store->file, store->sector, (uint32_t)store->sector_size,
                    (uint32_t)(index * store->sector_size)) >=
         CARD_ERROR_READY;
}

static bool derive_hmac(const char *label, const uint8_t *seed,
                        const uint8_t *additional, uint8_t *output) {
  const mbedtls_md_info_t *sha256 =
      mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (sha256 == NULL) {
    return false;
  }
  mbedtls_md_context_t hash;
  mbedtls_md_init(&hash);
  int result = mbedtls_md_setup(&hash, sha256, 1);
  if (result == 0) {
    result = mbedtls_md_hmac_starts(&hash, seed,
                                    MULTIPLEX_ENTROPY_SEED_SIZE);
  }
  if (result == 0) {
    result = mbedtls_md_hmac_update(&hash, (const unsigned char *)label,
                                    strlen(label));
  }
  if (result == 0 && additional != NULL) {
    result = mbedtls_md_hmac_update(&hash, additional,
                                    MULTIPLEX_ENTROPY_SEED_SIZE);
  }
  if (result == 0) {
    result = mbedtls_md_hmac_finish(&hash, output);
  }
  mbedtls_md_free(&hash);
  return result == 0;
}

static bool derive_seed(
    void *context, const uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t next_seed[MULTIPLEX_ENTROPY_SEED_SIZE]) {
  const MemoryCardEntropyDerivation *derivation = context;
  if (derivation == NULL || derivation->additional == NULL ||
      !derive_hmac("Multiplex GameCube TLS boot seed v1", seed,
                   derivation->additional, boot_seed)) {
    return false;
  }
  if (!derive_hmac("Multiplex GameCube TLS next seed v1", seed, boot_seed,
                   next_seed)) {
    clear_bytes(boot_seed, MULTIPLEX_ENTROPY_SEED_SIZE);
    return false;
  }
  return true;
}

static bool initialize_card_api(void) {
  if (card_initialized) {
    return true;
  }
  if (CARD_Init("MPLX", "MX") < CARD_ERROR_READY) {
    return false;
  }
  card_initialized = true;
  return true;
}

static int mount_slot(int slot, int *sector_size) {
  int memory_size = 0;
  int probed_sector_size = 0;
  int result = CARD_ERROR_BUSY;
  for (unsigned attempt = 0;
       attempt < MULTIPLEX_ENTROPY_CARD_READY_ATTEMPTS &&
       result == CARD_ERROR_BUSY;
       ++attempt) {
    result = CARD_ProbeEx(slot, &memory_size, &probed_sector_size);
    if (result == CARD_ERROR_BUSY) {
      usleep(MULTIPLEX_ENTROPY_CARD_READY_RETRY_US);
    }
  }
  if (result < CARD_ERROR_READY || probed_sector_size < (int)CARD_READSIZE ||
      probed_sector_size % (int)CARD_READSIZE != 0) {
    return result < CARD_ERROR_READY ? result : CARD_ERROR_IOERROR;
  }
  result = CARD_Mount(slot, card_workarea, NULL);
  if (result >= CARD_ERROR_READY) {
    *sector_size = probed_sector_size;
  }
  return result;
}

static MultiplexEntropySeedResult rotate_from_slot(
    int slot, const uint8_t additional[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE]) {
  int sector_size = 0;
  int result = mount_slot(slot, &sector_size);
  if (result < CARD_ERROR_READY) {
    return result == CARD_ERROR_NOCARD || result == CARD_ERROR_WRONGDEVICE
               ? MULTIPLEX_ENTROPY_SEED_MISSING
               : MULTIPLEX_ENTROPY_SEED_READ_FAILED;
  }

  card_file file;
  result = CARD_Open(slot, MULTIPLEX_ENTROPY_CARD_FILENAME, &file);
  if (result < CARD_ERROR_READY) {
    CARD_Unmount(slot);
    return result == CARD_ERROR_NOFILE ? MULTIPLEX_ENTROPY_SEED_MISSING
                                       : MULTIPLEX_ENTROPY_SEED_READ_FAILED;
  }
  if (file.len < sector_size * (int)MULTIPLEX_ENTROPY_CARD_SECTORS) {
    CARD_Close(&file);
    CARD_Unmount(slot);
    return MULTIPLEX_ENTROPY_SEED_CORRUPT;
  }

  uint8_t *sector = memalign(32, (size_t)sector_size);
  if (sector == NULL) {
    CARD_Close(&file);
    CARD_Unmount(slot);
    return MULTIPLEX_ENTROPY_SEED_READ_FAILED;
  }
  MemoryCardEntropyStore adapter = {
      .file = &file,
      .sector = sector,
      .sector_size = (size_t)sector_size,
  };
  const MultiplexEntropySeedStore store = {
      .context = &adapter,
      .read = read_record,
      .write = write_record,
  };
  MemoryCardEntropyDerivation derivation = {
      .additional = additional,
  };
  const MultiplexEntropySeedResult seed_result = multiplex_entropy_seed_rotate(
      &store, derive_seed, &derivation, boot_seed);
  clear_bytes(sector, (size_t)sector_size);
  free(sector);
  CARD_Close(&file);
  CARD_Unmount(slot);
  return seed_result;
}

MultiplexEntropySeedResult multiplex_memory_card_rotate_entropy(
    const uint8_t additional[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE]) {
  if (additional == NULL || boot_seed == NULL) {
    return MULTIPLEX_ENTROPY_SEED_INVALID_ARGUMENT;
  }
  if (!initialize_card_api()) {
    return MULTIPLEX_ENTROPY_SEED_READ_FAILED;
  }
  MultiplexEntropySeedResult best = MULTIPLEX_ENTROPY_SEED_MISSING;
  for (int slot = CARD_SLOTA; slot <= CARD_SLOTB; ++slot) {
    const MultiplexEntropySeedResult result =
        rotate_from_slot(slot, additional, boot_seed);
    if (result == MULTIPLEX_ENTROPY_SEED_OK) {
      SYS_Report("REFERENCE GX: TLS entropy seed rotated slot=%c\n",
                 slot == CARD_SLOTA ? 'A' : 'B');
      return result;
    }
    if (result != MULTIPLEX_ENTROPY_SEED_MISSING) {
      best = result;
    }
  }
  return best;
}
