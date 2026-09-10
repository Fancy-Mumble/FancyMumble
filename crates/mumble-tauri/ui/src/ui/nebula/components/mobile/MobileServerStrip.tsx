/**
 * Every server, along the top instead of down the side.
 *
 * The window stands these tiles in a 56px column because a window has a spare
 * column to give. A phone does not, so the same list lies on its side above
 * the channels - which is also where the artboard puts it, with the server you
 * are on pulled out in front and the rest scrolling behind a fade.
 *
 * It takes the rail's own bundle: same entries, same artwork, same handlers.
 * Two lists of the same servers that could disagree would be a bug waiting for
 * somebody to add a server on a phone.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { PlusIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { handheldChrome } from "../../theme";
import { radius } from "../../tokens";
import type { ServerStripModel } from "../../shellModel";
import { ScrollProgress, useStencil } from "./mobileMarks";

/** Two letters, which is what fits a tile at this size. */
function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  return (words[0][0] + words[1][0]).toLocaleUpperCase();
}

function Tile({
  entry,
  icon,
  active,
  onSelect,
}: Readonly<{
  entry: ServerRailEntry;
  icon: string | undefined;
  active: boolean;
  onSelect: () => void;
}>) {
  const stencil = useStencil();
  const tint = serverTint(entry.group.key);
  return (
    <Box sx={{ position: "relative", display: "grid", placeItems: "center", flex: "none" }}>
      <Box
        component="button"
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        aria-label={entry.group.label}
        data-testid="nebula-mobile-server-tile"
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          width: 46,
          height: 46,
          display: "grid",
          placeItems: "center",
          fontSize: 15,
          fontWeight: 700,
          color: active ? theme.palette.nebula.railText : theme.palette.nebula.railDim,
          background: active
            ? "linear-gradient(150deg," + tint.from + "," + tint.to + ")"
            : theme.palette.nebula.railTile,
          border:
            "var(--nebula-line-width, 1px) solid " +
            (active ? theme.palette.nebula.accentOnRail : theme.palette.nebula.railLine),
          borderRadius: radius("rail"),
          ...(icon
            ? {
                backgroundImage: "url(" + icon + ")",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : {}),
        })}
      >
        {icon ? "" : initials(entry.group.label)}
      </Box>
      {/* Which server you are on, said the way the channel list says which
          channel you are in - so the two selections read as one idea. */}
      {active && (
        <Box
          aria-hidden
          data-nebula-mark={stencil ? "underbar" : undefined}
          sx={(theme) => ({
            position: "absolute",
            bottom: -8,
            width: 30,
            height: 4,
            background: theme.palette.nebula.accentOnRail,
            clipPath: "var(--nebula-clip-selection, none)",
            borderRadius: "var(--nebula-radius-pill, 999px)",
          })}
        />
      )}
      {entry.unread > 0 && (
        <Box
          sx={(theme) => ({
            position: "absolute",
            right: -6,
            top: -6,
            minWidth: 20,
            height: 20,
            px: "5px",
            display: "grid",
            placeItems: "center",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            color: theme.palette.nebula.onAccent,
            background: theme.palette.nebula.bad,
            border: "2px solid " + theme.palette.nebula.rail,
            borderRadius: "var(--nebula-radius-pill, 999px)",
          })}
        >
          {entry.unread > 99 ? "99+" : entry.unread}
        </Box>
      )}
    </Box>
  );
}

export function MobileServerStrip({ model }: Readonly<{ model: ServerStripModel }>) {
  const { t } = useTranslation("nebulaCommon");
  const stencil = useStencil();
  const track = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(1);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const room = el.scrollWidth - el.clientWidth;
    // A strip that fits is "all of it", not "none of it".
    setProgress(room <= 0 ? 1 : el.scrollLeft / room);
  }, []);

  const active = model.entries.find((entry) => entry.group.key === model.activeKey);
  const rest = model.entries.filter((entry) => entry.group.key !== model.activeKey);

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.75}
      data-testid="nebula-mobile-server-strip"
      sx={(theme) => ({
        flex: "none",
        height: handheldChrome(theme).stripHeight,
        px: "14px",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(180deg," +
          theme.palette.nebula.rail +
          "," +
          theme.palette.nebula.railEdge +
          ")",
      })}
    >
      {stencil && (
        <Box
          aria-hidden
          data-nebula-mark="hazard"
          sx={(theme) => ({
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 5,
            background:
              "repeating-linear-gradient(115deg," +
              theme.palette.nebula.accent2 +
              " 0 8px,transparent 8px 16px)",
          })}
        />
      )}
      {active && (
        <>
          <Tile
            entry={active}
            icon={model.icons?.get(active.group.key)}
            active
            onSelect={() => model.onSelect(active)}
          />
          {/* The one you are on, and then everything else. */}
          <Box
            aria-hidden
            sx={(theme) => ({
              flex: "none",
              width: 2,
              height: 44,
              background: theme.palette.nebula.railLine,
            })}
          />
        </>
      )}
      <Box
        ref={track}
        onScroll={measure}
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: "14px",
          height: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          // Scrolled with a finger; a scrollbar under it would eat a third of
          // the tile height it sits below.
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {rest.map((entry) => (
          <Tile
            key={entry.group.key}
            entry={entry}
            icon={model.icons?.get(entry.group.key)}
            active={false}
            onSelect={() => model.onSelect(entry)}
          />
        ))}
        <Box
          component="button"
          type="button"
          onClick={model.onAddServer}
          aria-label={t("app.addServer")}
          data-testid="nebula-mobile-add-server"
          sx={(theme) => ({
            all: "unset",
            boxSizing: "border-box",
            cursor: "pointer",
            flex: "none",
            width: 42,
            height: 42,
            display: "grid",
            placeItems: "center",
            color: theme.palette.nebula.railDim,
            border: "var(--nebula-line-width, 1px) dashed " + theme.palette.nebula.railLine,
            borderRadius: radius("rail"),
          })}
        >
          <PlusIcon width={18} height={18} />
        </Box>
      </Box>
      {/* There is more of this row than fits, and no scrollbar to say so. */}
      <Box
        aria-hidden
        sx={(theme) => ({
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 34,
          pointerEvents: "none",
          background: "linear-gradient(90deg,transparent," + theme.palette.nebula.railEdge + ")",
        })}
      />
      <ScrollProgress value={progress} />
    </Stack>
  );
}
