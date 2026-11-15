import "./styleOrder";
import { useState, type CSSProperties } from "react";
import {
  ArrowLeftIcon as ArrowLeft,
  BellIcon as Bell,
  ChevronDownIcon as ChevronDown,
  CopyIcon as Copy,
  SparklesIcon as Sparkles,
  VolumeIcon as Volume2,
} from "@ui/icons";
import { getUiDesignOverride, setSelectedUiDesign } from "@ui/selection";
import WindowTitleBar, { type ChromePlatform } from "../client/WindowTitleBar";
import { sections, avatars } from "./designSheetData";
import FoundationSection from "./FoundationSection";
import ActionsSection from "./ActionsSection";
import FormsSection from "./FormsSection";
import FeedbackSection from "./FeedbackSection";
import CommunicationSection from "./CommunicationSection";
import VoiceSection from "./VoiceSection";
import NavigationSection from "./NavigationSection";
import DataSection from "./DataSection";
import OverlaysSection from "./OverlaysSection";
import Avatar from "./Avatar";
import controls from "./designSheetControls.module.css";
import hero from "./HeroSection.module.css";
import identity from "./designSheetIdentity.module.css";
import shell from "./DesignSheetShell.module.css";
import sidebar from "./DesignSheetSidebar.module.css";

/** Standalone visual language catalogue for the redesigned interface. */
export function DesignSheet({ onBackToClient }: { onBackToClient?: () => void }) {
  const [switchingBack, setSwitchingBack] = useState(false);
  const [chromePlatform, setChromePlatform] = useState<ChromePlatform>("windows");
  const override = getUiDesignOverride();

  const switchToStandard = async () => {
    if (switchingBack || override) return;
    setSwitchingBack(true);
    try {
      await setSelectedUiDesign("standard");
    } catch (error) {
      setSwitchingBack(false);
      console.error("failed to switch to the Standard UI:", error);
    }
  };

  return (
    <div className={shell.root} data-testid="aurora-ui-root">
      <WindowTitleBar platform={chromePlatform} subtitle="Design sheet" />
      <header className={shell.topbar}>
        {onBackToClient && (
          <button type="button" className={shell.backButton} onClick={onBackToClient}>
            <ArrowLeft size={17} />
            <span>Back to client</span>
          </button>
        )}
        <button
          type="button"
          className={shell.backButton}
          onClick={() => void switchToStandard()}
          disabled={switchingBack || override !== null}
          title={override ? `The URL currently forces the ${override} UI` : "Switch to the Standard design"}
        >
          <ArrowLeft size={17} />
          <span>{switchingBack ? "Switching…" : "Standard UI"}</span>
        </button>
        <div className={shell.brand}>
          <span className={identity.brandMark}>
            <Sparkles size={16} />
          </span>
          <span>
            <strong>Fancy UI</strong>
            <small>Design system / 2026</small>
          </span>
        </div>
        <div className={shell.topActions}>
          <div className={shell.platformSwitch} aria-label="Title bar platform preview">
            {(["windows", "macos", "linux"] as const).map((platform) => (
              <button
                type="button"
                key={platform}
                className={chromePlatform === platform ? shell.platformActive : undefined}
                aria-pressed={chromePlatform === platform}
                onClick={() => setChromePlatform(platform)}
              >
                {platform === "macos" ? "macOS" : platform[0].toUpperCase() + platform.slice(1)}
              </button>
            ))}
          </div>
          <span className={shell.status}>
            <i /> Preview build
          </span>
          <button
            type="button"
            className={`${controls.iconButton} ${shell.topActionsIconButton}`}
            aria-label="Notifications"
          >
            <Bell size={17} />
          </button>
          <Avatar label="MO" online />
        </div>
      </header>

      <aside className={sidebar.sidebar}>
        <div className={sidebar.sideIntro}>
          <span>UI inventory</span>
          <strong>Design sheet</strong>
          <small>One language for every surface.</small>
        </div>
        <nav aria-label="Design sheet sections">
          {sections.map(([id, label], index) => (
            <a key={id} href={`#${id}`} className={index === 0 ? sidebar.activeNav : undefined}>
              <span>0{index + 1}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className={sidebar.coverage}>
          <div>
            <span>Standard coverage</span>
            <strong>9 families</strong>
          </div>
          <div className={sidebar.progress}>
            <i />
          </div>
          <small>Living reference · v0.1</small>
        </div>
      </aside>

      <main className={shell.main}>
        <section className={hero.hero}>
          <div className={hero.heroCopy}>
            <span className={hero.heroBadge}>
              <Sparkles size={13} /> System preview
            </span>
            <h1>
              One interface.
              <br />
              <em>Every conversation.</em>
            </h1>
            <p>
              A tactile, calm visual system for voice, chat, community, collaboration, and
              administration-built to scale without losing character.
            </p>
            <div className={hero.heroActions}>
              <a href="#foundation" className={controls.primaryButton}>
                Explore components <ChevronDown size={16} />
              </a>
              <button type="button" className={controls.secondaryButton}>
                <Copy size={15} /> Copy tokens
              </button>
            </div>
          </div>
          <div className={hero.heroOrb} aria-hidden="true">
            <span className={hero.orbCore}>
              <Volume2 />
            </span>
            {avatars.map((avatar, index) => (
              <span key={avatar} className={hero.orbitAvatar} style={{ "--index": index } as CSSProperties}>
                {avatar}
              </span>
            ))}
            <i />
            <i />
            <i />
          </div>
        </section>

        <FoundationSection />

        <ActionsSection />

        <FormsSection />

        <FeedbackSection />

        <CommunicationSection />

        <VoiceSection />

        <NavigationSection />

        <DataSection />

        <OverlaysSection />

        <footer className={shell.footer}>
          <span className={`${identity.brandMark} ${shell.footerBrandMark}`}>
            <Sparkles size={15} />
          </span>
          <div>
            <strong>Fancy UI system</strong>
            <small>A living inventory for the new interface.</small>
          </div>
          <span>2026 preview · 9 component families</span>
        </footer>
      </main>
    </div>
  );
}
