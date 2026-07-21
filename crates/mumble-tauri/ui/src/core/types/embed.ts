/** Server-scraped link embeds and the inlined media previews they carry. */

/** A server-side downscaled, base64 inlined preview of an image-type
 *  media field. Surfaced by the server so clients never need to contact
 *  the origin host (avoids leaking the user's IP). */
export interface EmbedPreview {
  /** A `data:image/<mime>;base64,...` URL ready to use as `<img src>`. */
  data_url: string;
  mime: string;
  width?: number;
  height?: number;
}

/** Dimension/URL pair for an embedded image or video. */
export interface EmbedMedia {
  url: string;
  width?: number;
  height?: number;
  /** Original byte size of the upstream resource (when known). */
  original_size?: number;
  /** Server-generated downscaled preview, when available. Always prefer
   *  `preview.data_url` over `url` to avoid IP leaks. */
  preview?: EmbedPreview;
}

/** A link embed returned by the server after scraping Open Graph / oEmbed data. */
export interface LinkEmbed {
  url: string;
  type: "video" | "image" | "gifv" | "article" | "link" | "rich";
  title?: string;
  description?: string;
  color?: number;
  site_name?: string;
  thumbnail?: EmbedMedia;
  image?: EmbedMedia;
  video?: EmbedMedia;
  provider?: { name?: string; url?: string };
  author?: { name?: string; url?: string };
}
