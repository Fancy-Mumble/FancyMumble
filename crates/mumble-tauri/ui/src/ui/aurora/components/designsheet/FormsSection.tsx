import { useState } from "react";
import forms from "./FormsSection.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import fields from "./designSheetFields.module.css";
import layout from "./designSheetLayout.module.css";
import { CheckIcon as Check, ChevronDownIcon as ChevronDown, CloseIcon as X, LockIcon as LockKeyhole, SearchIcon as Search, ServerIcon as Server, VolumeIcon as Volume2 } from "@ui/icons";

/** Section forms of the design sheet. */
export default function FormsSection() {
  const [selectedPlan, setSelectedPlan] = useState("Balanced");
  const [toggleOn, setToggleOn] = useState(true);

  return (
    <Section id="forms" eyebrow="03 / Forms" title="Input, without friction" description="Accessible fields for server setup, profiles, permissions, search, security, and deep preference screens.">
      <div className={layout.specimenGrid}>
        <Specimen title="Text fields" meta="Input states" wide>
          <div className={forms.formGrid}>
            <label className={fields.field}><span>Display name</span><input defaultValue="Morgan Oakes" /><small>This is how others see you.</small></label>
            <label className={fields.field}><span>Server address</span><div className={fields.inputWithIcon}><Server size={16} /><input placeholder="voice.example.com" /></div></label>
            <label className={`${fields.field} ${fields.fieldError}`}><span>Password</span><div className={fields.inputWithIcon}><LockKeyhole size={16} /><input type="password" defaultValue="incorrect" /></div><small>That password doesn’t match.</small></label>
            <label className={fields.field}><span>Search</span><div className={fields.inputWithIcon}><Search size={16} /><input placeholder="Messages, people, files…" /><kbd>⌘ K</kbd></div></label>
          </div>
        </Specimen>
        <Specimen title="Selection" meta="Checkbox / radio">
          <div className={forms.optionStack}>
            {["Balanced", "Voice clarity", "Studio quality"].map(option => <label key={option} className={forms.radioRow}><input type="radio" checked={selectedPlan === option} onChange={() => setSelectedPlan(option)} /><span><i />{option}</span></label>)}
            <label className={forms.checkRow}><input type="checkbox" defaultChecked /><span><Check size={12} /></span>Auto-connect on launch</label>
          </div>
        </Specimen>
        <Specimen title="Switches & slider" meta="Preferences">
          <div className={forms.settingRow}><span><strong>Noise suppression</strong><small>Remove background sound</small></span><button type="button" role="switch" aria-checked={toggleOn} className={toggleOn ? forms.switchOn : forms.switch} onClick={() => setToggleOn(value => !value)}><i /></button></div>
          <label className={forms.range}><span><Volume2 size={15} /> Output volume <b>72%</b></span><input type="range" defaultValue="72" /></label>
        </Specimen>
        <Specimen title="Select & tags" meta="Structured input" wide>
          <div className={forms.formGrid}>
            <label className={fields.field}><span>Input device</span><div className={fields.selectLike}>Studio microphone <ChevronDown size={15} /></div></label>
            <label className={fields.field}><span>Roles</span><div className={`${forms.tagInput} ${fields.fieldTagInput}`}><span>Designer <X size={12} /></span><span>Moderator <X size={12} /></span><input placeholder="Add role…" /></div></label>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
