import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { SearchBox, Stack } from "../primitives";
import { radius } from "../../tokens";
import type { SettingsPageId } from "./SettingsNav";
import { searchSettings, type SettingsSearchEntry } from "./settingsSearchIndex";

/** What a chosen result asks the screen to do: open a page, flash a heading. */
export interface SettingsSearchTarget {
  page: SettingsPageId;
  /** What was typed, which is the first thing worth flashing. */
  term: string;
  /** The headings that matched, for a query that is a synonym rather than text. */
  titles: readonly string[];
}

/**
 * Finding a setting by name, from the settings sidebar.
 *
 * Twenty-six pages sit behind this one nav - twelve settings and, for an
 * administrator, fourteen more - which is well past the point where reading
 * the list is faster than remembering which page a thing was on. The results
 * name the page and how much of it matched rather than listing each hit: the
 * page is where you are going, and a list of eight rows that all say "Voice"
 * is a longer way of saying the same thing.
 *
 * Administration pages are deliberately not indexed. Their nav labels are
 * their contents - "Bans", "Emotes" - so the sidebar already answers the
 * question a search of them would.
 */
export function SettingsSearch({
  pages,
  onSelect,
}: Readonly<{
  pages: readonly { id: SettingsPageId; label: string }[];
  onSelect: (target: SettingsSearchTarget) => void;
}>) {
  const { t } = useTranslation(["settings", "nebulaSettings"]);
  const [query, setQuery] = useState("");

  const results = useMemo(
    () =>
      searchSettings(query, pages, (entry: SettingsSearchEntry) =>
        entry.titleKey ? t(entry.titleKey as "tabs.plugins", { defaultValue: entry.title }) : entry.title,
      ),
    [query, pages, t],
  );

  const choose = (page: SettingsPageId, titles: readonly string[]) => {
    onSelect({ page, term: query.trim(), titles });
    setQuery("");
  };

  return (
    <Box>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={t("nebulaSettings:search.placeholder")}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results.length > 0) choose(results[0].page, results[0].titles);
          else if (event.key === "Escape") setQuery("");
        }}
      />

      {query.trim().length > 0 && (
        <Stack gap="1px" sx={{ mt: "8px" }}>
          {results.length === 0 ? (
            <Typography
              sx={(theme) => ({ px: "12px", py: "8px", fontSize: 11.5, color: theme.palette.nebula.dim })}
            >
              {t("nebulaSettings:search.empty")}
            </Typography>
          ) : (
            results.map((result) => (
              <Box
                key={result.page}
                component="button"
                onClick={() => choose(result.page, result.titles)}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                  px: "12px",
                  py: "7px",
                  borderRadius: radius("md"),
                  fontSize: 12.5,
                  color: theme.palette.nebula.text,
                  "&:hover": { background: theme.palette.nebula.hover },
                })}
              >
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  {result.label}
                </Box>
                <Box
                  component="span"
                  sx={(theme) => ({ flex: "none", fontSize: 11, color: theme.palette.nebula.muted })}
                >
                  {result.count}
                </Box>
              </Box>
            ))
          )}
        </Stack>
      )}
    </Box>
  );
}
