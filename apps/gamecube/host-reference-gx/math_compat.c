/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Zig's compiler runtime contributes weak sin, cos, and sincos symbols whose
 * ABI does not match the devkitPPC C objects in FFmpeg. Use newlib's uniquely
 * named fdlibm kernels so this bridge cannot resolve back to those symbols.
 */

#include <math.h>
#include <stddef.h>

extern int __ieee754_rem_pio2(double angle, double remainder[2]);
extern double __kernel_sin(double primary, double tail, int has_tail);
extern double __kernel_cos(double primary, double tail);

void sincos(double angle, double *sine, double *cosine) {
  double remainder[2];
  const int quadrant = __ieee754_rem_pio2(angle, remainder) & 3;
  const double reduced_sine = __kernel_sin(remainder[0], remainder[1], 1);
  const double reduced_cosine = __kernel_cos(remainder[0], remainder[1]);
  if (sine != NULL) {
    static const int signs[4] = {1, 1, -1, -1};
    const double magnitude =
        (quadrant & 1) == 0 ? reduced_sine : reduced_cosine;
    *sine = signs[quadrant] * magnitude;
  }
  if (cosine != NULL) {
    static const int signs[4] = {1, -1, -1, 1};
    const double magnitude =
        (quadrant & 1) == 0 ? reduced_cosine : reduced_sine;
    *cosine = signs[quadrant] * magnitude;
  }
}
