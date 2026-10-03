#include "gateway_auth.h"
#include "gateway_catalog.h"
#include "generated-config.h"
#include "http.h"
#include "native_ui.h"
#include "storage.h"

#include <SDL.h>
#include <hal/debug.h>
#include <hal/video.h>
#include <hal/xbox.h>
#include <nxdk/mount.h>
#include <nxdk/net.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <windows.h>

#define AUTH_DIRECTORY "E:\\UDATA\\4d50584d"
#define AUTH_RETRY_INTERVAL_MS 8000u
#define CATALOG_RETRY_INTERVAL_MS 8000u

#define SCREEN_WIDTH 640
#define SCREEN_HEIGHT 480
#define BYTES_PER_PIXEL 4u
#define FRAME_BYTES                                                            \
  ((uint32_t)SCREEN_WIDTH * (uint32_t)SCREEN_HEIGHT * BYTES_PER_PIXEL)

typedef struct {
  SDL_Window *window;
  SDL_Renderer *renderer;
  SDL_Texture *texture;
  SDL_GameController *controller;
  uint8_t *pixels;
  uint8_t *scratch;
  MultiplexAuthCredentials credentials;
  uint32_t auth_generation;
  bool network_ready;
  MultiplexXboxDeviceAuth authorization;
  uint32_t next_auth_action_ms;
  bool catalog_loaded;
  uint32_t next_catalog_action_ms;
  MultiplexXboxCatalog catalog;
} XboxApp;

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  debugPrint("MULTIPLEX XBOX: input action=%lu focus=%lu count=%lu "
             "message=%lu\n",
             (unsigned long)action, (unsigned long)focus, (unsigned long)count,
             (unsigned long)message);
}

void *multiplex_native_cache_alloc(uint32_t len, uint32_t alignment) {
  if (len == 0 || alignment == 0 || (alignment & (alignment - 1u)) != 0) {
    return NULL;
  }
  if (alignment < sizeof(void *)) {
    alignment = sizeof(void *);
  }
  const uint32_t overhead = alignment - 1u + sizeof(void *);
  if (len > UINT32_MAX - overhead) {
    return NULL;
  }
  uint8_t *allocation = malloc(len + overhead);
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

void multiplex_native_profile_mark(uint32_t stage) { (void)stage; }

static void close_controller(XboxApp *app) {
  if (app->controller == NULL) {
    return;
  }
  SDL_GameControllerClose(app->controller);
  app->controller = NULL;
}

static void close_app(XboxApp *app) {
  close_controller(app);
  if (app->texture != NULL) {
    SDL_DestroyTexture(app->texture);
  }
  if (app->renderer != NULL) {
    SDL_DestroyRenderer(app->renderer);
  }
  if (app->window != NULL) {
    SDL_DestroyWindow(app->window);
  }
  free(app->scratch);
  free(app->pixels);
  SDL_Quit();
}

static int stop_with_error(XboxApp *app, const char *operation) {
  debugPrint("MULTIPLEX XBOX: %s failed: %s\n", operation, SDL_GetError());
  close_app(app);
  Sleep(5000);
  XReboot();
  return 1;
}

static bool open_app(XboxApp *app) {
  XVideoSetMode(SCREEN_WIDTH, SCREEN_HEIGHT, 32, REFRESH_DEFAULT);
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER) != 0) {
    return false;
  }
  app->window = SDL_CreateWindow("Multiplex", SDL_WINDOWPOS_UNDEFINED,
                                 SDL_WINDOWPOS_UNDEFINED, SCREEN_WIDTH,
                                 SCREEN_HEIGHT, SDL_WINDOW_SHOWN);
  if (app->window == NULL) {
    return false;
  }
  app->renderer = SDL_CreateRenderer(app->window, -1, 0);
  if (app->renderer == NULL) {
    return false;
  }
  app->texture = SDL_CreateTexture(app->renderer, SDL_PIXELFORMAT_RGBA32,
                                   SDL_TEXTUREACCESS_STREAMING, SCREEN_WIDTH,
                                   SCREEN_HEIGHT);
  if (app->texture == NULL) {
    return false;
  }
  app->pixels = malloc(FRAME_BYTES);
  app->scratch = malloc(FRAME_BYTES);
  return app->pixels != NULL && app->scratch != NULL;
}

