# React UI designs

The application hosts complete, independently designed React interfaces that
ship **side by side** as UI packs. Each pack is a named style, not a stage in a
migration:

- `nebula` is **the default**: the design a profile with no stored choice
  opens in. Built on MUI 9 and styled to the "Fancy Mumble 2026" mock. See
  `nebula/ARCHITECTURE.md`.
- `standard` is the older design. It still has the broadest feature coverage
  and the most testing, and remains selectable; every profile that already
  chose it keeps it, because a stored preference beats the default.
- `aurora` is **deprecated** and is to be deleted before the next release. It
  is still selectable, and still listed in the picker, so that a profile
  already on it is told to move rather than finding its interface gone. Treat
  it as read-only: fix things in `standard` or `nebula`.

All three are offered in Settings › Personalization as "Interface design",
Aurora marked as deprecated.

Aurora never adopted i18n - 131 components, not one `t()` call - so selecting
it silently makes the client English-only no matter what language the user has
chosen. That is not being fixed; the pack is being removed.

UI packs share the existing TypeScript model, stores, backend bindings, types,
and feature behavior. A pack owns layout, navigation, visual components, and
pack-specific transient state. Color themes are independent of UI packs and are
expected to work with every design.

Use `?ui=standard`, `?ui=aurora` or `?ui=nebula` to override the persisted
selection for local development and E2E runs. Add packs only through
`registry.ts` so they remain lazy-loaded and type checked.

Packs are peers, but `aurora` and `nebula` both reuse `standard` pages (popout
windows, the updater) and some of its leaf widgets. That dependency is
one-directional: another pack may import from `standard`, and never the
reverse - being the default does not license `nebula` to be imported from
`standard`. Nor may `aurora` and `nebula` import from each other: adding or
changing one pack must not require touching another. That last rule is what
makes deleting Aurora a deletion rather than a refactor - nothing outside it
imports it except `registry.ts`.
