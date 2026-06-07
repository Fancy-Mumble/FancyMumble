/**
 * liveDocRibbonGroups - responsive layout primitives for the Word-style ribbon.
 *
 * The ribbon panel is a horizontal row of captioned `Group`s.  Word shrinks its
 * ribbon by collapsing whole groups - lowest priority (rightmost) first - into a
 * single summary button that re-opens the full group in a flyout when there is
 * no longer room to show every control.  `RibbonGroupRow` reproduces that:
 *
 *   - each `Group` reports its natural (expanded) width while it is visible;
 *   - the row tracks the available width via a `ResizeObserver`;
 *   - when the groups no longer fit, a contiguous tail collapses to summary
 *     buttons until the rest fits, exactly like Word's ribbon.
 *
 * Collapse decisions are derived purely from the measured widths and the
 * available width, so they are deterministic and never oscillate.  Groups still
 * render their original children; collapsing only relocates them into a flyout.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../../../icons";
import styles from "./LiveDocRibbon.module.css";

/**
 * Rendered width (px) of a group once collapsed to its summary button - icon +
 * short caption + chevron, including padding and the right-hand divider.  Kept
 * in sync with `.groupCollapsed` / `.groupCollapsedBtn` in the stylesheet; a
 * slight over-estimate is safe (it just collapses marginally sooner, never
 * overflowing).
 */
const COLLAPSED_GROUP_WIDTH = 70;

const EMPTY_SET: ReadonlySet<string> = new Set();

interface RibbonRowApi {
  readonly register: (id: string) => void;
  readonly unregister: (id: string) => void;
  readonly reportWidth: (id: string, width: number) => void;
}

/** Stable callbacks (never change identity) so a group's registration effect
 *  runs exactly once. */
const RibbonRowApiContext = createContext<RibbonRowApi | null>(null);
/** The set of collapsed group ids, updated as the row resizes. */
const RibbonCollapsedContext = createContext<ReadonlySet<string>>(EMPTY_SET);

let groupSeq = 0;

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Row container: measures available width and decides which groups collapse
// ---------------------------------------------------------------------------

type RibbonGroupRowProps = HTMLAttributes<HTMLDivElement>;

export function RibbonGroupRow({ children, ...rest }: RibbonGroupRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Last measured natural width per group; retained while a group is collapsed
   *  so we know whether it would fit again as the row grows. */
  const widths = useRef<Map<string, number>>(new Map());
  /** Group ids in DOM order (= collapse priority, lowest priority last). */
  const order = useRef<string[]>([]);
  const available = useRef(0);
  const frame = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY_SET);

  const recompute = useCallback(() => {
    frame.current = null;
    const ids = order.current;
    const avail = available.current;
    if (avail <= 0 || ids.length === 0) {
      setCollapsed((prev) => (prev.size === 0 ? prev : EMPTY_SET));
      return;
    }

    // Decide only once every group has reported a width at least once; groups
    // always render expanded on mount, so this resolves on the first frame.
    let totalFull = 0;
    for (const id of ids) {
      const w = widths.current.get(id);
      if (w === undefined) return;
      totalFull += w;
    }

    const next = new Set<string>();
    if (totalFull > avail) {
      // Keep a contiguous prefix of the highest-priority groups expanded; once
      // one no longer fits, collapse it and everything after it.
      let used = ids.length * COLLAPSED_GROUP_WIDTH;
      let collapsing = false;
      for (const id of ids) {
        const full = widths.current.get(id) ?? COLLAPSED_GROUP_WIDTH;
        const delta = full - COLLAPSED_GROUP_WIDTH;
        if (!collapsing && used + delta <= avail) {
          used += delta;
        } else {
          collapsing = true;
          next.add(id);
        }
      }
    }
    setCollapsed((prev) => (setsEqual(prev, next) ? prev : next));
  }, []);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(recompute);
  }, [recompute]);

  const api = useMemo<RibbonRowApi>(
    () => ({
      register: (id) => {
        if (!order.current.includes(id)) order.current.push(id);
        schedule();
      },
      unregister: (id) => {
        order.current = order.current.filter((x) => x !== id);
        widths.current.delete(id);
        schedule();
      },
      reportWidth: (id, width) => {
        if (widths.current.get(id) !== width) {
          widths.current.set(id, width);
          schedule();
        }
      },
    }),
    [schedule],
  );

  // Decide collapse synchronously before every paint - including the first one
  // and tab switches - so the ribbon never flashes its fully-expanded layout.
  // Children report their widths in their own (earlier-running) layout effects,
  // and recompute only reads cached refs, so this stays cheap even though the
  // ribbon re-renders on every editor transaction.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) available.current = el.clientWidth;
    recompute();
  });

  // Catch width changes that happen without a re-render (window / pane resize).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      if (available.current !== width) {
        available.current = width;
        schedule();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <RibbonRowApiContext.Provider value={api}>
      <RibbonCollapsedContext.Provider value={collapsed}>
        <div ref={containerRef} {...rest}>
          {children}
        </div>
      </RibbonCollapsedContext.Provider>
    </RibbonRowApiContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Group: a captioned cluster of controls that collapses when space runs out