static bool create_auth_directory(void) {
  if (!nxIsDriveMounted('E') &&
      !nxMountDrive('E', "\\Device\\Harddisk0\\Partition1\\")) {
    return false;
  }
  if (!CreateDirectoryA("E:\\UDATA", NULL) &&
      GetLastError() != ERROR_ALREADY_EXISTS) {
    return false;
  }
  return CreateDirectoryA(AUTH_DIRECTORY, NULL) ||
         GetLastError() == ERROR_ALREADY_EXISTS;
}

static bool bind_auth(const MultiplexXboxDeviceAuth *authorization) {
  const char *code = authorization->status == MULTIPLEX_XBOX_AUTH_WAITING
                         ? authorization->user_code
                         : "";
  const char *link_url = authorization->status == MULTIPLEX_XBOX_AUTH_WAITING
                             ? authorization->link_url
                             : "";
  return multiplex_native_app_pairing_status(
             authorization->status, (const uint8_t *)code, strlen(code),
             (const uint8_t *)link_url, strlen(link_url)) != 0;
}

static bool begin_pairing(XboxApp *app, uint32_t now_ms) {
  if (MULTIPLEX_XBOX_BASE_URL[0] != '\0' && app->network_ready &&
      multiplex_xbox_auth_begin(MULTIPLEX_XBOX_BASE_URL,
                                multiplex_xbox_http_request_json, NULL,
                                &app->authorization)) {
    app->next_auth_action_ms =
        now_ms + (uint32_t)app->authorization.interval_seconds * 1000u;
    return bind_auth(&app->authorization);
  }
  app->authorization = (MultiplexXboxDeviceAuth){
      .status = MULTIPLEX_XBOX_AUTH_UNAVAILABLE,
  };
  app->next_auth_action_ms = now_ms + AUTH_RETRY_INTERVAL_MS;
  return bind_auth(&app->authorization);
}

static bool bind_catalog(const MultiplexXboxCatalog *catalog) {
  if (multiplex_native_app_catalog_begin((const uint8_t *)catalog->server_name,
                                         (uint32_t)strlen(catalog->server_name),
                                         catalog->row_count, 0) == 0) {
    return false;
  }
  uint32_t artwork_slot = 0;
  for (uint16_t row_index = 0; row_index < catalog->row_count; ++row_index) {
    const MultiplexXboxCatalogRow *row = &catalog->rows[row_index];
    if (multiplex_native_app_catalog_row(row_index, (const uint8_t *)row->title,
                                         (uint32_t)strlen(row->title),
                                         row->item_count) == 0) {
      return false;
    }
    for (uint16_t item_index = 0; item_index < row->item_count; ++item_index) {
      const MultiplexXboxCatalogItem *item = &row->items[item_index];
      uint32_t progress =
          item->duration_ms == 0
              ? 0
              : (uint32_t)(((uint64_t)item->view_offset_ms * 100u) /
                           item->duration_ms);
      if (progress > 100u) {
        progress = 100u;
      }
      if (multiplex_native_app_catalog_item(
              row_index, item_index, item->rating_key,
              (const uint8_t *)item->title, (uint32_t)strlen(item->title),
              (const uint8_t *)item->subtitle, (uint32_t)strlen(item->subtitle),
              artwork_slot++, item->duration_ms, item->view_offset_ms,
              progress) == 0) {
        return false;
      }
    }
  }
  return multiplex_native_app_catalog_commit() != 0;
}

static bool load_catalog(XboxApp *app, uint32_t now_ms) {
  app->next_catalog_action_ms = now_ms + CATALOG_RETRY_INTERVAL_MS;
  if (!app->network_ready || MULTIPLEX_XBOX_BASE_URL[0] == '\0' ||
      !multiplex_xbox_catalog_load(
          MULTIPLEX_XBOX_BASE_URL, app->credentials.session_token,
          multiplex_xbox_http_request_json, NULL, &app->catalog) ||
      !bind_catalog(&app->catalog)) {
    return false;
  }
  app->catalog_loaded = true;
  debugPrint("MULTIPLEX XBOX: catalog server=%s rows=%u\n",
             app->catalog.server_name, (unsigned)app->catalog.row_count);
  return true;
}

