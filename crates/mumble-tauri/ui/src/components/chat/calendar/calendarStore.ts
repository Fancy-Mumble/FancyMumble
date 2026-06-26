/**
 * Calendar state (client).
 *
 * Local CRUD mutates this store, then mirrors the change two ways: it persists
 * the whole calendar to the file-server per-user private store, and relays the
 * *shared* meeting data to the `fancy-calendar` plugin (which fans it out to the
 * other participants). Inbound relayed changes are merged via
 * `applyCalendarInbound`, preserving each user's personal overlay.
 */

import { create } from "zustand";
import {
  DEFAULT_WORK_HOURS,
  type AvailabilityBlock,
  type CalendarEvent,
  type CalendarView,
  type WorkHours,
} from "./types";
import { addDays, addMonths, startOfDay, startOfWeek } from "./calendarDates";
import { loadCalendarBlob, saveCalendarBlob, sendCalendar, showDesktopNotification } from "./calendarSync";
import { useAppStore } from "../../../store";

/** Generate a reasonably unique id without pulling in a uuid dep. */
function newId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Personal (per-user) fields that must never be relayed to other participants. */
function toShared(e: CalendarEvent): Record<string, unknown> {
  const { reminderMinutes, myStatus, showAs, personalColor, ...shared } = e;
  void reminderMinutes;
  void myStatus;
  void showAs;
  void personalColor;
  return shared;
}

/** The viewing user's registered user_id, or null (guest / not resolved). */
function myUserId(): number | null {
  const s = useAppStore.getState();
  return s.users.find((u) => u.session === s.ownSession)?.user_id ?? null;
}

/** Save the whole calendar (events + availability) to the private store. */
function persistCalendar(): void {
  const { events, availability } = useCalendarStore.getState();
  void saveCalendarBlob(JSON.stringify({ v: 1, events, availability }));
}

/** Relay the viewing user's availability blocks to the plugin. */
function syncMyAvailability(): void {
  const uid = myUserId();
  if (uid == null) return;
  const blocks = useCalendarStore.getState().availability.filter((b) => b.userId === uid);
  sendCalendar("calendar.availability", { userId: uid, blocks });
}

const WORK_HOURS_KEY = "fancy.calendar.workHours";

/** Load persisted work hours (localStorage) or fall back to the default. */
function loadWorkHours(): WorkHours {
  try {
    const raw = globalThis.localStorage?.getItem(WORK_HOURS_KEY);
    if (raw) return { ...DEFAULT_WORK_HOURS, ...(JSON.parse(raw) as Partial<WorkHours>) };
  } catch {
    /* ignore malformed/unavailable storage */
  }
  return DEFAULT_WORK_HOURS;
}

/** Anchor rectangle (viewport coords) for the detail card / popovers. */
export interface AnchorRect {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

interface DetailState {
  readonly eventId: string;
  /** Start of the clicked occurrence (UTC ms) so the card shows that instance. */
  readonly occStart: number;
  readonly rect: AnchorRect;
}

interface MenuState {
  readonly eventId: string;
  readonly x: number;
  readonly y: number;
}

interface CalendarState {
  events: CalendarEvent[];
  availability: AvailabilityBlock[];

  /** Current grid + the focused day (local-midnight UTC ms). */
  view: CalendarView;
  anchor: number;

  /** Create/edit dialog. */
  dialogOpen: boolean;
  editingEventId: string | null;
  /** Pre-filled start when "new event" was triggered from a grid slot. */
  draftStart: number | null;

  setView: (v: CalendarView) => void;
  setAnchor: (ms: number) => void;
  goToday: () => void;
  step: (dir: -1 | 1) => void;

  openNewEvent: (start?: number) => void;
  openEditEvent: (id: string) => void;
  closeDialog: () => void;

  upsertEvent: (
    e: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ) => CalendarEvent;
  deleteEvent: (id: string) => void;

  setAvailability: (a: AvailabilityBlock) => void;
  deleteAvailability: (id: string) => void;

  /** Detail card (shown when an event is clicked). */
  detail: DetailState | null;
  openDetail: (eventId: string, occStart: number, rect: AnchorRect) => void;
  closeDetail: () => void;

  /** Right-click context menu. */
  menu: MenuState | null;
  openMenu: (eventId: string, x: number, y: number) => void;
  closeMenu: () => void;

  /** Per-user working hours (persisted to localStorage for now). */
  workHours: WorkHours;
  setWorkHours: (patch: Partial<WorkHours>) => void;

  /** Replace the whole calendar (used by remote sync / personal-store load). */
  hydrate: (events: CalendarEvent[], availability?: AvailabilityBlock[]) => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  availability: [],
  view: "week",
  anchor: startOfDay(Date.now()),
  dialogOpen: false,
  editingEventId: null,
  draftStart: null,

  setView: (view) => set({ view }),
  setAnchor: (anchor) => set({ anchor: startOfDay(anchor) }),
  goToday: () => set({ anchor: startOfDay(Date.now()) }),

  step: (dir) => {
    const { view, anchor } = get();
    if (view === "month") {
      set({ anchor: startOfDay(addMonths(anchor, dir)) });
    } else if (view === "day") {
      set({ anchor: addDays(anchor, dir) });
    } else {
      // week / workweek move a whole week and snap to its Monday.
      set({ anchor: startOfWeek(addDays(anchor, dir * 7)) });
    }
  },

