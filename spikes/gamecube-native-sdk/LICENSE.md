# GameCube spike licensing

The console runtime in this directory is licensed under the GNU General
Public License, version 2 or (at your option) any later version
(`GPL-2.0-or-later`).

This choice is intentional: the GX YUV presentation path adapts MPlayer CE
code, and the resulting statically linked DOL can directly benefit from
MPlayer CE's GameCube work. The complete GPL version 2 text is available in
the pinned MPlayer CE checkout at `.mplayer-ce-libogc2/mplayer/LICENSE` and at
<https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>.

Third-party components retain their own licenses:

- Vercel Native SDK: Apache-2.0
- MPlayer CE: GPL-2.0-or-later
- MPlayer CE's bundled FFmpeg libraries: LGPL-2.1-or-later unless an enabled
  component states otherwise
- libogc2 and devkitPPC runtime components: their upstream license notices

The root Multiplex web application remains under its existing MIT license.
