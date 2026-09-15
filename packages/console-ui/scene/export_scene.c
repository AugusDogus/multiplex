#include "console_scene.h"
#include "native_ui.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CATALOG_HEADER_SIZE 12u
#define CATALOG_ITEM_HEADER_SIZE 20u
#define CATALOG_MAX_SIZE 16384u
#define CATALOG_MAX_ROWS 3u
#define CATALOG_MAX_ITEMS_PER_ROW 8u
#define CATALOG_MAX_LIBRARIES 8u
#define DETAILS_HEADER_SIZE 40u

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static uint32_t read_be32(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24u) | ((uint32_t)bytes[1] << 16u) |
         ((uint32_t)bytes[2] << 8u) | bytes[3];
}

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  fprintf(stderr, "Native UI input action=%u focus=%u handlers=%u message=%u\n",
          action, focus, count, message);
}

void multiplex_native_profile_mark(uint32_t stage) { (void)stage; }

void *multiplex_native_cache_alloc(uint32_t length, uint32_t alignment) {
  if (length == 0 || alignment == 0 || (alignment & (alignment - 1u)) != 0) {
    return NULL;
  }
  if (alignment < sizeof(void *)) {
    alignment = sizeof(void *);
  }
  const size_t overhead = alignment - 1u + sizeof(void *);
  if ((size_t)length > SIZE_MAX - overhead) {
    return NULL;
  }
  uint8_t *allocation = malloc((size_t)length + overhead);
  if (allocation == NULL) {
    return NULL;
  }
  const uintptr_t aligned =
      ((uintptr_t)allocation + sizeof(void *) + alignment - 1u) &
      ~(uintptr_t)(alignment - 1u);
  ((void **)aligned)[-1] = allocation;
  return (void *)aligned;
}

void multiplex_native_cache_free(void *memory) {
  if (memory != NULL) {
    free(((void **)memory)[-1]);
  }
}

static int service_details_request(const uint8_t *details,
                                   size_t details_size);

static int apply_actions(const char *actions, const uint8_t *details,
                         size_t details_size) {
  static MultiplexNativeDrawCommand refreshed_commands[MULTIPLEX_SCENE_MAX_COMMANDS];
  if (actions == NULL || actions[0] == '\0') {
    return 1;
  }
  const char *cursor = actions;
  while (*cursor != '\0') {
    char *end = NULL;
    const unsigned long action = strtoul(cursor, &end, 10);
    if (end == cursor || action > UINT32_MAX ||
        (*end != '\0' && *end != ',')) {
      return 0;
    }
    if (multiplex_native_app_input((uint32_t)action) == 0) {
      return 0;
    }
    if (details == NULL && multiplex_native_app_details_request() != 0) {
      break;
    }
    if (!service_details_request(details, details_size)) {
      return 0;
    }
    const uint32_t refreshed_count = multiplex_native_app_render(
        refreshed_commands, MULTIPLEX_SCENE_MAX_COMMANDS);
    if (refreshed_count == 0 || refreshed_count > MULTIPLEX_SCENE_MAX_COMMANDS) {
      return 0;
    }
    cursor = *end == ',' ? end + 1 : end;
  }
  return 1;
}

static uint8_t *read_catalog(const char *path, size_t *size) {
  FILE *file = fopen(path, "rb");
  if (file == NULL || fseek(file, 0, SEEK_END) != 0) {
    if (file != NULL) {
      fclose(file);
    }
    return NULL;
  }
  const long length = ftell(file);
  if (length < (long)CATALOG_HEADER_SIZE || length > (long)CATALOG_MAX_SIZE ||
      fseek(file, 0, SEEK_SET) != 0) {
    fclose(file);
    return NULL;
  }
  uint8_t *bytes = malloc((size_t)length);
  if (bytes == NULL) {
    fclose(file);
    return NULL;
  }
  const size_t read_size = fread(bytes, 1, (size_t)length, file);
  const int close_status = fclose(file);
  if (read_size != (size_t)length || close_status != 0) {
    free(bytes);
    return NULL;
  }
  *size = read_size;
  return bytes;
}

static int bind_catalog_item(const uint8_t *bytes, size_t size,
                             size_t *cursor, uint32_t row_index,
                             uint32_t item_index) {
  if (*cursor + CATALOG_ITEM_HEADER_SIZE > size) {
    return 0;
  }
  const uint8_t *header = bytes + *cursor;
  const uint32_t rating_key = read_be32(header);
  const uint32_t duration_ms = read_be32(header + 4);
  const uint32_t view_offset_ms = read_be32(header + 8);
  const uint16_t artwork_slot = read_be16(header + 12);
  const uint8_t progress_percent = header[14];
  const uint16_t title_length = read_be16(header + 16);
  const uint16_t subtitle_length = read_be16(header + 18);
  *cursor += CATALOG_ITEM_HEADER_SIZE;
  if (title_length == 0 || *cursor + title_length + subtitle_length > size) {
    return 0;
  }
  const uint8_t *title = bytes + *cursor;
  *cursor += title_length;
  const uint8_t *subtitle = bytes + *cursor;
  *cursor += subtitle_length;
  return multiplex_native_app_catalog_item(
             row_index, item_index, rating_key, title, title_length, subtitle,
             subtitle_length, artwork_slot, duration_ms, view_offset_ms,
             progress_percent) != 0;
}

