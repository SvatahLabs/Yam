# The mark

Vendored from the brand repository (`Portal/brand/yam/`, at `32560b3`) on
2026-09-13, by `node scripts/brand.mjs --from <Portal>/brand/yam`. That
repository is the source; this directory is a copy so that a build of this one
does not depend on a checkout of another. When the mark changes there, it is
copied here deliberately, with that command — `TV-A08`.

The mark is the refined botanical one: a heart-shaped leaf, a curved vine and an
elongated tuber, in solid shapes. It replaced the outlined sprout this directory
held until then.

| File | For |
|---|---|
| `yam-color-light.svg` | the mark on a light background |
| `yam-color-dark.svg` | the mark on a dark background |
| `yam-white.svg`, `yam-black.svg` | one colour, on dark and on light |
| `yam-*-small.svg` | the same four for 16–32 px, without the vein and tuber details |
| `yam-color-light-horizontal.svg`, `yam-color-dark-horizontal.svg` | the mark and the name, as the README shows them |
| `app-icon.icns` | the packaged app's icon on macOS, rendered by the script |
| `app-icon.ico` | the packaged app's and the installer's icon on Windows |
| `app-icon.png` | the Linux package's icon |

`forge.config.ts` points `packagerConfig.icon` at `app-icon` with no extension,
and the packager appends `.icns` or `.ico` for its platform. Every one of them
has to be here: when only the `.png` was, the macOS and Windows builds found no
icon, said nothing, and shipped Electron's.

The macOS icon is the kit's app icon — the mark at five-sixths on an `#eef3ea`
tile — drawn on Apple's grid, an 824-pixel rounded square on a 1024 canvas,
because that is the shape macOS gives every app icon. The Windows and Linux
icons are the mark alone, as those platforms draw theirs.

The kit's rules hold here as they do there: the small drawing from 16 to 32 px,
a quarter of the symbol's width clear around a standalone mark, and no
stretching, outlines or shadows. The app shell draws the mark at 18 px, so it
masks `yam-white-small.svg`.
