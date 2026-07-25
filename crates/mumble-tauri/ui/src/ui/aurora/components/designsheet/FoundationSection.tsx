import Avatar from "./Avatar";
import foundation from "./FoundationSection.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import identity from "./designSheetIdentity.module.css";
import layout from "./designSheetLayout.module.css";
import { CheckIcon as Check, HashIcon as Hash, ShieldCheckIcon as ShieldCheck } from "@ui/icons";
import { avatars } from "./designSheetData";

/** Section foundation of the design sheet. */
export default function FoundationSection() {
  return (
    <Section id="foundation" eyebrow="01 / Foundation" title="The visual grammar" description="Color, type, elevation, shape, icons, spacing, and identity primitives form the shared baseline.">
      <div className={layout.specimenGrid}>
        <Specimen title="Color tokens" meta="Semantic palette" wide>
          <div className={foundation.swatches}>
            {[
              ["Ink", "#0B0E13", foundation.ink], ["Canvas", "#12171E", foundation.canvas],
              ["Cloud", "#F3F5F7", foundation.cloud], ["Signal", "#69B7E8", foundation.signal],
              ["Slate", "#718096", foundation.iris], ["Coral", "#E4776D", foundation.coral],
            ].map(([name, hex, className]) => <div key={name} className={foundation.swatch}><i className={className} /><strong>{name}</strong><span>{hex}</span></div>)}
          </div>
        </Specimen>
        <Specimen title="Typography" meta="Display / body / mono" wide>
          <div className={foundation.typeScale}>
            <div><span>Display</span><strong>Clear voice,<br />quiet confidence.</strong></div>
            <div><span>Body</span><p>Designed to remain readable in dense workspaces, long conversations, and peripheral controls.</p></div>
            <code>MONO 12 · STATUS_CONNECTED</code>
          </div>
        </Specimen>
        <Specimen title="Avatars & presence" meta="User identity">
          <div className={identity.avatarRow}>
            <Avatar label="MO" online /><Avatar label="AK" /><Avatar label="SR" online />
            <span className={identity.avatarGroup}>{avatars.map(value => <Avatar key={value} label={value} />)}<b>+8</b></span>
          </div>
        </Specimen>
        <Specimen title="Chips & badges" meta="Metadata">
          <div className={layout.wrapRow}>
            <span className={identity.chip}><Hash size={12} /> design</span>
            <span className={identity.successChip}><Check size={12} /> verified</span>
            <span className={identity.roleChip}><ShieldCheck size={12} /> moderator</span>
            <span className={identity.countBadge}>12</span>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
