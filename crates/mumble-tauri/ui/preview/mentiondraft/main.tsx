/* Scratch preview: the shared markdown editor's overlay, so a role mention in
   a draft can be seen rather than only asserted on. */
import { createRoot } from "react-dom/client";
import { Box, CssBaseline, ThemeProvider } from "@mui/material";
import { createNebulaTheme } from "@nebula/theme";
import MarkdownInput from "@standard/components/chat/markdown/MarkdownInput";
import "@standard/theme.css";

const NAMES = new Map([[7, "Lorelando"]]);

function Row({ value }: { value: string }) {
  return (
    <Box
      sx={(theme) => ({
        borderRadius: "18px",
        px: "16px",
        py: "13px",
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        fontSize: 14,
      })}
    >
      <MarkdownInput
        value={value}
        onChange={() => {}}
        onSubmit={() => {}}
        ariaLabel="Message"
        mentionResolver={(session) => NAMES.get(session)}
      />
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box
      sx={(theme) => ({
        minHeight: "100vh",
        p: "28px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        background: `${theme.palette.nebula.backdrop},${theme.palette.nebula.bg0}`,
        color: theme.palette.nebula.text,
      })}
    >
      <Row value="<@&admin> **Test**" />
      <Row value="morning <@7> and <@&moderators> - see **this**" />
      <Row value="<@&adm" />
    </Box>
  </ThemeProvider>,
);
