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

typedef struct {
  double round_trip_seconds;
  double average_round_trip_seconds;
  double forward_delay_seconds;
} MultiplexSyncplayPingTiming;

bool multiplex_syncplay_validate_upgrade(const char *response,
                                         const char *expected_accept);
bool multiplex_syncplay_decode_frame_header(
    const uint8_t *bytes, size_t size, MultiplexSyncplayFrameHeader *output);
bool multiplex_syncplay_validate_hello(const char *response,
                                       const char *device_identifier);
bool multiplex_syncplay_epoch_seconds(uint64_t epoch_milliseconds,
                                      uint64_t epoch_monotonic_ms,
                                      uint64_t now_monotonic_ms,
                                      double *output);
bool multiplex_syncplay_update_ping(MultiplexSyncplayPingTiming *timing,
                                    double now_seconds,
                                    double client_timestamp_seconds,
                                    double sender_round_trip_seconds);
uint32_t multiplex_syncplay_compensate_position(uint32_t position_ms,
                                                bool paused,
                                                double forward_delay_seconds);
bool multiplex_syncplay_should_seek(uint32_t local_position_ms,
                                    uint32_t remote_position_ms,
                                    bool explicit_seek);
bool multiplex_syncplay_can_initiate_startup(const uint32_t *user_ids,
                                             size_t user_count,
                                             uint32_t local_user_id);

#endif
