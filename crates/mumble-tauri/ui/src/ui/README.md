# React UI designs

The application hosts complete, independently designed React interfaces that
ship **side by side** as UI packs. Each pack is a named style, not a stage in a
migration:

- `standard` is the mature, feature-complete design and the default. It has the
  broadest feature coverage and the most testing.
- `aurora` is an opt-in **design beta** - a distinct visual style offered
  alongside `standard`. It is not a replacement for `standard`.
- `nebula` is a second opt-in **design beta**, built on MUI 9 and styled to the
  "Fancy Mumble 2026" mock. See `nebula/ARCHITECTURE.md`.

All three are offered in Settings › Personalization as "Interface design".

UI packs share the existing TypeScript model, stores, backend bindings, types,
and feature behavior. A pack owns layout, navigation, visual components, and
pack-specific transient state. Color themes are independent of UI packs and are
expected to work with every design.

Use `?ui=standard`, `?ui=aurora` or `?ui=nebula` to override the persisted
selection for local development and E2E runs. Add packs only through
`registry.ts` so they remain lazy-loaded and type checked.

Packs are peers, but `aurora` and `nebula` both reuse `standard` pages (popout
windows, the updater) and some of its leaf widgets. That dependency is
one-directional: a beta pack may import from `standard`, and never the reverse.
Betas must not import from each other either - adding or changing one pack must
not require touching another.
