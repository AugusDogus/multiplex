#include "auth_record.h"

#include <limits.h>
#include <string.h>

#define AUTH_RECORD_VERSION 2u
#define AUTH_RECORD_LEGACY_VERSION 1u
#define AUTH_PAYLOAD_HEADER_SIZE 24u
#define AUTH_LEGACY_PAYLOAD_HEADER_SIZE 16u

static void write_be16(uint8_t *destination, uint16_t value) {
  destination[0] = (uint8_t)(value >> 8u);
  destination[1] = (uint8_t)value;
}

static void write_be32(uint8_t *destination, uint32_t value) {
  destination[0] = (uint8_t)(value >> 24u);
  destination[1] = (uint8_t)(value >> 16u);
  destination[2] = (uint8_t)(value >> 8u);
  destination[3] = (uint8_t)value;
}

static void write_be64(uint8_t *destination, uint64_t value) {
  write_be32(destination, (uint32_t)(value >> 32u));
  write_be32(destination + 4, (uint32_t)value);
}

static uint16_t read_be16(const uint8_t *source) {
  return (uint16_t)(((uint16_t)source[0] << 8u) | source[1]);
}

static uint32_t read_be32(const uint8_t *source) {
  return ((uint32_t)source[0] << 24u) | ((uint32_t)source[1] << 16u) |
         ((uint32_t)source[2] << 8u) | source[3];
}

static uint64_t read_be64(const uint8_t *source) {
  return ((uint64_t)read_be32(source) << 32u) | (uint64_t)read_be32(source + 4);
}

static size_t bounded_string_length(const char *value, size_t capacity) {
  size_t length = 0;
  while (length < capacity && value[length] != '\0') {
    ++length;
  }
  return length;
}

static uint32_t crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = UINT32_MAX;
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8; ++bit) {
      const uint32_t mask = (uint32_t) - (int32_t)(crc & 1u);
      crc = (crc >> 1u) ^ (0xedb88320u & mask);
    }
  }
  return ~crc;
}

static bool generation_is_newer(uint32_t candidate, uint32_t current) {
  const uint32_t distance = candidate - current;
  return distance != 0 && distance < UINT32_C(0x80000000);
}

