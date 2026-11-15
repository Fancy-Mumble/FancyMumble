/**
 * How much the river re-renders, in numbers.
 *
 * Every other entry under `preview/` exists to be looked at; this one exists to
 * be counted. It mounts the conversation exactly as the client does - the same
 * list, the same rows, the same store behind them - and then does one thing to
 * it over and over, reporting how many message rows React had to commit as a
 * result. A row that commits when nothing about it changed is the whole of
 * Nebula's performance problem, and this is where that shows up as a number
 * rather than as "it feels slow".
 *
 * The scenarios are the four shapes that cost something in a real session:
 *
 * - `parent`  - the shell re-rendered for any reason at all. Every row should
 *               cost nothing, because none of their props moved.
 * - `roster`  - somebody muted themselves, so the store replaced the user list.
 * - `talk`    - somebody started or stopped speaking.
 * - `react`   - a reaction landed on one message.
 * - `arrive`  - twenty messages arrived, one at a time.
 * - `scroll`  - the reader climbed towards the top, growing the window.
 *
 * Run them through `perf.mjs`, which builds this and drives a headless browser
 * over each scenario in turn. The handlers handed to the rows are deliberately
 * stable here, because that is what the shell is meant to hand them: a harness
 * that passed fresh closures would measure its own sloppiness instead.
 */
