#include "console_scene.h"
#include "geist_atlas.h"
#include "media_player.h"
#include "scene_client_config.h"

#include <arpa/inet.h>
#include <debug.h>
#include <dmaKit.h>
#include <gsKit.h>
#include <iopcontrol.h>
#include <iopheap.h>
#include <kernel.h>
#include <libpad.h>
#include <loadfile.h>
#include <netinet/in.h>
#include <netman.h>
#include <ps2ip.h>
#include <sbv_patches.h>
#include <sifrpc.h>
#include <sys/socket.h>

#include <malloc.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern unsigned char DEV9_irx[];
extern unsigned int size_DEV9_irx;
extern unsigned char NETMAN_irx[];
extern unsigned int size_NETMAN_irx;
extern unsigned char SMAP_irx[];
extern unsigned int size_SMAP_irx;
extern unsigned char AUDSRV_irx[];
extern unsigned int size_AUDSRV_irx;

enum {
  NETWORK_WAIT_ATTEMPTS = 20,
  HTTP_HEADER_CAPACITY = 4096,
  HTTP_RESPONSE_CAPACITY = MULTIPLEX_SCENE_MAX_BYTES + HTTP_HEADER_CAPACITY,
  LOGICAL_WIDTH = 640,
  LOGICAL_HEIGHT = 480,
  MEDIA_RESPONSE_CAPACITY = 4 * 1024 * 1024,
};

static int load_module(const unsigned char *bytes, unsigned int size) {
  int module_result = 0;
  const int module_id =
      SifExecModuleBuffer((void *)bytes, size, 0, NULL, &module_result);
  return module_id >= 0 && module_result >= 0;
}

static int link_is_ready(void) {
  return NetManIoctl(NETMAN_NETIF_IOCTL_GET_LINK_STATUS, NULL, 0, NULL, 0) ==
         NETMAN_NETIF_ETH_LINK_STATE_UP;
}

static int dhcp_is_ready(void) {
  t_ip_info info;
  return ps2ip_getconfig("sm0", &info) >= 0 && info.dhcp_enabled &&
         info.dhcp_status == DHCP_STATE_BOUND;
}

static int wait_until(int (*ready)(void)) {
  for (int attempt = 0; attempt < NETWORK_WAIT_ATTEMPTS; ++attempt) {
    if (ready()) {
      return 1;
    }
    sleep(1);
  }
  return 0;
}

static int start_network(void) {
  struct ip4_addr address;
  struct ip4_addr netmask;
  struct ip4_addr gateway;

  sceSifInitRpc(0);
  while (!SifIopReset("", 0)) {
  }
  while (!SifIopSync()) {
  }
  sceSifInitRpc(0);
  SifLoadFileInit();
  SifInitIopHeap();
  sbv_patch_enable_lmb();

  if (!load_module(DEV9_irx, size_DEV9_irx) ||
      !load_module(NETMAN_irx, size_NETMAN_irx) ||
      !load_module(SMAP_irx, size_SMAP_irx) || NetManInit() < 0) {
    return 0;
  }

  ip4_addr_set_zero(&address);
  ip4_addr_set_zero(&netmask);
  ip4_addr_set_zero(&gateway);
  if (ps2ipInit(&address, &netmask, &gateway) < 0) {
    return 0;
  }

  t_ip_info info;
  if (ps2ip_getconfig("sm0", &info) < 0) {
    return 0;
  }
  info.dhcp_enabled = 1;
  return ps2ip_setconfig(&info) >= 0 && wait_until(link_is_ready) &&
         wait_until(dhcp_is_ready);
}

static const uint8_t *find_http_body(const uint8_t *response, size_t size) {
  if (size < 4) {
    return NULL;
  }
  for (size_t index = 0; index + 4 <= size; ++index) {
    if (response[index] == '\r' && response[index + 1] == '\n' &&
        response[index + 2] == '\r' && response[index + 3] == '\n') {
      return response + index + 4;
    }
  }
  return NULL;
}

