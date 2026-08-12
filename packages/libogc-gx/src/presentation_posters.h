#ifndef MULTIPLEX_PRESENTATION_POSTERS_H
#define MULTIPLEX_PRESENTATION_POSTERS_H

#include <stdbool.h>
#include <stdint.h>

typedef struct MultiplexPresentation MultiplexPresentation;

typedef enum {
  MULTIPLEX_PRESENTATION_POSTERS_OVERWRITE = 0,
  MULTIPLEX_PRESENTATION_POSTERS_REUSE = 1,
} MultiplexPresentationPosterWriteMode;

typedef struct {
  uint8_t *pixels;
  uint32_t token;
} MultiplexPresentationPosterWrite;

bool multiplex_presentation_posters_begin(
    MultiplexPresentation *presentation, uint16_t offset, uint16_t count,
    MultiplexPresentationPosterWriteMode mode,
    MultiplexPresentationPosterWrite *write);
bool multiplex_presentation_posters_reuse(
    MultiplexPresentation *presentation,
    const MultiplexPresentationPosterWrite *write, uint16_t index,
    uint32_t rating_key);
bool multiplex_presentation_posters_commit(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write, const uint32_t *rating_keys);
void multiplex_presentation_posters_cancel(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write);
bool multiplex_presentation_poster_matches(
    const MultiplexPresentation *presentation, uint16_t slot,
    uint32_t rating_key);

#endif
