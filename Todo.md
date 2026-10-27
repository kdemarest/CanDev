# Todo

High-level roadmap for the whole workspace, in priority order. Details live in the files linked; per-asset work lives in [[Assets To Make]]. (Ken, 2026-10-21)

## 1. Toolchain MVP: see and compose areas on the phone (layout)

Goal: view a real Canopy area in 3D on the phone and compose landmarks. See `layout/README.md` and [[Android Toolchain]].

- [x] Guid index and `.asset` mesh to OBJ converter (`layout/tools`)
- [x] Import a Unity area; resolve pieces through prefabs; fetch meshes on demand
- [x] layout: browser page + local Node server; view in gray, folders filter, placeholder boxes
- [x] Compose: palette, carry on a cursor, move, orbit to turn, snap, scale bar, drop, cancel, delete, undo/redo, save Piece lines
- [ ] Try it on the phone and adjust the feel
- [x] FBX reader, applying each model's import settings (Scale Factor, Convert Units)
- [x] Apply per-instance overrides of objects inside prefabs, at any depth (e.g. Catapult arm, Cairn's switched-off gem holder)
- [x] Textures: Unity materials (color, normal, detail maps) on the pieces, with a gray toggle
- [x] Store textures capped at 1024 px (Beech area: 32 MB, was 155 MB)
- [x] Tree chunks: an area brings in only the chunks it overlaps, at L0, with leaves (2026-10-21)
- [x] `layout/unity.json`: tree LOD, texture cap, and show/hide rules per Unity scene; nothing hard coded (2026-10-21)
- [x] Fetch meshes and textures through a throwaway git store, so Canopy's stays lean (2026-10-21)
- [ ] Ken: run `bash ~/.cache/canopy-shrink/shrink-canopy-git.sh` to bring Canopy's git store from 322 MB back to about 53 MB
- [ ] Render a few existing objects as a style guide

## 2. Toolchain MVP: export

- [ ] Asset name resolution: description names for existing assets, derived unique names for new ones
- [ ] Early export test: one small prefab, so the first dev month catches format errors
- [ ] Export a scene file to `.prefab` plus `.meta` files in the Unity working tree, uncommitted
- [ ] Verify the import in Unity (dev-machine month)

## 3. modl modeling language

- [ ] Primitives with UVs generated alongside geometry (modl `PLAN.md`)
- [ ] `# Model <name>` headings produce OBJ plus atlases
- [ ] First real models: a few 🔴 pieces from one landmark
- [ ] In layout, lengthen or shorten a modl script's dimensions interactively (Ken, 2026-10-21)
- [ ] Decide the modl script language (maybe Python)

## 4. Textures

- [ ] Adapt gptviz to make texture maps; normal maps from them
- [ ] One atlas per asset; later compose them into bigger atlases
- [x] Convert the repo's TIF and PSD textures to PNG: all 25 handled in the Canopy working tree, uncommitted (2026-10-21)

## 5. Landmark design

- [ ] Finish the landmark write-ups, one per biome profession plus the three mana temples (see [[Points Of Interest]])
- [ ] Rule on the open landmark flags
- [ ] Lay out each landmark as a scene file once the toolchain works

## 6. Build the assets

- [ ] Work through [[Assets To Make]], highest-effort landmark first
- [ ] Export tablet drafts into `English.txt` entries

## 7. Merge canvid (done 2026-10-21)

- [x] Move the vault to `/sdcard/dev/docs` and canvid to `/sdcard/dev/vids`, which keeps all video-only material (Ken, 2026-10-21)
- [x] Merge list: each canvid doc, kept in vids or merged into a vault file (2026-10-21)
- [x] Common elements (e.g. `Aeku.md`) merged into their existing vault element files (2026-10-21)
- [x] Workspace search path (`workspace.json`, `tools/resolve.js`) and Traits in prompts
- [ ] Rule on Ring Creation and on curing stations (see [[Canvid Merge]])

## Research browser (not Canopy)

- [ ] A small WebView app to browse sites Claude can't read and save pages for it: see [[Research Browser]]. Waiting on a name and a GitHub repo

## Housekeeping

- [ ] Commit the gptviz, movi and modl changes (resolver, Traits, paths; modl's Unity tools moved to layout)
- [ ] Make `/sdcard/dev` a repo, so `workspace.json`, `setup.sh` and `tools/` are versioned
- [x] layout is on GitHub as `kdemarest/CanLayout` and in `setup.sh` (2026-10-21)

## Waiting for a dev machine

- [ ] Play-test the Beech ring phantom experiment, then decide where it is documented
- [ ] Check whether Lod1 meshes give a better poly count for the phone