static int complete_http_response(const uint8_t *response, size_t size,
                                  const uint8_t **body,
                                  size_t *content_length) {
  const uint8_t *candidate = find_http_body(response, size);
  if (candidate == NULL) {
    return 0;
  }
  static const char content_length_name[] = "\r\nContent-Length: ";
  const char *length_header = strstr((const char *)response, content_length_name);
  if (length_header == NULL || (const uint8_t *)length_header >= candidate) {
    return 0;
  }
  char *end = NULL;
  const unsigned long length = strtoul(
      length_header + sizeof(content_length_name) - 1u, &end, 10);
  if (end == length_header + sizeof(content_length_name) - 1u ||
      length > MEDIA_RESPONSE_CAPACITY) {
    return 0;
  }
  const size_t header_size = (size_t)(candidate - response);
  if (header_size + (size_t)length > size) {
    return 0;
  }
  *body = candidate;
  *content_length = (size_t)length;
  return 1;
}

static int fetch_scene(uint8_t *response, size_t response_capacity,
                       const char *path, const uint8_t **scene,
                       size_t *scene_size) {
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    return 0;
  }

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_port = htons(MULTIPLEX_SCENE_PORT);
  address.sin_addr.s_addr = inet_addr(MULTIPLEX_SCENE_HOST);
  if (connect(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
    close(fd);
    return 0;
  }

  char request[512];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s:%d\r\n"
      "User-Agent: Multiplex-PS2-Scene-Client/1\r\nConnection: close\r\n\r\n",
      path, MULTIPLEX_SCENE_HOST, MULTIPLEX_SCENE_PORT);
  if (request_size <= 0 || request_size >= (int)sizeof(request) ||
      send(fd, request, request_size, 0) != request_size) {
    close(fd);
    return 0;
  }

  size_t response_size = 0;
  const uint8_t *body = NULL;
  size_t content_length = 0;
  for (;;) {
    const int received =
        recv(fd, response + response_size,
             response_capacity - response_size - 1u,
             0);
    if (received < 0) {
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) {
        continue;
      }
      close(fd);
      return 0;
    }
    if (received == 0) {
      break;
    }
    response_size += (size_t)received;
    response[response_size] = 0;
    if (complete_http_response(response, response_size, &body,
                               &content_length)) {
      break;
    }
    if (response_size + 1u == response_capacity) {
      close(fd);
      return 0;
    }
  }
  close(fd);

  if (response_size < 12 || memcmp(response, "HTTP/1.1 200", 12) != 0) {
    return 0;
  }
  if (body == NULL &&
      !complete_http_response(response, response_size, &body,
                              &content_length)) {
    return 0;
  }
  *scene = body;
  *scene_size = content_length;
  return 1;
}

static unsigned scene_validation_error;
static uint32_t scene_expected_crc;
static uint32_t scene_actual_crc;

static int validate_scene(const uint8_t *scene, size_t size) {
  if (size < MULTIPLEX_SCENE_HEADER_SIZE ||
      multiplex_scene_read_u32(scene) != MULTIPLEX_SCENE_MAGIC ||
      multiplex_scene_read_u16(scene + 4) != MULTIPLEX_SCENE_VERSION ||
      multiplex_scene_read_u16(scene + 6) != MULTIPLEX_SCENE_HEADER_SIZE ||
      multiplex_scene_read_u32(scene + 8) != size) {
    scene_validation_error = 1;
    return 0;
  }
  const uint32_t command_count = multiplex_scene_read_u32(scene + 20);
  const uint32_t text_offset = multiplex_scene_read_u32(scene + 24);
  const uint32_t text_size = multiplex_scene_read_u32(scene + 28);
  if (command_count == 0 || command_count > MULTIPLEX_SCENE_MAX_COMMANDS ||
      text_size > MULTIPLEX_SCENE_MAX_TEXT_BYTES ||
      text_offset != MULTIPLEX_SCENE_HEADER_SIZE +
                         command_count * MULTIPLEX_SCENE_COMMAND_SIZE ||
      text_offset > size || text_size != size - text_offset) {
    scene_validation_error = 2;
    return 0;
  }
  const uint32_t expected_crc = multiplex_scene_read_u32(scene + 32);
  const uint32_t actual_crc = multiplex_scene_crc32(
      scene + MULTIPLEX_SCENE_HEADER_SIZE,
      size - MULTIPLEX_SCENE_HEADER_SIZE);
  if (actual_crc != expected_crc) {
    scene_validation_error = 3;
    scene_expected_crc = expected_crc;
    scene_actual_crc = actual_crc;
    return 0;
  }

  for (uint32_t index = 0; index < command_count; ++index) {
    const uint8_t *command = scene + MULTIPLEX_SCENE_HEADER_SIZE +
                             index * MULTIPLEX_SCENE_COMMAND_SIZE;
    const uint32_t kind = multiplex_scene_read_u16(
        command + MULTIPLEX_SCENE_COMMAND_KIND);
    const uint32_t command_text_offset = multiplex_scene_read_u32(
        command + MULTIPLEX_SCENE_COMMAND_TEXT_OFFSET);
    const uint32_t command_text_length = multiplex_scene_read_u32(
        command + MULTIPLEX_SCENE_COMMAND_TEXT_LENGTH);
    if (kind < 1 || kind > 9 || command_text_offset > text_size ||
        command_text_length > text_size - command_text_offset) {
      scene_validation_error = 4;
      return 0;
    }
  }
  return 1;
}

