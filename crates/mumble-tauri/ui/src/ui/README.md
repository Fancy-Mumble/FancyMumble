# React UI designs

The application hosts complete, independently designed React interfaces that
ship **side by side** as UI packs. Each pack is a named style, not a stage in a
migration:

- `standard` is the mature, feature-complete design and the default. It has the
  broadest feature coverage and the most testing.
- `aurora` is an opt-in **design beta** — a distinct visual style offered
  alongside `standard`, surfaced in Settings › Advanced as "Aurora design
  (beta)". It is not a replacement for `standard`.

UI packs share the existing TypeScript model, stores, backend bindings, types,
and feature behavior. A pack owns layout, navigation, visual components, and
pack-specific transient state. Color themes are independent of UI packs and are
expected to work with every design.

Use `?ui=standard` or `?ui=aurora` to override the persisted selection for local
development and E2E runs. Add packs only through `registry.ts` so they remain
lazy-loaded and type checked.

Packs are peers, but `aurora` currently reuses several `standard` pages (popout
windows, the updater) as a compatibility base. That dependency is one-directional:
`aurora` may import from `standard`; never import private `aurora` components into
`standard`.
