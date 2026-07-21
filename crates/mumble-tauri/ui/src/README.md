# Frontend source boundaries

- `core/` contains UI-independent types, stores, persistence, backend/event
  integration, feature models, and reusable utilities. It must not import an
  implementation from `ui/`.
- `ui/legacy/` contains the complete existing React UI, including its routes,
  components, hooks, CSS, themes, assets, and appearance bootstrap.
- `ui/new/` is the independent entry point for the redesigned React UI. It may
  use `core/`, but must not add new dependencies on legacy implementation
  details. Its current legacy import is a temporary compatibility fallback.
- `ui/` owns UI selection and lazy loading only.
- `main.tsx` is the design-neutral browser/Tauri bootstrap.

Use `@core/*`, `@legacy/*`, `@new/*`, and `@ui/*` for cross-boundary imports.
Relative imports are preferred within a boundary.
