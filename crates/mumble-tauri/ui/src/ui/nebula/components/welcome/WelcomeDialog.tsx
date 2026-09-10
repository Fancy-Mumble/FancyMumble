/**
 * The server's greeting, at full size.
 *
 * The pinned list keeps the greeting reachable, but a pin row is two clamped
 * lines of flattened text - it drops the layout, the pictures and the links,
 * which for a designed welcome is most of the message. This is where the row
 * leads: the same markup the connect modal shows, in the pack's own dialog,
 * for as long as the reader wants it rather than until they dismiss it.
 *
 * `LinkGuard` for the same reason the details panel wraps its copy in one - a
 * bare anchor inside the webview navigates the app's own window away, with
 * nothing left to come back with.
 */
import { useTranslation } from "react-i18next";
import { Box, Dialog, Typography } from "@mui/material";
import { CloseIcon, ServerIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { LinkGuard, Stack } from "../primitives";
import { WelcomeMarkup } from "./WelcomeMarkup";

export interface WelcomeDialogProps {
  /** The greeting's markup, as the server sent it. */
  readonly body: string;
  /** Whose greeting it is, which is what the header names. */
  readonly server: string;
  readonly onClose: () => void;
}

export function WelcomeDialog({ body, server, onClose }: Readonly<WelcomeDialogProps>) {
  const { t } = useTranslation(["server", "common"]);

  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="nebula-welcome-title"
      slotProps={{ paper: { sx: { width: 620, maxWidth: "calc(100% - 32px)" } } }}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap="11px"
        sx={(theme) => ({
          flex: "none",
          p: "14px 16px",
          borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        })}
      >
        <Box
          aria-hidden
          sx={(theme) => ({
            flex: "none",
            display: "grid",
            placeItems: "center",
            width: 30,
            height: 30,
            borderRadius: radius("md"),
            color: theme.palette.nebula.muted,
            background: theme.palette.nebula.card,
            border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
          })}
        >
          <ServerIcon width={14} height={14} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {/* The server's name is the title: the greeting is what this server
              says about itself, and "Welcome" alone names nothing. */}
          <Typography id="nebula-welcome-title" sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {server}
          </Typography>
          <Typography
            sx={(theme) => ({
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: theme.palette.nebula.muted,
            })}
          >
            {t("server:welcomeModal.title")}
          </Typography>
        </Box>
        <Box
          component="button"
          type="button"
          aria-label={t("common:actions.close")}
          onClick={onClose}
          sx={(theme) => ({
            all: "unset",
            flex: "none",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            color: theme.palette.nebula.muted,
            "&:hover,&:focus-visible": { color: theme.palette.nebula.text },
          })}
        >
          <CloseIcon width={13} height={13} />
        </Box>
      </Stack>

      <LinkGuard>
        <WelcomeMarkup
          html={body}
          sx={(theme) => ({
            p: "16px",
            // Tall enough for a designed sheet, short enough that the dialog
            // stays a dialog on a laptop; the greeting scrolls inside it.
            maxHeight: "min(64vh, 560px)",
            overflowY: "auto",
            fontSize: 13,
            lineHeight: 1.55,
            wordBreak: "break-word",
            "& a": { color: theme.palette.nebula.accent, textDecoration: "none" },
            "& a:hover": { textDecoration: "underline" },
            "& img": { maxWidth: "100%" },
          })}
        />
      </LinkGuard>
    </Dialog>
  );
}
