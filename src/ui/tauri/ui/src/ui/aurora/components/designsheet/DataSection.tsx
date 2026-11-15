import { Checkbox } from "../primitives";
import Avatar from "./Avatar";
import calendar from "./CalendarSpecimen.module.css";
import editor from "./EditorSpecimen.module.css";
import memberTable from "./MemberTableSpecimen.module.css";
import profileCard from "./ProfileCardSpecimen.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import controls from "./designSheetControls.module.css";
import fields from "./designSheetFields.module.css";
import identity from "./designSheetIdentity.module.css";
import layout from "./designSheetLayout.module.css";
import {
  CheckIcon as Check,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  ClockIcon as Clock3,
  CodeIcon as Code2,
  ImageIcon as Image,
  KebabMenuIcon as MoreHorizontal,
  Link2Icon as Link2,
  MessageCircleIcon as MessageCircle,
  SearchIcon as Search,
  SettingsIcon as Settings2,
  ShieldCheckIcon as ShieldCheck,
  UserPlusIcon as UserPlus,
} from "@ui/icons";

/** Section data of the design sheet. */
export default function DataSection() {
  return (
    <Section
      id="data"
      eyebrow="08 / Data display"
      title="Dense, never crowded"
      description="Profiles, roles, server metrics, audit data, schedules, and document tools remain scannable at every density."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Member table" meta="Admin / roles / status" wide>
          <div className={memberTable.tableToolbar}>
            <div className={`${fields.inputWithIcon} ${memberTable.tableToolbarInputWithIcon}`}>
              <Search />
              <input placeholder="Filter members…" />
            </div>
            <button type="button" className={controls.secondaryButton}>
              <Settings2 /> Columns
            </button>
            <button type="button" className={controls.primaryButton}>
              <UserPlus /> Add member
            </button>
          </div>
          <div className={memberTable.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>
                    <Checkbox aria-label="Select row" />
                  </th>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[
                  ["MO", "Morgan Oakes", "Owner", "Online", "Jan 12"],
                  ["AK", "Alex Kim", "Designer", "In voice", "Mar 04"],
                  ["SR", "Sam Rivera", "Moderator", "Away", "Apr 19"],
                ].map((row) => (
                  <tr key={row[1]}>
                    <td>
                      <Checkbox aria-label="Select row" />
                    </td>
                    <td>
                      <Avatar label={row[0]} className={memberTable.tableWrapAvatar} />
                      <span>
                        <strong>{row[1]}</strong>
                        <small>@{row[1].toLowerCase().replace(" ", ".")}</small>
                      </span>
                    </td>
                    <td>
                      <span className={`${identity.roleChip} ${memberTable.tableWrapRoleChip}`}>
                        {row[2]}
                      </span>
                    </td>
                    <td>
                      <span className={memberTable.tableStatus}>
                        <i />
                        {row[3]}
                      </span>
                    </td>
                    <td>{row[4]}</td>
                    <td>
                      <MoreHorizontal />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Specimen>
        <Specimen title="Profile card" meta="Identity / trust">
          <div className={profileCard.profileCard}>
            <div className={profileCard.profileCover} />
            <div className={profileCard.profileBody}>
              <Avatar label="MO" online className={profileCard.profileBodyAvatar} />
              <button type="button">
                <MoreHorizontal />
              </button>
              <h3>
                Morgan Oakes <ShieldCheck />
              </h3>
              <small>@morgan · they/them</small>
              <p>Product designer. Voice nerd. Building kinder tools for teams.</p>
              <div>
                <span>
                  <strong>42</strong>
                  <small>Friends</small>
                </span>
                <span>
                  <strong>8</strong>
                  <small>Servers</small>
                </span>
                <span>
                  <strong>3y</strong>
                  <small>Member</small>
                </span>
              </div>
              <button
                type="button"
                className={`${controls.primaryButton} ${profileCard.profileBodyPrimaryButton}`}
              >
                <MessageCircle /> Message
              </button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Calendar" meta="Events / schedule">
          <div className={calendar.calendar}>
            <header>
              <button type="button">
                <ChevronLeft />
              </button>
              <strong>July 2026</strong>
              <button type="button">
                <ChevronRight />
              </button>
            </header>
            <div className={calendar.weekdays}>
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <b key={`${day}-${index}`}>{day}</b>
              ))}
            </div>
            <div className={calendar.days}>
              {Array.from({ length: 35 }, (_, index) => (
                <button
                  type="button"
                  key={index}
                  className={
                    index === 22 ? calendar.today : index === 15 || index === 24 ? calendar.hasEvent : ""
                  }
                >
                  {index < 3 ? 28 + index : index - 2}
                </button>
              ))}
            </div>
            <div className={calendar.nextEvent}>
              <span>
                <Clock3 />
              </span>
              <div>
                <small>NEXT · 14:00</small>
                <strong>Design review</strong>
              </div>
              <Avatar label="+4" className={calendar.nextEventAvatar} />
            </div>
          </div>
        </Specimen>
        <Specimen title="Editor toolbar" meta="Live documents" wide>
          <div className={editor.editor}>
            <div className={editor.editorToolbar}>
              <select aria-label="Text style" defaultValue="Body">
                <option>Body</option>
              </select>
              <i />
              <button type="button">
                <strong>B</strong>
              </button>
              <button type="button">
                <em>I</em>
              </button>
              <button type="button">
                <u>U</u>
              </button>
              <i />
              <button type="button">
                <Link2 />
              </button>
              <button type="button">
                <Image />
              </button>
              <button type="button">
                <Code2 />
              </button>
              <button type="button">
                <MoreHorizontal />
              </button>
              <span>
                Saved just now <Check />
              </span>
            </div>
            <div className={editor.editorPage}>
              <small>PROJECT BRIEF · JULY 2026</small>
              <h3>A calmer place to collaborate</h3>
              <p>
                Fancy Mumble brings voice, messaging, and shared work into one focused space. The new system
                keeps every interaction direct, legible, and human.
              </p>
              <blockquote>Design for the conversation, not the chrome.</blockquote>
            </div>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
