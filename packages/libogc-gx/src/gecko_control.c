#include "gecko_control.h"
#include "app_internal.h"

#include <ogc/lwp_watchdog.h>
#include <ogc/usbgecko.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CAPTURE_CHUNK 2048u
#define CAPTURE_IDLE_TIMEOUT_MS 5000u

// SYS_Report may split a formatted line into several underlying writes. A
// single EXI-locked transfer prevents worker logs from interrupting a reply.
// Leading/trailing newlines isolate it from any partial diagnostic line.
static bool reply(MultiplexGeckoControl *control, const char *format, ...) {
  char line[CAPTURE_CHUNK * 2 + 128];
  line[0] = '\n';
  va_list args;
  va_start(args, format);
  const int length = vsnprintf(line + 1, sizeof(line) - 2, format, args);
  va_end(args);
  if (length < 0 || (size_t)length >= sizeof(line) - 2) {
    return false;
  }
  line[length + 1] = '\n';
  const int size = length + 2;
  // A disconnected host must not leave the application waiting indefinitely.
  const bool complete =
      usb_sendbuffer_safe_ex(control->channel, line, size, 100000) == size;
  if (!complete) {
    usb_sendbuffer_safe_ex(control->channel, "\n", 1, 1000);
  }
  return complete;
}

MultiplexGeckoControl multiplex_gecko_control_open(void) {
  const char *channel = getenv("USBGECKO_CHANNEL");
  int number = -1;
  if (channel != NULL && (channel[0] == '0' || channel[0] == '1') &&
      channel[1] == '\0' && usb_isgeckoalive(channel[0] - '0')) {
    number = channel[0] - '0';
  }
  return (MultiplexGeckoControl){.channel = number};
}

void multiplex_gecko_control_close(MultiplexGeckoControl *control) {
  free(control->capture.pixels);
  control->capture = (MultiplexPresentationCapture){0};
}

static uint32_t checksum(const uint8_t *data, uint32_t size) {
  uint32_t a = 1, b = 0;
  for (uint32_t index = 0; index < size; ++index) {
    a = (a + data[index]) % 65521u;
    b = (b + a) % 65521u;
  }
  return (b << 16) | a;
}

static void capture_start(MultiplexGeckoControl *control, MultiplexApp *app,
                          uint64_t now_ms) {
  multiplex_gecko_control_close(control);
  control->capture = multiplex_presentation_capture(app->presentation);
  const MultiplexPresentationCapture *capture = &control->capture;
  if (capture->pixels == NULL) {
    reply(control,
          "MULTIPLEX:ERROR screenshot unavailable (no frame or memory)");
    return;
  }
  control->capture_expires_at_ms = now_ms + CAPTURE_IDLE_TIMEOUT_MS;
  reply(control, "MULTIPLEX:SHOT %lu %lu %lu %lu %08lx",
        (unsigned long)capture->width, (unsigned long)capture->height,
        (unsigned long)capture->stride, (unsigned long)capture->size,
        (unsigned long)checksum(capture->pixels, capture->size));
}

static void capture_read(MultiplexGeckoControl *control, uint32_t offset,
                         uint64_t now_ms) {
  const MultiplexPresentationCapture *capture = &control->capture;
  if (capture->pixels == NULL || offset >= capture->size ||
      offset % CAPTURE_CHUNK != 0) {
    reply(control, "MULTIPLEX:ERROR screenshot expired or invalid offset");
    return;
  }
  const uint32_t remaining = capture->size - offset;
  const uint32_t count = remaining < CAPTURE_CHUNK ? remaining : CAPTURE_CHUNK;
  char hex[CAPTURE_CHUNK * 2 + 1];
  static const char digits[] = "0123456789abcdef";
  for (uint32_t index = 0; index < count; ++index) {
    const uint8_t pixel = capture->pixels[offset + index];
    hex[index * 2] = digits[pixel >> 4];
    hex[index * 2 + 1] = digits[pixel & 15];
  }
  hex[count * 2] = '\0';
  // Pull-based chunks stop transfer when the host disconnects.
  const bool sent =
      reply(control, "MULTIPLEX:DATA %08lx %s", (unsigned long)offset, hex);
  control->capture_expires_at_ms = now_ms + CAPTURE_IDLE_TIMEOUT_MS;
  if (sent && offset + count == capture->size) {
    multiplex_gecko_control_close(control);
  }
}

bool multiplex_gecko_control_poll(MultiplexGeckoControl *control,
                                  MultiplexApp *app) {
  if (control->channel < 0) {
    return false;
  }
  const uint64_t now_ms = ticks_to_millisecs(gettime());
  if (control->capture.pixels != NULL &&
      now_ms >= control->capture_expires_at_ms) {
    multiplex_gecko_control_close(control);
  }
  for (unsigned index = 0; index < 64u; ++index) {
    uint8_t byte;
    if (usb_recvbuffer_safe_ex(control->channel, &byte, 1, 1) != 1) {
      break;
    }
    const MultiplexGeckoRequest request =
        multiplex_gecko_command_feed(&control->command, byte);
    switch (request.kind) {
    case MULTIPLEX_GECKO_NONE:
      break;
    case MULTIPLEX_GECKO_EXIT:
      SYS_Report("REFERENCE GX: remote exit accepted\n");
      return true;
    case MULTIPLEX_GECKO_SCREENSHOT:
      capture_start(control, app, now_ms);
      return false;
    case MULTIPLEX_GECKO_READ:
      capture_read(control, request.payload.offset, now_ms);
      return false;
    case MULTIPLEX_GECKO_PAD:
      multiplex_gecko_input_set(&app->input.gecko, request.payload.pad, now_ms);
      reply(control, "MULTIPLEX:PAD OK");
      // Apply this sample through the input path before accepting its
      // successor.
      return false;
    }
  }
  return false;
}
