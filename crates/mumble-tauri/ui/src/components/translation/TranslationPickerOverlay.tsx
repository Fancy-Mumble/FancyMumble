/**
 * TranslationPickerOverlay - main-window companion to the translation
 * helper popout.  Lives at the top of `MainApp` and stays inert until the
 * popout sends a `translation-picker:start` Tauri event.
 *
 * Design:
 *  - The picker highlights the element under the cursor by positioning a
 *    *single, fixed-position overlay div* over it.  Nothing is added to
 *    the hovered element itself, so re-renders, framework style props,
 *    and missed mouseleave events can never leave a stuck border behind.
 *  - When the cursor isn't over a marked element the overlay is removed
 *    from the DOM (not just hidden).
 *  - Cleanup is paranoid: detach walks every node with our overlay id
 *    AND every node with our (now-retired) legacy class, and also kills
 *    the legacy stylesheet, in case the user has cached state from an
 *    earlier build.
 */

import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  parsePickerMarker,
  PICKER_MARK_START,
  setPickerActive,
} from "../../i18n";

const OVERLAY_ID = "translation-picker-overlay";
const TOAST_ID = "translation-picker-toast";

/** Legacy artefacts from earlier builds - clean up at every opportunity. */
const LEGACY_HIGHLIGHT_CLASS = "translation-picker-highlight";
const LEGACY_STYLE_ID = "translation-picker-style";

/** Set to true to flood the console with picker diagnostics. */
const DEBUG = true;
const log = (...args: unknown[]): void => {
  if (DEBUG) console.log("[trpicker]", ...args);
};

/** Regex matching every marker char i18n inserts during picker mode:
 *  the current ZW-family delimiters (U+200B..U+200D), the tag-character
 *  body of the encoded header (U+E0020..U+E007F), plus the legacy
 *  Invisible-Math (U+2062..U+2064) and ASCII Unit Separator (U+001F)
 *  sets so old-format DOM text during a hot-reload still strips clean. */
const MARKER_CHARS_RE = /[\u200B-\u200D\u{E0020}-\u{E007F}\u2062-\u2064]/gu;

interface SelectedPayload {
  ns: string;
  key: string;
  value: string;
}

function directText(el: Element): string {
  let s = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) s += node.nodeValue ?? "";
  }
  return s;
}

function findMarkedElement(target: EventTarget | null): {
  element: HTMLElement;
  marker: SelectedPayload;
} | null {
  let node: Node | null = target instanceof Node ? target : null;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
  while (node) {
    if (node instanceof HTMLElement) {
      const own = directText(node);
      if (own.includes(PICKER_MARK_START)) {
        const parsed = parsePickerMarker(own);
        if (parsed) return { element: node, marker: parsed };
      }
    }
    node = node.parentNode;
  }
  return null;
}

/** Remove every overlay-id and legacy-class artefact from the DOM. */
function nukeArtefacts(): void {
  // Multiple elements *should* never share an id, but if a renderer race
  // ever creates two, this kills them all.
  const overlays = document.querySelectorAll(`[id="${OVERLAY_ID}"]`);
  if (overlays.length) log(`removing ${overlays.length} overlay(s)`);
  for (const el of overlays) el.remove();

  const legacyClassed = document.querySelectorAll(`.${LEGACY_HIGHLIGHT_CLASS}`);
  if (legacyClassed.length) log(`removing legacy class from ${legacyClassed.length} element(s)`);
  for (const el of legacyClassed) el.classList.remove(LEGACY_HIGHLIGHT_CLASS);

  const legacyStyle = document.getElementById(LEGACY_STYLE_ID);
  if (legacyStyle) {
    log("removing legacy stylesheet");
    legacyStyle.remove();
  }
}

