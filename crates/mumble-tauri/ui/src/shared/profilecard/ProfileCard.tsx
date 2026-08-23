/**
 * The profile card.
 *
 * One card, every surface. The mock draws it plain for someone who has set
 * nothing - host colours, an assigned banner, the app's accent - and lets a
 * stored `FancyProfile` repaint every surface on it: banner, card, avatar ring,
 * nameplate, sticker, send button and the whole text ramp. `paint.ts` decides
 * which of those two a person gets; everything below is the one tree they
 * share, so the styled card can never drift from the plain one - and neither
 * can the hover preview, the settings preview, or the channel viewer, because
 * they are all this component with a different `variant` and a different host
 * filling in `model`.
 *
 * Deliberately dependency-free: plain React, inline style objects and one
 * injected stylesheet for the states inline styles cannot express. The client
 * draws on MUI and the channel viewer on a different major of it; a card built
 * on either would be a card only one of them could mount.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { BADGE_GLYPHS, CheckGlyph, CloseGlyph, SendGlyph, UsersGlyph, type IconProps } from "./icons";
import {
  arrangeBadges,
  showsSection,
  type BadgeGlyph,
  type BadgeShelf,
  type ProfileBadge,
  type ProfileCardModel,
} from "./model";
import { resolveProfilePaint, type ProfileInk } from "./paint";
import { placeBesideAnchor, type AnchorRect, type PlacementOptions } from "./placement";
import { RichText, isRichTextEmpty } from "./richText";
import { userTint } from "./tint";
import type { ProfileCardTokens } from "./tokens";
import { withAlpha } from "./color";

/** A button the host hangs off the card: local mute, edit profile, whatever. */
export interface CardAction {
  label: string;
  icon: (props: IconProps) => ReactNode;
  onClick: () => void;
  /** Drawn in the danger colour - a local mute that is currently on. */
  active?: boolean;
}

export interface ProfileCardProps {
  model: ProfileCardModel;
  tokens: ProfileCardTokens;
  /**
   * `hover` is the pointer-following preview: the same card, minus everything
   * that would need a click it will never receive.
   */
  variant?: "full" | "hover";
  width?: number;
  onClose?: () => void;
  /** The composer at the foot of the card. */
  message?: {
    placeholder?: string;
    /** Given a sender, the pill becomes a real input. */
    onSend?: (text: string) => void;
    /** Otherwise the whole pill is a button that opens the conversation. */
    onOpen?: () => void;
  } | null;
  /** Personal volume for this person, 0-200. */
  volume?: {
    value: number;
    onChange: (value: number) => void;
    onCommit: (value: number) => void;
  } | null;
  /** The round button beside the composer. */
  trailing?: CardAction | null;
  /** Caption under the composer; the mock uses it to name what is yours. */
  footnote?: string;
  /**
   * The row this card is about, in viewport coordinates. Given one, the card
   * fixes itself beside it rather than over it - see `placement.ts`.
   */
  anchor?: AnchorRect | null;
  placement?: PlacementOptions;
  className?: string;
  style?: CSSProperties;
}

const STYLE_ID = "fancy-profile-card-styles";
const CSS = `
.fpc-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;
justify-content:center;transition:filter 120ms ease,background 120ms ease,opacity 120ms ease}
.fpc-btn:hover{filter:brightness(1.12)}
.fpc-btn:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.fpc-input{all:unset;box-sizing:border-box;flex:1;min-width:0;font:inherit}
.fpc-input::placeholder{color:inherit;opacity:.75}
.fpc-range{-webkit-appearance:none;appearance:none;width:100%;height:14px;background:transparent;
cursor:pointer;margin:0}
.fpc-range::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--fpc-track)}
.fpc-range::-moz-range-track{height:4px;border-radius:999px;background:var(--fpc-track)}
.fpc-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
border-radius:50%;background:#fff;border:none;margin-top:-4px;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.fpc-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:none;
box-shadow:0 1px 4px rgba(0,0,0,.4)}
.fpc-range:focus-visible{outline:2px solid var(--fpc-accent);outline-offset:4px}
.fpc-caps{letter-spacing:.14em;text-transform:uppercase}
.fpc-scroll{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
scrollbar-color:var(--fpc-thumb) transparent}
.fpc-scroll::-webkit-scrollbar{width:6px}
.fpc-scroll::-webkit-scrollbar-track{background:transparent}
.fpc-scroll::-webkit-scrollbar-thumb{background:var(--fpc-thumb);border-radius:999px}
.fpc-scroll:focus-visible{outline:2px solid var(--fpc-accent);outline-offset:3px}
`;

