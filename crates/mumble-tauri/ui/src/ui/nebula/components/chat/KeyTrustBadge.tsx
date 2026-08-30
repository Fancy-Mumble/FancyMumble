import { Tooltip } from "@mui/material";
import type { KeyTrustLevel } from "@core/types";
import { DatabaseIcon, LockIcon, ShieldCheckIcon, ShieldIcon, WarningIcon } from "@ui/icons";
import { StatChip, type StatChipTone } from "../primitives";

/**
 * What the header says about a channel's key, at each level of trust.
 *
 * Every level carries its own glyph and its own word, so the four are told
 * apart without reading the colour - the tone is there to make disputed
 * impossible to miss, not to be the only thing that distinguishes it.
 */
const TRUST: Record<
  KeyTrustLevel,
  { label: string; tone: StatChipTone; Icon: typeof ShieldIcon; hint: string }
> = {
  Verified: {
    label: "Verified",
    tone: "ok",
    Icon: ShieldCheckIcon,
    hint: "This channel's key is the one you have seen before.",
  },
  ManuallyVerified: {
    label: "Manually verified",
    tone: "ok",
    Icon: ShieldCheckIcon,
    hint: "You compared this channel's fingerprint yourself.",
  },
  Unverified: {
    label: "Unverified",
    tone: "neutral",
    Icon: ShieldIcon,
    hint: "Nobody has checked this channel's key yet.",
  },
  Disputed: {
    label: "Disputed",
    tone: "bad",
    Icon: WarningIcon,
    hint: "Two different keys claim this channel. Compare the fingerprints before trusting it.",
  },
};

interface KeyTrustBadgeProps {
  /** Whether the channel's messages are end-to-end encrypted at all. */
  encrypted: boolean;
  /** Trust in the key, once the client has one to judge. */
  level?: KeyTrustLevel;
  /** Opens the verification dialog; the badge is the way in to it. */
  onVerify?: () => void;
}

/**
 * The encryption fact beside the channel name.
 *
 * An encrypted channel whose key has not been judged yet says only that it is
 * encrypted rather than borrowing "unverified", which is a verdict: the key
 * may simply not have arrived. A channel with no encryption says nothing -
 * silence is the ordinary case and does not deserve a chip.
 */
export function KeyTrustBadge({ encrypted, level, onVerify }: Readonly<KeyTrustBadgeProps>) {
  if (!encrypted && !level) return null;

  const trust = level ? TRUST[level] : null;
  const Icon = trust?.Icon ?? LockIcon;
  const label = trust?.label ?? "Encrypted";
  const hint = trust?.hint ?? "Messages here are end-to-end encrypted.";
  const action = onVerify
    ? ({
        component: "button",
        type: "button",
        onClick: onVerify,
        sx: { cursor: "pointer", fontFamily: "inherit" },
      } as const)
    : {};

  return (
    <Tooltip title={onVerify ? `${hint} Click to compare fingerprints.` : hint}>
      <StatChip tone={trust?.tone ?? "neutral"} {...action}>
        <Icon width={12} height={12} aria-hidden="true" />
        {label}
      </StatChip>
    </Tooltip>
  );
}

/**
 * The persistence fact, beside the trust one.
 *
 * Deliberately its own chip: where the history lives and who can read it are
 * separate questions, and a single badge covering both would leave the reader
 * unable to tell which of the two it was answering.
 */
export function HistoryBadge() {
  return (
    <Tooltip title="This channel keeps its history on the server, so messages are here when you come back.">
      <StatChip tone="neutral">
        <DatabaseIcon width={12} height={12} aria-hidden="true" />
        History saved
      </StatChip>
    </Tooltip>
  );
}
