/**
 * The channel's pins, hung from the pin in the conversation header.
 *
 * Nebula used to borrow Standard's panel, which is a column of the chat pane:
 * opening it narrowed the conversation, and it arrived here without the close
 * button Standard's splitter draws for it - so the only way out was to open
 * something else. A pin list is a glance, not a place, so this is a popover
 * over the conversation instead, dismissed by a click anywhere else.
 *
 * Every row answers the same four things in the mock's order: who wrote it,
 * how long ago, what it said, and whether it arrived since you last looked.
 * The accent rule down the left is what carries the last of those - a dot
 * beside the name would be one more thing in a row that already has four.
 */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Tooltip, Typography } from "@mui/material";
import type { ChatMessage } from "@core/types";
import { CloseIcon, PinIcon, PinOffIcon } from "@ui/icons";
import { washPanel } from "../../../theme";
import { NEBULA_MONO, radius } from "../../../tokens";
import type { TimeDisplay } from "../../../selectors";
import { Stack, UserAvatar } from "../../primitives";
import { PopoverScrim } from "../popover/PopoverPanel";
import { WELCOME_PIN_ID, pinAge, pinnedMessages, pinPreview, type WelcomePin } from "./pinnedModel";

/** The conversation header's height, which the panel hangs under. */
const HEADER_HEIGHT = 66;

interface PinnedPanelProps {
  /** The open conversation; the pinned ones are picked out of it here. */
  readonly messages: readonly ChatMessage[];
  /**
   * The server's welcome message, shown at the top of the list.
   *
   * Absent where there is none, or where the caller has no way to fetch it.
   */
  readonly welcome?: WelcomePin;
  /** Which pins were new when the panel was opened. */
  readonly unseenIds: ReadonlySet<string>;
  readonly time: TimeDisplay;
  readonly onClose: () => void;
  /** Scroll the conversation to a pin. */
  readonly onJump: (messageId: string) => void;
  /** Drop the NEW marks without waiting for the next open. */
  readonly onMarkRead: () => void;
  readonly onUnpin?: (message: ChatMessage) => void;
}