static u64 scene_color(uint32_t rgba) {
  const uint8_t red = (uint8_t)(rgba >> 24u);
  const uint8_t green = (uint8_t)(rgba >> 16u);
  const uint8_t blue = (uint8_t)(rgba >> 8u);
  const uint8_t alpha = (uint8_t)(((uint8_t)rgba + 1u) >> 1u);
  return GS_SETREG_RGBAQ(red, green, blue, alpha, 0);
}

static float scaled_x(const GSGLOBAL *global, float x) {
  return x * (float)global->Width / (float)LOGICAL_WIDTH;
}

static float scaled_y(const GSGLOBAL *global, float y) {
  return y * (float)global->Height / (float)LOGICAL_HEIGHT;
}

static void set_command_scissor(GSGLOBAL *global, const uint8_t *command) {
  const uint16_t flags = multiplex_scene_read_u16(
      command + MULTIPLEX_SCENE_COMMAND_FLAGS);
  if ((flags & MULTIPLEX_SCENE_FLAG_CLIPPED) == 0) {
    gsKit_set_scissor(global, GS_SCISSOR_RESET);
    return;
  }
  const float x = multiplex_scene_read_f32(
      command + MULTIPLEX_SCENE_COMMAND_CLIP_X);
  const float y = multiplex_scene_read_f32(
      command + MULTIPLEX_SCENE_COMMAND_CLIP_Y);
  const float width = multiplex_scene_read_f32(
      command + MULTIPLEX_SCENE_COMMAND_CLIP_WIDTH);
  const float height = multiplex_scene_read_f32(
      command + MULTIPLEX_SCENE_COMMAND_CLIP_HEIGHT);
  const unsigned left = (unsigned)scaled_x(global, x < 0.0f ? 0.0f : x);
  const unsigned top = (unsigned)scaled_y(global, y < 0.0f ? 0.0f : y);
  unsigned right = (unsigned)scaled_x(global, x + width);
  unsigned bottom = (unsigned)scaled_y(global, y + height);
  if (right >= (unsigned)global->Width) {
    right = (unsigned)global->Width - 1u;
  }
  if (bottom >= (unsigned)global->Height) {
    bottom = (unsigned)global->Height - 1u;
  }
  if (right < left || bottom < top) {
    gsKit_set_scissor(global, GS_SETREG_SCISSOR(0, 0, 0, 0));
    return;
  }
  gsKit_set_scissor(global, GS_SETREG_SCISSOR(left, right, top, bottom));
}

static unsigned geist_size_index(float size) {
  unsigned closest = 0;
  float closest_distance = __builtin_fabsf(size - (float)geist_sizes[0]);
  for (unsigned index = 1; index < GEIST_SIZE_COUNT; ++index) {
    const float distance = __builtin_fabsf(size - (float)geist_sizes[index]);
    if (distance < closest_distance) {
      closest = index;
      closest_distance = distance;
    }
  }
  return closest;
}

static void draw_character(GSGLOBAL *global, GSTEXTURE *font,
                           unsigned size_index, uint8_t character,
                           float font_size, float *cursor_x, float baseline,
                           int z, u64 color) {
  if (character < GEIST_FIRST_CHARACTER ||
      character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
    character = '?';
  }
  const GeistGlyphMetric *metric =
      &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
  const float scale = font_size / (float)geist_sizes[size_index];
  if (metric->width > 0 && metric->height > 0) {
    const float left = *cursor_x + (float)metric->bearing_x * scale;
    const float top = baseline + (float)metric->bearing_y * scale;
    const float right = left + (float)metric->width * scale;
    const float bottom = top + (float)metric->height * scale;
    gsKit_prim_sprite_texture(global, font, left, top, (float)metric->u,
                              (float)metric->v, right, bottom,
                              (float)(metric->u + metric->width),
                              (float)(metric->v + metric->height), z, color);
  }
  *cursor_x += ((float)metric->advance_64 / 64.0f) * scale;
}