bool multiplex_auth_record_encode(uint8_t *destination, size_t capacity,
                                  const MultiplexAuthCredentials *credentials,
                                  uint32_t generation) {
  if (destination == NULL || credentials == NULL ||
      capacity < MULTIPLEX_AUTH_RECORD_HEADER_SIZE + AUTH_PAYLOAD_HEADER_SIZE) {
    return false;
  }

  const size_t origin_length = bounded_string_length(
      credentials->origin, MULTIPLEX_AUTH_ORIGIN_CAPACITY);
  const size_t session_token_length = bounded_string_length(
      credentials->session_token, MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY);
  const size_t plex_token_length = bounded_string_length(
      credentials->plex_token, MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY);
  const size_t plex_client_id_length = bounded_string_length(
      credentials->plex_client_id, MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY);
  const size_t plex_server_url_length = bounded_string_length(
      credentials->plex_server_url, MULTIPLEX_AUTH_PLEX_SERVER_URL_CAPACITY);
  const size_t plex_server_token_length =
      bounded_string_length(credentials->plex_server_token,
                            MULTIPLEX_AUTH_PLEX_SERVER_TOKEN_CAPACITY);
  const size_t plex_server_id_length = bounded_string_length(
      credentials->plex_server_id, MULTIPLEX_AUTH_PLEX_SERVER_ID_CAPACITY);
  const size_t plex_server_name_length = bounded_string_length(
      credentials->plex_server_name, MULTIPLEX_AUTH_PLEX_SERVER_NAME_CAPACITY);
  if (origin_length == MULTIPLEX_AUTH_ORIGIN_CAPACITY ||
      session_token_length == MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY ||
      plex_token_length == MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY ||
      plex_client_id_length == MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY ||
      plex_server_url_length == MULTIPLEX_AUTH_PLEX_SERVER_URL_CAPACITY ||
      plex_server_token_length == MULTIPLEX_AUTH_PLEX_SERVER_TOKEN_CAPACITY ||
      plex_server_id_length == MULTIPLEX_AUTH_PLEX_SERVER_ID_CAPACITY ||
      plex_server_name_length == MULTIPLEX_AUTH_PLEX_SERVER_NAME_CAPACITY ||
      origin_length == 0 || session_token_length == 0) {
    return false;
  }

  const size_t payload_size = AUTH_PAYLOAD_HEADER_SIZE + origin_length +
                              session_token_length + plex_token_length +
                              plex_client_id_length + plex_server_url_length +
                              plex_server_token_length + plex_server_id_length +
                              plex_server_name_length;
  if (payload_size > UINT32_MAX ||
      MULTIPLEX_AUTH_RECORD_HEADER_SIZE + payload_size > capacity) {
    return false;
  }

  memset(destination, 0, capacity);
  memcpy(destination, "MPXA", 4);
  write_be16(destination + 4, AUTH_RECORD_VERSION);
  write_be16(destination + 6, MULTIPLEX_AUTH_RECORD_HEADER_SIZE);
  write_be32(destination + 8, generation);
  write_be32(destination + 12, (uint32_t)payload_size);

  uint8_t *payload = destination + MULTIPLEX_AUTH_RECORD_HEADER_SIZE;
  write_be64(payload, credentials->session_expires_at_unix);
  write_be16(payload + 8, (uint16_t)origin_length);
  write_be16(payload + 10, (uint16_t)session_token_length);
  write_be16(payload + 12, (uint16_t)plex_token_length);
  write_be16(payload + 14, (uint16_t)plex_client_id_length);
  write_be16(payload + 16, (uint16_t)plex_server_url_length);
  write_be16(payload + 18, (uint16_t)plex_server_token_length);
  write_be16(payload + 20, (uint16_t)plex_server_id_length);
  write_be16(payload + 22, (uint16_t)plex_server_name_length);

  size_t cursor = AUTH_PAYLOAD_HEADER_SIZE;
  memcpy(payload + cursor, credentials->origin, origin_length);
  cursor += origin_length;
  memcpy(payload + cursor, credentials->session_token, session_token_length);
  cursor += session_token_length;
  memcpy(payload + cursor, credentials->plex_token, plex_token_length);
  cursor += plex_token_length;
  memcpy(payload + cursor, credentials->plex_client_id, plex_client_id_length);
  cursor += plex_client_id_length;
  memcpy(payload + cursor, credentials->plex_server_url,
         plex_server_url_length);
  cursor += plex_server_url_length;
  memcpy(payload + cursor, credentials->plex_server_token,
         plex_server_token_length);
  cursor += plex_server_token_length;
  memcpy(payload + cursor, credentials->plex_server_id, plex_server_id_length);
  cursor += plex_server_id_length;
  memcpy(payload + cursor, credentials->plex_server_name,
         plex_server_name_length);

  write_be32(destination + 16, crc32(payload, payload_size));
  write_be32(destination + 20, crc32(destination, 20));
  return true;
}

