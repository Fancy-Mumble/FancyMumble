/**
 * Where a phone starts: which server.
 *
 * On a window this is a column of saved addresses beside a connect form, and
 * both are on screen at once. A phone gets the list first and the form after a
 * chevron, so this is the list - with the masthead the artboard puts over it,
 * which is doing real work: it is the only thing on screen before a session
 * exists that says which application you have opened.
 */
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { PlusIcon, UsersGroupIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { SearchBox } from "../primitives/SearchBox";
import { chamferedSurface } from "../../theme";
import { radius } from "../../tokens";
import type { MobileServerRow, MobileServersModel } from "../../shellModel";
import { DisplayText, useStencil } from "./mobileMarks";

/** The masthead's ground: the rail running into the accent, as the artboard. */
function Masthead({
  brand,
  onOpenFriends,
}: Readonly<{ brand: string; onOpenFriends: () => void }>) {
  const { t } = useTranslation(["nebulaCommon", "sidebar", "server"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  return (
    <Box
      data-testid="nebula-mobile-masthead"
      sx={{
        position: "relative",
        flex: "none",
        overflow: "hidden",
        px: "16px",
        pt: "16px",
        pb: "18px",
        background: `linear-gradient(150deg,${nebula.rail},${nebula.accent})`,
        color: nebula.railText,
      }}
    >
      {stencil && (
        <>
          <Box
            aria-hidden
            data-nebula-mark="hatch"
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 12px,transparent 12px 26px)",
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              top: -110,
              right: -80,
              width: 260,
              height: 260,
              borderRadius: "50%",
              border: `3px solid ${nebula.railLine}`,
            }}
          />
          <Box
            aria-hidden
            data-nebula-mark="hazard"
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 7,
              background: `repeating-linear-gradient(115deg,${nebula.accent2} 0 10px,transparent 10px 20px)`,
            }}
          />
        </>
      )}

      <Stack direction="row" alignItems="center" gap={1.25} sx={{ position: "relative" }}>
        {stencil ? (
          <Box
            sx={{
              transform: "skewX(-12deg)",
              background: nebula.card,
              px: "14px",
              py: "6px",
              boxShadow: "3px 3px 0 rgba(0,0,0,.22)",
            }}
          >
            <Box
              sx={(theme) => ({
                transform: "skewX(12deg)",
                fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
                fontStyle: "italic",
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                color: nebula.accent,
              })}
            >
              {brand}
            </Box>
          </Box>
        ) : (
          <DisplayText size={17} colour={nebula.railText}>
            {brand}
          </DisplayText>
        )}
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          type="button"
          onClick={onOpenFriends}
          aria-label={t("sidebar:sidebarTabs.members")}
          data-testid="nebula-mobile-masthead-friends"
          sx={{
            all: "unset",
            cursor: "pointer",
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            color: nebula.railText,
            background: nebula.railTile,
            border: `var(--nebula-line-width, 1px) solid ${nebula.railLine}`,
            borderRadius: radius("md"),
          }}
        >
          <UsersGroupIcon width={17} height={17} />
        </Box>
      </Stack>

      <Stack direction="row" alignItems="baseline" gap={1.125} sx={{ position: "relative", mt: "12px" }}>
        <DisplayText size={26} colour={nebula.railText}>
          {t("nebulaCommon:app.connect")}
        </DisplayText>
        <Box
          sx={(theme) => ({
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: theme.palette.nebulaSkin.chrome === "stencil" ? nebula.accent2 : nebula.railDim,
          })}
        >
          {t("nebulaCommon:app.pickAServer")}
        </Box>
      </Stack>
    </Box>
  );
}