static void draw_text(GSGLOBAL *global, GSTEXTURE *font,
                      const uint8_t *bytes, uint32_t length, float x, float y,
                      float font_size, int z, u64 color) {
  const unsigned size_index = geist_size_index(font_size);
  float cursor_x = x;
  float baseline = y;
  for (uint32_t index = 0; index < length; ++index) {
    if (bytes[index] == '\n') {
      cursor_x = x;
      baseline += font_size * 1.25f;
      continue;
    }
    draw_character(global, font, size_index, bytes[index], font_size,
                   &cursor_x, baseline, z, color);
  }
}

static void draw_scene(GSGLOBAL *global, GSTEXTURE *font,
                       const uint8_t *scene) {
  const uint32_t command_count = multiplex_scene_read_u32(scene + 20);
  const uint32_t text_offset = multiplex_scene_read_u32(scene + 24);
  const uint8_t *text = scene + text_offset;
  gsKit_clear(global, GS_SETREG_RGBAQ(0, 0, 0, 0x80, 0));

  for (uint32_t index = 0; index < command_count; ++index) {
    const uint8_t *command = scene + MULTIPLEX_SCENE_HEADER_SIZE +
                             index * MULTIPLEX_SCENE_COMMAND_SIZE;
    const uint32_t kind = multiplex_scene_read_u16(
        command + MULTIPLEX_SCENE_COMMAND_KIND);
    const float x = scaled_x(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_X));
    const float y = scaled_y(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_Y));
    const float width = scaled_x(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_WIDTH));
    const float height = scaled_y(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_HEIGHT));
    const float x2 = scaled_x(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_X2));
    const float y2 = scaled_y(
        global,
        multiplex_scene_read_f32(command + MULTIPLEX_SCENE_COMMAND_Y2));
    const float stroke = multiplex_scene_read_f32(
        command + MULTIPLEX_SCENE_COMMAND_STROKE_WIDTH);
    const uint32_t rgba = multiplex_scene_read_u32(
        command + MULTIPLEX_SCENE_COMMAND_COLOR);
    const u64 color = scene_color(rgba);
    const int z = (int)index + 1;
    set_command_scissor(global, command);

    if (kind == 1 || kind == 2 || kind == 6) {
      gsKit_prim_sprite(global, x, y, x + width, y + height, z, color);
    } else if (kind == 3) {
      const float line_width = stroke > 0.0f ? stroke : 1.0f;
      gsKit_prim_sprite(global, x, y, x + width, y + line_width, z, color);
      gsKit_prim_sprite(global, x, y + height - line_width, x + width,
                        y + height, z, color);
      gsKit_prim_sprite(global, x, y, x + line_width, y + height, z, color);
      gsKit_prim_sprite(global, x + width - line_width, y, x + width,
                        y + height, z, color);
    } else if (kind == 4 || kind == 8) {
      gsKit_prim_line(global, x, y, x2, y2, z, color);
    } else if (kind == 9) {
      gsKit_prim_triangle(global, x, y, x2, y2, width, height, z, color);
    } else if (kind == 5) {
      const uint32_t command_text_offset = multiplex_scene_read_u32(
          command + MULTIPLEX_SCENE_COMMAND_TEXT_OFFSET);
      uint32_t command_text_length = multiplex_scene_read_u32(
          command + MULTIPLEX_SCENE_COMMAND_TEXT_LENGTH);
      const float font_size = multiplex_scene_read_f32(
          command + MULTIPLEX_SCENE_COMMAND_FONT_SIZE);
      draw_text(global, font, text + command_text_offset, command_text_length,
                x, y, font_size, z, color);
    } else if (kind == 7) {
      const uint32_t glyph_id = multiplex_scene_read_u32(
          command + MULTIPLEX_SCENE_COMMAND_GLYPH_ID);
      uint8_t character = '?';
      for (unsigned glyph = 0; glyph < GEIST_CHARACTER_COUNT; ++glyph) {
        if (geist_glyph_ids[glyph] == glyph_id) {
          character = (uint8_t)(GEIST_FIRST_CHARACTER + glyph);
          break;
        }
      }
      const float font_size = multiplex_scene_read_f32(
          command + MULTIPLEX_SCENE_COMMAND_FONT_SIZE);
      draw_text(global, font, &character, 1, x, y, font_size, z, color);
    }
  }
  gsKit_set_scissor(global, GS_SCISSOR_RESET);
}

