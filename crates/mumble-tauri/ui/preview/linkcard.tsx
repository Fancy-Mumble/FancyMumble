import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import "@core/i18n";
import "@core/i18n/nebula";
import { createNebulaTheme } from "@nebula/theme";
import { useAppStore } from "@core/store";
import LinkPreviewCard from "@nebula/components/chat/LinkPreviewCard";

useAppStore.setState({ ownSession: 1, sendMessage: (() => Promise.resolve()) as never });

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

/** A picture of a stated size, so the shape rules have something to read. */
function picture(width: number, height: number) {
  return {
    url: "",
    width,
    height,
    preview: { data_url: stripes(width, height), mime: "image/svg+xml", width, height },
  };
}

const video = {
  url: "https://www.youtube.com/watch?v=eKqZWVcYs7E",
  type: "video",
  title: "UK Hardcore 1 Hour Mix #4 — Lift Me Up",
  site_name: "youtube.com",
  author: { name: "UberCrow" },
  media_duration: "1:00:14",
  image: picture(1280, 720),
  video: { url: "https://www.youtube.com/embed/eKqZWVcYs7E" },
} as never;

/** Tall art: contained on a blurred bed of itself, nothing cropped. */
const art = {
  url: "https://www.pixiv.net/en/artworks/112922619",
  type: "image",
  title: "水面のふたり",
  site_name: "pixiv",
  author: { name: "ame" },
  fields: [{ name: "likes", value: "12.4K", inline: true }],
  image: picture(1000, 1418),
} as never;

/** Small art: its own size on that bed, never enlarged. */
const small = {
  url: "https://danbooru.donmai.us/posts/1",
  type: "image",
  title: "Summer beach — scenery study",
  site_name: "danbooru.donmai.us",
  image: picture(360, 253),
} as never;

/** A listing: the price is the headline. */
const deal = {
  url: "https://www.mydealz.de/deals/the-c64-maxi",
  type: "product",
  title: "THE C64 Maxi — Commodore-Nachbau",
  site_name: "mydealz.de",
  price: { amount: "89.99", currency: "EUR", was: "129.99", availability: "instock" },
  fields: [{ name: "shipping", value: "Free", inline: true }],
  image: picture(600, 400),
} as never;

const article = {
  url: "https://example.org/posts/the-long-way-round",
  type: "article",
  title: "The long way round: a field report on latency, jitter and the people who notice",
  site_name: "example.org",
  description: "Why the numbers that look fine on a graph still sound wrong in a room.",
  image: picture(1200, 630),
} as never;

const bare = {
  url: "https://docs.example.org/reference/acl",
  type: "link",
  title: "Access control lists",
  site_name: "docs.example.org",
  description: "Rules, groups, and the order they are applied in.",
} as never;

function Pane({ mode }: Readonly<{ mode: "dark" | "light" }>) {
  return (
    <ThemeProvider theme={createNebulaTheme(mode)}>
      <CssBaseline />
      <Box
        sx={{
          flex: 1,
          p: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          minHeight: "100vh",
          background:
            mode === "dark"
              ? "linear-gradient(140deg,#2b3a5c,#1a2440 60%,#101a30)"
              : "linear-gradient(140deg,#f4f6fb,#fdfbf6 60%,#f7f4ec)",
        }}
      >
        <LinkPreviewCard embeds={[video]} allowExternalResources={false} channelId={1} />
        <LinkPreviewCard embeds={[art]} allowExternalResources={false} channelId={1} />
        <LinkPreviewCard embeds={[small]} allowExternalResources={false} channelId={1} />
        <LinkPreviewCard embeds={[deal]} allowExternalResources={false} channelId={1} />
        <LinkPreviewCard embeds={[article]} allowExternalResources={false} channelId={1} />
        <LinkPreviewCard embeds={[bare]} allowExternalResources={false} channelId={1} />
      </Box>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <Box sx={{ display: "flex", minHeight: "100vh" }}>
    <Pane mode="dark" />
    <Pane mode="light" />
  </Box>,
);
