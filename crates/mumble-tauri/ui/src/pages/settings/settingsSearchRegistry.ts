/**
 * Self-registration registry for the settings search box.
 *
 * Instead of a central hand-maintained list, each settings panel registers its
 * own settings at module scope via the fluent {@link registerSettings} builder,
 * e.g. (at the top of `NotificationsPanel.tsx`):
 *
 * ```ts
 * registerSettings("notifications")
 *   .add("notifications.sounds", ["sound"])
 *   .add("notifications.native");
 * ```
 *
 * Because every panel is statically imported by the settings page, all of these
 * registrations run as soon as the settings page module loads - before any tab
 * is rendered - so the search can count matches across every tab, including the
 * ones the user hasn't opened yet.  Adding a new setting to a panel therefore
 * only requires adding one `.add(...)` line next to it; nothing else to update.
 */

export interface SettingsSearchEntry {
  /** Tab id the setting lives on (matches the settings page tab ids). */
  readonly tab: string;
  /** i18n key (in the `settings` namespace) of the setting's visible title. */
  readonly titleKey: string;
  /** Extra match-only keywords / synonyms. */
  readonly keywords?: readonly string[];
}

const registry: SettingsSearchEntry[] = [];

/** Fluent builder returned by {@link registerSettings}; chain `.add(...)`. */
class SettingsSearchBuilder {
  constructor(private readonly tab: string) {}

  /** Register one searchable setting by its i18n title key and optional
   *  match-only keywords.  Idempotent per (tab, key) so module re-evaluation
   *  (e.g. HMR) doesn't create duplicates. */
  add(titleKey: string, keywords?: readonly string[]): this {
    if (!registry.some((e) => e.tab === this.tab && e.titleKey === titleKey)) {
      registry.push({ tab: this.tab, titleKey, keywords });
    }
    return this;
  }
}

/** Begin registering searchable settings for `tab`.  Call at module scope. */
export function registerSettings(tab: string): SettingsSearchBuilder {
  return new SettingsSearchBuilder(tab);
}

/** Every registered searchable setting (grows as panel modules load). */
export function getSettingsSearchIndex(): readonly SettingsSearchEntry[] {
  return registry;
}
