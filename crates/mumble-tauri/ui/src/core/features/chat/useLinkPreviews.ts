import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { requestLinkPreview, useAppStore } from "../../store";
import type { LinkEmbed } from "../../types";
import { extractUrlsFromMessage } from "../../utils/extractUrls";

/**
 * The cards for the links in one message.
 *
 * Requesting and reading belong together: a renderer that reads `linkEmbeds`
 * without sending the request draws nothing and gives no sign why. The store
 * drops URLs it already holds or has in flight, so every renderer of every
 * message may call this.
 *
 * Lookups are by **URL**, not by message id. That is what makes re-reading a
 * channel free: the store, the backend's encrypted cache and the server all key
 * on the same string, so a link that has been seen before costs nothing at any
 * of the three layers - and the same link in ten messages is one card rather
 * than ten fetches.
 *
 * Cards come back in the order the links appear in the message, which is the
 * order a reader expects; keying by message id returned them in whatever order
 * the hosts happened to answer.
 */
export function useLinkPreviews(
  messageId: string | null | undefined,
  body: string,
): LinkEmbed[] | undefined {
  const disabled = useAppStore((state) => state.disableLinkPreviews);

  // Extracting is a scan of the message body and this runs on every render of
  // every message in the viewport.
  const urls = useMemo(() => (disabled ? [] : extractUrlsFromMessage(body)), [body, disabled]);

  // This message's cards, rather than the map holding everybody's. The map is
  // replaced whenever any preview anywhere lands, so subscribing to it made a
  // single card arriving re-render every message in the viewport.
  const embeds = useAppStore(useShallow((state) => urls.map((url) => state.linkEmbeds.get(url))));

  useEffect(() => {
    if (!messageId || disabled || urls.length === 0) return;
    void requestLinkPreview(urls, messageId);
  }, [messageId, urls, disabled]);

  return useMemo(() => {
    if (disabled || urls.length === 0) return undefined;
    const found = embeds.filter((embed): embed is LinkEmbed => embed !== undefined);
    // `undefined` rather than an empty array while nothing has arrived: the
    // renderers branch on it, and an empty array is a message whose links all
    // failed rather than one still waiting.
    return found.length > 0 ? found : undefined;
  }, [urls, embeds, disabled]);
}
