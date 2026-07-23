import { useTranslation } from "react-i18next";
import type { ImageWrapMode } from "./LiveDocImage";

export function wrapLabel(mode: ImageWrapMode, t: ReturnType<typeof useTranslation>["t"]): string {
  const tr = t as (key: string) => string;
  switch (mode) {
    case "inline":   return tr("liveDoc.image.inline");
    case "wrap":     return tr("liveDoc.image.wrap");
    case "wrapRight":return tr("liveDoc.image.wrapRight");
    case "break":    return tr("liveDoc.image.break");
    case "behind":   return tr("liveDoc.image.behind");
    case "front":    return tr("liveDoc.image.front");
  }
}

export function WrapIcon({ mode }: { readonly mode: ImageWrapMode }) {
  switch (mode) {
    case "inline":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <rect x="2" y="3" width="6" height="4" rx="0.5" fill="currentColor" />
          <line x1="9" y1="4" x2="14" y2="4" stroke="currentColor" />
          <line x1="9" y1="6" x2="14" y2="6" stroke="currentColor" />
          <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" />
          <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" />
        </svg>
      );
    case "wrap":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <rect x="2" y="3" width="5" height="5" rx="0.5" fill="currentColor" />
          <line x1="8" y1="4" x2="14" y2="4" stroke="currentColor" />
          <line x1="8" y1="6" x2="14" y2="6" stroke="currentColor" />
          <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" />
          <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" />
        </svg>
      );
    case "wrapRight":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <rect x="9" y="3" width="5" height="5" rx="0.5" fill="currentColor" />
          <line x1="2" y1="4" x2="8" y2="4" stroke="currentColor" />
          <line x1="2" y1="6" x2="8" y2="6" stroke="currentColor" />
          <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" />
          <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" />
        </svg>
      );
    case "break":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" />
          <rect x="4" y="5" width="8" height="4" rx="0.5" fill="currentColor" />
          <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" />
          <line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" />
        </svg>
      );
    case "behind":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" rx="0.5" fill="currentColor" opacity="0.35" />
          <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" />
          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" />
          <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" />
        </svg>
      );
    case "front":
      return (
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
          <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" opacity="0.5" />
          <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" opacity="0.5" />
          <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" opacity="0.5" />
          <line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" opacity="0.5" />
          <rect x="3" y="3" width="10" height="10" rx="0.5" fill="currentColor" />
        </svg>
      );
  }
}
