/**
 * Nebula, laid out for one hand.
 *
 * The window is a row of four things at once - rail, column, conversation,
 * aside. None of that survives 390px, so this is the same four things taken
 * one at a time:
 *
 * - the rail lies along the top as `MobileServerStrip`;
 * - the column and the conversation become two *panes*, one in front;
 * - the aside comes up as a sheet;
 * - a tab bar says which screen you are on.
 *
 * The pane switch is the whole idea, and it is why this file is short. Every
 * screen the pack has is already a list beside a page - channels beside a
 * conversation, settings pages beside a settings page, servers beside a
 * connect form - so one "which half is in front" answers all of them, and no
 * screen needs a handheld design of its own to stop being clipped.
 *
 * Nothing here owns application state. Every handler and every list is a
 * bundle `NebulaClientApp` already built for the window.
 */
import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { Stack } from "../primitives";
import { ChatBackdrop } from "../chat/ChatBackdrop";
import { ChatHeader } from "../chat/ChatHeader";
import { Composer } from "../chat/Composer";
import { MemberPanel } from "../chat/MemberPanel";
import { MessageList } from "../chat/MessageList";
import { ChannelList } from "../sidebar/ChannelList";
import { SearchBox } from "../primitives/SearchBox";
import type { MobileShellModel } from "../../shellModel";
import { MobileCallBar } from "./MobileCallBar";
import { MobileConnectPane } from "./MobileConnectPane";
import { MobileHeader } from "./MobileHeader";
import { MobileServerStrip } from "./MobileServerStrip";
import { MobileServersPane } from "./MobileServersPane";
import { MobileSheet } from "./MobileSheet";
import { MobileTabBar, type MobileTab } from "./MobileTabBar";
import { MobileVoiceScreen } from "./MobileVoiceScreen";
import { HazardRule, useStencil } from "./mobileMarks";

/**
 * Which half is in front.
 *
 * Not a `Screen`: the screen is still "chat" while you are reading a
 * conversation, exactly as it is on a window. This only says whether the list
 * or the thing the list opens is the one you can see.
 */
export type MobilePane = "nav" | "content";

const TAB_FOR_SCREEN: Record<string, MobileTab> = {
  chat: "chats",
  connect: "chats",
  messages: "people",
  settings: "settings",
};

const SCREEN_FOR_TAB = { chats: "chat", people: "messages", settings: "settings" } as const;

export function MobileShell({
  model,
  initialPane = "nav",
  openVoice = false,
}: Readonly<{ model: MobileShellModel; initialPane?: MobilePane; openVoice?: boolean }>) {
  const [pane, setPane] = useState<MobilePane>(initialPane);
  // The call is not a pane but a place you go and come back from, so it sits
  // over whichever pane you were on rather than replacing it.
  const [voiceOpen, setVoiceOpen] = useState(openVoice);

  // Changing screen lands on that screen's list, never on whatever page the
  // last screen had open - a tab that dropped you into a stale settings page
  // would be a tab that does something different each time you press it.
  //
  // Changing, not arriving: an effect that also ran on mount would overwrite
  // whatever pane the shell was opened on, which is how the preview page asks
  // for the conversation.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) setPane("nav");
    arrived.current = true;
  }, [model.screen]);

  const chat = model.screen === "chat";
  // The start screen is the same two halves as the conversation - a list, and
  // the thing a row on it opens - so it rides the same pane switch rather
  // than being a third layout.
  const start = model.screen === "connect" && model.servers !== undefined;
  const nav = chat ? (
    <ChannelsPane model={model} onOpen={() => setPane("content")} />
  ) : start ? (
    <MobileServersPane
      model={{ ...model.servers!, onOpen: (key) => {
        model.servers!.onOpen(key);
        setPane("content");
      } }}
      brand={model.brand}
    />
  ) : (
    model.screenNav
  );
  const content = chat ? (
    <ChatPane model={model} onBack={() => setPane("nav")} onExpandVoice={() => setVoiceOpen(true)} />
  ) : start && model.connect ? (
    <MobileConnectPane model={{ ...model.connect, onBack: () => setPane("nav") }} />
  ) : (
    model.screenContent
  );

  // A screen with only one half has nothing to switch to, so its half is
  // simply the pane - which is what the friends list and the empty connect
  // screen are.
  const front = pane === "content" && content ? content : (nav ?? content);
  const tabs = !((chat || start) && pane === "content" && content);

  return (
    <Stack
      data-testid="nebula-mobile-shell"
      sx={{
        position: "relative",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        // The status bar and the two rounded corners of the screen. Said once
        // here so no band below has to know the phone's shape.
        pt: "env(safe-area-inset-top, 0px)",
        pl: "env(safe-area-inset-left, 0px)",
        pr: "env(safe-area-inset-right, 0px)",
      }}
    >
      <ChatBackdrop />
      {/* Nothing to switch between before a session exists, and the start
          screen carries its own masthead in that space instead. */}
      {!start && <MobileServerStrip model={model.serverStrip} />}
      <Stack sx={{ flex: 1, minHeight: 0, position: "relative", zIndex: 1 }}>{front}</Stack>
      {/* Not on an open conversation: the artboard gives that the whole
          screen, and the way out of it is the arrow in its own header. Three
          more destinations under the composer would be three ways to lose a
          half-typed message. */}
      {tabs && (
        <>
          {/* The artboard's tape above the bar; a hairline on every other
              skin. Both say the same thing - the chrome starts here - so the
              rule decides which of the two it is, and this does not have to
              know: gating it here left twelve skins with no rule at all. */}
          <HazardRule />
          <MobileTabBar
            active={TAB_FOR_SCREEN[model.screen] ?? "chats"}
            onSelect={(tab) => model.onScreen(SCREEN_FOR_TAB[tab])}
            servers={start}
        chatsBadge={model.unread.chats}
            peopleBadge={model.unread.people}
          />
        </>
      )}
      {model.voice && voiceOpen && (
        <MobileVoiceScreen model={model.voice} onCollapse={() => setVoiceOpen(false)} />
      )}
      <MobileSheet
        open={model.membersOpen}
        title={model.serverName}
        onClose={model.onCloseMembers}
        testId="nebula-mobile-members-sheet"
      >
        <MemberPanel {...model.members} variant="sheet" />
      </MobileSheet>
    </Stack>
  );
}

