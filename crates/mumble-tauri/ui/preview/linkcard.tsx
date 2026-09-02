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

const thumb = { url: "", preview: { data_url: stripes(320, 180), mime: "image/svg+xml" } };

const video = {
  url: "https://www.youtube.com/watch?v=eKqZWVcYs7E",
  type: "video",
  title: "Entity — Stargazer (ft. Amy)",
  site_name: "youtube.com",
  author: { name: "Entity Records" },
  thumbnail: thumb,
  video: { url: "https://www.youtube.com/embed/eKqZWVcYs7E" },
} as never;

const article = {
  url: "https://example.org/posts/the-long-way-round",
  type: "article",
  title: "The long way round: a field report on latency, jitter and the people who notice",
  site_name: "example.org",
  description: "Why the numbers that look fine on a graph still sound wrong in a room.",
  thumbnail: thumb,
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
