#ifndef MULTIPLEX_SYNCPLAY_PROTOCOL_H
#define MULTIPLEX_SYNCPLAY_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  uint8_t opcode;
  size_t header_size;
  size_t payload_size;
  bool final;
  bool masked;
} MultiplexSyncplayFrameHeader;

bool multiplex_syncplay_validate_upgrade(const char *response,
                                         const char *expected_accept);
bool multiplex_syncplay_decode_frame_header(
    const uint8_t *bytes, size_t size, MultiplexSyncplayFrameHeader *output);
bool multiplex_syncplay_validate_hello(const char *response,
                                       const char *device_identifier);

#endif
