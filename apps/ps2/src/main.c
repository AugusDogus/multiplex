#include <dmaKit.h>
#include <gsKit.h>

#include <malloc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  FRAME_WIDTH = 640,
  FRAME_HEIGHT = 480,
  FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 4,
};

extern unsigned char native_reference[];
extern unsigned int size_native_reference;

static int load_reference_texture(GSGLOBAL *global, GSTEXTURE *texture) {
  if (size_native_reference != FRAME_BYTES) {
    printf("MULTIPLEX PS2: unexpected frame bytes=%u\n", size_native_reference);
    return 0;
  }

  void *memory = memalign(128, FRAME_BYTES);
  if (memory == NULL) {
    printf("MULTIPLEX PS2: texture memory allocation failed\n");
    return 0;
  }
  memcpy(memory, native_reference, FRAME_BYTES);

  *texture = (GSTEXTURE){0};
  texture->Width = FRAME_WIDTH;
  texture->Height = FRAME_HEIGHT;
  texture->PSM = GS_PSM_CT32;
  texture->Mem = memory;
  texture->Vram = gsKit_vram_alloc(
      global, gsKit_texture_size(FRAME_WIDTH, FRAME_HEIGHT, GS_PSM_CT32),
      GSKIT_ALLOC_USERBUFFER);
  texture->Filter = GS_FILTER_LINEAR;
  if (texture->Vram == GSKIT_ALLOC_ERROR) {
    printf("MULTIPLEX PS2: texture VRAM allocation failed\n");
    free(memory);
    return 0;
  }

  gsKit_texture_upload(global, texture);
  return 1;
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  GSGLOBAL *global = gsKit_init_global();
  if (global == NULL) {
    printf("MULTIPLEX PS2: gsKit initialization failed\n");
    return 1;
  }
  global->PSM = GS_PSM_CT24;
  global->PSMZ = GS_PSMZ_16S;
  global->DoubleBuffering = GS_SETTING_OFF;
  global->ZBuffering = GS_SETTING_OFF;
  global->PrimAlphaEnable = GS_SETTING_OFF;

  dmaKit_init(D_CTRL_RELE_OFF, D_CTRL_MFD_OFF, D_CTRL_STS_UNSPEC,
              D_CTRL_STD_OFF, D_CTRL_RCYC_8, 1 << DMA_CHANNEL_GIF);
  dmaKit_chan_init(DMA_CHANNEL_GIF);
  gsKit_init_screen(global);

  GSTEXTURE texture;
  if (!load_reference_texture(global, &texture)) {
    gsKit_deinit_global(global);
    return 1;
  }

  gsKit_mode_switch(global, GS_PERSISTENT);
  gsKit_clear(global, GS_SETREG_RGBAQ(0, 0, 0, 0, 0));
  gsKit_set_test(global, GS_ZTEST_OFF);
  gsKit_prim_sprite_texture(global, &texture, 0.0f, 0.0f, 0.0f, 0.0f,
                            (float)global->Width, (float)global->Height,
                            (float)FRAME_WIDTH, (float)FRAME_HEIGHT, 1,
                            GS_SETREG_RGBAQ(0x80, 0x80, 0x80, 0x80, 0));

  printf("MULTIPLEX PS2: console UI reference frame ready %dx%d\n",
         global->Width, global->Height);
  for (;;) {
    gsKit_sync_flip(global);
    gsKit_queue_exec(global);
  }
}
