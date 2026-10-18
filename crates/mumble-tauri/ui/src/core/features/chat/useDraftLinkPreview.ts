import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import type { LinkEmbed } from "../../types";
import { extractUrlsFromMessage } from "../../utils/extractUrls";
import { useLinkPreviews } from "./useLinkPreviews";

/**
 * How long a link has to sit in the draft before it is asked about.
 *
 * A pasted link arrives whole and waits this long for nothing; a typed one
 * arrives a character at a time, and without the pause every prefix of it -
 * `https://y`, `https://yo` - would be a fetch of a host nobody meant.
 */
const SETTLE_MS = 450;

/**
 * How long the row waits for a card before it gives up and goes.
 *
 * The store cannot tell a card still on its way from one that will never come:
 * a refused link simply has no entry. A row that said "fetching" forever over a
 * link with no preview would be lying, so it stops saying it.
 */
const GIVE_UP_MS = 10_000;

export interface DraftLinkPreview {
  /** The link the row is about: the first one in the draft. */
  url: string;
  /** Its card, once the server has answered. */
  embed: LinkEmbed | undefined;
  /** Hide the row for this link until the draft is cleared. */
  dismiss: () => void;
}

/**
 * The card for the first link in a message that has not been sent yet.
 *
 * Asked for through the same store as a sent message's cards, and keyed the
 * same way - by URL - so the fetch this starts is the one the sent message
 * would have made anyway: the card is already held when the message lands and
 * draws without a round-trip.
 *
 * Dismissing hides the row only. What the channel draws under the sent message
 * is each reader's own preference, and nothing in the draft speaks for it.
 */
export function useDraftLinkPreview(draft: string): DraftLinkPreview | null {
  const disabled = useAppStore((state) => state.disableLinkPreviews);
  const first = useMemo(() => (disabled ? undefined : extractUrlsFromMessage(draft)[0]), [draft, disabled]);

  const [settled, setSettled] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!first) {
      setSettled(undefined);
      return;
    }
    const timer = setTimeout(() => setSettled(first), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [first]);

  // Closed rows stay closed for the life of the draft, and come back with the
  // next one: sending, or clearing the field, is starting over.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (draft === "") setDismissed((current) => (current.size === 0 ? current : new Set()));
  }, [draft]);

  // A link still in the draft but no longer first is not the row's business.
  const url = settled !== undefined && settled === first && !dismissed.has(settled) ? settled : undefined;

  const embeds = useLinkPreviews(url ? `draft:${url}` : null, url ?? "");
  const embed = embeds?.[0];

  const [gaveUp, setGaveUp] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!url || embed) return;
    const timer = setTimeout(() => setGaveUp(url), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [url, embed]);

  const dismiss = useCallback(() => {
    if (!url) return;
    setDismissed((current) => new Set(current).add(url));
  }, [url]);

  if (!url || (!embed && gaveUp === url)) return null;
  return { url, embed, dismiss };
}