import { memo, Profiler, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { MessageList } from "@nebula/components/chat/MessageList";
import { MessageAvatar, MessageRow } from "@nebula/components/chat/MessageRow";
import { useAppStore } from "@core/store";
import { reconcileList } from "@core/store/reconcile";
import type { ChatMessage } from "@core/types";
import "@standard/theme.css";
import { initializeStandardAppearance } from "@standard/appearance";

initializeStandardAppearance();

const params = new URLSearchParams(location.search);
const TOTAL = Number(params.get("n") ?? "500");
const SCENARIO = params.get("scenario") ?? "parent";
/** How many times the scenario's one action is repeated. */
const STEPS = Number(params.get("steps") ?? "20");
const SENDERS = 20;

// -- The conversation ---------------------------------------------------

const people = Array.from({ length: SENDERS }, (_, index) => ({
  session: index + 1,
  name: `Person ${index + 1}`,
  channel_id: 1,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
  hash: `hash-${index + 1}`,
}));

useAppStore.setState({
  ownSession: 1,
  users: people as never,
  channels: [{ id: 1, name: "Perf", parent_id: null, position: 0 }] as never,
  currentChannel: 1,
  selectedChannel: 1,
  polls: new Map(),
  linkEmbeds: new Map(),
  disableLinkPreviews: true,
  readReceiptVersion: 0,
  reactionVersion: 0,
  talkingSessions: new Set<number>(),
});

/**
 * A body of each kind the river actually carries.
 *
 * The mix matters: a thread of bare sentences would say nothing about the cost
 * of parsing, and parsing a body is most of what mounting a row does.
 */
function bodyFor(index: number): string {
  switch (index % 20) {
    case 3:
      return `a line with <a href="https://example.com/${index}" data-external="true">a link in it</a> and words after`;
    case 7:
      return `<blockquote>quoted from earlier</blockquote><p>and the answer to it, number ${index}</p>`;
    case 11:
      return `<img src="https://placehold.co/320x180/2b6cb0/ffffff/png" alt="">`;
    case 15:
      return `<p>a longer one. ${"the same clause repeated for length, ".repeat(6)}number ${index}</p>`;
    default:
      return `message number ${index}, which is the ordinary case`;
  }
}

const START = Date.UTC(2026, 8, 1, 9, 0);

function makeMessage(index: number): ChatMessage {
  const session = (index % SENDERS) + 1;
  return {
    sender_session: session,
    sender_name: `Person ${session}`,
    sender_hash: `hash-${session}`,
    body: bodyFor(index),
    channel_id: 1,
    is_own: session === 1,
    message_id: `m-${index}`,
    timestamp: START + index * 45_000,
  } as ChatMessage;
}

const THREAD: ChatMessage[] = Array.from({ length: TOTAL }, (_, index) => makeMessage(index));

// -- Counters -----------------------------------------------------------

const counts = { mounts: 0, updates: 0, listCommits: 0, rowMs: 0 };

function countRow(_id: string, phase: string, actual: number): void {
  if (phase === "mount") counts.mounts += 1;
  else counts.updates += 1;
  counts.rowMs += actual;
}

function countList(): void {
  counts.listCommits += 1;
}

function reset(): void {
  counts.mounts = 0;
  counts.updates = 0;
  counts.listCommits = 0;
  counts.rowMs = 0;
}

/**
 * The list's scroller, found by being the thing that scrolls.
 *
 * It carries no name of its own, and giving it one for a harness would be a
 * mark in the app that only this file reads.
 */
function findScroller(root: HTMLElement | null): HTMLElement | null {
  for (const node of (root ?? document.body).querySelectorAll<HTMLElement>("div")) {
    if (node.scrollHeight > node.clientHeight + 40) return node;
  }
  return null;
}

/**
 * Long enough for React to have committed and run its effects.
 *
 * A timer rather than a frame: headless Chromium with a virtual clock produces
 * no frames, so a `requestAnimationFrame` here never fires and the whole run
 * waits for a callback the browser is never going to make.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 8);
  });
}

/**
 * A row, counted.
 *
 * The counter has to sit *inside* a memo boundary of its own, or it reports the
 * wrong thing entirely. `MessageList` calls its render prop again on every list
 * render, so a `Profiler` wrapped around the outside is a new element every
 * time and commits every time - even when the row inside it compared its props
 * and did nothing at all. Measured that way, memoising the row appeared to
 * change nothing.
 *
 * Wrapped like this, the bail-out happens here first and nothing below it
 * renders, which is exactly what happens in the client: `MessageRow` is
 * memoised with the same shallow comparison, so "rows whose props changed" and
 * "rows React had to render again" are the same number.
 */
const CountedRow = memo(function CountedRow(props: React.ComponentProps<typeof MessageRow>) {
  return (
    <Profiler id={props.message.message_id ?? "?"} onRender={countRow}>
      <MessageRow {...props} />
    </Profiler>
  );
});

// -- The harness --------------------------------------------------------

/**
 * Deliberately subscribes to nothing.
 *
 * The shell's own subscriptions are a fact anyone can count by reading it; what
 * cannot be read off the source is whether a render of the shell reaches the
 * rows, so that is what `parent` asks, with the shell's other reasons to render
 * held out of the way.
 */
function Harness() {
  const [messages, setMessages] = useState<ChatMessage[]>(THREAD);
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const noop = useCallback(() => {}, []);

  const renderAvatar = useCallback(
    (message: ChatMessage, avatar: string | null) => (
      <MessageAvatar message={message} avatar={avatar} onOpenProfile={noop} />
    ),
    [noop],
  );

  const renderMessage = useCallback(
    (
      message: ChatMessage,
      avatar: string | null,
      grouped: boolean,
      restoring: boolean,
      endsGroup: boolean,
    ) => (
      <CountedRow
        message={message}
        avatar={avatar}
        grouped={grouped}
        endsGroup={endsGroup}
        restoring={restoring}
        stickyAvatar
        onOpenProfile={noop}
      />
    ),
    [noop],
  );

  // The controls the driver reaches for, published once the tree is up.
  useEffect(() => {
    let next = TOTAL;
    Object.assign(window as never, {
      __perf: {
        counts,
        reset,
        settle,
        forceRender,
        appendOne: () => setMessages((prior) => [...prior, makeMessage(next++)]),
        // What `refreshState` does on every state change: the backend answers
        // with the whole roster, freshly deserialised, and the store decides
        // how much of it is actually new. Reconciled here for the same reason
        // it is reconciled there - a scenario that skipped that step would be
        // measuring a store this client no longer has.
        replaceUsers: () =>
          useAppStore.setState({
            users: reconcileList(
              useAppStore.getState().users,
              useAppStore.getState().users.map((user) => ({ ...user })),
              (user) => user.session,
            ),
          }),
        flipTalking: (on: boolean) =>
          useAppStore.setState({ talkingSessions: new Set(on ? [7] : []) }),
        bumpReaction: () =>
          useAppStore.setState((state) => ({ reactionVersion: state.reactionVersion + 1 })),
        scroller: () => findScroller(scrollerRef.current),
      },
    });
  }, [forceRender]);

  return (
    <Box ref={scrollerRef} sx={{ width: 900, height: 700, display: "flex" }}>
      <Profiler id="list" onRender={countList}>
        <MessageList
          messages={messages}
          users={people as never}
          renderAvatar={renderAvatar}
          renderMessage={renderMessage}
        />
      </Profiler>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Harness />
  </ThemeProvider>,
);

// -- The run ------------------------------------------------------------

interface Report {
  scenario: string;
  steps: number;
  mounts: number;
  updates: number;
  listCommits: number;
  rowMs: number;
  wallMs: number;
  heapMb: number | null;
}

function publish(report: Report): void {
  const line = JSON.stringify(report);
  document.title = line;
  const out = document.createElement("pre");
  out.id = "perf-result";
  out.textContent = line;
  document.body.append(out);
}

async function repeat(times: number, step: (index: number) => void): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    step(index);
    await settle();
  }
}

