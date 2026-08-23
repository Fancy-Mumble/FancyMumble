import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "@mui/material";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { MicOffGlyph, ProfileCard as SharedProfileCard, type AnchorRect } from "@shared/profilecard";
import { nebulaCardTokens } from "../../profileStyle";
import { useUserCardModel } from "./userCardModel";

interface ProfileCardProps {
  user: UserEntry;
  /** The row the card was opened from; null pins it to the conversation's edge. */
  anchor: AnchorRect | null;
  /**
   * False while the card is only following the pointer. It is the same card
   * either way - resting on a row shows exactly what clicking it keeps - so
   * this decides one thing: whether the pointer can reach the card. It must
   * not, or the card would take the pointer off the row that is showing it.
   */
  pinned?: boolean;
  onClose: () => void;
  /** Open the conversation with this person. */
  onMessage: (session: number) => void;
}

/** Marks the card in the DOM, so a click can ask whether it landed on it. */
const CARD_CLASS = "nebula-profile-card";

/**
 * Close the pinned card on the next click that lands outside it.
 *
 * A card that stays until its close button is found is a card left open behind
 * whatever the user went on to do. Listening on the way down, and on the
 * capture phase, means the click that dismisses the card still reaches what it
 * was aimed at - clicking straight from one person's card to another person's
 * row opens theirs rather than being spent closing this one.
 */
function useDismissOnOutsideClick(active: boolean, onClose: () => void): void {
  // The host hands a fresh closure every render; holding it in a ref keeps the
  // listener subscribed once rather than resubscribing behind every keystroke.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(`.${CARD_CLASS}`)) close.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active]);
}

/**
 * The profile card, wherever Nebula shows one.
 *
 * Everything visible here is the shared card; this file is the Nebula half of
 * it - where the card sits, which of the window's colours it borrows, and what
 * its two buttons do. There is no second, smaller card for the pointer: a
 * preview that dropped rows would be a second thing to keep in step with this
 * one, and the first time they drifted the hover would start lying about what
 * a click was going to show.
 */
export function ProfileCard({ user, anchor, pinned = true, onClose, onMessage }: Readonly<ProfileCardProps>) {
  const tokens = nebulaCardTokens(useTheme().palette.nebula);
  const model = useUserCardModel(user, tokens);
  useDismissOnOutsideClick(pinned, onClose);
  const storedVolume = useAppStore((state) => (user.hash ? (state.userVolumes[user.hash] ?? 100) : 100));
  const [volume, setVolume] = useState(storedVolume);

  const applyVolume = (next: number) => {
    setVolume(next);
    if (user.hash) useAppStore.getState().setUserVolume(user.hash, next);
    void invoke("set_user_volume", { session: user.session, volume: next / 100 });
  };

  return (
    <SharedProfileCard
      model={model}
      tokens={tokens}
      onClose={onClose}
      anchor={anchor}
      className={CARD_CLASS}
      placement={{ prefer: "left" }}
      style={{
        // Above the window's own furniture, below the full-window surfaces
        // settings and administration open at 30.
        zIndex: 8,
        ...(pinned ? null : { pointerEvents: "none" }),
        // Without an anchor - opened from something that is not a row - the
        // card keeps the mock's resting place at the window's top right.
        ...(anchor ? null : { position: "absolute" as const, right: 22, top: 78 }),
      }}
      volume={{ value: volume, onChange: setVolume, onCommit: applyVolume }}
      // The mock ends the card on a composer, not a button: the thing you most
      // often want a profile card for is to say something to the person on it.
      // Sending opens the conversation too, so the message is seen to land
      // rather than disappearing into a card that is about to close.
      message={{
        onSend: (text) => {
          void useAppStore.getState().sendDm(user.session, text);
          onMessage(user.session);
        },
      }}
      trailing={{
        label: volume === 0 ? "Unmute locally" : "Mute locally",
        icon: MicOffGlyph,
        active: volume === 0,
        onClick: () => applyVolume(volume === 0 ? 100 : 0),
      }}
    />
  );
}
