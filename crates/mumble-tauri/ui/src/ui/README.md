# React UI implementations

The application can host complete, independently designed React interfaces.
`legacy` is the existing UI and remains supported; `new` is the incremental
replacement entry point.

UI packs share the existing TypeScript model, stores, backend bindings, types,
and feature behavior. A pack owns layout, navigation, visual components, and
pack-specific transient state. Color themes are independent of UI packs.

Use `?ui=legacy` or `?ui=new` to override the persisted selection for local
development and E2E runs. Add packs only through `registry.ts` so they remain
lazy-loaded and type checked.

The new pack currently renders the legacy app as a compatibility fallback.
Replace that fallback one shell or screen at a time; do not import private new
pack components into the legacy UI.
