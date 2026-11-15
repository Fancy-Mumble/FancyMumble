/**
 * A message that carried a link, in each of the three styles.
 *
 * `linkcard` shows the card on its own; this shows the thing that was
 * actually wrong - where the card sits relative to the message it belongs to.
 * The two bubbled styles put it inside the bubble, and the flat style, which
 * has no bubble to put it in, keeps it as a card of its own.
 */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import { createNebulaTheme } from "@nebula/theme";
import { nebulaScheme } from "@nebula/themeScheme";
import { MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import "@standard/theme.css";

/** A striped placeholder, inline, so the preview never touches the network. */
function stripes(w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><pattern id="p" width="18" height="18" patternTransform="rotate(35)"
      patternUnits="userSpaceOnUse">
      <rect width="18" height="18" fill="#3a4d73"/>
      <rect width="9" height="18" fill="#445984"/>
    </pattern></defs>
    <rect width="${w}" height="${h}" fill="url(#p)"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const URL_TEXT = "https://www.youtube.com/watch?v=eKqZWVcYs7E&list=RDeKqZWVcYs7E&start_radio=1";

const EMBED = {
  url: URL_TEXT,
  type: "video",
  title: "Unbreakable (Arknights Soundtrack)",
  site_name: "YouTube",
  author: { name: "Provided to YouTube by IIP-DDSUnbreakable (Arknights Soundtrack)" },
  thumbnail: { url: "", preview: { data_url: stripes(320, 180), mime: "image/svg+xml" } },
  video: { url: "https://www.youtube.com/embed/eKqZWVcYs7E" },
} as never;

useAppStore.setState({
  ownSession: 1,
  users: [
    { session: 1, name: "You", channel_id: 1, texture_size: null },
    { session: 7, name: "Sebi", channel_id: 1, texture_size: null },
  ] as never,
  polls: new Map(),
  linkEmbeds: new Map([
    ["mine", [EMBED]],
    ["theirs", [EMBED]],
    ["long", [EMBED]],
  ]) as never,
  disableLinkPreviews: false,
  readReceiptVersion: 0,
  reactionVersion: 0,
  sendMessage: (() => Promise.resolve()) as never,
  watchSessions: new Map(),
  watchSessionsVersion: 0,
});

function msg(id: string, own: boolean, said = ""): ChatMessage {
  return {
    sender_session: own ? 1 : 7,
    sender_name: own ? "You" : "Sebi",
    body: `${said}<a href="${URL_TEXT}">${URL_TEXT}</a>`,
    channel_id: 1,
    is_own: own,
    message_id: id,
    timestamp: Date.UTC(2026, 8, 1, 20, 25),
  } as ChatMessage;
}

/**
 * Which skin to draw in: `?skin=<theme id>` picks one out of the catalogue,
 * because the skins that fill your own bubble with the accent itself are the
 * ones the attached card has to survive - it is standing on the accent there,
 * not on a surface.
 */
const skinId = new URLSearchParams(location.search).get("skin");

function paneTheme(mode: "dark" | "light") {
  const scheme = nebulaScheme(skinId, mode);
  return scheme ? createNebulaTheme(mode, scheme.tokens, null, scheme.skin) : createNebulaTheme(mode);
}

function Pane({ style, mode }: Readonly<{ style: "bubbles" | "flat"; mode: "dark" | "light" }>) {
  return (
    <ThemeProvider theme={paneTheme(mode)}>
      <CssBaseline />
      <Box
        sx={(theme) => ({
          width: 560,
          p: "18px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          background: theme.palette.nebula.bg0,
        })}
      >
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
          {style} / {mode}
        </Typography>
        <MessageRow
          message={msg("theirs", false)}
          grouped={false}
          endsGroup
          bubbleStyle={style}
          onOpenProfile={() => {}}
        />
        <MessageRow
          message={msg(
            "long",
            false,
            "this one has a good deal to say before it gets to the link, which is the case the bubble must not be squeezed for - ",
          )}
          grouped={false}
          endsGroup
          bubbleStyle={style}
          onOpenProfile={() => {}}
        />
        <MessageRow
          message={msg("mine", true)}
          grouped={false}
          endsGroup
          bubbleStyle={style}
          onOpenProfile={() => {}}
        />
      </Box>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <Box sx={{ display: "flex", flexWrap: "wrap" }}>
    <Pane style="bubbles" mode="dark" />
    <Pane style="bubbles" mode="light" />
    <Pane style="flat" mode="dark" />
    <Pane style="flat" mode="light" />
  </Box>,
);