static void fatal_screen(const char *message) {
  init_scr();
  scr_printf("Multiplex PS2 scene client\n\n%s\n", message);
  for (;;) {
    sleep(1);
  }
}

static char pad_buffer[256] __attribute__((aligned(64)));

static int start_pad(void) {
  if (SifLoadModule("rom0:SIO2MAN", 0, NULL) < 0 ||
      SifLoadModule("rom0:PADMAN", 0, NULL) < 0 || padInit(0) == 0 ||
      padPortOpen(0, 0, pad_buffer) == 0) {
    return 0;
  }
  return 1;
}

static int pad_action(uint32_t pressed) {
  if ((pressed & PAD_LEFT) != 0) return 0;
  if ((pressed & PAD_RIGHT) != 0) return 1;
  if ((pressed & PAD_CROSS) != 0) return 2;
  if ((pressed & PAD_CIRCLE) != 0) return 3;
  if ((pressed & PAD_UP) != 0) return 8;
  if ((pressed & PAD_DOWN) != 0) return 9;
  return -1;
}

static void play_requested_media(uint8_t *response, const uint8_t *scene) {
  if (multiplex_scene_read_u32(scene + MULTIPLEX_SCENE_REQUEST_KIND) !=
      MULTIPLEX_SCENE_REQUEST_PLAYBACK) {
    return;
  }
  const uint32_t rating_key = multiplex_scene_read_u32(
      scene + MULTIPLEX_SCENE_REQUEST_RATING_KEY);
  if (rating_key == 0) {
    fatal_screen("MPS2-MEDIA-RATING-FAILED");
  }
  uint8_t *video_response = memalign(64, MEDIA_RESPONSE_CAPACITY);
  uint8_t *audio_response = memalign(64, MEDIA_RESPONSE_CAPACITY);
  if (video_response == NULL || audio_response == NULL) {
    fatal_screen("MPS2-MEDIA-MEMORY-FAILED");
  }
  char path[64];
  const uint8_t *video = NULL;
  size_t video_size = 0;
  snprintf(path, sizeof(path), "/video/%u.m2v", (unsigned)rating_key);
  if (!fetch_scene(video_response, MEDIA_RESPONSE_CAPACITY, path, &video,
                   &video_size)) {
    fatal_screen("MPS2-MEDIA-VIDEO-DOWNLOAD-FAILED");
  }
  if (video_size > MEDIA_RESPONSE_CAPACITY - 2048u) {
    fatal_screen("MPS2-MEDIA-VIDEO-SIZE-FAILED");
  }
  memmove(video_response, video, video_size);
  memset(video_response + video_size, 0, 2048u);
  video = video_response;
  const uint8_t *audio = NULL;
  size_t audio_size = 0;
  snprintf(path, sizeof(path), "/audio/%u.pcm", (unsigned)rating_key);
  if (!fetch_scene(audio_response, MEDIA_RESPONSE_CAPACITY, path, &audio,
                   &audio_size)) {
    fatal_screen("MPS2-MEDIA-AUDIO-DOWNLOAD-FAILED");
  }
  if (SifLoadModule("rom0:LIBSD", 0, NULL) < 0 ||
      !load_module(AUDSRV_irx, size_AUDSRV_irx)) {
    fatal_screen("MPS2-MEDIA-AUDIO-MODULE-FAILED");
  }
  if (!multiplex_ps2_play_media(video, video_size, audio, audio_size)) {
    fatal_screen("MPS2-MEDIA-PLAYBACK-FAILED");
  }
  const uint8_t *played_body = NULL;
  size_t played_size = 0;
  snprintf(path, sizeof(path), "/played/%u", (unsigned)rating_key);
  if (!fetch_scene(response, HTTP_RESPONSE_CAPACITY, path, &played_body,
                   &played_size) || played_size == 0) {
    fatal_screen("MPS2-MEDIA-PROOF-FAILED");
  }
  printf("MPS2-MEDIA-VERIFIED rating_key=%u video=%u audio=%u\n",
         (unsigned)rating_key, (unsigned)video_size, (unsigned)audio_size);
}

