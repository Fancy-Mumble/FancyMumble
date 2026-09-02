import { useState } from "react";
import { Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
// Selection needs the families registered: registration is a module-load side
// effect of the two family modules, so import them explicitly rather than
// relying on some chat component having loaded them first.
import "@standard/components/chat/stream/useScreenShare";
import "@standard/components/chat/stream/nativeStreamView";
import {
  getStreamViewerStrategyPreference,
  selectableStreamViewerStrategyIds,
  setStreamViewerStrategyPreference,
  STRATEGY_AUTO,
  StreamViewerStrategyId,
  type StreamViewerStrategyPreference,
} from "@standard/components/chat/stream/viewerStrategy";
import { Stack } from "../primitives";
import { ChoiceCards, GroupTitle } from "./controls";

/** Whether this platform and build offer more than one viewer family. */
const backendSelectable = selectableStreamViewerStrategyIds().length >= 2;

/** The choices in display order, with their i18n key stems. */
const OPTIONS = [
  { id: STRATEGY_AUTO, key: "Auto" },
  { id: StreamViewerStrategyId.Webview, key: "Webview" },
  { id: StreamViewerStrategyId.Native, key: "Native" },
] as const satisfies readonly { id: StreamViewerStrategyPreference; key: string }[];

/**
 * Which viewer family receives screen shares - "auto", the webview's own
 * WebRTC, or the native Rust peer.
 *
 * Rendered only where the choice exists (two or more families - i.e. Windows,
 * where WebView2 has WebRTC and the Rust backend is compiled). On Linux the
 * native family is the only one that works, so the section hides itself rather
 * than offering a switch with one position.
 *
 * The preference is persisted by the strategy layer itself, in localStorage,
 * because it is read synchronously at the strategy latch - before the async
 * preferences store has answered. Unlike Standard's copy this registers nothing
 * with the settings search: Nebula indexes its pages from a data module, since
 * a page that has never been opened has never run its own module scope.
 */
export function StreamViewerBackendSetting() {
  const [preference, setPreference] = useState<StreamViewerStrategyPreference>(
    getStreamViewerStrategyPreference,
  );
  // The active strategy is latched at first stream use, so a change only
  // reliably applies on the next load - say so once the switch is dirty.
  const [changed, setChanged] = useState(false);
  const { t } = useTranslation("settings");
  const tStr = t as (key: string) => string;

  if (!backendSelectable) return null;

  const handleChange = (next: StreamViewerStrategyPreference) => {
    setStreamViewerStrategyPreference(next);
    setPreference(next);
    setChanged(true);
  };

  return (
    <>
      <GroupTitle hint={t("advanced.streamBackendHint")}>{t("advanced.streamBackend")}</GroupTitle>
      <ChoiceCards
        ariaLabel={t("advanced.streamBackend")}
        value={preference}
        onChange={handleChange}
        options={OPTIONS.map(({ id, key }) => ({
          id,
          label: tStr(`advanced.streamBackend${key}`),
          hint: tStr(`advanced.streamBackend${key}Desc`),
        }))}
      />
      {changed && (
        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "12px" }}>
          <Typography sx={(theme) => ({ flex: 1, fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("advanced.streamBackendReloadHint")}
          </Typography>
          <Button size="small" sx={{ flex: "none" }} onClick={() => globalThis.location.reload()}>
            {t("advanced.streamBackendReloadBtn")}
          </Button>
        </Stack>
      )}
    </>
  );
}
