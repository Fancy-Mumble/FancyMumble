/**
 * The server's welcome message, for the pinned list.
 *
 * A greeting is the one message on a server written to be read more than
 * once - it carries the rules, the schedule, where to ask for help - and it
 * was shown in a modal on connect and then gone. It is not a chat message, so
 * there has never been anything to pin; this fetches it so the pinned panel
 * can show it as one.
 *
 * Fetched rather than read from the store because that is where it lives: the
 * backend holds it from the `ServerSync` that carried it, and `get_welcome_text`
 * is how every other surface here asks for it.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import type { WelcomePin } from "./pinnedModel";

export function useWelcomePin(): WelcomePin | undefined {
  const activeServerId = useAppStore((state) => state.activeServerId);
  // The name this greeting belongs to, narrowed to a string so that a roster
  // change does not re-run the panel.
  const server = useAppStore((state) => {
    const active = state.sessions.find((session) => session.id === state.activeServerId);
    return active?.label || active?.host || "";
  });
  const [body, setBody] = useState("");

  useEffect(() => {
    // Outside the webview there is no backend to ask, and every consumer
    // takes the "no welcome" path.
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    let live = true;
    setBody("");
    invoke<string | null>("get_welcome_text")
      .then((text) => {
        if (live) setBody(text ?? "");
      })
      .catch(() => {
        // A server that answers nothing has no welcome, which is a real
        // answer and not worth saying anything about.
      });
    return () => {
      live = false;
    };
  }, [activeServerId]);

  return body.trim() === "" ? undefined : { body, server: server || "This server" };
}