// ---------------------------------------------------------------------------

interface GroupProps {
  readonly caption: string;
  /** Representative glyph shown on the summary button when collapsed. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Group({ caption, icon, children }: GroupProps) {
  const api = useContext(RibbonRowApiContext);
  const collapsedSet = useContext(RibbonCollapsedContext);
  const idRef = useRef("");
  if (!idRef.current) idRef.current = `rg-${++groupSeq}`;
  const id = idRef.current;
  const collapsed = collapsedSet.has(id);
  const sectionRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    api?.register(id);
    return () => api?.unregister(id);
  }, [api, id]);

  // Re-measure whenever we render expanded so the row tracks our natural width.
  useLayoutEffect(() => {
    if (collapsed || !api || !sectionRef.current) return;
    api.reportWidth(id, sectionRef.current.offsetWidth);
  });

  if (collapsed) {
    return (
      <CollapsedGroup caption={caption} icon={icon}>
        {children}
      </CollapsedGroup>
    );
  }

  return (
    <section ref={sectionRef} className={styles.group}>
      <div className={styles.groupBody}>{children}</div>
      <div className={styles.groupCaption}>{caption}</div>
    </section>
  );
}

function CollapsedGroup({ caption, icon, children }: GroupProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !flyoutRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the flyout inside the viewport's right edge.
  useLayoutEffect(() => {
    if (!open || !flyoutRef.current) return;
    const width = flyoutRef.current.offsetWidth;
    const maxLeft = window.innerWidth - width - 8;
    setPos((p) => (p.left > maxLeft ? { ...p, left: Math.max(8, maxLeft) } : p));
  }, [open]);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 2 });
    }
    setOpen((v) => !v);
  };

  return (
    <section className={styles.groupCollapsed}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.groupCollapsedBtn} ${open ? styles.groupCollapsedBtnOpen : ""}`}
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        title={caption}
      >
        {icon && (
          <span className={styles.groupCollapsedIcon} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className={styles.groupCollapsedFoot}>
          <span className={styles.groupCollapsedLabel}>{caption}</span>
          <ChevronDownIcon width={11} height={11} aria-hidden="true" />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={flyoutRef}
            className={styles.groupFlyout}
            style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }}
            role="group"
            aria-label={caption}
          >
            <div className={styles.groupBody}>{children}</div>
            <div className={styles.groupCaption}>{caption}</div>
          </div>,
          document.body,
        )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small row helpers (stack compact controls like Word's multi-row groups)
// ---------------------------------------------------------------------------

export function Rows({ children }: { readonly children: ReactNode }) {
  return <div className={styles.groupRows}>{children}</div>;
}

export function Row({ children }: { readonly children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
