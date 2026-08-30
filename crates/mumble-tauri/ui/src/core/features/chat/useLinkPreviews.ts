import { useEffect } from "react";
import { requestLinkPreview, useAppStore } from "../../store";
import type { LinkEmbed } from "../../types";
import { extractUrlsFromMessage } from "../../utils/extractUrls";

/**
 * Ask the server for previews of the links in one message, and return the
 * embeds it sent back.
 *
 * Requesting and reading belong together: the embeds only ever arrive for a
 * `request_id` somebody asked about, so a renderer that reads `linkEmbeds`
 * without sending the request draws nothing and gives no sign why. The store
 * drops duplicate requests, so every renderer of a message may call this.
 */
export function useLinkPreviews(
  messageId: string | null | undefined,
  body: string,
): LinkEmbed[] | undefined {
  const disabled = useAppStore((state) => state.disableLinkPreviews);
  const embeds = useAppStore((state) => (messageId ? state.linkEmbeds.get(messageId) : undefined));

  useEffect(() => {
    if (!messageId || disabled) return;
    const urls = extractUrlsFromMessage(body);
    if (urls.length === 0) return;
    void requestLinkPreview(urls, messageId);
  }, [messageId, body, disabled]);

  return disabled ? undefined : embeds;
}
