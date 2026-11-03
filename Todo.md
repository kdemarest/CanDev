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
- [ ] Leaves waver in the wind: find how expensive it would be, in layout and on the Quest (Ken, 2026-10-29)
- [ ] Animations for harvesters in layout (Ken, 2026-10-29)

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

- [x] Lens, a WebView app with a Claude chat pane that drives the page: see `lens/README.md` and [[Research Browser]] (`lens/Research Browser.md`). Built 2026-11-03
- [ ] Create the GitHub repo kdemarest/lens, and try Lens on real sites (TripAdvisor first)

## Housekeeping

- [ ] Commit the gptviz, movi and modl changes (resolver, Traits, paths; modl's Unity tools moved to layout)
- [ ] Make `/sdcard/dev` a repo, so `workspace.json`, `setup.sh` and `tools/` are versioned
- [x] layout is on GitHub as `kdemarest/CanLayout` and in `setup.sh` (2026-10-21)

## Waiting for a dev machine

- [ ] Play-test the Beech ring phantom experiment, then decide where it is documented
- [ ] Check whether Lod1 meshes give a better poly count for the phone
- [ ] Spinners keep their clients' collision cheap (Ken, 2026-10-29). A spun part's colliders have no Rigidbody, so PhysX moves static colliders every frame, which may be why 30 spinners cost so much frame time. Ken's design: Spinner.cs turns a client's collision on only when something nearby needs it, and gives it a kinematic Rigidbody whenever a collider that turns is on:
  - Items: only a hand picking it up needs the collider (Touch's triggers). Thrown items never spin, since an item is thrown only after it's picked up, and RegionHost's region checks are only an editor validation. So the collider is on only while the player is near enough to reach it.
  - Strictly terrain: the collider is on only while the player is within about 5 m. That covers the head bumping it (Movement, HeadCollider), grabbing to climb, line of sight (almost always enemy to player: Awareness, SearchPhysics), rain cover, dropped loot falling onto it, and thrown or pulsed objects finding it. Mobile harvesters checking the ground (Mobility, Spatial) either ignore spun terrain and pass through (it's very unlikely they'd meet it), or look for spinners near them and ask them to turn their clients' collision on.
  - Anything else: warn that it doesn't know how to make it cheaper.
  - What spins today (Claude, 2026-10-29; colliders that turn with it): Daisy's and SawBladeAlone's saw blade (SawBladeLods: a convex mesh on the Terrain layer, though it's a harvester's saw, so "strictly terrain" can't go by layer alone), Major's Spinner (a convex mesh shell, Harvester layer), Mine's Radar (a box and a convex mesh, Harvester layer), PoisonBubble's Model (a sphere, TerrainBonk), Mcguffin's Model (a box, Item), Cairn's WildPortalPiece (a non-convex mesh, Terrain; its spinner is off). Mite's and Flamer's spun parts and Blade's have no colliders, so they already cost nothing. The ring loci weren't resolved.
  - First, profile 30 spinners with spin on and off on a headset build, to confirm the cost is physics (Physics.Processing).
  - Mine is deprecated: leave it. Major uses the 5 m rule. (Ken, 2026-10-29)
  - Ken saw spinners slow long before IcMass or IcVelocity existed, so neither is the cause.
- [ ] Possibly: IcVelocity always assures a kinematic Rigidbody (Ken, 2026-10-29). Setting an Interactable's velocity on something without a physics-driven Rigidbody adds an IcVelocity, which moves the transform each physics step; with colliders and no Rigidbody, that moves static colliders, the same cost as the spinners. IcVelocity could call AssureRigidbody() when it starts. Ken resisted this once, for a reason he can't recall: find it before doing it (CodeMovesMe's warning that turning a Rigidbody kinematic forces OnTriggerExit, so the touch stack loses the object, may be it).
- [ ] Chunk loads fire their triggers in quadratic time (Claude, 2026-10-29). `EffectCacheKeyed.FireTriggersAppearingInChunk` (`EffectCache.cs`) gathers the chunk's triggers into a list, checking `list.Contains(trigger)` for each, so it costs the square of the trigger count. Use a HashSet (pooled, like the list) for the check. Profile a biome load first to see how much it costs.
- [ ] Later: conditions evaluated once per flag change, not once per trigger (Ken, 2026-10-29). Many triggers share a condition (61 Kelp in the Oak all test `Underwater`): cache each condition text's result until the next flag change, except conditions using `this`, `limb` or `myStage`, which depend on the object. Each text already has one compiled program (`MathEval.Compile`, 2026-10-29), the natural place for the cached result.
- [ ] Run Canopy/Validate MathEval once Unity is back (Claude, 2026-10-29): MathEval's operator fixes and compiled conditions (`MathEval.cs`, `Expression.cs`) haven't been compiled yet; it checks every condition in the open scenes both ways.
- [ ] Saw blades: split the visual from the collider, so only the visual spins (Ken, 2026-10-29). The blades (SawBladeLods, in Daisy and SawBladeAlone) are disks: spinning one about its axis never changes its collision shape, but Unity doesn't know that and moves the collider every frame. Give the collider its own object that stays still, and let the Spinner turn only the renderers' object.