static int bind_catalog(const uint8_t *bytes, size_t size) {
  if (size < CATALOG_HEADER_SIZE || memcmp(bytes, "MPXG", 4) != 0) {
    return 0;
  }
  const uint16_t version = read_be16(bytes + 4);
  const uint16_t row_count = read_be16(bytes + 6);
  const uint16_t server_length = read_be16(bytes + 8);
  const uint16_t library_count = read_be16(bytes + 10);
  if (version != 3 || row_count == 0 || row_count > CATALOG_MAX_ROWS ||
      library_count > CATALOG_MAX_LIBRARIES || server_length == 0 ||
      CATALOG_HEADER_SIZE + server_length > size ||
      multiplex_native_app_pairing_status(2, bytes, 0, bytes, 0) == 0 ||
      multiplex_native_app_catalog_begin(bytes + CATALOG_HEADER_SIZE,
                                         server_length, row_count,
                                         library_count) == 0) {
    return 0;
  }

  size_t cursor = CATALOG_HEADER_SIZE + server_length;
  for (uint32_t row_index = 0; row_index < row_count; ++row_index) {
    if (cursor + 4u > size) {
      return 0;
    }
    const uint16_t title_length = read_be16(bytes + cursor);
    const uint16_t item_count = read_be16(bytes + cursor + 2);
    cursor += 4u;
    if (title_length == 0 || item_count == 0 ||
        item_count > CATALOG_MAX_ITEMS_PER_ROW ||
        cursor + title_length > size ||
        multiplex_native_app_catalog_row(row_index, bytes + cursor,
                                         title_length, item_count) == 0) {
      return 0;
    }
    cursor += title_length;
    for (uint32_t item_index = 0; item_index < item_count; ++item_index) {
      if (!bind_catalog_item(bytes, size, &cursor, row_index, item_index)) {
        return 0;
      }
    }
  }

  for (uint32_t index = 0; index < library_count; ++index) {
    if (cursor + 6u > size) {
      return 0;
    }
    const uint16_t section_id = read_be16(bytes + cursor);
    const uint8_t media_type = bytes[cursor + 2];
    const uint16_t title_length = read_be16(bytes + cursor + 4);
    cursor += 6u;
    if (section_id == 0 || title_length == 0 ||
        cursor + title_length > size ||
        multiplex_native_app_catalog_library(index, section_id, media_type,
                                             bytes + cursor,
                                             title_length) == 0) {
      return 0;
    }
    cursor += title_length;
  }
  return cursor == size && multiplex_native_app_catalog_commit() != 0;
}

static int bind_details(const uint8_t *bytes, size_t size) {
  if (size < DETAILS_HEADER_SIZE || memcmp(bytes, "MPXD", 4) != 0 ||
      read_be16(bytes + 4) != 1 || read_be32(bytes + 8) == 0) {
    return 0;
  }
  const uint16_t flags = read_be16(bytes + 6);
  uint16_t lengths[8];
  size_t total_length = 0;
  for (unsigned index = 0; index < 8; ++index) {
    lengths[index] = read_be16(bytes + 24 + index * 2u);
    total_length += lengths[index];
  }
  if (lengths[0] == 0 || DETAILS_HEADER_SIZE + total_length != size) {
    return 0;
  }
  const uint8_t *values[8];
  size_t cursor = DETAILS_HEADER_SIZE;
  for (unsigned index = 0; index < 8; ++index) {
    values[index] = bytes + cursor;
    cursor += lengths[index];
  }
  static const uint8_t empty[] = "";
  return multiplex_native_app_details_commit(
             values[0], lengths[0], values[1], lengths[1], empty, 0,
             values[2], lengths[2], values[3], lengths[3], values[4],
             lengths[4], empty, 0, values[5], lengths[5], values[6],
             lengths[6], values[7], lengths[7], flags & 1u) != 0;
}

static int service_details_request(const uint8_t *details,
                                   size_t details_size) {
  const uint32_t rating_key = multiplex_native_app_details_request();
  if (rating_key == 0) {
    return 1;
  }
  return details != NULL && details_size >= DETAILS_HEADER_SIZE &&
         read_be32(details + 8) == rating_key &&
         bind_details(details, details_size);
}

