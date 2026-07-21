import { useState, type CSSProperties, type ReactNode } from "react";
import {
  WarningIcon as AlertTriangle,
  ArrowLeftIcon as ArrowLeft,
  BellIcon as Bell,
  CalendarIcon as CalendarDays,
  CheckIcon as Check,
  ChevronDownIcon as ChevronDown,
  ChevronLeftIcon as ChevronLeft,
  ChevronRightIcon as ChevronRight,
  ClockIcon as Clock3,
  UploadIcon as CloudUpload,
  CodeIcon as Code2,
  CommandIcon as Command,
  CopyIcon as Copy,
  DownloadIcon as Download,
  FileTextIcon as FileText,
  HashIcon as Hash,
  HeadphonesIcon as Headphones,
  ImageIcon as Image,
  InfoIcon as Info,
  Link2Icon as Link2,
  LockIcon as LockKeyhole,
  MenuIcon as Menu,
  MessageCircleIcon as MessageCircle,
  MicIcon as Mic,
  MicOffIcon as MicOff,
  MinimizeIcon as Minus,
  KebabMenuIcon as MoreHorizontal,
  AttachIcon as Paperclip,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RadioIcon as Radio,
  SearchIcon as Search,
  SendIcon as Send,
  ServerIcon as Server,
  SettingsIcon as Settings2,
  ShieldCheckIcon as ShieldCheck,
  EmojiPlusIcon as Smile,
  SparklesIcon as Sparkles,
  StarIcon as Star,
  SquareIcon as Square,
  TrashIcon as Trash2,
  UserPlusIcon as UserPlus,
  UsersGroupIcon as Users,
  WebcamIcon as Video,
  VolumeIcon as Volume2,
  CloseIcon as X,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import NewClientApp from "./NewClientApp";
import styles from "./NewUiApp.module.css";

const sections = [
  ["foundation", "Foundation"],
  ["actions", "Actions"],
  ["forms", "Forms"],
  ["feedback", "Feedback"],
  ["communication", "Communication"],
  ["voice", "Voice & media"],
  ["navigation", "Navigation"],
  ["data", "Data display"],
  ["overlays", "Overlays"],
] as const;

const avatars = ["MO", "AK", "SR", "JL"];
type ChromePlatform = "windows" | "macos" | "linux";

function WindowTitleBar({ platform }: { platform: ChromePlatform }) {
  if (platform === "macos") {
    return (
      <div className={`${styles.titleBar} ${styles.titleBarMac}`} data-tauri-drag-region data-testid="window-title-bar">
        <div className={styles.trafficLights} aria-label="macOS window controls">
          <button type="button" className={styles.macClose} aria-label="Close window"><X /></button>
          <button type="button" className={styles.macMinimize} aria-label="Minimize window"><Minus /></button>
          <button type="button" className={styles.macMaximize} aria-label="Maximize window"><Plus /></button>
        </div>
        <span className={styles.macTitle}>Fancy Mumble</span>
        <span className={styles.titleBarSpacer} />
      </div>
    );
  }

  if (platform === "linux") {
    return (
      <div className={`${styles.titleBar} ${styles.titleBarLinux}`} data-tauri-drag-region data-testid="window-title-bar">
        <div className={styles.windowIdentity}><span className={styles.miniAppMark}>F</span><strong>Fancy Mumble</strong><small>Design sheet</small></div>
        <div className={styles.linuxWindowControls} aria-label="Linux window controls">
          <button type="button" aria-label="Minimize window"><Minus /></button>
          <button type="button" aria-label="Maximize window"><Square /></button>
          <button type="button" className={styles.linuxClose} aria-label="Close window"><X /></button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.titleBar} ${styles.titleBarWindows}`} data-tauri-drag-region data-testid="window-title-bar">
      <div className={styles.windowIdentity}><span className={styles.miniAppMark}>F</span><span>Fancy Mumble</span><small>Design sheet</small></div>
      <div className={styles.windowsWindowControls} aria-label="Windows window controls">
        <button type="button" aria-label="Minimize window"><Minus /></button>
        <button type="button" aria-label="Maximize window"><Square /></button>
        <button type="button" className={styles.windowsClose} aria-label="Close window"><X /></button>
      </div>
    </div>
  );
}

function Section({ id, eyebrow, title, description, children }: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function Specimen({ title, meta, wide, children }: {
  title: string;
  meta: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={`${styles.specimen} ${wide ? styles.wide : ""}`}>
      <div className={styles.specimenLabel}>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className={styles.specimenBody}>{children}</div>
    </article>
  );
}

function Avatar({ label, online = false }: { label: string; online?: boolean }) {
  return (
    <span className={styles.avatar} aria-label={label}>
      {label}
      {online && <i />}
    </span>
  );
}

/** Standalone visual language catalogue for the redesigned interface. */
export function DesignSheet({ onBackToClient }: { onBackToClient?: () => void }) {
  const [switchingBack, setSwitchingBack] = useState(false);
  const [toggleOn, setToggleOn] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState("Balanced");
  const [tab, setTab] = useState("Overview");
  const [liked, setLiked] = useState(false);
  const [chromePlatform, setChromePlatform] = useState<ChromePlatform>("windows");
  const override = getUiDesignOverride();

  const switchToLegacy = async () => {
    if (switchingBack || override) return;
    setSwitchingBack(true);
    try {
      await setSelectedUiDesign("legacy");
    } catch (error) {
      setSwitchingBack(false);
      console.error("failed to switch to the legacy UI:", error);
    }
  };

  return (
    <div className={styles.root} data-testid="new-ui-root">
      <WindowTitleBar platform={chromePlatform} />
      <header className={styles.topbar}>
        {onBackToClient && (
          <button type="button" className={styles.backButton} onClick={onBackToClient}>
            <ArrowLeft size={17} /><span>Back to client</span>
          </button>
        )}
        <button
          type="button"
          className={styles.backButton}
          onClick={() => void switchToLegacy()}
          disabled={switchingBack || override !== null}
          title={override ? `The URL currently forces the ${override} UI` : "Return to the classic interface"}
        >
          <ArrowLeft size={17} />
          <span>{switchingBack ? "Switching…" : "Back to old UI"}</span>
        </button>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Sparkles size={16} /></span>
          <span><strong>Fancy UI</strong><small>Design system / 2026</small></span>
        </div>
        <div className={styles.topActions}>
          <div className={styles.platformSwitch} aria-label="Title bar platform preview">
            {(["windows", "macos", "linux"] as const).map(platform => (
              <button
                type="button"
                key={platform}
                className={chromePlatform === platform ? styles.platformActive : undefined}
                aria-pressed={chromePlatform === platform}
                onClick={() => setChromePlatform(platform)}
              >
                {platform === "macos" ? "macOS" : platform[0].toUpperCase() + platform.slice(1)}
              </button>
            ))}
          </div>
          <span className={styles.status}><i /> Preview build</span>
          <button type="button" className={styles.iconButton} aria-label="Notifications"><Bell size={17} /></button>
          <Avatar label="MO" online />
        </div>
      </header>

      <aside className={styles.sidebar}>
        <div className={styles.sideIntro}>
          <span>UI inventory</span>
          <strong>Design sheet</strong>
          <small>One language for every surface.</small>
        </div>
        <nav aria-label="Design sheet sections">
          {sections.map(([id, label], index) => (
            <a key={id} href={`#${id}`} className={index === 0 ? styles.activeNav : undefined}>
              <span>0{index + 1}</span>{label}
            </a>
          ))}
        </nav>
        <div className={styles.coverage}>
          <div><span>Legacy coverage</span><strong>9 families</strong></div>
          <div className={styles.progress}><i /></div>
          <small>Living reference · v0.1</small>
        </div>
      </aside>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroBadge}><Sparkles size={13} /> System preview</span>
            <h1>One interface.<br /><em>Every conversation.</em></h1>
            <p>A tactile, calm visual system for voice, chat, community, collaboration, and administration—built to scale without losing character.</p>
            <div className={styles.heroActions}>
              <a href="#foundation" className={styles.primaryButton}>Explore components <ChevronDown size={16} /></a>
              <button type="button" className={styles.secondaryButton}><Copy size={15} /> Copy tokens</button>
            </div>
          </div>
          <div className={styles.heroOrb} aria-hidden="true">
            <span className={styles.orbCore}><Volume2 /></span>
            {avatars.map((avatar, index) => <span key={avatar} className={styles.orbitAvatar} style={{ "--index": index } as CSSProperties}>{avatar}</span>)}
            <i /><i /><i />
          </div>
        </section>

        <Section id="foundation" eyebrow="01 / Foundation" title="The visual grammar" description="Color, type, elevation, shape, icons, spacing, and identity primitives form the shared baseline.">
          <div className={styles.specimenGrid}>
            <Specimen title="Color tokens" meta="Semantic palette" wide>
              <div className={styles.swatches}>
                {[
                  ["Ink", "#0B0E13", styles.ink], ["Canvas", "#12171E", styles.canvas],
                  ["Cloud", "#F3F5F7", styles.cloud], ["Signal", "#69B7E8", styles.signal],
                  ["Slate", "#718096", styles.iris], ["Coral", "#E4776D", styles.coral],
                ].map(([name, hex, className]) => <div key={name} className={styles.swatch}><i className={className} /><strong>{name}</strong><span>{hex}</span></div>)}
              </div>
            </Specimen>
            <Specimen title="Typography" meta="Display / body / mono" wide>
              <div className={styles.typeScale}>
                <div><span>Display</span><strong>Clear voice,<br />quiet confidence.</strong></div>
                <div><span>Body</span><p>Designed to remain readable in dense workspaces, long conversations, and peripheral controls.</p></div>
                <code>MONO 12 · STATUS_CONNECTED</code>
              </div>
            </Specimen>
            <Specimen title="Avatars & presence" meta="User identity">
              <div className={styles.avatarRow}>
                <Avatar label="MO" online /><Avatar label="AK" /><Avatar label="SR" online />
                <span className={styles.avatarGroup}>{avatars.map(value => <Avatar key={value} label={value} />)}<b>+8</b></span>
              </div>
            </Specimen>
            <Specimen title="Chips & badges" meta="Metadata">
              <div className={styles.wrapRow}>
                <span className={styles.chip}><Hash size={12} /> design</span>
                <span className={styles.successChip}><Check size={12} /> verified</span>
                <span className={styles.roleChip}><ShieldCheck size={12} /> moderator</span>
                <span className={styles.countBadge}>12</span>
              </div>
            </Specimen>
          </div>
        </Section>

        <Section id="actions" eyebrow="02 / Actions" title="Buttons with intent" description="A small hierarchy of clear actions replaces one-off button treatments across dialogs, chat, calls, and settings.">
          <div className={styles.specimenGrid}>
            <Specimen title="Button hierarchy" meta="Default states" wide>
              <div className={styles.wrapRow}>
                <button type="button" className={styles.primaryButton}><Plus size={15} /> Create channel</button>
                <button type="button" className={styles.secondaryButton}><UserPlus size={15} /> Invite people</button>
                <button type="button" className={styles.ghostButton}><Settings2 size={15} /> Configure</button>
                <button type="button" className={styles.dangerButton}><Trash2 size={15} /> Delete</button>
                <button type="button" className={styles.secondaryButton} disabled>Unavailable</button>
              </div>
            </Specimen>
            <Specimen title="Icon actions" meta="Compact controls">
              <div className={styles.wrapRow}>
                <button type="button" className={styles.iconButton}><Search size={17} /></button>
                <button type="button" className={styles.iconButton}><Paperclip size={17} /></button>
                <button type="button" className={styles.iconButton}><MoreHorizontal size={17} /></button>
                <button type="button" className={styles.floatingButton}><Plus size={20} /></button>
              </div>
            </Specimen>
            <Specimen title="Split & segmented" meta="Related actions">
              <div className={styles.splitButton}><button type="button">Join voice</button><button type="button" aria-label="More join options"><ChevronDown size={15} /></button></div>
              <div className={styles.segmented}>{["Overview", "Members", "Files"].map(item => <button type="button" key={item} className={tab === item ? styles.segmentActive : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
            </Specimen>
          </div>
        </Section>

        <Section id="forms" eyebrow="03 / Forms" title="Input, without friction" description="Accessible fields for server setup, profiles, permissions, search, security, and deep preference screens.">
          <div className={styles.specimenGrid}>
            <Specimen title="Text fields" meta="Input states" wide>
              <div className={styles.formGrid}>
                <label className={styles.field}><span>Display name</span><input defaultValue="Morgan Oakes" /><small>This is how others see you.</small></label>
                <label className={styles.field}><span>Server address</span><div className={styles.inputWithIcon}><Server size={16} /><input placeholder="voice.example.com" /></div></label>
                <label className={`${styles.field} ${styles.fieldError}`}><span>Password</span><div className={styles.inputWithIcon}><LockKeyhole size={16} /><input type="password" defaultValue="incorrect" /></div><small>That password doesn’t match.</small></label>
                <label className={styles.field}><span>Search</span><div className={styles.inputWithIcon}><Search size={16} /><input placeholder="Messages, people, files…" /><kbd>⌘ K</kbd></div></label>
              </div>
            </Specimen>
            <Specimen title="Selection" meta="Checkbox / radio">
              <div className={styles.optionStack}>
                {["Balanced", "Voice clarity", "Studio quality"].map(option => <label key={option} className={styles.radioRow}><input type="radio" checked={selectedPlan === option} onChange={() => setSelectedPlan(option)} /><span><i />{option}</span></label>)}
                <label className={styles.checkRow}><input type="checkbox" defaultChecked /><span><Check size={12} /></span>Auto-connect on launch</label>
              </div>
            </Specimen>
            <Specimen title="Switches & slider" meta="Preferences">
              <div className={styles.settingRow}><span><strong>Noise suppression</strong><small>Remove background sound</small></span><button type="button" role="switch" aria-checked={toggleOn} className={toggleOn ? styles.switchOn : styles.switch} onClick={() => setToggleOn(value => !value)}><i /></button></div>
              <label className={styles.range}><span><Volume2 size={15} /> Output volume <b>72%</b></span><input type="range" defaultValue="72" /></label>
            </Specimen>
            <Specimen title="Select & tags" meta="Structured input" wide>
              <div className={styles.formGrid}>
                <label className={styles.field}><span>Input device</span><div className={styles.selectLike}>Studio microphone <ChevronDown size={15} /></div></label>
                <label className={styles.field}><span>Roles</span><div className={styles.tagInput}><span>Designer <X size={12} /></span><span>Moderator <X size={12} /></span><input placeholder="Add role…" /></div></label>
              </div>
            </Specimen>
          </div>
        </Section>

        <Section id="feedback" eyebrow="04 / Feedback" title="Every state speaks" description="Banners, progress, loading, notification, and validation patterns keep system feedback consistent and calm.">
          <div className={styles.specimenGrid}>
            <Specimen title="Banners" meta="Info / warning / success" wide>
              <div className={styles.bannerStack}>
                <div className={styles.infoBanner}><Info size={18} /><span><strong>A new version is ready</strong><small>Restart Fancy Mumble to finish updating.</small></span><button type="button">Restart</button><X size={15} /></div>
                <div className={styles.warningBanner}><AlertTriangle size={18} /><span><strong>Your encryption key changed</strong><small>Verify this device before sharing sensitive files.</small></span><button type="button">Review</button></div>
                <div className={styles.successBanner}><Check size={18} /><span><strong>Connected securely</strong><small>All messages are end-to-end encrypted.</small></span></div>
              </div>
            </Specimen>
            <Specimen title="Progress & loading" meta="Determinate / skeleton">
              <div className={styles.progressDemo}><span><CloudUpload size={16} /> Uploading project-notes.pdf <b>68%</b></span><div><i /></div></div>
              <div className={styles.skeleton}><i /><span><b /><b /></span></div>
            </Specimen>
            <Specimen title="Toast notification" meta="Transient feedback">
              <div className={styles.toast}><span className={styles.toastIcon}><Check size={16} /></span><span><strong>Link copied</strong><small>Ready to share with your team.</small></span><button type="button"><X size={14} /></button></div>
            </Specimen>
          </div>
        </Section>

        <Section id="communication" eyebrow="05 / Communication" title="Conversation, redesigned" description="Messages, reactions, threads, files, previews, polls, mentions, typing, and composition share one rhythm.">
          <div className={styles.specimenGrid}>
            <Specimen title="Message timeline" meta="Chat / reactions / reply" wide>
              <div className={styles.chatCard}>
                <div className={styles.chatHeader}><span><Hash /> <strong>product-design</strong><small>Build the next chapter</small></span><div><button type="button"><Users size={16} /> 24</button><button type="button"><Search size={16} /></button><button type="button"><MoreHorizontal size={16} /></button></div></div>
                <div className={styles.messageList}>
                  <div className={styles.dateDivider}><span>Today</span></div>
                  <div className={styles.message}><Avatar label="AK" online /><div><header><strong>Alex Kim</strong><time>10:42</time><span className={styles.roleChip}>Design</span></header><p>I tightened the voice-room states and added the new spatial audio control. The handoff is ready for a look.</p><div className={styles.linkCard}><span><Link2 /></span><div><small>FIGMA · DESIGN SYSTEM</small><strong>Voice room — final interaction pass</strong><p>18 frames · Updated 3 minutes ago</p></div><ChevronRight /></div><div className={styles.reactions}><button type="button" className={liked ? styles.reacted : ""} onClick={() => setLiked(value => !value)}>✨ <span>{liked ? 8 : 7}</span></button><button type="button">🔥 <span>3</span></button><button type="button"><Plus size={13} /></button></div></div>
                  </div>
                  <div className={styles.message}><Avatar label="MO" /><div><header><strong>Morgan Oakes</strong><time>10:45</time></header><p>Beautiful. I’ll test the permission states and bring feedback to the review.</p></div></div>
                  <div className={styles.typing}><span><i /><i /><i /></span>Sam is typing</div>
                </div>
                <div className={styles.composer}><div contentEditable suppressContentEditableWarning data-placeholder="Message #product-design" /><div><span><button type="button"><Plus /></button><button type="button"><Paperclip /></button><button type="button"><Image /></button></span><span><button type="button"><Smile /></button><button type="button"><Mic /></button><button type="button" className={styles.sendButton}><Send /></button></span></div></div>
              </div>
            </Specimen>
            <Specimen title="Attachments" meta="Files / upload">
              <div className={styles.fileCard}><span><FileText /></span><div><strong>Research-notes.pdf</strong><small>4.8 MB · PDF</small></div><button type="button"><Download size={16} /></button></div>
              <div className={styles.uploadZone}><CloudUpload /><strong>Drop files to share</strong><small>Up to 2 GB per file</small></div>
            </Specimen>
            <Specimen title="Poll" meta="Collaborative choice">
              <div className={styles.poll}><small>QUICK POLL · 18 VOTES</small><strong>When should we run the design review?</strong>{[["Tuesday, 14:00", 72], ["Wednesday, 10:00", 28]].map(([label, value]) => <button type="button" key={label as string}><span>{label}<b>{value}%</b></span><i style={{ width: `${value}%` }} /></button>)}</div>
            </Specimen>
          </div>
        </Section>

        <Section id="voice" eyebrow="06 / Voice & media" title="Presence you can feel" description="Voice rooms, call controls, audio meters, streams, recording, and watch-together surfaces become tactile and legible.">
          <div className={styles.specimenGrid}>
            <Specimen title="Active voice room" meta="Call state" wide>
              <div className={styles.voiceRoom}>
                <div className={styles.voiceTop}><div><span className={styles.livePill}><Radio size={12} /> LIVE</span><h3>Design stand-up</h3><p>4 people · Spatial audio on</p></div><div className={styles.voiceTimer}><i /> 24:18</div></div>
                <div className={styles.participants}>{avatars.map((avatar, index) => <div key={avatar} className={index === 0 ? styles.speaking : ""}><Avatar label={avatar} online /><strong>{["Morgan", "Alex", "Sam", "Jo"][index]}</strong><small>{index === 0 ? "Speaking" : index === 2 ? "Muted" : "Listening"}</small>{index === 2 ? <MicOff /> : <Mic />}</div>)}</div>
                <div className={styles.callControls}><button type="button"><Mic /><span>Mute</span></button><button type="button"><Headphones /><span>Deafen</span></button><button type="button"><Video /><span>Camera</span></button><button type="button"><Menu /><span>More</span></button><button type="button" className={styles.hangup}><X /><span>Leave</span></button></div>
              </div>
            </Specimen>
            <Specimen title="Audio meter" meta="Input calibration">
              <div className={styles.meter}><span><Mic size={15} /> Studio microphone <b>−12 dB</b></span><div>{Array.from({ length: 24 }, (_, index) => <i key={index} className={index < 17 ? styles.meterOn : ""} />)}</div><small>Good signal · No clipping detected</small></div>
            </Specimen>
            <Specimen title="Media player" meta="Stream / watch together">
              <div className={styles.player}><div className={styles.playerVisual}><span><Play /></span><small>SCREEN SHARE · 1080P</small></div><div className={styles.playerControls}><button type="button"><Pause /></button><div><i /></div><time>12:48 / 34:20</time><button type="button"><Volume2 /></button></div></div>
            </Specimen>
          </div>
        </Section>

        <Section id="navigation" eyebrow="07 / Navigation" title="Know where you are" description="Servers, channels, tabs, breadcrumbs, context menus, and pagination use the same clear location cues.">
          <div className={styles.specimenGrid}>
            <Specimen title="Workspace navigation" meta="Server / channels" wide>
              <div className={styles.workspaceDemo}>
                <div className={styles.serverRail}>{["FM", "DX", "ST"].map((item, index) => <button type="button" key={item} className={index === 0 ? styles.serverActive : ""}>{item}</button>)}<button type="button"><Plus /></button></div>
                <div className={styles.channelRail}><header><span><strong>Fancy studio</strong><small>24 members online</small></span><ChevronDown /></header><div className={styles.channelGroup}><span>CONVERSATIONS <Plus /></span><button type="button" className={styles.channelActive}><Hash /> general <b>3</b></button><button type="button"><Hash /> product-design</button><button type="button"><Hash /> release-notes</button></div><div className={styles.channelGroup}><span>VOICE ROOMS <Plus /></span><button type="button"><Volume2 /> Design stand-up <small>4</small></button><div className={styles.miniPeople}><Avatar label="MO" /><span>Morgan</span><Mic /></div><div className={styles.miniPeople}><Avatar label="AK" /><span>Alex</span><MicOff /></div></div></div>
                <div className={styles.emptyPanel}><span><MessageCircle /></span><strong>Select a conversation</strong><small>Your messages and activity will appear here.</small></div>
              </div>
            </Specimen>
            <Specimen title="Breadcrumb & pagination" meta="Location / traversal">
              <div className={styles.breadcrumb}><button type="button">Admin</button><ChevronRight /><button type="button">Members</button><ChevronRight /><strong>Morgan Oakes</strong></div>
              <div className={styles.pagination}><button type="button"><ChevronLeft /></button><button type="button" className={styles.pageActive}>1</button><button type="button">2</button><button type="button">3</button><span>…</span><button type="button">12</button><button type="button"><ChevronRight /></button></div>
            </Specimen>
            <Specimen title="Menu & tooltip" meta="Contextual navigation">
              <div className={styles.menuDemo}><button type="button"><Star /> Add to favorites <kbd>⌘D</kbd></button><button type="button"><Bell /> Notification settings</button><i /><button type="button" className={styles.menuDanger}><Trash2 /> Remove channel</button></div>
            </Specimen>
          </div>
        </Section>

        <Section id="data" eyebrow="08 / Data display" title="Dense, never crowded" description="Profiles, roles, server metrics, audit data, schedules, and document tools remain scannable at every density.">
          <div className={styles.specimenGrid}>
            <Specimen title="Member table" meta="Admin / roles / status" wide>
              <div className={styles.tableToolbar}><div className={styles.inputWithIcon}><Search /><input placeholder="Filter members…" /></div><button type="button" className={styles.secondaryButton}><Settings2 /> Columns</button><button type="button" className={styles.primaryButton}><UserPlus /> Add member</button></div>
              <div className={styles.tableWrap}><table><thead><tr><th><input type="checkbox" /></th><th>Member</th><th>Role</th><th>Status</th><th>Joined</th><th /></tr></thead><tbody>{[["MO", "Morgan Oakes", "Owner", "Online", "Jan 12"], ["AK", "Alex Kim", "Designer", "In voice", "Mar 04"], ["SR", "Sam Rivera", "Moderator", "Away", "Apr 19"]].map(row => <tr key={row[1]}><td><input type="checkbox" /></td><td><Avatar label={row[0]} /><span><strong>{row[1]}</strong><small>@{row[1].toLowerCase().replace(" ", ".")}</small></span></td><td><span className={styles.roleChip}>{row[2]}</span></td><td><span className={styles.tableStatus}><i />{row[3]}</span></td><td>{row[4]}</td><td><MoreHorizontal /></td></tr>)}</tbody></table></div>
            </Specimen>
            <Specimen title="Profile card" meta="Identity / trust">
              <div className={styles.profileCard}><div className={styles.profileCover} /><div className={styles.profileBody}><Avatar label="MO" online /><button type="button"><MoreHorizontal /></button><h3>Morgan Oakes <ShieldCheck /></h3><small>@morgan · they/them</small><p>Product designer. Voice nerd. Building kinder tools for teams.</p><div><span><strong>42</strong><small>Friends</small></span><span><strong>8</strong><small>Servers</small></span><span><strong>3y</strong><small>Member</small></span></div><button type="button" className={styles.primaryButton}><MessageCircle /> Message</button></div></div>
            </Specimen>
            <Specimen title="Calendar" meta="Events / schedule">
              <div className={styles.calendar}><header><button type="button"><ChevronLeft /></button><strong>July 2026</strong><button type="button"><ChevronRight /></button></header><div className={styles.weekdays}>{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <b key={`${day}-${index}`}>{day}</b>)}</div><div className={styles.days}>{Array.from({ length: 35 }, (_, index) => <button type="button" key={index} className={index === 22 ? styles.today : index === 15 || index === 24 ? styles.hasEvent : ""}>{index < 3 ? 28 + index : index - 2}</button>)}</div><div className={styles.nextEvent}><span><Clock3 /></span><div><small>NEXT · 14:00</small><strong>Design review</strong></div><Avatar label="+4" /></div></div>
            </Specimen>
            <Specimen title="Editor toolbar" meta="Live documents" wide>
              <div className={styles.editor}><div className={styles.editorToolbar}><select aria-label="Text style" defaultValue="Body"><option>Body</option></select><i /><button type="button"><strong>B</strong></button><button type="button"><em>I</em></button><button type="button"><u>U</u></button><i /><button type="button"><Link2 /></button><button type="button"><Image /></button><button type="button"><Code2 /></button><button type="button"><MoreHorizontal /></button><span>Saved just now <Check /></span></div><div className={styles.editorPage}><small>PROJECT BRIEF · JULY 2026</small><h3>A calmer place to collaborate</h3><p>Fancy Mumble brings voice, messaging, and shared work into one focused space. The new system keeps every interaction direct, legible, and human.</p><blockquote>Design for the conversation, not the chrome.</blockquote></div></div>
            </Specimen>
          </div>
        </Section>

        <Section id="overlays" eyebrow="09 / Overlays" title="Layers with purpose" description="Dialogs, command palettes, popovers, sheets, and confirmation states focus attention without losing context.">
          <div className={styles.specimenGrid}>
            <Specimen title="Dialog" meta="Confirmation" wide>
              <div className={styles.overlayStage}><div className={styles.dialog}><button type="button" className={styles.dialogClose}><X /></button><span className={styles.dialogIcon}><AlertTriangle /></span><h3>Leave Design stand-up?</h3><p>You can rejoin the voice room at any time. Your screen share will stop.</p><div><button type="button" className={styles.secondaryButton}>Stay connected</button><button type="button" className={styles.dangerButton}>Leave room</button></div></div></div>
            </Specimen>
            <Specimen title="Command palette" meta="Search / shortcuts" wide>
              <div className={styles.commandPalette}><div><Search /><input placeholder="Type a command or search…" autoComplete="off" /><kbd>ESC</kbd></div><small>QUICK ACTIONS</small>{[[MessageCircle, "New message", "⌘ N"], [Mic, "Join a voice room", "⌘ J"], [CalendarDays, "Create an event", "⌘ E"], [Settings2, "Open settings", "⌘ ,"]].map(([Icon, label, keys]) => { const ActionIcon = Icon as typeof MessageCircle; return <button type="button" key={label as string}><span><ActionIcon />{label as string}</span><kbd>{keys as string}</kbd></button>; })}<footer><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><strong><Command /> Fancy command</strong></footer></div>
            </Specimen>
            <Specimen title="Popover" meta="User preview">
              <div className={styles.userPopover}><div><Avatar label="AK" online /><span><strong>Alex Kim <ShieldCheck /></strong><small>@alex · In Design stand-up</small></span></div><p>Product designer focused on interaction and prototyping.</p><div><button type="button" className={styles.primaryButton}><MessageCircle /> Message</button><button type="button" className={styles.iconButton}><MoreHorizontal /></button></div></div>
            </Specimen>
            <Specimen title="Mobile sheet" meta="Responsive action menu">
              <div className={styles.mobileSheet}><i /><header><Avatar label="MO" /><span><strong>Message options</strong><small>Morgan · 10:45</small></span></header><button type="button"><span><Copy /> Copy message</span><ChevronRight /></button><button type="button"><span><Star /> Save for later</span><ChevronRight /></button><button type="button" className={styles.menuDanger}><span><Trash2 /> Delete message</span><ChevronRight /></button></div>
            </Specimen>
          </div>
        </Section>

        <footer className={styles.footer}>
          <span className={styles.brandMark}><Sparkles size={15} /></span>
          <div><strong>Fancy UI system</strong><small>A living inventory for the new interface.</small></div>
          <span>2026 preview · 9 component families</span>
        </footer>
      </main>
    </div>
  );
}

export default function NewUiApp() {
  const [showDesignSheet, setShowDesignSheet] = useState(
    () => new URLSearchParams(globalThis.location.search).has("design-sheet"),
  );

  if (showDesignSheet) {
    return <DesignSheet onBackToClient={() => setShowDesignSheet(false)} />;
  }

  return <NewClientApp onOpenDesignSheet={() => setShowDesignSheet(true)} />;
}