/** The controls are published from an effect, so the run waits for them. */
async function waitForApi(): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if ((window as never as { __perf?: unknown }).__perf) return;
    await settle();
  }
  throw new Error("the harness never published its controls");
}

async function main(): Promise<void> {
  const perf = () => (window as never as { __perf: Record<string, never> }).__perf;
  await waitForApi();
  // The mount is a measurement of its own, so it is taken before the reset.
  await settle();
  await settle();
  const mounted = counts.mounts;
  const mountMs = counts.rowMs;

  reset();
  const started = performance.now();

  const api = perf() as unknown as {
    forceRender: () => void;
    appendOne: () => void;
    replaceUsers: () => void;
    flipTalking: (on: boolean) => void;
    bumpReaction: () => void;
    scroller: () => HTMLElement | null | undefined;
  };

  switch (SCENARIO) {
    case "mount":
      break;
    case "parent":
      await repeat(STEPS, () => api.forceRender());
      break;
    case "roster":
      await repeat(STEPS, () => api.replaceUsers());
      break;
    case "talk":
      await repeat(STEPS, (index) => api.flipTalking(index % 2 === 0));
      break;
    case "react":
      await repeat(STEPS, () => api.bumpReaction());
      break;
    case "arrive":
      await repeat(STEPS, () => api.appendOne());
      break;
    case "scroll": {
      const node = api.scroller();
      if (node) {
        const span = node.scrollHeight;
        await repeat(10, (index) => {
          node.scrollTop = Math.max(0, span - (span / 10) * (index + 1));
        });
      }
      break;
    }
    default:
      break;
  }

  await settle();
  const memory = (performance as never as { memory?: { usedJSHeapSize: number } }).memory;
  publish({
    scenario: SCENARIO,
    steps: SCENARIO === "mount" ? 1 : STEPS,
    mounts: SCENARIO === "mount" ? mounted : counts.mounts,
    updates: counts.updates,
    listCommits: counts.listCommits,
    rowMs: Math.round((SCENARIO === "mount" ? mountMs : counts.rowMs) * 10) / 10,
    wallMs: Math.round(performance.now() - started),
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1e5) / 10 : null,
  });
}

// A run that threw has to say so in the same place a run that worked reports,
// or the driver simply times out and the reason is lost with the browser.
void main().catch((error: unknown) => {
  const line = JSON.stringify({ scenario: SCENARIO, error: String(error) });
  document.title = line;
  const out = document.createElement("pre");
  out.id = "perf-result";
  out.textContent = line;
  document.body.append(out);
});
