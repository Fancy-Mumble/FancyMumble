# Frontend source boundaries

- `core/` contains UI-independent types, stores, persistence, backend/event
  integration, feature models, and reusable utilities. It must not import an
  implementation from `ui/`.
- `ui/standard/` contains the mature, feature-complete React UI (the default
  design), including its routes, components, hooks, CSS, themes, assets, and
  appearance bootstrap.
- `ui/aurora/` is the independent entry point for the Aurora design (an opt-in
  design beta), shipped side by side with `standard`. It may use `core/` and
  may reuse `standard/` pages as a compatibility base, but `standard` must
  never depend on `aurora`.
- `ui/` owns UI selection and lazy loading only.
- `main.tsx` is the design-neutral browser/Tauri bootstrap.

Use `@core/*`, `@standard/*`, `@aurora/*`, and `@ui/*` for cross-boundary imports.
Relative imports are preferred within a boundary.
