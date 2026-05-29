/**
 * String-enum of every Tauri event name the frontend subscribes to.
 *
 * Each value matches a `ctx.emit("...")` call on the Rust side (see
 * `crates/mumble-tauri/src/state/handler/*.rs`).  Use these instead of
 * inline string literals so a typo or rename surfaces at compile time
 * and a single rename here propagates everywhere.
 *
 * Alphabetised so it stays diff-friendly as new events are added.
 */
export enum TauriEvent {
  AudioTransportChanged = "audio-transport-changed",
  ConnectionRejected = "connection-rejected",
  CurrentChannelChanged = "current-channel-changed",
  CustodianPinChanged = "custodian-pin-changed",
  CustomReactionsConfig = "custom-reactions-config",
  DmUnreadChanged = "dm-unread-changed",
  FancyPoll = "fancy-poll",
  FancyPollVote = "fancy-poll-vote",
  KeyDisputeDetected = "key-dispute-detected",
  KeyDisputeResolved = "key-dispute-resolved",
  KeyTrustChanged = "key-trust-changed",
  ListenDenied = "listen-denied",
  NavigateToChannel = "navigate-to-channel",
  NewDm = "new-dm",
  NewMessage = "new-message",
  OnboardingConfig = "onboarding-config",
  OnboardingResponse = "onboarding-response",
  PchatFetchComplete = "pchat-fetch-complete",
  PchatHistoryLoading = "pchat-history-loading",
  PchatKeyHoldersChanged = "pchat-key-holders-changed",
  PchatKeyRestored = "pchat-key-restored",
  PchatKeyRevoked = "pchat-key-revoked",
  PchatKeyShareRequest = "pchat-key-share-request",
  PchatKeyShareRequestsChanged = "pchat-key-share-requests-changed",
  PchatPinDeliver = "pchat-pin-deliver",
  PchatPinFetchResponse = "pchat-pin-fetch-response",
  PchatReactionDeliver = "pchat-reaction-deliver",
  PchatReactionFetchResponse = "pchat-reaction-fetch-response",
  PchatSignalBridgeError = "pchat-signal-bridge-error",
  PersistenceConfigChanged = "persistence-config-changed",
  PluginData = "plugin-data",
  PluginMessage = "plugin-message",
  PluginRegistry = "plugin-registry",
  ReadReceiptDeliver = "read-receipt-deliver",
  ServerConfig = "server-config",
  ServerConnected = "server-connected",
  ServerDisconnected = "server-disconnected",
  ServerLog = "server-log",
  StateChanged = "state-changed",
  StreamPopoutState = "stream-popout-state",
  TypingIndicator = "typing-indicator",
  UnreadChanged = "unread-changed",
  UserTalking = "user-talking",
  VoiceStateChanged = "voice-state-changed",
  WatchSync = "watch-sync",
  WebrtcSignal = "webrtc-signal",
}