int main(void) {
  if (!start_network()) {
    fatal_screen("MPS2-SCENE-NETWORK-FAILED");
  }

  uint8_t *response = memalign(64, HTTP_RESPONSE_CAPACITY);
  const uint8_t *scene = NULL;
  size_t scene_size = 0;
  if (response == NULL ||
      !fetch_scene(response, HTTP_RESPONSE_CAPACITY, "/scene", &scene,
                   &scene_size)) {
    fatal_screen("MPS2-SCENE-DOWNLOAD-FAILED");
  }
  uint8_t verification_response[512];
  const uint8_t *verification_body = NULL;
  size_t verification_size = 0;
  if (!validate_scene(scene, scene_size)) {
    char failure_path[80];
    snprintf(failure_path, sizeof(failure_path), "/failed/%u/%08x/%08x/%u",
             scene_validation_error, (unsigned)scene_expected_crc,
             (unsigned)scene_actual_crc,
             (unsigned)scene_size);
    fetch_scene(verification_response, sizeof(verification_response),
                failure_path, &verification_body, &verification_size);
    fatal_screen("MPS2-SCENE-INVALID");
  }
  if (!fetch_scene(verification_response, sizeof(verification_response),
                   "/verified", &verification_body, &verification_size) ||
      verification_size == 0) {
    fatal_screen("MPS2-SCENE-VERIFICATION-FAILED");
  }

  GSGLOBAL *global = gsKit_init_global();
  if (global == NULL) {
    fatal_screen("MPS2-SCENE-RENDERER-FAILED");
  }
  global->PSM = GS_PSM_CT24;
  global->DoubleBuffering = GS_SETTING_OFF;
  global->ZBuffering = GS_SETTING_OFF;
  global->PrimAlphaEnable = GS_SETTING_ON;

  dmaKit_init(D_CTRL_RELE_OFF, D_CTRL_MFD_OFF, D_CTRL_STS_UNSPEC,
              D_CTRL_STD_OFF, D_CTRL_RCYC_8, 1 << DMA_CHANNEL_GIF);
  dmaKit_chan_init(DMA_CHANNEL_GIF);
  gsKit_init_screen(global);
  gsKit_TexManager_init(global);
  static u32 font_clut[256] __attribute__((aligned(128)));
  for (unsigned index = 0; index < 256; ++index) {
    const uint32_t alpha = index > 0x80u ? 0x80u : index;
    font_clut[index] = alpha << 24u | UINT32_C(0x00808080);
  }
  GSTEXTURE font = {0};
  font.Width = GEIST_ATLAS_WIDTH;
  font.Height = GEIST_ATLAS_HEIGHT;
  font.PSM = GS_PSM_T8;
  font.ClutPSM = GS_PSM_CT32;
  font.Mem = (u32 *)geist_atlas;
  font.Clut = font_clut;
  font.Filter = GS_FILTER_LINEAR;
  font.Delayed = 1;
  gsKit_mode_switch(global, GS_ONESHOT);
  gsKit_set_primalpha(global, GS_SETREG_ALPHA(0, 1, 0, 1, 0), 0);
  if (!start_pad()) {
    fatal_screen("MPS2-SCENE-PAD-FAILED");
  }

  printf("MPS2-SCENE-VERIFIED bytes=%u commands=%u\n", (unsigned)scene_size,
         (unsigned)multiplex_scene_read_u32(scene + 20));
  uint32_t previous_buttons = 0;
  for (;;) {
    struct padButtonStatus buttons;
    if (padGetState(0, 0) == PAD_STATE_STABLE &&
        padRead(0, 0, &buttons) != 0) {
      const uint32_t current_buttons = UINT32_C(0xffff) ^ buttons.btns;
      const int action = pad_action(current_buttons & ~previous_buttons);
      previous_buttons = current_buttons;
      if (action >= 0) {
        char path[32];
        snprintf(path, sizeof(path), "/action/%d", action);
        if (!fetch_scene(response, HTTP_RESPONSE_CAPACITY, path, &scene,
                         &scene_size) ||
            !validate_scene(scene, scene_size)) {
          fatal_screen("MPS2-SCENE-ACTION-FAILED");
        }
        printf("MPS2-SCENE-ACTION action=%d screen=%u\n", action,
               (unsigned)multiplex_scene_read_u32(scene + 16));
        play_requested_media(response, scene);
      }
    }
    gsKit_TexManager_bind(global, &font);
    draw_scene(global, &font, scene);
    gsKit_queue_exec(global);
    gsKit_sync_flip(global);
    gsKit_TexManager_nextFrame(global);
  }
}
