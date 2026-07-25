import type { ReactNode } from "react";
import { CloseIcon } from "@ui/icons";
import IconButton from "./IconButton";
import styles from "../../AuroraClientSurfaces.module.css";

export interface ModalSurfaceProps {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
}

export default function ModalSurface({ title, eyebrow, onClose, children, className = "", backdropClassName = "" }: ModalSurfaceProps) {
  return <div className={`${styles.backdrop} ${backdropClassName}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.surface} ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><div><small>{eyebrow}</small><h2>{title}</h2></div><IconButton icon={<CloseIcon />} label="Close" onClick={onClose} /></header><div className={styles.surfaceBody}>{children}</div></section></div>;
}
