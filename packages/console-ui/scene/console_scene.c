#include "console_scene.h"

#include <string.h>

uint16_t multiplex_scene_read_u16(const uint8_t *bytes) {
  return (uint16_t)((uint16_t)bytes[0] | (uint16_t)bytes[1] << 8u);
}

uint32_t multiplex_scene_read_u32(const uint8_t *bytes) {
  return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8u |
         (uint32_t)bytes[2] << 16u | (uint32_t)bytes[3] << 24u;
}

float multiplex_scene_read_f32(const uint8_t *bytes) {
  const uint32_t bits = multiplex_scene_read_u32(bytes);
  float value = 0.0f;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

void multiplex_scene_write_u16(uint8_t *bytes, uint16_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8u);
}

void multiplex_scene_write_u32(uint8_t *bytes, uint32_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8u);
  bytes[2] = (uint8_t)(value >> 16u);
  bytes[3] = (uint8_t)(value >> 24u);
}

void multiplex_scene_write_f32(uint8_t *bytes, float value) {
  uint32_t bits = 0;
  memcpy(&bits, &value, sizeof(bits));
  multiplex_scene_write_u32(bytes, bits);
}

uint32_t multiplex_scene_crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = UINT32_C(0xffffffff);
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8; ++bit) {
      const uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
      crc = (crc >> 1u) ^ (UINT32_C(0xedb88320) & mask);
    }
  }
  return ~crc;
}