static void initialize_services(XboxApp *app) {
  multiplex_native_app_init();
  const bool storage_ready = create_auth_directory();
  const MultiplexXboxStorageResult stored =
      storage_ready
          ? multiplex_xbox_storage_load(AUTH_DIRECTORY, &app->credentials,
                                        &app->auth_generation)
          : MULTIPLEX_XBOX_STORAGE_IO_ERROR;
  debugPrint("MULTIPLEX XBOX: auth storage=%s generation=%lu\n",
             multiplex_xbox_storage_result_message(stored),
             (unsigned long)app->auth_generation);

  const nx_net_parameters_t network = {
      .ipv4_mode = NX_NET_DHCP,
  };
  app->network_ready = nxNetInit(&network) == 0;
  debugPrint("MULTIPLEX XBOX: network=%s\n",
             app->network_ready ? "ready" : "unavailable");
  bool bound = false;
  if (stored == MULTIPLEX_XBOX_STORAGE_OK) {
    app->authorization = (MultiplexXboxDeviceAuth){
        .status = MULTIPLEX_XBOX_AUTH_LINKED,
    };
    bound = bind_auth(&app->authorization);
    app->next_catalog_action_ms = SDL_GetTicks();
  } else {
    bound = begin_pairing(app, SDL_GetTicks());
  }
  if (!bound) {
    debugPrint("MULTIPLEX XBOX: failed to bind startup state\n");
  }
}

static bool deadline_reached(uint32_t now_ms, uint32_t deadline_ms) {
  return (int32_t)(now_ms - deadline_ms) >= 0;
}

static bool step_services(XboxApp *app) {
  const uint32_t now_ms = SDL_GetTicks();
  if (app->authorization.status == MULTIPLEX_XBOX_AUTH_LINKED &&
      !app->catalog_loaded &&
      deadline_reached(now_ms, app->next_catalog_action_ms)) {
    return load_catalog(app, now_ms);
  }
  if (!deadline_reached(now_ms, app->next_auth_action_ms)) {
    return false;
  }
  if (app->authorization.status == MULTIPLEX_XBOX_AUTH_UNAVAILABLE) {
    return begin_pairing(app, now_ms);
  }
  if (app->authorization.status != MULTIPLEX_XBOX_AUTH_WAITING) {
    return false;
  }

  const MultiplexXboxAuthStatus previous = app->authorization.status;
  const bool polled = multiplex_xbox_auth_poll(
      MULTIPLEX_XBOX_BASE_URL, multiplex_xbox_http_request_json, NULL,
      &app->authorization, &app->credentials);
  app->next_auth_action_ms =
      now_ms + (uint32_t)app->authorization.interval_seconds * 1000u;
  if (!polled || app->authorization.status == previous) {
    return false;
  }
  if (app->authorization.status == MULTIPLEX_XBOX_AUTH_LINKED) {
    const MultiplexXboxStorageResult saved = multiplex_xbox_storage_save(
        AUTH_DIRECTORY, &app->credentials, &app->auth_generation);
    debugPrint("MULTIPLEX XBOX: auth persistence=%s generation=%lu\n",
               multiplex_xbox_storage_result_message(saved),
               (unsigned long)app->auth_generation);
    app->next_catalog_action_ms = now_ms;
  }
  return bind_auth(&app->authorization);
}

static bool render_ui(XboxApp *app, bool initialize) {
  if (initialize) {
    initialize_services(app);
  }
  const uint32_t command_count = multiplex_native_app_render_reference(
      app->pixels, FRAME_BYTES, app->scratch, FRAME_BYTES);
  if (command_count == 0) {
    debugPrint("MULTIPLEX XBOX: shared UI render failed at stage %lu\n",
               (unsigned long)multiplex_native_reference_render_stage());
    return false;
  }
  if (SDL_UpdateTexture(app->texture, NULL, app->pixels,
                        SCREEN_WIDTH * (int)BYTES_PER_PIXEL) != 0) {
    return false;
  }
  if (SDL_RenderClear(app->renderer) != 0 ||
      SDL_RenderCopy(app->renderer, app->texture, NULL, NULL) != 0) {
    return false;
  }
  SDL_RenderPresent(app->renderer);
  return true;
}

