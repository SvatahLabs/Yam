# The mark

Vendored from the brand repository (`Portal/brand/yam/`) on 2026-09-09. That
repository is the source; this directory is a copy so that a build of this one
does not depend on a checkout of another. When the mark changes there, it is copied
here deliberately — `TV-A08`.

| File | For |
|---|---|
| `yam-color-dark.svg` | the primary mark on a dark background |
| `yam-color-light.svg` | the primary mark on a light background |
| `yam-white.svg` | the mono lockup on dark, and anywhere colour is not available |
| `yam-black.svg` | the mono lockup on light |
| `app-icon-512.png` | the source for the packaged application's icon set |

All four SVGs are one system: a 48 grid, `stroke-width: 2`, round caps and
joins, transparent background. Everything at 24 px and above uses this artwork
unchanged.

**Below 24 px it is drawn, not scaled.** The identity is in the outline and the
diagonal, not the mass: a solid silhouette at 16 px loses the two-leaf fork and
reads as a pear, which was tried and thrown away. The 16 px asset keeps the
outline on a 16 grid with a 1 px stroke.
