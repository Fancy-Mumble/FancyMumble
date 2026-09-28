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

/** One labelled fact a page published about itself.
 *
 *  `name` is the crawler's reading of the page's own label where it recognised
 *  one - "score", "comments", "likes", "views", "shipping", "sellers",
 *  "rating" - and the label the page wrote where it did not. A renderer draws
 *  a shape for the handful it knows and prints the rest as they stand. */
export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

/** What a shop listing costs, where the crawler found a price. */
export interface EmbedPrice {
  /** The amount with a `.` decimal point, whichever way the page wrote it. */
  amount: string;
  /** ISO 4217 ("EUR"), empty where the page named no currency. */
  currency: string;
  /** What it cost before, for a listing advertising a reduction. */
  was: string;
  /** "instock", "oos", "preorder" - as the page wrote it. */
  availability: string;
}

/** A link embed returned by the server after scraping Open Graph / oEmbed data.
 *
 *  `type` is the server's classification, not a guess made here: the crawler
 *  had the page in front of it - its `og:type`, its Twitter card, the content
 *  type the host served - and a client holding a title and a thumbnail cannot
 *  tell a shop listing from an article. See Starling's `link-preview/classify`. */
export interface LinkEmbed {
  url: string;
  type: "video" | "image" | "gifv" | "article" | "link" | "rich" | "audio" | "product" | "forum" | "profile";
  title?: string;
  description?: string;
  color?: number;
  site_name?: string;
  thumbnail?: EmbedMedia;
  image?: EmbedMedia;
  video?: EmbedMedia;
  /** The site's own icon, fetched and inlined by the server like the picture. */
  favicon?: EmbedMedia;
  provider?: { name?: string; url?: string };
  author?: { name?: string; url?: string };
  /** Playing time as a clock, for video and audio: "1:00:14". */
  media_duration?: string;
  /** When the page says it was published, as it wrote it. */
  published_time?: string;
  /**
   * Whether the page's own content rating means "not in front of everybody".
   *
   * Derived on the server side from whichever vocabulary the page used - the
   * word itself arrives as the `content.rating` field - so no client has to
   * keep a list of the words that mean "adult".
   */
  nsfw?: boolean;
  /** The page's own labelled facts, in the order it published them. */
  fields?: EmbedField[];
  price?: EmbedPrice;
}
