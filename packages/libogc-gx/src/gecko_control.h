#ifndef MULTIPLEX_GECKO_CONTROL_H
#define MULTIPLEX_GECKO_CONTROL_H

#include "app.h"
#include "gecko_command.h"

typedef struct {
  int channel;
  MultiplexGeckoCommand command;
  MultiplexPresentationCapture capture;
  uint64_t capture_expires_at_ms;
} MultiplexGeckoControl;

MultiplexGeckoControl multiplex_gecko_control_open(void);
// Returns true for a remote exit request. Called on the app thread.
bool multiplex_gecko_control_poll(MultiplexGeckoControl *control,
                                  MultiplexApp *app);
void multiplex_gecko_control_close(MultiplexGeckoControl *control);

#endif
