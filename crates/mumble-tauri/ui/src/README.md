# Frontend source boundaries

- `core/` contains UI-independent types, stores, persistence, backend/event
  integration, feature models, and reusable utilities. It must not import an
  implementation from `ui/`.
- `ui/standard/` contains the older, most feature-complete React UI,
  including its routes, components, hooks, CSS, themes, assets, and appearance
  bootstrap. It also owns the pack-agnostic auxiliary windows (the updater,
  popouts, the drawing overlay) that the other packs reuse.
- `ui/nebula/` is the independent entry point for the Nebula design, the pack
  a profile with no stored choice starts in. It may use `core/` and may reuse
  `standard/` pages as a compatibility base, but `standard` must never depend
  on `nebula`.
- `ui/aurora/` is the independent entry point for the Aurora design (a design
  beta), shipped side by side with `standard`. It may use `core/` and
  may reuse `standard/` pages as a compatibility base, but `standard` must
  never depend on `aurora`.
- `ui/` owns UI selection and lazy loading only.
- `main.tsx` is the design-neutral browser/Tauri bootstrap.

Use `@core/*`, `@standard/*`, `@nebula/*`, `@aurora/*`, and `@ui/*` for
cross-boundary imports.
Relative imports are preferred within a boundary.
