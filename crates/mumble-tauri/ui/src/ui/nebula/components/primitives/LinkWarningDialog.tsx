/**
 * The warning shown before a link leaves for the browser.
 *
 * Nebula draws its own rather than hosting Standard's, for the same reason
 * `LeaveServerDialog` does: this one sits over the pack's own chrome, and a
 * dialog is a surface the design has an opinion about. The *decision* is not
 * redrawn - `useExternalLinkGuard` decides when to ask and what trust means,
 * and this component only asks.
 *
 * The URL is drawn in two weights, host then the rest, because the host is the
 * whole question: it is what the tick would trust, and the only part worth
 * reading before deciding. One even weight invites reading left to right and
 * stopping at whatever looks familiar, which is the mistake a long deceptive
 * path is built to cause.
 */

import { Box, Button, Checkbox, Dialog, FormControlLabel, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { describeLink } from "@core/features/elements/externalLinks";
import { ExternalLinkIcon, GlobeIcon, WarningIcon } from "@ui/icons";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "./Stack";

interface LinkWarningDialogProps {
  /** The URL awaiting confirmation, or null when the dialog is closed. */
  url: string | null;
  /** State of the "trust this host" tick. */
  trust: boolean;
  onTrustChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LinkWarningDialog({
  url,
  trust,
  onTrustChange,
  onConfirm,
  onCancel,
}: Readonly<LinkWarningDialogProps>) {
  const { host, rest, scheme } = describeLink(url ?? "");

  return (
    <Dialog
      open={url !== null}
      onClose={onCancel}
      aria-labelledby="nebula-link-warning-title"
      slotProps={{ paper: { sx: { width: 380, maxWidth: "calc(100% - 32px)" } } }}
    >
      <Stack direction="row" alignItems="flex-start" gap="12px" sx={{ p: "18px 18px 14px" }}>
        <Box
          sx={(theme) => ({
            width: 34,
            height: 34,
            flex: "none",
            borderRadius: radius("md"),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.palette.nebula.warn,
            background: alpha(theme.palette.nebula.warn, 0.14),
            border: `1px solid ${alpha(theme.palette.nebula.warn, 0.3)}`,
          })}
        >
          <WarningIcon width={16} height={16} aria-hidden="true" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography id="nebula-link-warning-title" sx={{ fontSize: 14, fontWeight: 600 }}>
            Leaving Fancy Mumble
          </Typography>
          <Typography
            sx={(theme) => ({
              fontSize: 12,
              lineHeight: 1.55,
              mt: "3px",
              color: theme.palette.nebula.muted,
            })}
          >
            This link opens in your browser. Fancy Mumble can&rsquo;t vouch for where it goes.
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap="9px"
        title={url ?? undefined}
        sx={(theme) => ({
          mx: "18px",
          p: "10px 12px",
          borderRadius: radius("md"),
          color: theme.palette.nebula.muted,
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <GlobeIcon width={13} height={13} aria-hidden="true" style={{ flex: "none" }} />
        <Typography
          component="span"
          sx={(theme) => ({
            minWidth: 0,
            fontFamily: NEBULA_MONO,
            fontSize: 12,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: theme.palette.nebula.dim,
          })}
        >
          <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.text })}>
            {host || url}
          </Box>
          {host ? rest : ""}
        </Typography>
        {scheme ? (
          <Box
            component="span"
            sx={(theme) => ({
              ml: "auto",
              flex: "none",
              fontSize: 10,
              p: "2px 7px",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.card2,
              color: theme.palette.nebula.dim,
            })}
          >
            {scheme}
          </Box>
        ) : null}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap="9px"
        sx={(theme) => ({
          mt: "14px",
          p: "14px 18px 16px",
          borderTop: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        {/* Nothing to key trust on when the URL did not parse, so nothing is offered. */}
        {host ? (
          <FormControlLabel
            sx={{ minWidth: 0, mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={trust}
                onChange={(event) => onTrustChange(event.target.checked)}
              />
            }
            label={
              // A long host ellipsises here, so the full one stays reachable:
              // a tick that hides what it would trust is worse than no tick.
              <Typography
                title={host}
                sx={(theme) => ({
                  fontSize: 11.5,
                  color: theme.palette.nebula.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                })}
              >
                Trust {host}
              </Typography>
            }
          />
        ) : null}
        <Stack direction="row" gap="7px" sx={{ ml: "auto", flex: "none" }}>
          <Button variant="outlined" onClick={onCancel} sx={{ fontSize: 12 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={onConfirm}
            endIcon={<ExternalLinkIcon width={12} height={12} />}
            sx={{ fontSize: 12, fontWeight: 600 }}
          >
            Open link
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
