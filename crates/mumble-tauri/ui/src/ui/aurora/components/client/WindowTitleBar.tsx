import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "@core/utils/platform";
import { CloseIcon, MinimizeIcon, PlusIcon, SquareIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import styles from "../../AuroraApp.module.css";

export type ChromePlatform = "windows" | "macos" | "linux";

export interface TitleBarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
}

// Window operations resolve `getCurrentWindow()` on click, never at render, so
// the bar mounts safely outside a Tauri webview (e.g. in tests).
const minimizeWindow = () => void getCurrentWindow().minimize();
const toggleMaximizeWindow = () => void getCurrentWindow().toggleMaximize();
const closeWindow = () => void getCurrentWindow().close();

/** Detect the host desktop platform so the chrome matches native conventions.
 *  Anything unrecognised falls back to the Linux-style controls. */
function detectPlatform(): ChromePlatform {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X|iPhone|iPad/i.test(ua)) return "macos";
  if (/Windows|Win32|Win64/i.test(ua)) return "windows";
  return "linux";
}

function TitleBarActions({ actions }: { actions?: readonly TitleBarAction[] }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className={styles.barActions}>
      {actions.map((action) => action.iconOnly
        ? <IconButton key={action.id} icon={action.icon} label={action.label} onClick={action.onClick} disabled={action.disabled} />
        : <Button key={action.id} variant="bare" leadingIcon={action.icon} onClick={action.onClick} disabled={action.disabled}>{action.label}</Button>)}
    </div>
  );
}

/**
 * Frameless-window title bar shared by the running client and the design sheet.
 * `platform` forces a specific chrome (the design sheet previews all three);
 * otherwise the real host platform is detected. Window controls render only on
 * desktop - mobile uses the OS chrome - while the app actions always render so
 * they stay reachable everywhere.
 */
export default function WindowTitleBar({ platform, subtitle, serverTitle, actions }: {
  platform?: ChromePlatform;
  subtitle?: string;
  serverTitle?: string;
  actions?: readonly TitleBarAction[];
}) {
  const chrome = platform ?? detectPlatform();
  const showControls = isDesktopPlatform();
  const detail = subtitle ?? serverTitle;

  if (chrome === "macos") {
    return (
      <div className={`${styles.titleBar} ${styles.titleBarMac}`} data-tauri-drag-region data-testid="window-title-bar">
        {showControls && (
          <div className={styles.trafficLights} aria-label="macOS window controls">
            <button type="button" className={styles.macClose} aria-label="Close window" onClick={closeWindow}><CloseIcon /></button>
            <button type="button" className={styles.macMinimize} aria-label="Minimize window" onClick={minimizeWindow}><MinimizeIcon /></button>
            <button type="button" className={styles.macMaximize} aria-label="Maximize window" onClick={toggleMaximizeWindow}><PlusIcon /></button>
          </div>
        )}
        <span className={styles.macTitle}>{serverTitle ? `Fancy Mumble — ${serverTitle}` : "Fancy Mumble"}</span>
        <TitleBarActions actions={actions} />
      </div>
    );
  }

  if (chrome === "linux") {
    return (
      <div className={`${styles.titleBar} ${styles.titleBarLinux}`} data-tauri-drag-region data-testid="window-title-bar">
        <div className={styles.windowIdentity}><span className={styles.miniAppMark}>F</span><strong>Fancy Mumble</strong>{detail ? <small>{detail}</small> : null}</div>
        <TitleBarActions actions={actions} />
        {showControls && (
          <div className={styles.linuxWindowControls} aria-label="Linux window controls">
            <button type="button" aria-label="Minimize window" onClick={minimizeWindow}><MinimizeIcon /></button>
            <button type="button" aria-label="Maximize window" onClick={toggleMaximizeWindow}><SquareIcon /></button>
            <button type="button" className={styles.linuxClose} aria-label="Close window" onClick={closeWindow}><CloseIcon /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.titleBar} ${styles.titleBarWindows}`} data-tauri-drag-region data-testid="window-title-bar">
      <div className={styles.windowIdentity}><span className={styles.miniAppMark}>F</span><span>Fancy Mumble</span>{detail ? <small>{detail}</small> : null}</div>
      <TitleBarActions actions={actions} />
      {showControls && (
        <div className={styles.windowsWindowControls} aria-label="Windows window controls">
          <button type="button" aria-label="Minimize window" onClick={minimizeWindow}><MinimizeIcon /></button>
          <button type="button" aria-label="Maximize window" onClick={toggleMaximizeWindow}><SquareIcon /></button>
          <button type="button" className={styles.windowsClose} aria-label="Close window" onClick={closeWindow}><CloseIcon /></button>
        </div>
      )}
    </div>
  );
}
