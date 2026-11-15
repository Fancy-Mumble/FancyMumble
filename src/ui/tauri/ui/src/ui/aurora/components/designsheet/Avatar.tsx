import identity from "./designSheetIdentity.module.css";

export interface AvatarProps {
  label: string;
  online?: boolean;
  /** Lets a parent attach its own contextual sizing/placement modifier. */
  className?: string;
}

/** Initials chip with an optional presence dot. */
export default function Avatar({ label, online = false, className }: AvatarProps) {
  return (
    <span className={`${identity.avatar} ${className ?? ""}`} aria-label={label}>
      {label}
      {online && <i />}
    </span>
  );
}
