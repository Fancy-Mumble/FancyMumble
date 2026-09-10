/**
 * The three places a phone can be.
 *
 * Not new state: each tab is one of the `Screen` values the pack has always
 * had, so a tap here is the same `openScreen` a desktop user reaches from the
 * rail and the title bar. The connect screen is deliberately absent - it is
 * where the app sends you when there is no session, not somewhere you go.
 */
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { GlobeIcon, HashIcon, SettingsIcon, UsersGroupIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { glassChrome, handheldChrome } from "../../theme";
import { useStencil } from "./mobileMarks";

export type MobileTab = "chats" | "people" | "settings";

interface MobileTabBarProps {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  /** Unread conversations, on the tab that leads to them. */
  chatsBadge?: number;
  peopleBadge?: number;
  /**
   * Whether the first tab is a list of servers rather than of channels.
   *
   * Before a session there are no channels to list, so the tab that leads
   * there says what it actually leads to - which is what the artboard's start
   * screen labels it.
   */
  servers?: boolean;
}

const ICONS = { chats: HashIcon, people: UsersGroupIcon, settings: SettingsIcon } as const;
const SERVER_ICONS = { ...ICONS, chats: GlobeIcon } as const;

export function MobileTabBar({
  active,
  onSelect,
  chatsBadge = 0,
  peopleBadge = 0,
  servers = false,
}: Readonly<MobileTabBarProps>) {
  const { t } = useTranslation(["sidebar", "common", "nebulaCommon", "server"]);
  const stencil = useStencil();
  const icons = servers ? SERVER_ICONS : ICONS;
  const labels: Record<MobileTab, string> = {
    chats: servers ? t("nebulaCommon:app.servers") : t("sidebar:sidebarTabs.channels"),
    // Before a session there is no roster to be a member of; what that tab
    // leads to is the friends list, which is what it says it is.
    people: servers ? t("server:tabsBar.friends") : t("sidebar:sidebarTabs.members"),
    settings: t("common:minimal.settings"),
  };
  const badges: Record<MobileTab, number> = { chats: chatsBadge, people: peopleBadge, settings: 0 };

  return (
    <Stack
      component="nav"
      direction="row"
      data-testid="nebula-mobile-tabbar"
      aria-label={t("nebulaCommon:app.sections")}
      sx={(theme) => ({
        flex: "none",
        // The bar's own height, plus whatever the gesture bar is taking. The
        // padding is inside the band so the ink stays where it was drawn and
        // only the ground grows.
        height: `calc(${handheldChrome(theme).tabBarHeight}px + env(safe-area-inset-bottom, 0px))`,
        pb: "env(safe-area-inset-bottom, 0px)",
        borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        ...glassChrome(theme),
      })}
    >
      {(Object.keys(icons) as MobileTab[]).map((tab) => {
        const Icon = icons[tab];
        const on = tab === active;
        const badge = badges[tab];
        return (
          <Box
            key={tab}
            component="button"
            type="button"
            data-testid={`nebula-mobile-tab-${tab}`}
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(tab)}
            sx={(theme) => ({
              all: "unset",
              boxSizing: "border-box",
              cursor: "pointer",
              flex: 1,
              minWidth: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              color: on ? theme.palette.nebula.accent : theme.palette.nebula.dim,
            })}
          >
            <Box sx={{ position: "relative", display: "flex", opacity: on ? 1 : 0.7 }}>
              <Icon width={19} height={19} />
              {badge > 0 && (
                <Box
                  sx={(theme) => ({
                    position: "absolute",
                    right: -11,
                    top: -5,
                    minWidth: 18,
                    height: 18,
                    px: "5px",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: theme.palette.nebula.onAccent,
                    background: theme.palette.nebula.bad,
                    borderRadius: "var(--nebula-radius-pill, 999px)",
                  })}
                >
                  {badge > 99 ? "99+" : badge}
                </Box>
              )}
            </Box>
            <Typography
              component="div"
              noWrap
              sx={(theme) => ({
                fontSize: 10,
                fontWeight: on ? 800 : 700,
                letterSpacing: stencil ? ".12em" : theme.palette.nebulaSkin.track,
                textTransform: stencil ? "uppercase" : theme.palette.nebulaSkin.caps,
                maxWidth: "100%",
              })}
            >
              {labels[tab]}
            </Typography>
            {/* Which tab you are on, said a second way: the colour alone is a
                single channel, and on a phone it is the only one there is. */}
            {on && (
              <Box
                data-nebula-mark={stencil ? "underbar" : undefined}
                aria-hidden
                sx={(theme) => ({
                  position: "absolute",
                  bottom: 10,
                  width: 28,
                  height: 3,
                  background: theme.palette.nebula.accent,
                  clipPath: "var(--nebula-clip-selection, none)",
                  borderRadius: "var(--nebula-radius-pill, 999px)",
                })}
              />
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