export function PinnedPanel({
  messages,
  welcome,
  unseenIds,
  time,
  onClose,
  onJump,
  onMarkRead,
  onUnpin,
}: Readonly<PinnedPanelProps>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  // The whole conversation arrives here, so the filter and the sort are worth
  // holding across the renders a hover or a mark-read causes.
  const pins = useMemo(() => pinnedMessages(messages, welcome), [messages, welcome]);
  const unread = pins.filter((message) => unseenIds.has(message.message_id ?? "")).length;

  // Escape closes it, as it does every floating surface in the pack. The
  // scrim below only catches the pointer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <PopoverScrim onClose={onClose} />
      <Box
        role="dialog"
        aria-label={t("nebulaChat:pinned.title")}
        sx={(theme) => ({
          position: "absolute",
          top: HEADER_HEIGHT + 8,
          right: 14,
          width: 460,
          maxWidth: "calc(100% - 28px)",
          zIndex: 25,
          display: "flex",
          flexDirection: "column",
          borderRadius: radius("lg"),
          overflow: "hidden",
          boxShadow: theme.palette.nebula.shadow,
          ...washPanel(theme),
        })}
      >
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            height: 48,
            flex: "none",
            px: "14px",
            color: theme.palette.nebula.text,
            borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
          })}
        >
          <Box sx={{ display: "flex" }}>
            <PinIcon width={13} height={13} aria-hidden="true" />
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t("nebulaChat:pinned.title")}</Typography>
          {pins.length > 0 && (
            <Box
              component="span"
              sx={(theme) => ({
                display: "grid",
                placeItems: "center",
                minWidth: 18,
                height: 18,
                px: "5px",
                borderRadius: "999px",
                background: theme.palette.nebula.card2,
                color: theme.palette.nebula.muted,
                fontSize: 10.5,
                fontWeight: 700,
              })}
            >
              {pins.length}
            </Box>
          )}

          {/* Opening the panel already clears the channel's badge; this is for
              the marks on the rows, which deliberately outlive the open so the
              badge that sent you here can still say what it was about. */}
          {unread > 0 && (
            <Box
              component="button"
              type="button"
              onClick={onMarkRead}
              sx={(theme) => ({
                all: "unset",
                ml: "auto",
                cursor: "pointer",
                fontSize: 11.5,
                color: theme.palette.nebula.muted,
                "&:hover,&:focus-visible": { color: theme.palette.nebula.text },
              })}
            >
              {t("nebulaChat:pinned.markRead")}
            </Box>
          )}
          <Box
            component="button"
            type="button"
            aria-label={t("chat:pinned.closeAriaLabel")}
            onClick={onClose}
            sx={(theme) => ({
              all: "unset",
              ...(unread > 0 ? {} : { marginLeft: "auto" }),
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

        {pins.length === 0 ? (
          <Stack gap={0.5} sx={{ px: "18px", py: "26px", alignItems: "center", textAlign: "center" }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t("chat:pinned.empty")}</Typography>
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
              {t("nebulaChat:pinned.emptyHint")}
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ p: "6px", overflowY: "auto", maxHeight: "min(46vh, 420px)" }}>
            {pins.map((message) => {
              // The welcome pin is not in the conversation, so there is
              // nowhere to jump to and nothing to unpin: it is the server's,
              // not a member's, and offering either would be a dead end.
              const greeting = message.message_id === WELCOME_PIN_ID;
              return (
                <PinRow
                  key={message.message_id}
                  message={message}
                  unseen={unseenIds.has(message.message_id ?? "")}
                  time={time}
                  onJump={greeting ? undefined : onJump}
                  onUnpin={greeting ? undefined : onUnpin}
                />
              );
            })}
          </Box>
        )}

        <Stack
          direction="row"
          alignItems="center"
          sx={(theme) => ({
            flex: "none",
            minHeight: 38,
            px: "14px",
            borderTop: `1px solid ${theme.palette.nebula.washLine}`,
            fontSize: 11,
            color: theme.palette.nebula.muted,
          })}
        >
          {t("nebulaChat:pinned.hint")}
        </Stack>
      </Box>
    </>
  );
}

interface PinRowProps {
  readonly message: ChatMessage;
  readonly unseen: boolean;
  readonly time: TimeDisplay;
  /** Absent for a pin that is not in the conversation - the server's welcome. */
  readonly onJump?: (messageId: string) => void;
  readonly onUnpin?: (message: ChatMessage) => void;
}

/**
 * One pin.
 *
 * The row itself is the button - the whole thing is one target, because there
 * is one thing to do with a pin - and Unpin is a sibling laid over its corner
 * rather than a button inside a button. It takes the NEW mark's place while
 * the pointer is on the row: a row being read no longer needs telling that it
 * is unread, and the corner is where both belong.
 */