/** Artboard A: the servers, the search, and the channel tree. */
function ChannelsPane({
  model,
  onOpen,
}: Readonly<{ model: MobileShellModel; onOpen: () => void }>) {
  const stencil = useStencil();
  return (
    <>
      <MobileHeader
        title={model.serverName}
        testId="nebula-mobile-channels-header"
        leading={
          stencil ? (
            // The wordmark plate the column carries on a window, which is the
            // one piece of the sidebar's chrome worth the room up here.
            <Box
              sx={(theme) => ({
                flex: "none",
                transform: "skewX(-12deg)",
                background: theme.palette.nebula.accent,
                px: "12px",
                py: "5px",
              })}
            >
              <Box
                sx={(theme) => ({
                  transform: "skewX(12deg)",
                  fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
                  fontStyle: "italic",
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  color: theme.palette.nebula.onAccent,
                })}
              >
                {model.brand}
              </Box>
            </Box>
          ) : undefined
        }
      />
      <Box sx={{ flex: "none", px: "14px", pt: "14px", pb: "4px" }}>
        <SearchBox
          value={model.channelSearch.value}
          onChange={model.channelSearch.onChange}
          placeholder={model.channelSearch.placeholder}
        />
      </Box>
      {/* The list itself is untouched: it already scrolls, already draws the
          open channel as a filled plate with the skin's own selection bar, and
          already stacks the occupants under it. */}
      <ChannelList
        {...model.channels}
        onJoin={(channel) => {
          model.channels.onJoin(channel);
          onOpen();
        }}
        onSelect={(channel) => {
          model.channels.onSelect(channel);
          onOpen();
        }}
      />
    </>
  );
}

/** Artboard B: the conversation, at the full width of the screen. */
function ChatPane({
  model,
  onBack,
  onExpandVoice,
}: Readonly<{ model: MobileShellModel; onBack: () => void; onExpandVoice: () => void }>) {
  return (
    <>
      <ChatHeader {...model.chatHeader} onBack={onBack} dense />
      {model.chatBanners}
      <Stack sx={{ flex: 1, minHeight: 0 }}>
        {model.messageList ? (
          <MessageList {...model.messageList} />
        ) : (
          <Box
            sx={(theme) => ({
              flex: 1,
              display: "grid",
              placeItems: "center",
              px: "24px",
              textAlign: "center",
              fontSize: 13,
              color: theme.palette.nebula.muted,
            })}
          >
            {model.emptyLabel}
          </Box>
        )}
      </Stack>
      {model.voice && <MobileCallBar model={model.voice} onExpand={onExpandVoice} />}
      {/* The tab bar is not drawn on this pane, so the composer is the bottom
          edge and it is the one that has to clear the gesture bar. */}
      <Box sx={{ flex: "none", pb: "env(safe-area-inset-bottom, 0px)" }}>
        <Composer {...model.composer} dense />
      </Box>
    </>
  );
}
