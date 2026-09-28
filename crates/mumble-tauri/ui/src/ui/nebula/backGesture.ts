/**
 * Android's back gesture, answered by whatever is in front.
 *
 * Tauri hands the gesture to the page only while the page is listening. With
 * no listener it does what Android does everywhere else - the app goes to the
 * background - and with one it does nothing at all unless the page acts. So
 * the listener is held exactly while there is something here to step back
 * from, and let go at the root:
 *
 * 1. An open MUI overlay - dialog, menu, popover, full-screen calendar. It is
 *    dismissed the way Escape dismisses it, so each one closes through its own
 *    `onClose` and none of them has to know about the gesture.
 * 2. The newest step registered through `useBackStep` - the voice screen, the
 *    members sheet, the conversation pane, a screen that is not the home one.
 *
 * Holding the listener at the root instead would leave back doing nothing on
 * the one screen where every phone user expects it to leave.
 */
import { useEffect, useRef } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";
import { isMobile } from "@core/utils/platform";

interface Step {
  run: () => void;
}

/** Registration order; the last one is the one in front. */
const steps: Step[] = [];

/** The listener while one is held - a promise, since registering is an IPC. */
let listener: Promise<PluginListener | null> | null = null;

/** Body children MUI portals an overlay into, closed ones excluded. */
const OVERLAY_SELECTOR = "body > .MuiModal-root:not(.MuiModal-hidden)";

/** The overlay in front, or null. MUI appends each new one after the last. */
function topOverlay(): HTMLElement | null {
  const open = document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR);
  return open.length > 0 ? open[open.length - 1] : null;
}

/**
 * Close an overlay as its own Escape handling would. The modal root carries
 * that handler, and a focused element inside it bubbles to it the same way.
 */
function dismiss(overlay: HTMLElement): void {
  const focused = document.activeElement;
  const target = focused instanceof HTMLElement && overlay.contains(focused) ? focused : overlay;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

/** One press: the overlay in front first, then the newest step. */
export function handleBack(): void {
  const overlay = topOverlay();
  if (overlay) {
    dismiss(overlay);
    return;
  }
  steps.at(-1)?.run();
}

/** Whether anything would answer a press right now. */
export function canStepBack(): boolean {
  return steps.length > 0 || topOverlay() !== null;
}

/** Hold the listener while something can answer, and not a moment longer. */
function sync(): void {
  if (!isMobile) return;
  const wanted = canStepBack();
  if (wanted && listener === null) {
    // A refused registration is the desktop answer - there is no gesture to
    // take - so it settles to null rather than rejecting on every press.
    listener = onBackButtonPress(handleBack).catch(() => null);
  } else if (!wanted && listener !== null) {
    const held = listener;
    listener = null;
    void held.then((registered) => registered?.unregister());
  }
}

/**
 * Overlays come and go without telling anyone, so their arrival is watched
 * rather than reported. MUI portals every one of them straight into `<body>`,
 * which keeps the observer to one level.
 */
let watching = false;
function watchOverlays(): void {
  if (watching || !isMobile || typeof MutationObserver === "undefined") return;
  watching = true;
  // A kept-mounted overlay closes by flipping `MuiModal-hidden` on itself
  // rather than leaving the body, so each child's class is watched too - but
  // only the children's: a subtree watch would wake on every styled element.
  const classes = new MutationObserver(sync);
  const children = (): void => {
    for (const child of Array.from(document.body.children)) {
      classes.observe(child, { attributes: true, attributeFilter: ["class"] });
    }
    sync();
  };
  new MutationObserver(children).observe(document.body, { childList: true });
  children();
}

/**
 * Answer the back gesture with `onBack` while it is non-null.
 *
 * Pass null when there is nothing to go back to; the step then leaves the
 * stack, and when it was the last one the listener goes with it. The handler
 * is read through a ref, so a caller can pass a fresh closure every render
 * without re-registering anything.
 */
export function useBackStep(onBack: (() => void) | null): void {
  const current = useRef(onBack);
  current.current = onBack;
  const active = onBack !== null;
  // Watched from the first caller on, stepping or not: a dialog over the root
  // screen needs the gesture as much as one over a conversation.
  useEffect(watchOverlays, []);
  useEffect(() => {
    if (!active) return undefined;
    const step: Step = { run: () => current.current?.() };
    steps.push(step);
    sync();
    return () => {
      const index = steps.indexOf(step);
      if (index >= 0) steps.splice(index, 1);
      sync();
    };
  }, [active]);
}
