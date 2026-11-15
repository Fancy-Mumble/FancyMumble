/**
 * Build a URL-safe, *unique* slug for a brand-new document.
 *
 * Two documents that share a title - "Untitled" being the one everybody
 * reaches for - must never collapse onto the same server-side document or the
 * same sidebar entry, so the title only seeds the slug and a random suffix
 * decides it. Opening an *existing* document does not come through here: it
 * keeps using its title-derived slug, which is what lets it rehydrate.
 */
export function newDocSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const rand = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${rand}` : `doc-${rand}`;
}
