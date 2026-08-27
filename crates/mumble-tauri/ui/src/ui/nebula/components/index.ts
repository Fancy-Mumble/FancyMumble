export * from "./primitives";
export { TitleBar } from "./chrome/TitleBar";
export { MiniMode } from "./chrome/MiniMode";
export { GlobalSearch } from "./chrome/GlobalSearch";
export { SidebarShell } from "./sidebar/SidebarShell";
export { ChannelList } from "./sidebar/ChannelList";
export { ChannelMenu } from "./sidebar/ChannelMenu";
export { DirectMessageList } from "./sidebar/DirectMessageList";
export { ServerList } from "./sidebar/ServerList";
export { ServerRail } from "./sidebar/ServerRail";
export { VoiceDock } from "./sidebar/VoiceDock";
export { ServerInfoPanel } from "./server/ServerInfoPanel";
export { ChatBackdrop } from "./chat/ChatBackdrop";
export { ChatHeader } from "./chat/ChatHeader";
export { MessageList } from "./chat/MessageList";
export { MessageRow } from "./chat/MessageRow";
export { MemberPanel } from "./chat/MemberPanel";
export { Composer } from "./chat/Composer";
export { ConnectScreen } from "./connect/ConnectScreen";
export { QuickConnect } from "./connect/QuickConnect";
export { LeaveServerDialog } from "./connect/LeaveServerDialog";
export {
  SettingsNav,
  useSettingsNavContext,
  type SettingsPageId,
  type NavEntry,
  type SettingsNavContext,
} from "./settings/SettingsNav";
// `SettingsScreen` and `AdminScreen` are deliberately NOT re-exported here.
// A barrel is imported whole: one `import { TitleBar } from "./components"`
// would pull every settings page - and through them the administration
// console - into the graph of a window that is showing a connect screen.
// Both are loaded from their own modules, lazily, by `NebulaClientApp`.
export { ProfileCard } from "./user/ProfileCard";
export { UserMenu, type UserMenuTarget } from "./user/UserMenu";
export { NebulaRuntime } from "./runtime/NebulaRuntime";
export { ConnectionOverlays } from "./runtime/ConnectionOverlays";