/**
 * States inline styles cannot express - hover, focus rings, the range track -
 * injected once per document rather than once per card.
 */
function useCardStylesheet(): void {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const element = document.createElement("style");
    element.id = STYLE_ID;
    element.textContent = CSS;
    document.head.append(element);
  }, []);
}

/**
 * Keep the card beside its row.
 *
 * The height is measured rather than assumed: a card's rows depend on what the
 * person has filled in, so the same component is anything from a name and a
 * banner to a full sheet, and hanging that off a guess is what puts the tall
 * ones off the bottom of the screen. Measuring in a layout effect means the
 * placement is settled before the browser paints, so nothing is seen to jump.
 */
function useAnchoredPosition(
  root: RefObject<HTMLElement | null>,
  anchor: AnchorRect | null,
  width: number,
  options: PlacementOptions | undefined,
): CSSProperties | undefined {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!anchor || !root.current) return;
    const measure = () => {
      const next = root.current?.offsetHeight ?? 0;
      setHeight((current) => (Math.abs(current - next) > 1 ? next : current));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [root, anchor]);

  if (!anchor) return undefined;
  const viewport = {
    width: typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1280,
    height: typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 800,
  };
  const { left, top } = placeBesideAnchor(anchor, { width, height }, viewport, options);
  return { position: "fixed", left, top, right: "auto", bottom: "auto" };
}

