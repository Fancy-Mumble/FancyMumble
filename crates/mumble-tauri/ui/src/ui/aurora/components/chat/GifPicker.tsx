import { useEffect, useState } from "react";
import { findKlipyMedia, type KlipyResult } from "@core/features/chat/gif/klipyClient";
import { Button, SearchField } from "../primitives";
import styles from "./GifPicker.module.css";

export function GifPicker({
  onSelect,
  onClose,
}: {
  onSelect: (gif: KlipyResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<KlipyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const timer = globalThis.setTimeout(
      () => {
        setLoading(true);
        setError(null);
        void findKlipyMedia(query)
          .then((result) => {
            if (active) setItems(result.items);
          })
          .catch((reason) => {
            if (active) {
              setItems([]);
              setError(reason instanceof Error ? reason.message : String(reason));
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
    };
  }, [query]);
  return (
    <section className={styles.picker}>
      <header>
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIFs"
          aria-label="Search GIFs"
          onDismiss={onClose}
          dismissLabel="Close GIF picker"
          autoFocus
        />
      </header>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <div className={styles.state}>Finding GIFs…</div>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <Button variant="bare" key={item.id} onClick={() => onSelect(item)} title={item.title}>
              <img src={item.preview} alt={item.title} loading="lazy" />
            </Button>
          ))}
        </div>
      )}
      <footer>Powered by Klipy</footer>
    </section>
  );
}
