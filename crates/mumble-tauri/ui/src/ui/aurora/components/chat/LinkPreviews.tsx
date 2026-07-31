import type { LinkEmbed } from "@core/types";
import styles from "../../AuroraClientSurfaces.module.css";

export type LinkPreviewsProps = { embeds: LinkEmbed[]; allowExternal: boolean };

export default function LinkPreviews({ embeds, allowExternal }: LinkPreviewsProps) {
  return (
    <div className={styles.previews}>
      {embeds.map((embed) => {
        const image =
          embed.image?.preview?.data_url ??
          embed.thumbnail?.preview?.data_url ??
          (allowExternal ? (embed.image?.url ?? embed.thumbnail?.url) : undefined);
        let host = embed.url;
        try {
          host = new URL(embed.url).hostname;
        } catch {
          /* retain the original value */
        }
        return (
          <a
            key={`${embed.url}-${embed.title}`}
            className={styles.preview}
            href={embed.url}
            target="_blank"
            rel="noreferrer"
          >
            <div>
              <small>{embed.site_name ?? embed.provider?.name ?? host}</small>
              <strong>{embed.title ?? embed.url}</strong>
              {embed.description && <p>{embed.description}</p>}
            </div>
            {image && <img src={image} alt="" loading="lazy" />}
          </a>
        );
      })}
    </div>
  );
}