static void open_controller(XboxApp *app, int device_index) {
  SDL_GameController *controller = SDL_GameControllerOpen(device_index);
  if (controller == NULL) {
    debugPrint("MULTIPLEX XBOX: controller open failed: %s\n", SDL_GetError());
    return;
  }
  if (app->controller == NULL) {
    app->controller = controller;
    return;
  }
  SDL_GameControllerClose(controller);
}

static void remove_controller(XboxApp *app, SDL_JoystickID instance_id) {
  if (app->controller == NULL) {
    return;
  }
  SDL_Joystick *joystick = SDL_GameControllerGetJoystick(app->controller);
  if (SDL_JoystickInstanceID(joystick) == instance_id) {
    close_controller(app);
  }
}

static bool button_action(Uint8 button, uint32_t *action) {
  switch (button) {
  case SDL_CONTROLLER_BUTTON_DPAD_LEFT:
    *action = MULTIPLEX_INPUT_FOCUS_LEFT;
    return true;
  case SDL_CONTROLLER_BUTTON_DPAD_RIGHT:
    *action = MULTIPLEX_INPUT_FOCUS_RIGHT;
    return true;
  case SDL_CONTROLLER_BUTTON_A:
    *action = MULTIPLEX_INPUT_CONFIRM;
    return true;
  case SDL_CONTROLLER_BUTTON_B:
  case SDL_CONTROLLER_BUTTON_BACK:
    *action = MULTIPLEX_INPUT_BACK;
    return true;
  case SDL_CONTROLLER_BUTTON_Y:
    *action = MULTIPLEX_INPUT_HOME;
    return true;
  case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER:
    *action = MULTIPLEX_INPUT_PAGE_FORWARD;
    return true;
  case SDL_CONTROLLER_BUTTON_LEFTSHOULDER:
    *action = MULTIPLEX_INPUT_PAGE_BACK;
    return true;
  case SDL_CONTROLLER_BUTTON_DPAD_UP:
    *action = MULTIPLEX_INPUT_FOCUS_UP;
    return true;
  case SDL_CONTROLLER_BUTTON_DPAD_DOWN:
    *action = MULTIPLEX_INPUT_FOCUS_DOWN;
    return true;
  case SDL_CONTROLLER_BUTTON_X:
    *action = MULTIPLEX_INPUT_SEARCH;
    return true;
  case SDL_CONTROLLER_BUTTON_START:
    *action = MULTIPLEX_INPUT_START;
    return true;
  default:
    return false;
  }
}

static bool handle_event(XboxApp *app, const SDL_Event *event, bool *running) {
  switch (event->type) {
  case SDL_QUIT:
    *running = false;
    return false;
  case SDL_CONTROLLERDEVICEADDED:
    open_controller(app, event->cdevice.which);
    return false;
  case SDL_CONTROLLERDEVICEREMOVED:
    remove_controller(app, event->cdevice.which);
    return false;
  case SDL_CONTROLLERBUTTONDOWN: {
    uint32_t action = 0;
    if (!button_action(event->cbutton.button, &action)) {
      return false;
    }
    return multiplex_native_app_input(action) != 0;
  }
  default:
    return false;
  }
}

int main(void) {
  XboxApp app = {0};
  if (multiplex_native_abi_version() != MULTIPLEX_NATIVE_ABI_VERSION) {
    debugPrint("MULTIPLEX XBOX: shared UI ABI mismatch\n");
    Sleep(5000);
    XReboot();
    return 1;
  }
  if (multiplex_native_reference_pixel_bytes() != FRAME_BYTES) {
    debugPrint("MULTIPLEX XBOX: shared UI frame size mismatch\n");
    Sleep(5000);
    XReboot();
    return 1;
  }
  if (!open_app(&app)) {
    return stop_with_error(&app, "application initialization");
  }
  if (!render_ui(&app, true)) {
    return stop_with_error(&app, "initial UI render");
  }

  bool running = true;
  while (running) {
    SDL_Event event;
    bool render_requested = false;
    while (SDL_PollEvent(&event)) {
      render_requested =
          handle_event(&app, &event, &running) || render_requested;
    }
    render_requested = step_services(&app) || render_requested;
    if (render_requested && !render_ui(&app, false)) {
      return stop_with_error(&app, "UI render");
    }
    SDL_Delay(1);
  }

  close_app(&app);
  return 0;
}
