import Avatar from "./Avatar";
import overlays from "./OverlaysSection.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import controls from "./designSheetControls.module.css";
import identity from "./designSheetIdentity.module.css";
import layout from "./designSheetLayout.module.css";
import {
  CalendarIcon as CalendarDays,
  ChevronRightIcon as ChevronRight,
  CloseIcon as X,
  CommandIcon as Command,
  CopyIcon as Copy,
  KebabMenuIcon as MoreHorizontal,
  MessageCircleIcon as MessageCircle,
  MicIcon as Mic,
  SearchIcon as Search,
  SettingsIcon as Settings2,
  ShieldCheckIcon as ShieldCheck,
  StarIcon as Star,
  TrashIcon as Trash2,
  WarningIcon as AlertTriangle,
} from "@ui/icons";

/** Section overlays of the design sheet. */
export default function OverlaysSection() {
  return (
    <Section
      id="overlays"
      eyebrow="09 / Overlays"
      title="Layers with purpose"
      description="Dialogs, command palettes, popovers, sheets, and confirmation states focus attention without losing context."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Dialog" meta="Confirmation" wide>
          <div className={overlays.overlayStage}>
            <div className={overlays.dialog}>
              <button type="button" className={overlays.dialogClose}>
                <X />
              </button>
              <span className={overlays.dialogIcon}>
                <AlertTriangle />
              </span>
              <h3>Leave Design stand-up?</h3>
              <p>You can rejoin the voice room at any time. Your screen share will stop.</p>
              <div>
                <button type="button" className={controls.secondaryButton}>
                  Stay connected
                </button>
                <button type="button" className={controls.dangerButton}>
                  Leave room
                </button>
              </div>
            </div>
          </div>
        </Specimen>
        <Specimen title="Command palette" meta="Search / shortcuts" wide>
          <div className={overlays.commandPalette}>
            <div>
              <Search />
              <input placeholder="Type a command or search…" autoComplete="off" />
              <kbd>ESC</kbd>
            </div>
            <small>QUICK ACTIONS</small>
            {[
              [MessageCircle, "New message", "⌘ N"],
              [Mic, "Join a voice room", "⌘ J"],
              [CalendarDays, "Create an event", "⌘ E"],
              [Settings2, "Open settings", "⌘ ,"],
            ].map(([Icon, label, keys]) => {
              const ActionIcon = Icon as typeof MessageCircle;
              return (
                <button type="button" key={label as string}>
                  <span>
                    <ActionIcon />
                    {label as string}
                  </span>
                  <kbd>{keys as string}</kbd>
                </button>
              );
            })}
            <footer>
              <span>
                <kbd>↑↓</kbd> Navigate
              </span>
              <span>
                <kbd>↵</kbd> Open
              </span>
              <strong>
                <Command /> Fancy command
              </strong>
            </footer>
          </div>
        </Specimen>
        <Specimen title="Popover" meta="User preview">
          <div className={overlays.userPopover}>
            <div>
              <Avatar label="AK" online className={overlays.userPopoverAvatar} />
              <span>
                <strong>
                  Alex Kim <ShieldCheck />
                </strong>
                <small>@alex · In Design stand-up</small>
              </span>
            </div>
            <p>Product designer focused on interaction and prototyping.</p>
            <div>
              <button
                type="button"
                className={`${controls.primaryButton} ${overlays.userPopoverPrimaryButton}`}
              >
                <MessageCircle /> Message
              </button>
              <button type="button" className={`${controls.iconButton} ${overlays.userPopoverIconButton}`}>
                <MoreHorizontal />
              </button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Mobile sheet" meta="Responsive action menu">
          <div className={overlays.mobileSheet}>
            <i />
            <header>
              <Avatar label="MO" className={overlays.mobileSheetAvatar} />
              <span>
                <strong>Message options</strong>
                <small>Morgan · 10:45</small>
              </span>
            </header>
            <button type="button">
              <span>
                <Copy /> Copy message
              </span>
              <ChevronRight />
            </button>
            <button type="button">
              <span>
                <Star /> Save for later
              </span>
              <ChevronRight />
            </button>
            <button type="button" className={`${identity.menuDanger} ${overlays.mobileSheetMenuDanger}`}>
              <span>
                <Trash2 /> Delete message
              </span>
              <ChevronRight />
            </button>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}
