/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * devkitPPC's prebuilt newlib exposes sincos as a weak symbol whose pointer
 * argument ABI does not match code generated for this app. GCC combines the
 * adjacent sin/cos calls in FFmpeg's AAC MDCT setup into sincos, so provide a
 * strong implementation compiled with the same flags as the caller.
 */

#include <math.h>

static __attribute__((noinline)) double scalar_sine(double angle) {
  return sin(angle);
}

static __attribute__((noinline)) double scalar_cosine(double angle) {
  return cos(angle);
}

void sincos(double angle, double *sine, double *cosine) {
  if (sine != NULL) {
    *sine = scalar_sine(angle);
  }
  if (cosine != NULL) {
    *cosine = scalar_cosine(angle);
  }
}