function ServerRow({
  row,
  active,
  onOpen,
  onMenu,
}: Readonly<{
  row: MobileServerRow;
  active: boolean;
  onOpen: () => void;
  onMenu?: (event: MouseEvent) => void;
}>) {
  const nebula = useTheme().palette.nebula;
  return (
    <Box sx={{ position: "relative", flex: "none" }}>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        onContextMenu={onMenu}
        data-testid="nebula-mobile-server-row"
        aria-current={active ? "true" : undefined}
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "13px",
          px: "14px",
          py: "12px",
          borderRadius: radius("lg"),
          color: active ? nebula.onAccent : nebula.text,
          ...chamferedSurface(
            theme,
            active ? nebula.accent : nebula.card,
            active ? nebula.accent : nebula.line,
          ),
        })}
      >
        <Box sx={{ position: "relative", flex: "0 0 50px" }}>
          <Box
            sx={{
              width: 50,
              height: 50,
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 16,
              color: "#fff",
              background: `linear-gradient(150deg,${row.tint.from},${row.tint.to})`,
              border: `var(--nebula-line-width, 1px) solid ${active ? nebula.onAccent : nebula.line2}`,
              borderRadius: radius("rail"),
            }}
          >
            {row.initials}
          </Box>
          {row.online && (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                right: -4,
                bottom: -4,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: nebula.ok,
                border: `2px solid ${active ? nebula.accent : nebula.card}`,
              }}
            />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <Stack direction="row" alignItems="center" gap={0.875}>
            <Box
              sx={{
                fontWeight: active ? 900 : 700,
                fontSize: 16,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.label}
            </Box>
            {row.favorite && (
              <Box sx={{ flex: "none", fontSize: 13, color: nebula.accent2 }} aria-hidden>
                ★
              </Box>
            )}
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.875} sx={{ mt: "3px" }}>
            {row.usersLabel && (
              <Box
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  px: "7px",
                  py: "2px",
                  borderRadius: radius("sm"),
                  color: active ? nebula.onAccent : nebula.muted,
                  background: active ? "rgba(255,255,255,.24)" : nebula.card2,
                }}
              >
                {row.usersLabel}
              </Box>
            )}
            <Box
              sx={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: active ? nebula.onAccent : nebula.dim,
                opacity: active ? 0.85 : 1,
              }}
            >
              {row.identitiesLabel}
            </Box>
          </Stack>
        </Box>
        <Box sx={{ flex: "none", fontSize: 22, fontWeight: 300, opacity: 0.75 }} aria-hidden>
          ›
        </Box>
      </Box>
      {/* The tab the skin uses for a selection, in the place the artboard
          hangs it: off the leading edge rather than inside the plate. */}
      {active && (
        <Box
          aria-hidden
          data-nebula-mark="underbar"
          sx={(theme) => ({
            position: "absolute",
            left: -6,
            top: 8,
            bottom: 8,
            width: theme.palette.nebulaSkin.selectionBar ? 5 : 0,
            background: nebula.accent2,
            clipPath: "var(--nebula-clip-selection, none)",
          })}
        />
      )}
    </Box>
  );
}

export function MobileServersPane({
  model,
  brand,
  onMenu,
}: Readonly<{
  model: MobileServersModel;
  brand: string;
  /** A long press on a row: that server's menu, which the shell draws. */
  onMenu?: (key: string, event: MouseEvent) => void;
}>) {
  const { t } = useTranslation(["nebulaCommon", "server"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;

  return (
    <>
      <Masthead brand={brand} onOpenFriends={model.onOpenFriends} />

      <Box
        sx={{
          flex: "none",
          px: "16px",
          pt: "14px",
          pb: "8px",
          background: nebula.panel,
          borderBottom: `var(--nebula-line-width, 1px) solid ${nebula.line}`,
        }}
      >
        <SearchBox
          value={model.search.value}
          onChange={model.search.onChange}
          placeholder={model.search.placeholder}
        />
      </Box>

      <Stack
        gap={1.5}
        data-testid="nebula-mobile-servers"
        sx={{ flex: 1, minHeight: 0, px: "16px", pt: "14px", pb: "12px", overflowY: "auto" }}
      >
        <Stack direction="row" alignItems="center" gap={1.25} sx={{ flex: "none" }}>
          <DisplayText size={12} colour={nebula.muted}>
            {t("nebulaCommon:app.savedServers")}
          </DisplayText>
          <Box
            aria-hidden
            sx={{
              flex: 1,
              height: 2,
              background: stencil
                ? `repeating-linear-gradient(90deg,${nebula.line2} 0 6px,transparent 6px 10px)`
                : nebula.line,
            }}
          />
          <Box sx={{ fontSize: 11, fontWeight: 700, color: nebula.dim }}>
            {String(model.rows.length).padStart(2, "0")}
          </Box>
        </Stack>

        {model.rows.map((row) => (
          <ServerRow
            key={row.key}
            row={row}
            active={row.key === model.activeKey}
            onOpen={() => model.onOpen(row.key)}
            onMenu={onMenu && ((event) => onMenu(row.key, event))}
          />
        ))}

        <Box
          component="button"
          type="button"
          onClick={model.onAddServer}
          data-testid="nebula-mobile-add-server"
          sx={{
            all: "unset",
            boxSizing: "border-box",
            cursor: "pointer",
            flex: "none",
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            color: nebula.accent,
            background: nebula.hover,
            border: `var(--nebula-line-width, 1px) dashed ${nebula.line2}`,
            borderRadius: radius("lg"),
          }}
        >
          <PlusIcon width={17} height={17} />
          <DisplayText size={13} colour={nebula.accent}>
            {t("nebulaCommon:app.addAServer")}
          </DisplayText>
        </Box>

        <Box sx={{ flex: 1 }} />

        {model.lastSession && (
          <Stack
            direction="row"
            alignItems="center"
            gap={1.125}
            sx={{
              flex: "none",
              px: "12px",
              py: "10px",
              background: nebula.card,
              border: `var(--nebula-line-width, 1px) solid ${nebula.line}`,
              borderRadius: radius("md"),
            }}
          >
            <Box aria-hidden sx={{ flex: "none", width: 5, height: 16, background: nebula.accent2 }} />
            <Box
              sx={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: nebula.muted,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {model.lastSession}
            </Box>
          </Stack>
        )}
      </Stack>
    </>
  );
}
