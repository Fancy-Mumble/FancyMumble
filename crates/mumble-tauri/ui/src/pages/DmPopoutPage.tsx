/**
 * DmPopoutPage - dedicated route rendered inside a separate webview
 * window spawned by `open_dm_popout`.
 *
 * Internally the popout reuses the same `<ChatView />` component the
 * main window uses, so it inherits all chat features (markdown,
 * attachments, GIFs, polls, reactions, edits, lightbox, ...).  This
 * page is therefore mostly a thin shell that:
 *   1. Reads the popout payload created by the backend
 *      (`take_popout_dm`) to know which user to chat with.
 *   2. Subscribes to backend Tauri events via `initEventListeners` so
 *      the popout's *own* Zustand store stays in sync with state
 *      changes (the main window has its own JS context and store).
 *   3. Bootstraps the popout's store (servers, channels, users,
 *      identity, server config, ...) by calling `switchServer` and a
 *      few extra invokes the main window's `server-connected` handler
 *      would normally do.
 *   4. Selects the target DM user and renders `<ChatView inPopout />`.
 *
 * Limitation: because the backend's "active server" is a process-wide
 * value, switching servers in the popout will also re-target the
 * main window's outgoing messages.  This matches the previous
 * popout's behaviour.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon } from "../icons";
import ChatView from "../components/chat/ChatView";
import { initEventListeners, useAppStore } from "../store";
import type { MumbleServerConfig, ServerInfo } from "../types";
import styles from "./DmPopoutPage.module.css";

interface PopoutDmPayload {
  server_id: string;
  server_label?: string | null;
  user_session: number;
  user_name: string;
  user_hash?: string | null;
}

function popoutIdFromLabel(): string | null {
  try {
    const label = getCurrentWindow().label;
    const prefix = "popout-dm-";
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  } catch {
    /* not running inside a Tauri window (dev mode) */
  }
  return new URLSearchParams(globalThis.location.search).get("popout-dm");
}

export default function DmPopoutPage() {
  const { t } = useTranslation("chat");
  const [payload, setPayload] = useState<PopoutDmPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const initRef = useRef(false);

  // Translations are only used inside render below; reading them via a
  // ref keeps the bootstrap effect free of `t` as a dependency, which
  // matters because `t`'s identity can change (e.g. on language switch)
  // and `take_popout_dm` is a one-shot consumer - if the effect re-ran
  // it would always get `null` back and report "unavailable".
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    // React 19 StrictMode mounts effects twice in dev (mount -> cleanup
    // -> mount).  Guard with a ref so we *only* bootstrap once and let
    // the in-flight bootstrap finish even after the first cleanup runs.
    // The cleanup just unsubscribes event listeners we already created.
    if (initRef.current) return;
    initRef.current = true;

    const unlistenersBox: { current: UnlistenFn[] } = { current: [] };

    const bootstrap = async () => {
      const id = popoutIdFromLabel();
      if (!id) {
        setError(tRef.current("dmPopout.missingId"));
        return;
      }
      let p: PopoutDmPayload | null;
      try {
        p = await invoke<PopoutDmPayload | null>("take_popout_dm", { id });
      } catch (e) {
        setError(String(e));
        return;
      }
      if (!p) {
        setError(tRef.current("dmPopout.unavailable"));
        return;
      }
      setPayload(p);

      // Subscribe this webview's JS context to all backend events so
      // the popout's local Zustand store stays in sync.  We pass a
      // no-op navigate because the popout window has no router-driven
      // navigation - it stays on this page for its entire lifetime.
      try {
        unlistenersBox.current = await initEventListeners(() => { /* popout has no router */ });
      } catch (e) {
        console.warn("DM popout: initEventListeners failed", e);
      }

      // Activate the right backend session and pull initial state into
      // this webview's store (channels, users, current channel, own
      // session, status, ...).
      try {
        await useAppStore.getState().switchServer(p.server_id);
      } catch (e) {
        console.warn("DM popout: switchServer failed", e);
      }

      // ChatView depends on these two values to render correctly
      // (server-side message length, fancy-mumble feature gating, ...);
      // `switchServer` does not fetch them, so do it here.
      try {
        const cfg = await invoke<MumbleServerConfig>("get_server_config");
        useAppStore.setState({ serverConfig: cfg });
      } catch {
        /* leave defaults if not connected */
      }
      try {
        const info = await invoke<ServerInfo>("get_server_info");
        useAppStore.setState({ serverFancyVersion: info.fancy_version });
      } catch {
        /* legacy server or pre-connect */
      }

      // Finally, target the DM user.  This populates `dmMessages`,
      // sets `selectedDmUser`, and clears the unread badge for this
      // thread on the backend.
      try {
        await useAppStore.getState().selectDmUser(p.user_session);
      } catch (e) {
        console.warn("DM popout: selectDmUser failed", e);
      }

      setReady(true);
    };

    void bootstrap();

    return () => {
      for (const fn of unlistenersBox.current) {
        try { fn(); } catch { /* ignore */ }
      }
      unlistenersBox.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* ignore */
    }
  }, []);

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }
  if (!payload || !ready) {
    return <div className={styles.loading}>{t("dmPopout.loading")}</div>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header} data-tauri-drag-region>
        <span className={styles.headerTitle}>
          @ {payload.user_name}
          {payload.server_label && (
            <>
              {" • "}
              <span className={styles.serverLabel}>{payload.server_label}</span>
            </>
          )}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => void handleClose()}
          aria-label={t("dmPopout.close")}
          title={t("dmPopout.close")}
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>
      <div className={styles.chatHost}>
        <ChatView inPopout />
      </div>
    </div>
  );
}
