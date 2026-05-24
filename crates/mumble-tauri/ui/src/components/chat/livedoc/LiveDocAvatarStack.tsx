/**
 * LiveDocAvatarStack - shows up to N peer avatars in the Live Doc
 * panel header; overflow collapses into a `+X` chip that pops a
 * scrollable list of the remaining editors.
 *
 * The local user is rendered first with a small "you" marker.  Each
 * avatar's border colour matches the peer's awareness colour so
 * users can match avatars to inline cursors.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { getCachedUserAvatar } from "../../../lazyBlobs";
import type { LiveDocPeer } from "./useLiveDoc";
import styles from "./LiveDocAvatarStack.module.css";

interface LiveDocAvatarStackProps {
  readonly peers: ReadonlyArray<LiveDocPeer>;
  /** Maximum avatars to render before collapsing to a +X chip. */
  readonly max?: number;
}

export default function LiveDocAvatarStack({ peers, max = 5 }: LiveDocAvatarStackProps) {
  const { t } = useTranslation("chat");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Sort: local user first, then alphabetically by name for stability.
  const ordered = useMemo(() => {
    const list = [...peers];
    list.sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [peers]);

  const visible = ordered.slice(0, max);
  const overflow = ordered.slice(max);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [overflowOpen]);

  if (ordered.length === 0) return null;

  return (
    <div
      className={styles.stack}
      role="group"
      aria-label={t("liveDoc.peers", { count: ordered.length })}
    >
      {visible.map((p) => (
        <AvatarChip key={p.session} peer={p} />
      ))}
      {overflow.length > 0 && (
        <div ref={overflowRef} className={styles.overflowWrap}>
          <button
            type="button"
            className={styles.overflowChip}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={overflowOpen}
            title={t("liveDoc.peers", { count: overflow.length })}
          >
            +{overflow.length}
          </button>
          {overflowOpen && (
            <div className={styles.overflowMenu} role="listbox">
              {overflow.map((p) => (
                <OverflowRow key={p.session} peer={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AvatarChip({ peer }: { readonly peer: LiveDocPeer }) {
  const { t } = useTranslation("chat");
  const textureSize = useAppStore(
    (s) => s.users.find((u) => u.session === peer.session)?.texture_size ?? null,
  );
  const src = getCachedUserAvatar(peer.session, textureSize);

  return (
    <span
      className={styles.avatar}
      style={{ borderColor: peer.color }}
      title={peer.isLocal ? `${peer.name} (${t("liveDoc.you")})` : peer.name}
      aria-label={peer.isLocal ? `${peer.name} (${t("liveDoc.you")})` : peer.name}
    >
      {src ? (
        <img src={src} alt="" className={styles.avatarImg} />
      ) : (
        <span className={styles.avatarFallback}>{initials(peer.name)}</span>
      )}
      {peer.isLocal && <span className={styles.localDot} aria-hidden="true" />}
    </span>
  );
}

function OverflowRow({ peer }: { readonly peer: LiveDocPeer }) {
  const textureSize = useAppStore(
    (s) => s.users.find((u) => u.session === peer.session)?.texture_size ?? null,
  );
  const src = getCachedUserAvatar(peer.session, textureSize);

  return (
    <div className={styles.overflowRow}>
      <span className={styles.overflowAvatar} style={{ borderColor: peer.color }}>
        {src ? (
          <img src={src} alt="" className={styles.avatarImg} />
        ) : (
          <span className={styles.avatarFallback}>{initials(peer.name)}</span>
        )}
      </span>
      <span className={styles.overflowName}>{peer.name || "—"}</span>
    </div>
  );
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
