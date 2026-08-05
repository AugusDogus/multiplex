#ifndef MULTIPLEX_PLEX_BOOTSTRAP_H
#define MULTIPLEX_PLEX_BOOTSTRAP_H

#include "auth_record.h"

#include <stdbool.h>

bool multiplex_plex_bootstrap_credentials(MultiplexAuthCredentials *credentials,
                                          const char *preferred_server_url);

#endif
