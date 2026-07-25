import type { ReactNode } from "react";
import layout from "./designSheetLayout.module.css";

export interface SpecimenProps {
  title: string;
  meta: string;
  wide?: boolean;
  children: ReactNode;
}

/** A single labelled exhibit inside a design-sheet section. */
export default function Specimen({ title, meta, wide, children }: SpecimenProps) {
  return (
    <article className={`${layout.specimen} ${wide ? layout.wide : ""}`}>
      <div className={layout.specimenLabel}>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className={layout.specimenBody}>{children}</div>
    </article>
  );
}
