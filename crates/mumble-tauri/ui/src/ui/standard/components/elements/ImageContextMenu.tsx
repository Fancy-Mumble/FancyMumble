import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isRemoteImage } from "@core/features/chat/imageActions";
import { useImageActions, type ImageActionKind } from "@core/features/chat/useImageActions";
import styles from "./ImageContextMenu.module.css";

/** How long a finished action stays on its row before the menu closes. */
const LINGER = 900;
/** The panel's own size, for keeping it inside the window. */
const MENU_WIDTH = 208;
const ROW_HEIGHT = 32;

export interface ImageContextMenuProps {
  /** The picture, as its `src` attribute was written. */
  readonly src: string;
  /**
   * The address to copy and to open in a browser, where it is not the `src`.
   *
   * A public or password-protected file is drawn from a downloaded copy, so
   * the thing worth sharing is the link it arrived as rather than the path on
   * this machine. Defaults to the `src` when that is already an address.
   */
  readonly link?: string | null;
  /** Where the reader right-clicked. */
  readonly at: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
  /** Offered as one more row where the host can open this picture on its own. */
  readonly onPopOut?: () => void;
}

/**
 * The picture menu, for surfaces that are not a message row.
 *
 * The lightbox is the one that needed it: it draws a picture over the whole
 * window, and a right-click there used to reach the message underneath - so
 * the menu that came up was the message's, drawn at the message's z-index,
 * which put it *behind* the lightbox's own blurred backdrop. What is wanted
 * there is not the message's menu at all but this one, and it is a child of
 * the overlay rather than a portal to the body, so it is painted on top of
 * the picture it belongs to instead of underneath it.
 *
 * The rows are the same ones Nebula's message menu grows when the right-click
 * lands on a photograph, from the same actions and the same strings: the same
 * picture should offer the same things wherever the reader met it.
 */
export function ImageContextMenu({ src, link, at, onClose, onPopOut }: Readonly<ImageContextMenuProps>) {
  const { t } = useTranslation("chat");
  const openable = link ?? (isRemoteImage(src) ? src : null);
  const actions = useImageActions(src, openable);
  const status = actions.status;
  const panel = useRef<HTMLDivElement>(null);

  // Escape belongs to the menu while it is open, and to whatever is behind it
  // afterwards - the lightbox's own handler would otherwise close the picture
  // and the menu together on one press.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    globalThis.addEventListener("keydown", handler, { capture: true });
    return () => globalThis.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  useEffect(() => {
    if (!status || status.phase === "busy") return;
    const timer = setTimeout(onClose, LINGER);
    return () => clearTimeout(timer);
  }, [status, onClose]);

  // Focus the panel so the keyboard has somewhere to be, and so a menu opened
  // over a picture is announced rather than silently appearing.
  useEffect(() => panel.current?.focus(), []);

  const rows = 2 + (openable ? 2 : 0) + (onPopOut ? 1 : 0);
  const label = (kind: ImageActionKind, idle: string) => {
    if (status?.kind !== kind) return idle;
    if (status.phase === "busy") return t("contextMenu.imageWorking");
    if (status.phase === "failed") return t("contextMenu.imageFailed");
    return kind === "save" ? t("contextMenu.imageSaved") : t("contextMenu.imageCopied");
  };
  const busy = status?.phase === "busy";

  return (
    <div
      ref={panel}
      className={styles.menu}
      role="menu"
      tabIndex={-1}
      aria-label={t("contextMenu.imageMenuAriaLabel")}
      // A right-click on the menu itself is still a right-click inside the
      // app: without this the webview answers it with Back / Refresh /
      // Inspect, drawn over the menu that was already open.
      onContextMenu={(event) => event.preventDefault()}
      // A click on a row is the row's, and nobody else's. The surface under
      // this menu closes it on the next click anywhere - which, without this,
      // would take the menu away in the same tick the row was pressed, before
      // it had said whether the picture was copied.
      onClick={(event) => event.stopPropagation()}
      style={{
        // Clamped rather than merely placed: a right-click near the bottom
        // right corner would otherwise open a menu half of which is off the
        // window, with nothing to scroll it back into view.
        left: Math.max(8, Math.min(at.x, globalThis.innerWidth - MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(at.y, globalThis.innerHeight - rows * ROW_HEIGHT - 16)),
        width: MENU_WIDTH,
      }}
    >
      <button
        type="button"
        role="menuitem"
        className={styles.row}
        disabled={busy}
        onClick={actions.copyImage}
      >
        {label("copy", t("contextMenu.copyImage"))}
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.row}
        disabled={busy}
        onClick={actions.saveImage}
      >
        {label("save", t("contextMenu.saveImage"))}
      </button>
      {/* A picture carried inside the message has no address and no page of
          its own; only one fetched over the network does. */}
      {openable && (
        <button
          type="button"
          role="menuitem"
          className={styles.row}
          disabled={busy}
          onClick={actions.copyLink}
        >
          {label("link", t("contextMenu.copyImageLink"))}
        </button>
      )}
      {onPopOut && (
        <button
          type="button"
          role="menuitem"
          className={styles.row}
          onClick={() => {
            onPopOut();
            onClose();
          }}
        >
          {t("contextMenu.popOutImage")}
        </button>
      )}
      {openable && (
        <button
          type="button"
          role="menuitem"
          className={styles.row}
          onClick={() => {
            void openUrl(openable).catch(() => undefined);
            onClose();
          }}
        >
          {t("contextMenu.openImageExternally")}
        </button>
      )}
    </div>
  );
}
