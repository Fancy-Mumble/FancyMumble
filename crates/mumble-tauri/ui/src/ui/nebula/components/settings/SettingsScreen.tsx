import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";
import type { SettingsPageId } from "./SettingsNav";

/**
 * One chunk per page.
 *
 * Settings is opened for one thing at a time - a microphone, a language, a
 * shortcut - and the pages have little in common: Voice carries the meter and
 * the calibrator, Profile the card preview and the cropper. Loading twelve to
 * show one is the same mistake the client made with settings as a whole.
 */
const AccountSettings = lazy(() => import("./AccountSettings").then((m) => ({ default: m.AccountSettings })));
const AdvancedSettings = lazy(() =>
  import("./AdvancedSettings").then((m) => ({ default: m.AdvancedSettings })),
);
const ChannelsRolesSettings = lazy(() =>
  import("./ChannelsRolesSettings").then((m) => ({ default: m.ChannelsRolesSettings })),
);
const IdentitiesSettings = lazy(() =>
  import("./IdentitiesSettings").then((m) => ({ default: m.IdentitiesSettings })),
);
const LocalizationSettings = lazy(() =>
  import("./LocalizationSettings").then((m) => ({ default: m.LocalizationSettings })),
);
const NotificationsSettings = lazy(() =>
  import("./NotificationsSettings").then((m) => ({ default: m.NotificationsSettings })),
);
const PersonalizeSettings = lazy(() =>
  import("./PersonalizeSettings").then((m) => ({ default: m.PersonalizeSettings })),
);
const PrivacySettings = lazy(() => import("./PrivacySettings").then((m) => ({ default: m.PrivacySettings })));
const OverlaySettings = lazy(() => import("./OverlaySettings").then((m) => ({ default: m.OverlaySettings })));
const PluginsSettings = lazy(() => import("./PluginsSettings").then((m) => ({ default: m.PluginsSettings })));
const ProfileSettings = lazy(() => import("./ProfileSettings").then((m) => ({ default: m.ProfileSettings })));
const ShortcutsSettings = lazy(() =>
  import("./ShortcutsSettings").then((m) => ({ default: m.ShortcutsSettings })),
);
const VoiceSettings = lazy(() => import("./VoiceSettings").then((m) => ({ default: m.VoiceSettings })));

/** How long a heading stays lit after the search sent you to it. */
const FLASH_MS = 2200;

/**
 * How long to keep looking for the heading before giving up.
 *
 * The page arriving is two waits, not one: its chunk has to load, and then the
 * page itself has to hear back from the store or the backend - Voice renders
 * nothing at all until the engine answers. So the anchors are looked for once
 * a frame rather than once, and the deadline is generous enough to cover a
 * cold chunk on a slow disk.
 */
const FLASH_DEADLINE_MS = 4000;

/** What the search asks for: a page, and the heading it was aiming at. */
export interface SettingsHighlight {
  /** The query as typed - the first thing worth looking for on the page. */
  term: string;
  /**
   * The headings the query matched.
   *
   * The fallback for a query that is a synonym: "ptt" matches the shortcuts
   * group through its keywords and appears nowhere on the page, so the flash
   * would otherwise land on nothing.
   */
  titles: readonly string[];
  /** Bumped per selection, so choosing the same result twice flashes twice. */
  nonce: number;
}

/** The headings under `root` whose text contains `term`. */
function anchorsMatching(root: HTMLElement, term: string): HTMLElement[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  return [...root.querySelectorAll<HTMLElement>("[data-settings-anchor]")].filter((element) =>
    (element.dataset.settingsAnchor ?? "").toLowerCase().includes(needle),
  );
}

/**
 * What to light up for a chosen result.
 *
 * The typed term first, because it is what the user is looking for and reads
 * as an answer when it lights up. Only where the page says it nowhere - a
 * query that matched on a keyword - do the matched headings stand in, and then
 * all of them, because the count in the result said how many there were.
 */
export function highlightTargets(root: HTMLElement, highlight: SettingsHighlight): HTMLElement[] {
  const typed = anchorsMatching(root, highlight.term);
  if (typed.length > 0) return typed;
  return highlight.titles.flatMap((title) => anchorsMatching(root, title));
}

/**
 * The settings content area. The nav lives in the sidebar, as in the mock.
 *
 * Each page is mounted only while it is showing rather than hidden with CSS,
 * so a page that subscribes to backend events (Account, Voice) is not holding
 * a listener open for a screen nobody is looking at.
 */
export function SettingsScreen({
  page,
  highlight,
  onEditIdentityProfile,
  onNavigate,
}: Readonly<{
  page: SettingsPageId;
  /** A setting chosen from the search, to be scrolled to and lit. */
  highlight?: SettingsHighlight | null;
  /** Jumps to Profile with that identity loaded, from the Identities page. */
  onEditIdentityProfile?: (label: string) => void;
  /** Opens another settings page, for the links a page draws itself. */
  onNavigate?: (page: SettingsPageId) => void;
}>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  /**
   * The identity Identities asked Profile to open on.
   *
   * Held here rather than in Profile because the pages are mounted one at a
   * time: the request is made on the page that is about to unmount, and read
   * on the one that has not mounted yet.
   */
  const [profileIdentity, setProfileIdentity] = useState<string | null>(null);

  // Lighting the heading is what makes a search result an answer rather than
  // just a page: the pages are long, and "it is on Advanced somewhere" is the
  // part the user already knew.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !highlight) return;

    let cancelled = false;
    const started = performance.now();

    const attempt = () => {
      if (cancelled) return;
      const found = highlightTargets(root, highlight);
      if (found.length === 0) {
        if (performance.now() - started < FLASH_DEADLINE_MS) requestAnimationFrame(attempt);
        return;
      }

      found[0].scrollIntoView({ block: "center", behavior: "smooth" });
      for (const element of found) {
        // Animated rather than class-swapped: the flash has to end by itself
        // even if the page unmounts mid-way, and a keyframe on the element is
        // the only version of that with nothing left to clean up.
        element.animate?.(
          [
            {
              background: theme.palette.nebula.accentSoft,
              boxShadow: `0 0 0 6px ${theme.palette.nebula.accentSoft}`,
            },
            { background: "transparent", boxShadow: "0 0 0 6px transparent" },
          ],
          { duration: FLASH_MS, easing: "ease-out" },
        );
      }
    };

    requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
    };
  }, [highlight, page, theme]);

  return (
    <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: "52px", py: "38px" }}>
      <Suspense fallback={null}>
        {page === "profile" && (
          <ProfileSettings
            identity={profileIdentity}
            onManageIdentities={onNavigate && (() => onNavigate("identities"))}
          />
        )}
        {page === "account" && <AccountSettings />}
        {page === "voice" && <VoiceSettings />}
        {page === "personalize" && <PersonalizeSettings />}
        {page === "notifications" && <NotificationsSettings />}
        {page === "privacy" && <PrivacySettings />}
        {page === "overlay" && <OverlaySettings />}
        {page === "localization" && <LocalizationSettings />}
        {page === "shortcuts" && <ShortcutsSettings />}
        {page === "identities" && (
          <IdentitiesSettings
            onEditProfile={
              onEditIdentityProfile &&
              ((label) => {
                setProfileIdentity(label);
                onEditIdentityProfile(label);
              })
            }
          />
        )}
        {page === "channels-roles" && <ChannelsRolesSettings />}
        {page === "plugins" && <PluginsSettings />}
        {page === "advanced" && <AdvancedSettings />}
      </Suspense>
    </Box>
  );
}