  openNewEvent: (start) =>
    set({ dialogOpen: true, editingEventId: null, draftStart: start ?? null }),
  openEditEvent: (id) =>
    set({ dialogOpen: true, editingEventId: id, draftStart: null }),
  closeDialog: () =>
    set({ dialogOpen: false, editingEventId: null, draftStart: null }),

  upsertEvent: (input) => {
    const now = Date.now();
    const existing = input.id ? get().events.find((e) => e.id === input.id) : undefined;
    const event: CalendarEvent = {
      ...input,
      id: input.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    set((s) => ({
      events: existing
        ? s.events.map((e) => (e.id === event.id ? event : e))
        : [...s.events, event],
    }));
    persistCalendar();
    sendCalendar("calendar.upsert", toShared(event));
    return event;
  },

  deleteEvent: (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    persistCalendar();
    sendCalendar("calendar.delete", { id });
  },

  setAvailability: (a) => {
    set((s) => ({
      availability: s.availability.some((b) => b.id === a.id)
        ? s.availability.map((b) => (b.id === a.id ? a : b))
        : [...s.availability, a],
    }));
    persistCalendar();
    syncMyAvailability();
  },
  deleteAvailability: (id) => {
    set((s) => ({ availability: s.availability.filter((b) => b.id !== id) }));
    persistCalendar();
    syncMyAvailability();
  },

  detail: null,
  openDetail: (eventId, occStart, rect) =>
    set({ detail: { eventId, occStart, rect }, menu: null }),
  closeDetail: () => set({ detail: null }),

  menu: null,
  openMenu: (eventId, x, y) => set({ menu: { eventId, x, y }, detail: null }),
  closeMenu: () => set({ menu: null }),

  workHours: loadWorkHours(),
  setWorkHours: (patch) =>
    set((s) => {
      const next = { ...s.workHours, ...patch };
      try {
        globalThis.localStorage?.setItem(WORK_HOURS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { workHours: next };
    }),

  hydrate: (events, availability) =>
    set({ events, availability: availability ?? [] }),
}));

/**
 * Apply an inbound relayed calendar message from the plugin (decoded JSON).
 * Shared meeting data is merged while preserving the local personal overlay;
 * never re-broadcasts (avoids loops).
 */
export function applyCalendarInbound(payloadType: string, data: Record<string, unknown>): void {
  if (payloadType === "calendar.upsert") {
    const shared = data as unknown as CalendarEvent;
    if (!shared.id) return;

    // Notify on a brand-new invitation: an event we don't already have, that we
    // were invited to (a participant) and didn't organise ourselves. Keying off
    // "not already in the store" dedups the connect-time catch-up replay of
    // meetings we already knew about (the persisted calendar is loaded first),
    // while a meeting created while we were offline still surfaces on reconnect.
    const me = myUserId();
    const alreadyKnown = useCalendarStore.getState().events.some((e) => e.id === shared.id);
    const isNewInvitation =
      !alreadyKnown &&
      me != null &&
      shared.organizerId !== me &&
      (shared.participants ?? []).some((p) => p.userId === me);

    useCalendarStore.setState((s) => {
      const existing = s.events.find((e) => e.id === shared.id);
      const merged: CalendarEvent = {
        ...shared,
        reminderMinutes: existing?.reminderMinutes ?? null,
        myStatus: existing?.myStatus,
        showAs: existing?.showAs,
        personalColor: existing?.personalColor,
        createdAt: shared.createdAt ?? existing?.createdAt ?? Date.now(),
        updatedAt: shared.updatedAt ?? Date.now(),
      };
      return {
        events: existing
          ? s.events.map((e) => (e.id === merged.id ? merged : e))
          : [...s.events, merged],
      };
    });

    if (isNewInvitation) {
      showDesktopNotification(
        "Meeting invitation",
        `You've been invited to "${shared.title || "a meeting"}"`,
      );
    }
  } else if (payloadType === "calendar.delete") {
    const id = data.id as string | undefined;
    if (id) useCalendarStore.setState((s) => ({ events: s.events.filter((e) => e.id !== id) }));
  } else if (payloadType === "calendar.availability") {
    const userId = data.userId as number | undefined;
    if (userId == null) return;
    const blocks = (data.blocks as AvailabilityBlock[] | undefined) ?? [];
    useCalendarStore.setState((s) => ({
      availability: [...s.availability.filter((b) => b.userId !== userId), ...blocks],
    }));
  } else {
    return;
  }
  persistCalendar();
}

/** Re-publish the meetings the viewing user organises (+ their availability) so
 *  the plugin's in-memory index is rebuilt after a (re)connect. */
export function publishCalendar(): void {
  const uid = myUserId();
  if (uid == null) return;
  const { events, availability } = useCalendarStore.getState();
  const mine = events.filter((e) => e.organizerId === uid);
  if (mine.length > 0) sendCalendar("calendar.publish", { events: mine.map(toShared) });
  const myBlocks = availability.filter((b) => b.userId === uid);
  if (myBlocks.length > 0) sendCalendar("calendar.availability", { userId: uid, blocks: myBlocks });
}

/** Load the user's calendar from the private store into the local state. */
export async function loadCalendarFromStore(): Promise<void> {
  const json = await loadCalendarBlob();
  if (!json) return;
  try {
    const data = JSON.parse(json) as {
      events?: CalendarEvent[];
      availability?: AvailabilityBlock[];
    };
    useCalendarStore.getState().hydrate(data.events ?? [], data.availability ?? []);
  } catch (e) {
    console.error("[calendar] failed to parse stored calendar:", e);
  }
}