static int write_scene(const char *path, const char *actions,
                       const char *catalog_path, const char *details_path,
                       const char *playback_rating_text) {
  MultiplexNativeDrawCommand commands[MULTIPLEX_SCENE_MAX_COMMANDS];
  uint8_t *catalog = NULL;
  size_t catalog_size = 0;
  uint8_t *details = NULL;
  size_t details_size = 0;
  multiplex_native_app_init();
  if (catalog_path != NULL) {
    catalog = read_catalog(catalog_path, &catalog_size);
    if (catalog == NULL || !bind_catalog(catalog, catalog_size)) {
      fprintf(stderr, "Could not parse and bind the gateway catalog.\n");
      free(catalog);
      return 0;
    }
  }
  if (details_path != NULL) {
    details = read_catalog(details_path, &details_size);
    if (details == NULL) {
      fprintf(stderr, "Could not read the gateway details.\n");
      free(catalog);
      return 0;
    }
  }
  if (!apply_actions(actions, details, details_size)) {
    fprintf(stderr, "Could not apply the requested UI action sequence.\n");
    free(catalog);
    free(details);
    return 0;
  }
  if (details != NULL && !service_details_request(details, details_size)) {
    fprintf(stderr, "Could not bind the requested gateway details.\n");
    free(catalog);
    free(details);
    return 0;
  }
  uint32_t playback_rating = 0;
  if (playback_rating_text != NULL) {
    char *end = NULL;
    const unsigned long parsed = strtoul(playback_rating_text, &end, 10);
    if (end == playback_rating_text || *end != '\0' || parsed == 0 ||
        parsed > UINT32_MAX ||
        multiplex_native_app_playback_request() != (uint32_t)parsed ||
        multiplex_native_app_playback_commit() == 0) {
      fprintf(stderr, "Could not commit the prepared playback request.\n");
      free(catalog);
      free(details);
      return 0;
    }
    playback_rating = (uint32_t)parsed;
  }
  const uint32_t command_count = multiplex_native_app_render(
      commands, MULTIPLEX_SCENE_MAX_COMMANDS);
  if (command_count == 0 || command_count > MULTIPLEX_SCENE_MAX_COMMANDS) {
    fprintf(stderr, "Native UI returned an invalid scene command count.\n");
    free(catalog);
    return 0;
  }

  size_t text_size = 0;
  for (uint32_t index = 0; index < command_count; ++index) {
    const MultiplexNativeDrawCommand *command = &commands[index];
    if (command->kind == MULTIPLEX_NATIVE_DRAW_TEXT) {
      if (command->text_ptr == NULL ||
          command->text_len > MULTIPLEX_SCENE_MAX_TEXT_BYTES - text_size) {
        fprintf(stderr, "Native UI scene text exceeds the protocol limit.\n");
        free(catalog);
        return 0;
      }
      text_size += command->text_len;
    }
  }

  const size_t commands_size =
      (size_t)command_count * MULTIPLEX_SCENE_COMMAND_SIZE;
  const size_t total_size =
      MULTIPLEX_SCENE_HEADER_SIZE + commands_size + text_size;
  if (total_size > MULTIPLEX_SCENE_MAX_BYTES) {
    fprintf(stderr, "Native UI scene exceeds the protocol byte limit.\n");
    free(catalog);
    return 0;
  }

  uint8_t *scene = calloc(1, total_size);
  if (scene == NULL) {
    fprintf(stderr, "Could not allocate the scene buffer.\n");
    free(catalog);
    return 0;
  }

  multiplex_scene_write_u32(scene, MULTIPLEX_SCENE_MAGIC);
  multiplex_scene_write_u16(scene + 4, MULTIPLEX_SCENE_VERSION);
  multiplex_scene_write_u16(scene + 6, MULTIPLEX_SCENE_HEADER_SIZE);
  multiplex_scene_write_u32(scene + 8, (uint32_t)total_size);
  uint32_t request_kind = MULTIPLEX_SCENE_REQUEST_NONE;
  uint32_t request_rating_key = multiplex_native_app_details_request();
  if (playback_rating != 0) {
    request_kind = MULTIPLEX_SCENE_REQUEST_PLAYBACK;
    request_rating_key = playback_rating;
  } else if (request_rating_key != 0) {
    request_kind = MULTIPLEX_SCENE_REQUEST_DETAILS;
  } else {
    request_rating_key = multiplex_native_app_playback_request();
    if (request_rating_key != 0) {
      request_kind = MULTIPLEX_SCENE_REQUEST_PLAYBACK;
    }
  }
  multiplex_scene_write_u32(scene + MULTIPLEX_SCENE_REQUEST_KIND,
                            request_kind);
  multiplex_scene_write_u32(scene + 16, multiplex_native_app_screen());
  multiplex_scene_write_u32(scene + 20, command_count);
  multiplex_scene_write_u32(
      scene + 24, (uint32_t)(MULTIPLEX_SCENE_HEADER_SIZE + commands_size));
  multiplex_scene_write_u32(scene + 28, (uint32_t)text_size);

  MultiplexVideoSurface video = {0};
  multiplex_native_video_surface(&video);
  multiplex_scene_write_u32(scene + 36, video.visible);
  multiplex_scene_write_u32(scene + 40, video.playing);
  multiplex_scene_write_f32(scene + 44, video.x);
  multiplex_scene_write_f32(scene + 48, video.y);
  multiplex_scene_write_f32(scene + 52, video.width);
  multiplex_scene_write_f32(scene + 56, video.height);
  multiplex_scene_write_u32(scene + MULTIPLEX_SCENE_REQUEST_RATING_KEY,
                            request_rating_key);

  uint32_t text_offset = 0;
  for (uint32_t index = 0; index < command_count; ++index) {
    const MultiplexNativeDrawCommand *command = &commands[index];
    uint8_t *output = scene + MULTIPLEX_SCENE_HEADER_SIZE +
                      (size_t)index * MULTIPLEX_SCENE_COMMAND_SIZE;
    multiplex_scene_write_u16(output + MULTIPLEX_SCENE_COMMAND_KIND,
                              (uint16_t)command->kind);
    multiplex_scene_write_u16(
        output + MULTIPLEX_SCENE_COMMAND_FLAGS,
        command->has_clip != 0 ? MULTIPLEX_SCENE_FLAG_CLIPPED : 0);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_X, command->x);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_Y, command->y);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_WIDTH,
                              command->width);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_HEIGHT,
                              command->height);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_X2,
                              command->x2);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_Y2,
                              command->y2);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_RADIUS,
                              command->radius);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_STROKE_WIDTH,
                              command->stroke_width);
    multiplex_scene_write_u32(output + MULTIPLEX_SCENE_COMMAND_COLOR,
                              command->color_rgba);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_CLIP_X,
                              command->clip_x);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_CLIP_Y,
                              command->clip_y);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_CLIP_WIDTH,
                              command->clip_width);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_CLIP_HEIGHT,
                              command->clip_height);
    multiplex_scene_write_u32(output + MULTIPLEX_SCENE_COMMAND_TEXT_OFFSET,
                              text_offset);
    multiplex_scene_write_u32(output + MULTIPLEX_SCENE_COMMAND_TEXT_LENGTH,
                              command->kind == MULTIPLEX_NATIVE_DRAW_TEXT
                                  ? command->text_len
                                  : 0);
    multiplex_scene_write_u32(output + MULTIPLEX_SCENE_COMMAND_GLYPH_ID,
                              command->glyph_id);
    multiplex_scene_write_f32(output + MULTIPLEX_SCENE_COMMAND_FONT_SIZE,
                              command->font_size);

    if (command->kind == MULTIPLEX_NATIVE_DRAW_TEXT && command->text_len > 0) {
      memcpy(scene + MULTIPLEX_SCENE_HEADER_SIZE + commands_size + text_offset,
             command->text_ptr, command->text_len);
      text_offset += command->text_len;
    }
  }

  const uint32_t crc = multiplex_scene_crc32(
      scene + MULTIPLEX_SCENE_HEADER_SIZE,
      total_size - MULTIPLEX_SCENE_HEADER_SIZE);
  multiplex_scene_write_u32(scene + 32, crc);

  FILE *file = fopen(path, "wb");
  int wrote = 0;
  if (file != NULL) {
    const size_t written = fwrite(scene, 1, total_size, file);
    const int close_status = fclose(file);
    wrote = written == total_size && close_status == 0;
  }
  free(scene);
  free(catalog);
  free(details);
  if (!wrote) {
    fprintf(stderr, "Could not write the console scene.\n");
    return 0;
  }
  printf("Exported %u commands and %u text bytes to %s.\n", command_count,
         text_offset, path);
  return 1;
}

int main(int argc, char **argv) {
  if (argc < 2 || argc > 6) {
    fprintf(stderr,
            "usage: %s output.scene [action,action,...] [catalog.bin] "
            "[details.bin] [playback-rating-key]\n",
            argv[0]);
    return 2;
  }
  return write_scene(argv[1], argc >= 3 ? argv[2] : NULL,
                     argc >= 4 ? argv[3] : NULL,
                     argc >= 5 ? argv[4] : NULL,
                     argc == 6 ? argv[5] : NULL)
             ? 0
             : 1;
}
