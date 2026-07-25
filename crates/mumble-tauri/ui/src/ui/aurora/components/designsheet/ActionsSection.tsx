import { useState } from "react";
import Section from "./Section";
import Specimen from "./Specimen";
import controls from "./designSheetControls.module.css";
import layout from "./designSheetLayout.module.css";
import { AttachIcon as Paperclip, ChevronDownIcon as ChevronDown, KebabMenuIcon as MoreHorizontal, PlusIcon as Plus, SearchIcon as Search, SettingsIcon as Settings2, TrashIcon as Trash2, UserPlusIcon as UserPlus } from "@ui/icons";

/** Section actions of the design sheet. */
export default function ActionsSection() {
  const [tab, setTab] = useState("Overview");

  return (
    <Section id="actions" eyebrow="02 / Actions" title="Buttons with intent" description="A small hierarchy of clear actions replaces one-off button treatments across dialogs, chat, calls, and settings.">
      <div className={layout.specimenGrid}>
        <Specimen title="Button hierarchy" meta="Default states" wide>
          <div className={layout.wrapRow}>
            <button type="button" className={controls.primaryButton}><Plus size={15} /> Create channel</button>
            <button type="button" className={controls.secondaryButton}><UserPlus size={15} /> Invite people</button>
            <button type="button" className={controls.ghostButton}><Settings2 size={15} /> Configure</button>
            <button type="button" className={controls.dangerButton}><Trash2 size={15} /> Delete</button>
            <button type="button" className={controls.secondaryButton} disabled>Unavailable</button>
          </div>
        </Specimen>
        <Specimen title="Icon actions" meta="Compact controls">
          <div className={layout.wrapRow}>
            <button type="button" className={controls.iconButton}><Search size={17} /></button>
            <button type="button" className={controls.iconButton}><Paperclip size={17} /></button>
            <button type="button" className={controls.iconButton}><MoreHorizontal size={17} /></button>
            <button type="button" className={controls.floatingButton}><Plus size={20} /></button>
          </div>
        </Specimen>
        <Specimen title="Split & segmented" meta="Related actions">
          <div className={controls.splitButton}><button type="button">Join voice</button><button type="button" aria-label="More join options"><ChevronDown size={15} /></button></div>
          <div className={controls.segmented}>{["Overview", "Members", "Files"].map(item => <button type="button" key={item} className={tab === item ? controls.segmentActive : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        </Specimen>
      </div>
    </Section>
  );
}
