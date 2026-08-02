#ifndef MULTIPLEX_MEMORY_CARD_PRESENTATION_H
#define MULTIPLEX_MEMORY_CARD_PRESENTATION_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_CARD_ICON_OFFSET 0u
#define MULTIPLEX_CARD_ICON_SIZE 2048u
#define MULTIPLEX_CARD_COMMENT_OFFSET 2048u
#define MULTIPLEX_CARD_COMMENT_SIZE 64u
#define MULTIPLEX_CARD_AUTH_OFFSET 2560u

bool multiplex_memory_card_prepare_presentation(uint8_t *block,
                                                size_t block_size);
bool multiplex_memory_card_has_presentation(const uint8_t *block,
                                            size_t block_size);

#endif
