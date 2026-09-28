import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { SlashCommandEntry } from "@core/plugins/tier1/manifest";
import { NEBULA_MONO, radius } from "../../tokens";
import { PopupSurface, PopupEmpty, POPUP_ROW } from "./popupSurface";

interface Props {
  readonly entries: readonly SlashCommandEntry[];
  readonly activeIndex: number;
  readonly onPick: (entry: SlashCommandEntry) => void;
  readonly onActiveIndexChange: (next: number) => void;
}

/** `/command <required> [optional]`, as the plugin declared it. */
function formatSyntax(entry: SlashCommandEntry): string {
  const parts = (entry.command.options ?? []).map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  const args = parts.length > 0 ? ` ${parts.join(" ")}` : "";
  return `/${entry.command.name}${args}`;
}

/**
 * The list `/` opens over the composer.
 *
 * The plugin's name rides on every row rather than grouping the list by plugin:
 * the question being answered is "which command", and two plugins that both
 * offer `/roll` are told apart by the tag, not by a heading a fast typist never
 * reads. `handleSlashKey` stays in Standard - the keys are the same contract.
 */
export default function SlashCommandMenu({ entries, activeIndex, onPick, onActiveIndexChange }: Props) {
  const { t } = useTranslation("chat");

  if (entries.length === 0) {
    return (
      <PopupSurface>
        <PopupEmpty>{t("slashCommandMenu.noMatches")}</PopupEmpty>
      </PopupSurface>
    );
  }

  return (
    <PopupSurface>
      <Box sx={{ p: "4px", overflowY: "auto" }}>
        {entries.map((entry, i) => {
          const active = i === activeIndex;
          return (
            <Box
              key={`${entry.pluginName}:${entry.command.name}`}
              component="button"
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => onActiveIndexChange(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(entry);
              }}
              sx={(theme) => ({
                ...POPUP_ROW,
                textAlign: "left",
                color: theme.palette.nebula.text,
                background: active ? theme.palette.nebula.accentSoft : "transparent",
                "&:hover": { background: active ? undefined : theme.palette.nebula.hover },
              })}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  noWrap
                  sx={{ fontFamily: NEBULA_MONO, fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}
                >
                  {formatSyntax(entry)}
                </Typography>
                {entry.command.description && (
                  <Typography noWrap sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>
                    {entry.command.description}
                  </Typography>
                )}
              </Box>
              <Typography
                sx={(theme) => ({
                  flex: "none",
                  px: "5px",
                  py: "1px",
                  borderRadius: radius("sm"),
                  fontFamily: NEBULA_MONO,
                  fontSize: 10,
                  color: theme.palette.nebula.dim,
                  background: theme.palette.nebula.card2,
                })}
              >
                {entry.pluginName}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </PopupSurface>
  );
}
