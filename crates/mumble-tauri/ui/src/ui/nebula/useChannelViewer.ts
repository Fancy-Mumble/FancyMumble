/**
 * How the channel column draws the people in a channel.
 *
 * The record is Standard's `channelViewerStyle`, and the Personalize page
 * writes it from either design, so the choice follows the user between packs
 * rather than being asked twice.
 *
 * Nebula answers two of the three values. "Flat" lists occupants by name under
 * their channel; "modern" stacks their faces on the channel row itself, which
 * is the compact reading of a long server.
 *
 * Standard's third value, "classic", is its traditional Mumble tree: folders
 * that expand and collapse behind a chevron, the current channel held at the
 * top, and stacked avatars on each entry. The avatars are the part Nebula
 * already draws - that is "modern" - so what actually separates classic is the
 * collapsing, which Nebula's column has none of: every channel it is allowed
 * to see is on screen. A stored "classic" therefore reads as "flat" here, and
 * `PersonalizeSettings` says so rather than letting the picker present it as
 * the user's own choice.
 */
import { useEffect, useState } from "react";
import {
  loadPersonalization,
  PERSONALIZATION_CHANGED_EVENT,
  type ChannelViewerStyle,
} from "@standard/personalizationStorage";

/** The two layouts Nebula draws. */
export type NebulaChannelViewer = "flat" | "modern";

/** Standard's three-valued record, narrowed to what Nebula can draw. */
export function nebulaChannelViewer(style: ChannelViewerStyle | undefined): NebulaChannelViewer {
  return style === "modern" ? "modern" : "flat";
}

export function useChannelViewer(): NebulaChannelViewer {
  const [style, setStyle] = useState<NebulaChannelViewer>("flat");

  useEffect(() => {
    let live = true;
    const read = () => {
      void loadPersonalization()
        .then((data) => {
          if (live) setStyle(nebulaChannelViewer(data.channelViewerStyle));
        })
        .catch(() => undefined);
    };
    read();
    // The setting is two panes away from the list it changes, so waiting for a
    // remount would make it look like it had done nothing again.
    globalThis.addEventListener(PERSONALIZATION_CHANGED_EVENT, read);
    return () => {
      live = false;
      globalThis.removeEventListener(PERSONALIZATION_CHANGED_EVENT, read);
    };
  }, []);

  return style;
}
