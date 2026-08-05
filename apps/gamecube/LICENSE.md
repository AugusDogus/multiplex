# GameCube app licensing

The console runtime in this directory is licensed under the GNU General
Public License, version 3 or (at your option) any later version
(`GPL-3.0-or-later`).

This choice is intentional: the GX YUV presentation path adapts MPlayer CE
code, and the direct Audio Interface DMA path adapts WiiMC-GCN's `ao_gekko`
driver. Both are `GPL-2.0-or-later`, so their code may be incorporated into
this later-version work, and the resulting statically linked DOL can directly
benefit from their GameCube work. The complete GPL version 3 text is available
at <https://www.gnu.org/licenses/gpl-3.0.html>; the version 2 text for the
adapted components remains in the pinned MPlayer CE checkout at
`.mplayer-ce-libogc2/mplayer/LICENSE`.

Third-party components retain their own licenses:

- Vercel Native SDK: Apache-2.0
- WiiMC-GCN: GPL-2.0-or-later
- MPlayer CE: GPL-2.0-or-later
- MPlayer CE's bundled FFmpeg libraries: LGPL-2.1-or-later unless an enabled
  component states otherwise
- libogc2 and devkitPPC runtime components: their upstream license notices

The root Multiplex web application remains under its existing MIT license.