function initials(name: string): string {
  return name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function ProfileCard({
  model,
  tokens,
  variant = "full",
  width = variant === "hover" ? 268 : 310,
  onClose,
  message = null,
  volume = null,
  trailing = null,
  footnote,
  anchor = null,
  placement,
  className,
  style,
}: Readonly<ProfileCardProps>) {
  useCardStylesheet();
  const root = useRef<HTMLElement>(null);
  const anchored = useAnchoredPosition(root, anchor, width, placement);
  const hover = variant === "hover";
  const paint = resolveProfilePaint(model.profile, userTint(model.tintKey), tokens);
  const { ink } = paint;
  const sections = model.profile?.sections;
  const scale = hover ? 0.78 : 1;

  const { strip, stripOverflow, shelves } = arrangeBadges(model.badges, shelfLabelsOf(model.shelves));
  // A host that arranged its own shelves wins; otherwise the badges' own
  // metadata decides, which is how a server-sent catalogue will arrive.
  const rails = model.shelves.length > 0 ? model.shelves : shelves;

  const identity = [model.profile?.pronouns, model.profile?.contact].filter(Boolean).join(" · ");
  const bannerHeight = Math.round(150 * scale);
  const avatarSize = Math.round(76 * scale);

  return (
    <aside
      ref={root}
      aria-label={`${model.name} profile`}
      className={className}
      style={{
        position: "relative",
        boxSizing: "border-box",
        width,
        borderRadius: 22,
        background: tokens.surface,
        border: `1px solid ${tokens.line}`,
        boxShadow: tokens.shadow,
        color: ink.text,
        fontSize: 12,
        // The sticker hangs off the corner, so a styled card cannot clip itself.
        overflow: paint.decoration ? "visible" : "hidden",
        ...paint.card,
        ...style,
        ...anchored,
      }}
    >
      {paint.decoration && <Sticker sticker={paint.decoration} scale={scale} />}

      <div
        style={{
          margin: 8,
          height: bannerHeight,
          borderRadius: 16,
          position: "relative",
          ...paint.banner,
        }}
      >
        <div style={{ position: "absolute", inset: 0, borderRadius: 16, ...paint.bannerScrim }} />
        <span
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 20,
            background: paint.bannerChrome,
            backdropFilter: "blur(6px)",
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 500,
          }}
        >
          <Dot tone={presenceColor(model.presence.tone, tokens)} />
          {model.presence.label}
        </span>
        {onClose && !hover && (
          <button
            type="button"
            className="fpc-btn"
            aria-label="Close profile"
            onClick={onClose}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 26,
              height: 26,
              borderRadius: "50%",
              color: "#fff",
              background: paint.bannerChrome,
              backdropFilter: "blur(6px)",
            }}
          >
            <CloseGlyph size={11} />
          </button>
        )}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: -Math.round(avatarSize * 0.42),
            transform: "translateX(-50%)",
          }}
        >
          <div style={{ borderRadius: "50%", display: "flex", ...paint.avatarRing }}>
            <Avatar
              name={model.name}
              src={model.avatar}
              size={avatarSize}
              fill={paint.avatarFill}
              ink={paint.avatarInk}
              pip={presenceColor(model.presence.tone, tokens)}
              ring={paint.ground}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: `${Math.round(avatarSize * 0.55)}px 20px 18px`,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 0,
        }}
      >
        <Row gap={6}>
          <span
            style={{
              fontSize: paint.nameplate ? 15 * scale + 0.5 : 17 * scale,
              ...(paint.nameplate
                ? {
                    padding: "4px 16px",
                    borderRadius: 20,
                    background: paint.nameplate,
                    letterSpacing: ".03em",
                    boxShadow: "0 4px 14px rgba(0,0,0,.28)",
                  }
                : {}),
              ...paint.name,
            }}
          >
            {model.name}
          </span>
          {model.verified && <Verified tone={ink.accent} />}
        </Row>

        {showsSection(sections, "badges") && (strip.length > 0 || stripOverflow > 0) && (
          <Row gap={5} style={{ marginTop: 7 }}>
            {strip.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} ink={ink} />
            ))}
            {stripOverflow > 0 && (
              <span
                title={`${stripOverflow} more`}
                style={{
                  minWidth: 20,
                  height: 20,
                  padding: "0 5px",
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: ink.fill,
                  color: ink.muted,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                +{stripOverflow}
              </span>
            )}
          </Row>
        )}

        {identity && showsSection(sections, "identity") && (
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: ink.muted }}>{identity}</p>
        )}

        {!isRichTextEmpty(model.profile?.status ?? "") && showsSection(sections, "status") && (
          <p style={{ margin: "7px 0 0", fontSize: 12, fontStyle: "italic", color: ink.text }}>
            <RichText inline html={model.profile?.status ?? ""} linkColor={ink.accent} />
          </p>
        )}

        {showsSection(sections, "bio") && !isRichTextEmpty(model.bio) && (
          <Bio html={model.bio} name={model.name} ink={ink} hover={hover} />
        )}

        {model.mutualServers != null && model.mutualServers > 0 && showsSection(sections, "mutual") && (
          <Row gap={7} style={{ marginTop: 9, color: ink.muted, fontSize: 11 }}>
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: ink.fill,
                color: ink.dim,
              }}
            >
              <UsersGlyph size={9} />
            </span>
            {model.mutualServers} mutual {model.mutualServers === 1 ? "server" : "servers"}
          </Row>
        )}

        {model.roles.length > 0 && showsSection(sections, "roles") && (
          <Row gap={7} style={{ marginTop: 10, flexWrap: "wrap" }}>
            {model.roles.map((role) => (
              <span
                key={role.id}
                style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: role.color ?? ink.text,
                  background: role.color ? withAlpha(role.color, 0.18) : ink.fill,
                  border: `1px solid ${role.color ? withAlpha(role.color, 0.4) : ink.line}`,
                }}
              >
                {role.name}
              </span>
            ))}
          </Row>
        )}

        {model.activity && showsSection(sections, "activity") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: ink.fill,
              textAlign: "left",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                flex: "none",
                background: model.activity.image
                  ? `center/cover url(${model.activity.image})`
                  : `repeating-linear-gradient(45deg,${ink.line} 0 6px,transparent 6px 12px)`,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {model.activity.title}
              </div>
              <div style={{ fontSize: 10.5, color: ink.dim }}>
                {model.activity.detail}
                {model.activity.action && (
                  <>
                    {model.activity.detail ? " · " : ""}
                    <button
                      type="button"
                      className="fpc-btn"
                      onClick={model.activity.action.onClick}
                      style={{ color: ink.accent, fontSize: 10.5, display: "inline" }}
                    >
                      {model.activity.action.label}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {showsSection(sections, "shelves") &&
          rails.map((shelf) => <Shelf key={shelf.id} shelf={shelf} ink={ink} />)}

        {model.stats.length > 0 && showsSection(sections, "stats") && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${model.stats.length},1fr)`,
              marginTop: 14,
            }}
          >
            {model.stats.map((stat, index) => (
              <div
                key={stat.id}
                style={{
                  borderLeft: index === 0 ? "none" : `1px solid ${ink.line}`,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700 }}>{stat.value}</div>
                <div style={{ fontSize: 10.5, color: ink.muted, marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {volume && !hover && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16 }}>
            <span className="fpc-caps" style={{ fontSize: 10, fontWeight: 600, color: ink.dim }}>
              Vol
            </span>
            <input
              className="fpc-range"
              type="range"
              min={0}
              max={200}
              value={volume.value}
              aria-label={`Personal volume for ${model.name}`}
              // The mock gives the row to the bar, so the number lives in the
              // control rather than beside it - still announced, still on hover.
              title={`${volume.value}%`}
              onChange={(event) => volume.onChange(Number(event.target.value))}
              onPointerUp={(event) => volume.onCommit(Number(event.currentTarget.value))}
              onKeyUp={(event) => volume.onCommit(Number(event.currentTarget.value))}
              style={
                {
                  "--fpc-accent": ink.accent,
                  "--fpc-track": `linear-gradient(90deg,${ink.accent} 0 ${volume.value / 2}%,${ink.line} ${volume.value / 2}% 100%)`,
                } as CSSProperties
              }
            />
          </div>
        )}

        {message && !hover && (
          <Composer
            name={model.name}
            ink={ink}
            send={paint.send}
            message={message}
            trailing={trailing}
          />
        )}

        {footnote && !hover && (
          <p
            className="fpc-caps"
            style={{
              margin: "14px 0 0",
              fontSize: 9,
              lineHeight: 1.7,
              fontWeight: 600,
              color: ink.dim,
            }}
          >
            {footnote}
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * How tall the bio grows before it scrolls instead.
 *
 * A profile is the one page on the server that is the user's own, and people
 * fill it: paragraphs, a memorial, quotes, a picture. Unbounded, that is a card
 * taller than the window, whose volume slider and composer have been pushed off
 * the bottom of the screen where no pointer can reach them - and the placement
 * below has nowhere left to put it. Ending the text at a fixed height keeps the
 * rest of the card on screen whatever anybody writes.
 */
const BIO_MAX_HEIGHT = 208;

/** How deep the fade at a scrollable edge is. */
const BIO_FADE = 72;

/**
 * The shape of that fade: alpha at even steps down its depth.
 *
 * A straight ramp holds near opaque for most of its length and then drops,
 * which reads as an edge arriving rather than as text receding into the card.
 * Easing it puts the change in the middle of the run, where the eye follows it
 * as one continuous fade instead of finding the line where it began.
 */
const BIO_RAMP = [0, 0.04, 0.14, 0.34, 0.6, 0.85, 1];

/** The mask for a box with more text above it, below it, or both. */
function bioMask(edges: Readonly<{ top: boolean; bottom: boolean }>): string {
  const depth = (step: number) => Math.round((BIO_FADE * step) / (BIO_RAMP.length - 1));
  const stops: string[] = [];
  if (edges.top) BIO_RAMP.forEach((alpha, step) => stops.push(`rgba(0,0,0,${alpha}) ${depth(step)}px`));
  else stops.push("#000 0");
  if (edges.bottom)
    for (let step = BIO_RAMP.length - 1; step >= 0; step--)
      stops.push(`rgba(0,0,0,${BIO_RAMP[step]}) calc(100% - ${depth(step)}px)`);
  else stops.push("#000 100%");
  return `linear-gradient(180deg,${stops.join(",")})`;
}

/**
 * The bio: as much of it as fits, and a way to reach the rest.
 *
 * The cut is a fade rather than a straight edge, and the fade is a mask rather
 * than a gradient laid over the text, because the card underneath is whatever
 * the user painted it - a photograph, a gradient, glass over a message list -
 * and a scrim can only match one of those. Masking fades the words themselves,
 * so it is right on every card. It is drawn only at an edge there is something
 * beyond, which is what keeps a bio that already fits from looking cut off.
 */
function Bio({
  html,
  name,
  ink,
  hover,
}: Readonly<{ html: string; name: string; ink: ProfileInk; hover: boolean }>) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useLayoutEffect(() => {
    const element = box.current;
    if (hover || !element) return;
    const measure = () => {
      const top = element.scrollTop > 1;
      const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setEdges((current) =>
        current.top === top && current.bottom === bottom ? current : { top, bottom },
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    // A bio's pictures are decoded after the first paint, so the height this
    // depends on is not settled when the effect runs: watching the text inside
    // is what turns "no fade" into a fade once the image has taken its space.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [hover, html]);

  // Paragraphs the user typed, spaced as paragraphs rather than run together -
  // but never a leading gap above the first of them.
  const text: CSSProperties = { fontSize: 12, lineHeight: 1.5, color: ink.muted };

  if (hover)
    return (
      <RichText
        html={html}
        linkColor={ink.accent}
        style={{
          margin: "7px 0 0",
          ...text,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      />
    );

  const scrollable = edges.top || edges.bottom;
  const mask = scrollable ? bioMask(edges) : undefined;

  return (
    // The mask goes on a box that does not scroll, with the scrolling one
    // inside it, so the fade is pinned to the card's edge rather than to
    // whatever coordinates an engine happens to paint a scroller's mask in.
    <div style={{ marginTop: 7, maskImage: mask, WebkitMaskImage: mask }}>
      <div
        ref={box}
        className="fpc-scroll"
        style={
          {
            maxHeight: BIO_MAX_HEIGHT,
            ...text,
            "--fpc-thumb": ink.line,
            "--fpc-accent": ink.accent,
          } as CSSProperties
        }
        // Reachable by keyboard only while there is something to scroll to, and
        // named there, so it is not an unexplained stop on the way to the
        // composer on every card that happens to be short.
        {...(scrollable
          ? { tabIndex: 0, role: "region" as const, "aria-label": `About ${name}` }
          : null)}
      >
        <RichText html={html} linkColor={ink.accent} />
      </div>
    </div>
  );
}

function shelfLabelsOf(shelves: readonly BadgeShelf[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const shelf of shelves) if (shelf.label) labels[shelf.id] = shelf.label;
  return labels;
}

function presenceColor(tone: ProfileCardModel["presence"]["tone"], tokens: ProfileCardTokens): string {
  if (tone === "muted" || tone === "deafened") return tokens.bad;
  if (tone === "offline") return tokens.dim;
  return tokens.ok;
}

function Row({
  children,
  gap,
  style,
}: Readonly<{ children: ReactNode; gap: number; style?: CSSProperties }>) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap, ...style }}
    >
      {children}
    </div>
  );
}

function Dot({ tone }: Readonly<{ tone: string }>) {
  return (
    <span
      aria-hidden
      style={{ width: 6, height: 6, borderRadius: "50%", background: tone, flex: "none" }}
    />
  );
}

function Verified({ tone }: Readonly<{ tone: string }>) {
  return (
    <span
      title="Registered account"
      aria-label="Registered account"
      role="img"
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: tone,
        color: "#fff",
        flex: "none",
      }}
    >
      <CheckGlyph size={9} />
    </span>
  );
}

function Glyph({ glyph, size }: Readonly<{ glyph: BadgeGlyph; size: number }>) {
  if (glyph.kind === "icon") {
    const Component = BADGE_GLYPHS[glyph.name];
    return <Component size={size} />;
  }
  if (glyph.kind === "image")
    return <img src={glyph.src} alt="" width={size} height={size} style={{ borderRadius: 3 }} />;
  return <span style={{ fontSize: size, lineHeight: 1 }}>{glyph.text}</span>;
}

function BadgeChip({ badge, ink }: Readonly<{ badge: ProfileBadge; ink: ProfileInk }>) {
  const tone = badge.tone ?? ink.accent;
  return (
    <span
      title={badge.label}
      aria-label={badge.label}
      role="img"
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: tone,
        background: withAlpha(tone, 0.18),
        flex: "none",
      }}
    >
      <Glyph glyph={badge.glyph} size={10} />
    </span>
  );
}

/**
 * One rail of badges.
 *
 * The nodes are threaded on a hairline rather than sitting in a row, which is
 * what makes a shelf read as a collection with room left on it instead of as
 * four more chips: the line continues past the last badge someone owns.
 */
function Shelf({ shelf, ink }: Readonly<{ shelf: BadgeShelf; ink: ProfileInk }>) {
  if (shelf.badges.length === 0 && shelf.overflow === 0) return null;
  const items: ReactNode[] = [];
  shelf.badges.forEach((badge, index) => {
    if (index > 0) items.push(<Thread key={`t${badge.id}`} ink={ink} />);
    items.push(<ShelfNode key={badge.id} badge={badge} ink={ink} />);
  });
  if (shelf.label) {
    items.splice(
      1,
      0,
      <Thread key="t-label-l" ink={ink} />,
      <span
        key="label"
        className="fpc-caps"
        style={{ fontSize: 9, fontWeight: 700, color: ink.muted, flex: "none" }}
      >
        {shelf.label}
      </span>,
      <Thread key="t-label-r" ink={ink} />,
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          background: ink.fill,
        }}
      >
        {items}
      </div>
      {shelf.overflow > 0 && (
        <span
          title={`${shelf.overflow} more`}
          style={{
            flex: "none",
            padding: "6px 10px",
            borderRadius: 999,
            background: ink.fill,
            color: ink.muted,
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          +{shelf.overflow}
        </span>
      )}
    </div>
  );
}

function Thread({ ink }: Readonly<{ ink: ProfileInk }>) {
  return <span aria-hidden style={{ flex: 1, height: 1, background: ink.line, minWidth: 8 }} />;
}

function ShelfNode({ badge, ink }: Readonly<{ badge: ProfileBadge; ink: ProfileInk }>) {
  const tone = badge.tone ?? ink.muted;
  const diamond = badge.shape === "diamond";
  return (
    <span
      title={badge.label}
      aria-label={badge.label}
      role="img"
      style={{
        flex: "none",
        width: 10,
        height: 10,
        background: tone,
        borderRadius: diamond ? 2 : "50%",
        transform: diamond ? "rotate(45deg)" : undefined,
      }}
    />
  );
}

function Composer({
  name,
  ink,
  send,
  message,
  trailing,
}: Readonly<{
  name: string;
  ink: ProfileInk;
  send: { background: string; color: string };
  message: NonNullable<ProfileCardProps["message"]>;
  trailing: CardAction | null;
}>) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const TrailingIcon = trailing?.icon ?? SendGlyph;
  const placeholder = message.placeholder ?? `Message @${name}`;
  const submit = () => {
    const text = draft.trim();
    if (!text || !message.onSend) return;
    message.onSend(text);
    setDraft("");
    input.current?.focus();
  };

  const pill: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 999,
    background: ink.fill,
    border: `1px solid ${ink.line}`,
    padding: "0 6px 0 14px",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
      {message.onSend ? (
        <div style={pill}>
          <input
            ref={input}
            className="fpc-input"
            value={draft}
            aria-label={placeholder}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            style={{ fontSize: 11.5, color: ink.text, textAlign: "left" }}
          />
          <SendButton label={`Send to ${name}`} onClick={submit} send={send} />
        </div>
      ) : (
        <button type="button" className="fpc-btn" onClick={message.onOpen} style={pill}>
          <span style={{ flex: 1, textAlign: "left", fontSize: 11.5, color: ink.dim }}>
            {placeholder}
          </span>
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              flex: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              ...send,
            }}
          >
            <SendGlyph size={11} />
          </span>
        </button>
      )}
      {trailing && (
        <button
          type="button"
          className="fpc-btn"
          aria-label={trailing.label}
          title={trailing.label}
          onClick={trailing.onClick}
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            flex: "none",
            border: `1px solid ${ink.line}`,
            color: trailing.active ? "#f57e7e" : ink.muted,
          }}
        >
          <TrailingIcon size={13} />
        </button>
      )}
    </div>
  );
}

function SendButton({
  label,
  onClick,
  send,
}: Readonly<{ label: string; onClick: () => void; send: { background: string; color: string } }>) {
  return (
    <button
      type="button"
      className="fpc-btn"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        flex: "none",
        ...send,
      }}
    >
      <SendGlyph size={11} />
    </button>
  );
}

function Sticker({
  sticker,
  scale,
}: Readonly<{ sticker: NonNullable<ReturnType<typeof resolveProfilePaint>["decoration"]>; scale: number }>) {
  const size = Math.round(46 * scale);
  const common: CSSProperties = {
    position: "absolute",
    top: -Math.round(26 * scale),
    right: -Math.round(18 * scale),
    transform: "rotate(8deg)",
    filter: "drop-shadow(0 6px 14px rgba(0,0,0,.4))",
    zIndex: 3,
    pointerEvents: "none",
  };
  if (sticker.kind === "image")
    return <img aria-hidden alt="" src={sticker.src} style={{ ...common, width: size * 1.6 }} />;
  return (
    <div aria-hidden style={{ ...common, fontSize: size, lineHeight: 1 }}>
      {sticker.text}
    </div>
  );
}

function Avatar({
  name,
  src,
  size,
  fill,
  ink,
  pip,
  ring,
}: Readonly<{
  name: string;
  src?: string | null;
  size: number;
  fill: string;
  ink: string;
  pip: string;
  ring: string;
}>) {
  // Hosts hand over an avatar URL without knowing whether there is a picture
  // behind it - the channel viewer's texture endpoint answers per user id - so
  // a portrait that fails to load falls back to initials rather than to the
  // browser's broken-image glyph.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      {src && !broken ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          onError={() => setBroken(true)}
          style={{ borderRadius: "50%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          aria-label={name}
          role="img"
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: fill,
            color: ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.max(9, size * 0.38),
            fontWeight: 600,
          }}
        >
          {initials(name)}
        </div>
      )}
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 1,
          bottom: 1,
          width: Math.max(8, size * 0.2),
          height: Math.max(8, size * 0.2),
          borderRadius: "50%",
          background: pip,
          border: `2px solid ${ring}`,
          boxSizing: "content-box",
        }}
      />
    </div>
  );
}
