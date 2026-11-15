import ChannelRosterSpecimen from "./ChannelRosterSpecimen";
import MemberSidebarSpecimen from "./MemberSidebarSpecimen";
import ServerRailSpecimen from "./ServerRailSpecimen";
import Avatar from "./Avatar";
import navigation from "./NavigationSection.module.css";
import Section from "./Section";
import Specimen from "./Specimen";
import identity from "./designSheetIdentity.module.css";
import layout from "./designSheetLayout.module.css";
import {
  BellIcon as Bell,
  ChevronDownIcon as ChevronDown,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  HashIcon as Hash,
  MessageCircleIcon as MessageCircle,
  MicIcon as Mic,
  MicOffIcon as MicOff,
  PlusIcon as Plus,
  StarIcon as Star,
  TrashIcon as Trash2,
  VolumeIcon as Volume2,
} from "@ui/icons";

/** Section navigation of the design sheet. */
export default function NavigationSection() {
  return (
    <Section
      id="navigation"
      eyebrow="07 / Navigation"
      title="Know where you are"
      description="Servers, channels, tabs, breadcrumbs, context menus, and pagination use the same clear location cues."
    >
      <div className={layout.specimenGrid}>
        <Specimen title="Workspace navigation" meta="Server / channels" wide>
          <div className={navigation.workspaceDemo}>
            <div className={navigation.serverRail}>
              {["FM", "DX", "ST"].map((item, index) => (
                <button type="button" key={item} className={index === 0 ? navigation.serverActive : ""}>
                  {item}
                </button>
              ))}
              <button type="button">
                <Plus />
              </button>
            </div>
            <div className={navigation.channelRail}>
              <header>
                <span>
                  <strong>Fancy studio</strong>
                  <small>24 members online</small>
                </span>
                <ChevronDown />
              </header>
              <div className={navigation.channelGroup}>
                <span>
                  CONVERSATIONS <Plus />
                </span>
                <button type="button" className={navigation.channelActive}>
                  <Hash /> general <b>3</b>
                </button>
                <button type="button">
                  <Hash /> product-design
                </button>
                <button type="button">
                  <Hash /> release-notes
                </button>
              </div>
              <div className={navigation.channelGroup}>
                <span>
                  VOICE ROOMS <Plus />
                </span>
                <button type="button">
                  <Volume2 /> Design stand-up <small>4</small>
                </button>
                <div className={navigation.miniPeople}>
                  <Avatar label="MO" className={navigation.miniPeopleAvatar} />
                  <span>Morgan</span>
                  <Mic />
                </div>
                <div className={navigation.miniPeople}>
                  <Avatar label="AK" className={navigation.miniPeopleAvatar} />
                  <span>Alex</span>
                  <MicOff />
                </div>
              </div>
            </div>
            <div className={navigation.emptyPanel}>
              <span>
                <MessageCircle />
              </span>
              <strong>Select a conversation</strong>
              <small>Your messages and activity will appear here.</small>
            </div>
          </div>
        </Specimen>
        <Specimen title="Breadcrumb & pagination" meta="Location / traversal">
          <div className={navigation.breadcrumb}>
            <button type="button">Admin</button>
            <ChevronRight />
            <button type="button">Members</button>
            <ChevronRight />
            <strong>Morgan Oakes</strong>
          </div>
          <div className={navigation.pagination}>
            <button type="button">
              <ChevronLeft />
            </button>
            <button type="button" className={navigation.pageActive}>
              1
            </button>
            <button type="button">2</button>
            <button type="button">3</button>
            <span>…</span>
            <button type="button">12</button>
            <button type="button">
              <ChevronRight />
            </button>
          </div>
        </Specimen>
        <Specimen title="Menu & tooltip" meta="Contextual navigation">
          <div className={navigation.menuDemo}>
            <button type="button">
              <Star /> Add to favorites <kbd>⌘D</kbd>
            </button>
            <button type="button">
              <Bell /> Notification settings
            </button>
            <i />
            <button type="button" className={`${identity.menuDanger} ${navigation.menuDemoMenuDanger}`}>
              <Trash2 /> Remove channel
            </button>
          </div>
        </Specimen>
      </div>
      <Specimen title="Server rail" meta="Client component / collapsed + expanded" wide>
        <ServerRailSpecimen />
      </Specimen>
      <Specimen title="Member sidebar" meta="Client component / roster" wide>
        <MemberSidebarSpecimen />
      </Specimen>
      <Specimen title="Voice channel occupancy" meta="Client component / speaking, muted, deafened">
        <ChannelRosterSpecimen />
      </Specimen>
    </Section>
  );
}
