import { ArrowLeftIcon, SettingsIcon, ShieldCheckIcon, StarIcon, UsersGroupIcon } from "@ui/icons";
import WindowTitleBar, { type TitleBarAction } from "./WindowTitleBar";

export interface ClientTitleBarProps {
  /** Server name shown next to the app identity (connected/disconnected chrome). */
  serverTitle?: string;
  /** Opens the settings surface. Present in every app state - it is the only
   *  entry point to the appearance section, which holds the interface-design
   *  (Aurora / Standard) switch. */
  onOpenSettings: () => void;
  /** Connected-only surfaces; omitted states simply drop the action. */
  onOpenFriends?: () => void;
  onOpenWorkspace?: () => void;
  /** Only for users who may administer the active server. */
  onOpenAdmin?: () => void;
  onDisconnect?: () => void;
}

/**
 * The running client's title bar: window chrome plus the actions that belong to
 * the current app state.
 *
 * Deliberately sparse. Navigation that already has a home elsewhere is NOT
 * repeated here - the server browser is reached through the server rail, and
 * the interface-design switch lives in Settings -> Appearance. What remains are
 * surfaces with no other entry point, plus the settings gear (icon-only, so the
 * bar stays quiet) which every state needs.
 */
export default function ClientTitleBar({
  serverTitle,
  onOpenSettings,
  onOpenFriends,
  onOpenWorkspace,
  onOpenAdmin,
  onDisconnect,
}: ClientTitleBarProps) {
  const actions: readonly TitleBarAction[] = [
    ...(onOpenFriends
      ? [{ id: "friends", label: "Friends", icon: <UsersGroupIcon />, onClick: onOpenFriends }]
      : []),
    ...(onOpenWorkspace
      ? [{ id: "workspace", label: "Workspace", icon: <StarIcon />, onClick: onOpenWorkspace }]
      : []),
    ...(onOpenAdmin
      ? [
          {
            id: "admin",
            label: "Administration",
            icon: <ShieldCheckIcon />,
            iconOnly: true,
            onClick: onOpenAdmin,
          },
        ]
      : []),
    { id: "settings", label: "Settings", icon: <SettingsIcon />, iconOnly: true, onClick: onOpenSettings },
    ...(onDisconnect
      ? [{ id: "disconnect", label: "Disconnect", icon: <ArrowLeftIcon />, onClick: onDisconnect }]
      : []),
  ];
  return <WindowTitleBar serverTitle={serverTitle} actions={actions} />;
}