function setOverlay(el: HTMLElement | null): void {
  // Always start by nuking any duplicates / leftovers before placing the new one.
  nukeArtefacts();
  if (!el) return;
  const div = document.createElement("div");
  div.id = OVERLAY_ID;
  Object.assign(div.style, {
    position: "fixed",
    pointerEvents: "none",
    border: "2px solid var(--accent, #2aabee)",
    borderRadius: "3px",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
    background: "rgba(42, 171, 238, 0.08)",
    zIndex: "2147483646",
  } as Partial<CSSStyleDeclaration>);
  const r = el.getBoundingClientRect();
  div.style.top = `${r.top - 2}px`;
  div.style.left = `${r.left - 2}px`;
  div.style.width = `${r.width}px`;
  div.style.height = `${r.height}px`;
  document.body.appendChild(div);
}

function showToast() {
  if (document.getElementById(TOAST_ID)) return;
  const t = document.createElement("div");
  t.id = TOAST_ID;
  t.textContent = "Translation picker - click any UI text, ESC to cancel";
  Object.assign(t.style, {
    position: "fixed",
    bottom: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(20,20,20,0.92)",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: "6px",
    font: "12px/1.4 system-ui, sans-serif",
    zIndex: "2147483647",
    pointerEvents: "none",
    boxShadow: "0 6px 22px rgba(0,0,0,0.45)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(t);
}

function hideToast() {
  document.getElementById(TOAST_ID)?.remove();
}

export default function TranslationPickerOverlay() {
  useEffect(() => {
    let unlistenStart: UnlistenFn | undefined;
    let unlistenStop: UnlistenFn | undefined;
    let active = false;
    let highlighted: HTMLElement | null = null;
    let prevCursor = "";

    // Sweep up any artefacts left by a previous build / hot-reload before
    // we do anything else.
    nukeArtefacts();

    function describe(el: HTMLElement | null): string {
      if (!el) return "(none)";
      const text = directText(el).replace(MARKER_CHARS_RE, "").trim();
      const cls = typeof el.className === "string" ? el.className : "";
      return `<${el.tagName.toLowerCase()}${cls ? "." + cls.split(" ")[0] : ""}> "${text.slice(0, 40)}"`;
    }

    function highlight(el: HTMLElement | null) {
      if (highlighted === el) return;
      log("highlight", { from: describe(highlighted), to: describe(el) });
      highlighted = el;
      setOverlay(el);
    }

    function onMouseMove(e: MouseEvent) {
      const hit = findMarkedElement(e.target);
      highlight(hit?.element ?? null);
    }

    function onClick(e: MouseEvent) {
      const hit = findMarkedElement(e.target);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      log("clicked", hit.marker);
      void emit("translation-picker:selected", hit.marker);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        log("ESC pressed");
        void emit("translation-picker:cancelled");
        detach();
      }
    }

    function onMouseLeaveWindow() {
      log("mouse left window");
      highlight(null);
    }

    function onScrollOrResize() {
      if (!highlighted) return;
      if (!document.contains(highlighted)) {
        log("highlighted element detached during scroll/resize");
        highlight(null);
        return;
      }
      setOverlay(highlighted);
    }

    function attach() {
      if (active) {
        log("attach called while already active - no-op");
        return;
      }
      log("attach");
      active = true;
      setPickerActive(true);
      prevCursor = document.body.style.cursor;
      document.body.style.cursor = "crosshair";
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
      document.documentElement.addEventListener("mouseleave", onMouseLeaveWindow);
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize, true);
      showToast();
    }

    function detach() {
      if (!active) {
        log("detach called while inactive - sweeping anyway");
        nukeArtefacts();
        return;
      }
      log("detach");
      active = false;
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.removeEventListener("mouseleave", onMouseLeaveWindow);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize, true);
      nukeArtefacts();
      highlighted = null;
      document.body.style.cursor = prevCursor;
      hideToast();
      setPickerActive(false);
    }

    void listen("translation-picker:start", () => attach()).then((u) => {
      unlistenStart = u;
    });
    void listen("translation-picker:stop", () => detach()).then((u) => {
      unlistenStop = u;
    });

    return () => {
      log("component unmount");
      unlistenStart?.();
      unlistenStop?.();
      detach();
    };
  }, []);

  return null;
}