bool multiplex_auth_record_decode(const uint8_t *record, size_t size,
                                  MultiplexAuthCredentials *credentials,
                                  uint32_t *generation) {
  if (record == NULL || credentials == NULL || generation == NULL ||
      size < MULTIPLEX_AUTH_RECORD_HEADER_SIZE ||
      memcmp(record, "MPXA", 4) != 0 ||
      read_be16(record + 6) != MULTIPLEX_AUTH_RECORD_HEADER_SIZE ||
      crc32(record, 20) != read_be32(record + 20)) {
    return false;
  }
  const uint16_t version = read_be16(record + 4);
  if (version != AUTH_RECORD_VERSION && version != AUTH_RECORD_LEGACY_VERSION) {
    return false;
  }

  const size_t payload_size = read_be32(record + 12);
  const size_t payload_header_size = version == AUTH_RECORD_VERSION
                                         ? AUTH_PAYLOAD_HEADER_SIZE
                                         : AUTH_LEGACY_PAYLOAD_HEADER_SIZE;
  if (payload_size < payload_header_size ||
      payload_size > size - MULTIPLEX_AUTH_RECORD_HEADER_SIZE) {
    return false;
  }

  const uint8_t *payload = record + MULTIPLEX_AUTH_RECORD_HEADER_SIZE;
  if (crc32(payload, payload_size) != read_be32(record + 16)) {
    return false;
  }

  const size_t origin_length = read_be16(payload + 8);
  const size_t session_token_length = read_be16(payload + 10);
  const size_t plex_token_length = read_be16(payload + 12);
  const size_t plex_client_id_length = read_be16(payload + 14);
  const size_t plex_server_url_length =
      version == AUTH_RECORD_VERSION ? read_be16(payload + 16) : 0;
  const size_t plex_server_token_length =
      version == AUTH_RECORD_VERSION ? read_be16(payload + 18) : 0;
  const size_t plex_server_id_length =
      version == AUTH_RECORD_VERSION ? read_be16(payload + 20) : 0;
  const size_t plex_server_name_length =
      version == AUTH_RECORD_VERSION ? read_be16(payload + 22) : 0;
  const size_t field_bytes = origin_length + session_token_length +
                             plex_token_length + plex_client_id_length +
                             plex_server_url_length + plex_server_token_length +
                             plex_server_id_length + plex_server_name_length;
  if (origin_length == 0 || origin_length >= MULTIPLEX_AUTH_ORIGIN_CAPACITY ||
      session_token_length == 0 ||
      session_token_length >= MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY ||
      plex_token_length >= MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY ||
      plex_client_id_length >= MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY ||
      plex_server_url_length >= MULTIPLEX_AUTH_PLEX_SERVER_URL_CAPACITY ||
      plex_server_token_length >= MULTIPLEX_AUTH_PLEX_SERVER_TOKEN_CAPACITY ||
      plex_server_id_length >= MULTIPLEX_AUTH_PLEX_SERVER_ID_CAPACITY ||
      plex_server_name_length >= MULTIPLEX_AUTH_PLEX_SERVER_NAME_CAPACITY ||
      field_bytes != payload_size - payload_header_size) {
    return false;
  }

  memset(credentials, 0, sizeof(*credentials));
  credentials->session_expires_at_unix = read_be64(payload);
  size_t cursor = payload_header_size;
  memcpy(credentials->origin, payload + cursor, origin_length);
  cursor += origin_length;
  memcpy(credentials->session_token, payload + cursor, session_token_length);
  cursor += session_token_length;
  memcpy(credentials->plex_token, payload + cursor, plex_token_length);
  cursor += plex_token_length;
  memcpy(credentials->plex_client_id, payload + cursor, plex_client_id_length);
  cursor += plex_client_id_length;
  memcpy(credentials->plex_server_url, payload + cursor,
         plex_server_url_length);
  cursor += plex_server_url_length;
  memcpy(credentials->plex_server_token, payload + cursor,
         plex_server_token_length);
  cursor += plex_server_token_length;
  memcpy(credentials->plex_server_id, payload + cursor, plex_server_id_length);
  cursor += plex_server_id_length;
  memcpy(credentials->plex_server_name, payload + cursor,
         plex_server_name_length);
  *generation = read_be32(record + 8);
  return true;
}

MultiplexAuthRecordSelection
multiplex_auth_record_select(const uint8_t *first, size_t first_size,
                             const uint8_t *second, size_t second_size,
                             MultiplexAuthCredentials *credentials,
                             uint32_t *generation) {
  MultiplexAuthCredentials first_credentials;
  MultiplexAuthCredentials second_credentials;
  uint32_t first_generation = 0;
  uint32_t second_generation = 0;
  const bool first_valid = multiplex_auth_record_decode(
      first, first_size, &first_credentials, &first_generation);
  const bool second_valid = multiplex_auth_record_decode(
      second, second_size, &second_credentials, &second_generation);

  if (!first_valid && !second_valid) {
    return MULTIPLEX_AUTH_RECORD_NONE;
  }

  const bool select_second =
      second_valid && (!first_valid || generation_is_newer(second_generation,
                                                           first_generation));
  if (select_second) {
    *credentials = second_credentials;
    *generation = second_generation;
    return MULTIPLEX_AUTH_RECORD_SECOND;
  }

  *credentials = first_credentials;
  *generation = first_generation;
  return MULTIPLEX_AUTH_RECORD_FIRST;
}