function PinRow({ message, unseen, time, onJump, onUnpin }: Readonly<PinRowProps>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const id = message.message_id ?? "";
  // Parsing a body is a DOM round trip; the body only changes on an edit.
  const preview = useMemo(() => pinPreview(message.body), [message.body]);
  const age = pinAge(t, message.timestamp ?? message.pinned_at, time);
  // Named only when it was somebody else's doing: "pinned by" beside the
  // author's own name is a line that never says anything.
  const pinner = message.pinned_by && message.pinned_by !== message.sender_name ? message.pinned_by : null;

  const empty = preview.runs.length === 0;
  const placeholder = preview.image
    ? t("chat:pinned.imageLabel")
    : preview.kind === "poll"
      ? t("nebulaChat:pinned.poll")
      : preview.kind === "file"
        ? t("nebulaChat:pinned.attachment")
        : t("chat:pinned.mediaLabel");

  return (
    <Box
      sx={{
        position: "relative",
        "&:hover .pinnedNew": { opacity: 0 },
        "&:hover .pinnedUnpin": { opacity: 1 },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onJump?.(id)}
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          display: "flex",
          gap: "11px",
          width: "100%",
          // A pin with nowhere to jump is still worth reading, so it is still
          // a row - it just does not pretend to be a link to somewhere.
          cursor: onJump ? "pointer" : "default",
          p: "11px 12px",
          borderRadius: radius("md"),
          "&:hover": { background: theme.palette.nebula.hover },
          "&:focus-visible": { background: theme.palette.nebula.hover },
        })}
      >
        {/* The gutter is drawn on every row, filled only on the unread ones,
            so the avatars stay in one column however the list is read. */}
        <Box
          aria-hidden
          sx={(theme) => ({
            flex: "none",
            alignSelf: "stretch",
            width: 3,
            borderRadius: "999px",
            background: unseen ? theme.palette.nebula.accent : "transparent",
          })}
        />
        <Stack gap={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={0.875}>
            <UserAvatar
              name={message.sender_name}
              session={message.sender_session}
              textureSize={null}
              size={22}
            />
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
              {message.sender_name}
            </Typography>
            {age && (
              <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })} noWrap>
                {age}
              </Typography>
            )}
            {pinner && (
              <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })} noWrap>
                · {t("chat:pinned.pinnedBy", { name: pinner })}
              </Typography>
            )}
            {unseen && (
              <Box
                component="span"
                className="pinnedNew"
                sx={(theme) => ({
                  ml: "auto",
                  flex: "none",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: theme.palette.nebula.accent,
                  transition: "opacity 120ms ease",
                })}
              >
                {t("nebulaChat:pinned.new")}
              </Box>
            )}
          </Stack>

          <Stack direction="row" alignItems="flex-start" gap={1.25}>
            <Typography
              sx={(theme) => ({
                flex: 1,
                minWidth: 0,
                fontSize: 12.5,
                lineHeight: 1.45,
                color: empty ? theme.palette.nebula.muted : theme.palette.nebula.text,
                fontStyle: empty ? "italic" : "normal",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
                wordBreak: "break-word",
              })}
            >
              {empty
                ? placeholder
                : preview.runs.map((run, index) => (
                    <Box
                      component="span"
                      // The runs are a flattening of one body, so their order
                      // is their identity - there is nothing else to key on.
                      key={index}
                      sx={run.code ? { fontFamily: NEBULA_MONO, fontSize: 11.5, fontWeight: 500 } : undefined}
                    >
                      {run.text}
                    </Box>
                  ))}
            </Typography>
            {preview.image && (
              <Box
                component="img"
                src={preview.image}
                alt=""
                sx={{
                  flex: "none",
                  width: 84,
                  height: 48,
                  objectFit: "cover",
                  borderRadius: radius("sm"),
                }}
              />
            )}
          </Stack>
        </Stack>
      </Box>

      {onUnpin && (
        <Tooltip title={t("chat:pinned.unpin")}>
          <Box
            component="button"
            type="button"
            aria-label={t("chat:pinned.unpinAriaLabel")}
            onClick={() => onUnpin(message)}
            className="pinnedUnpin"
            sx={(theme) => ({
              all: "unset",
              position: "absolute",
              top: 10,
              right: 10,
              display: "grid",
              placeItems: "center",
              width: 20,
              height: 20,
              borderRadius: radius("sm"),
              cursor: "pointer",
              opacity: 0,
              color: theme.palette.nebula.muted,
              transition: "opacity 120ms ease",
              "&:hover": { background: theme.palette.nebula.card2, color: theme.palette.nebula.text },
              "&:focus-visible": { opacity: 1, color: theme.palette.nebula.text },
            })}
          >
            <PinOffIcon width={12} height={12} />
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
