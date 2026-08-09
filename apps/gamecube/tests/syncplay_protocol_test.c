#include "syncplay_protocol.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void test_upgrade(void) {
  static const char response[] = "HTTP/1.1 101 Switching Protocols\r\n"
                                 "Upgrade: websocket\r\n"
                                 "Connection: keep-alive, Upgrade\r\n"
                                 "Sec-WebSocket-Accept: accepted\r\n\r\n";
  assert(multiplex_syncplay_validate_upgrade(response, "accepted"));
  assert(!multiplex_syncplay_validate_upgrade(response, "wrong"));
  assert(!multiplex_syncplay_validate_upgrade(response, "Accepted"));
  assert(!multiplex_syncplay_validate_upgrade(
      "HTTP/1.1 200 OK\r\nUpgrade: websocket\r\n"
      "Connection: Upgrade\r\n"
      "Sec-WebSocket-Accept: accepted\r\n\r\n",
      "accepted"));
  assert(!multiplex_syncplay_validate_upgrade("HTTP/1.1 101\r\n", "accepted"));
  assert(!multiplex_syncplay_validate_upgrade(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
      "Sec-WebSocket-Accept: accepted\r\n\r\n",
      "accepted"));
}

static void test_frames(void) {
  MultiplexSyncplayFrameHeader header;
  const uint8_t text[] = {0x81, 0x03, 'o', 'k', '!'};
  assert(multiplex_syncplay_decode_frame_header(text, sizeof(text), &header));
  assert(header.opcode == 1 && header.final && !header.masked &&
         header.header_size == 2 && header.payload_size == 3);
  const uint8_t extended[] = {0x89, 126, 0, 126};
  assert(multiplex_syncplay_decode_frame_header(extended, sizeof(extended),
                                                &header));
  assert(header.opcode == 9 && header.payload_size == 126);
  const uint8_t truncated[] = {0x81, 126, 0};
  assert(!multiplex_syncplay_decode_frame_header(truncated, sizeof(truncated),
                                                 &header));
  const uint8_t masked[] = {0x81, 0x80};
  assert(
      !multiplex_syncplay_decode_frame_header(masked, sizeof(masked), &header));
  const uint8_t huge[] = {0x81, 127};
  assert(!multiplex_syncplay_decode_frame_header(huge, sizeof(huge), &header));
  const uint8_t reserved[] = {0xc1, 0};
  assert(!multiplex_syncplay_decode_frame_header(reserved, sizeof(reserved),
                                                 &header));
  const uint8_t noncanonical[] = {0x81, 126, 0, 125};
  assert(!multiplex_syncplay_decode_frame_header(
      noncanonical, sizeof(noncanonical), &header));
}

static void test_hello(void) {
  assert(multiplex_syncplay_validate_hello(
      "{\"Set\":{\"username\":\"{\\\"deviceIdentifier\\\":"
      "\\\"device-1\\\"}\"}}",
      "device-1"));
  assert(multiplex_syncplay_validate_hello("{\"Hello\":{}}", "device-1"));
  assert(multiplex_syncplay_validate_hello("{\"List\":{}}", "device-1"));
  assert(
      !multiplex_syncplay_validate_hello("{\"Error\":\"denied\"}", "device-1"));
  assert(!multiplex_syncplay_validate_hello(
      "{\"Set\":{\"deviceIdentifier\":\"device-10\"}}", "device-1"));
}

int main(void) {
  test_upgrade();
  test_frames();
  test_hello();
  puts("GameCube Syncplay protocol tests passed.");
  return 0;
}
