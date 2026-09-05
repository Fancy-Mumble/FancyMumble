import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Snackbar, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { useServerLivery } from "../../useServerLivery";
import { Stack } from "../primitives";
import { NodeEditor, Segmented, useGraphHistory } from "./nodes";
import {
  WELCOME_SUGGESTED,
  WelcomeConflictProvider,
  WelcomeOpenDesignProvider,
  WelcomeSubjectProvider,
  welcomeSpec,
} from "./welcome/spec";
import { DesignEditor } from "./welcome/DesignEditor";
import { removeDesignInput, renameDesignInput } from "./welcome/model";
import { patchNode } from "./nodes";
import type { Design } from "./welcome/design";
import { conflictKey, conflictsIn, sameConflictKey, type Conflicts } from "./welcome/solver";
import { seedGraph } from "./welcome/seed";
import { loadGreeting, saveGreeting } from "./welcome/greetingStore";
import {
  describeGreeting,
  greetingsOf,
  graphStatus,
  snippetsOf,
  inputOfPort,
  wiredInputsOf,
  type PreviewSubject,
  type WelcomeGraph,
} from "./welcome/model";

/**
 * The Welcome message page.
 *
 * An operator draws the condition rather than writing one. That is the whole
 * decision behind this page: the facts a greeting can turn on - version,
 * country, how long somebody has been here, whether they have an account - are
 * combined with `and`, `or` and `xor`, and a boolean expression typed into a
 * box is a thing people get wrong silently. Wires cannot be mistyped, and the
 * status bar reads the drawing back as the sentence it means, so the operator
 * can check the two against each other.
 *
 * Everything visible here is the shared node editor; what makes it a *welcome*
 * editor is `welcomeSpec`. The onboarding page is the same component with a
 * different dialect wired into it.
 *
 * The page deliberately has no title of its own: the canvas wants the height,
 * and the sidebar already says which page this is.
 */
export function WelcomeAdmin() {
  // The graph, with a way back. Every gesture on a canvas is destructive -
  // a mis-drag scatters a selection, Delete takes a node and its wires, a
  // template can replace the lot - and without undo the safe move is to not
  // touch it, which is the opposite of what a canvas is for.
  const history = useGraphHistory<WelcomeGraph>(emptyGraph);
  const graph = history.value;
  const setGraph = history.set;
  const [mode, setMode] = useState<"blocks" | "canvas">("canvas");
  const [saving, setSaving] = useState(false);
  /**
   * Which design block has its editor open, if any.
   *
   * The id rather than the design itself, so edits land back on the node
   * through the same `onChange` every other edit uses - and so undo, the save
   * button and the conflict solver all see them without knowing an editor
   * exists.
   */
  const [designing, setDesigning] = useState<string | null>(null);
  /**
   * How far the read of this server's greeting has got.
   *
   * Nothing is drawn until it says `ready`, which is the whole of the fix for
   * a page that used to open on the seed: the canvas showed an example nobody
   * wrote, and a second later the operator's own greeting replaced it. Two
   * layouts in a row, the first of them a lie - and one an operator had every
   * reason to read as the page having just changed something.
   *
   * It also keeps the save button honest, which is what the old flag was for:
   * saving before the read lands would write a demonstration over whatever
   * this server actually has.
   */
  const [read, setRead] = useState<Read>({ state: "reading" });
  /** Bumped by Try again, to run the read below once more. */
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const activeServerId = useAppStore((state) => state.activeServerId);
  // The two facts the preview needs, rather than the arrays they are in. A
  // selector that returns `state.users` re-runs this page - and with it every
  // node on the canvas - whenever anybody anywhere starts talking, mutes, or
  // moves channel; one that returns a name only re-runs it when that name
  // changes.
  const ownName = useAppStore(
    (state) => state.users.find((user) => user.session === state.ownSession)?.name,
  );
  const serverName = useAppStore((state) => {
    const active = state.sessions.find((session) => session.id === state.activeServerId);
    return active?.label || active?.host || "";
  });
  // Whether this server will send the markup half of a greeting at all. The
  // preview needs it, and so does the operator: formatting a greeting on a
  // server with the setting off changes nothing anybody sees.
  const allowHtml = useAppStore((state) => state.serverConfig.allow_html);
  // The tab this page is administering, never whichever server pushed last.
  const livery = useServerLivery(activeServerId);

  const subject: PreviewSubject = useMemo(
    () => ({
      name: ownName ?? "Lyn",
      channel: "#Gaming",
      server: livery?.displayName || serverName || "this server",
      allowHtml,
      icon: livery?.iconSrc,
      banner: livery?.bannerSrc,
    }),
    [ownName, serverName, livery, allowHtml],
  );

  const status = graphStatus(graph);
  const conflicts = useConflicts(graph);

  // What this server has drawn, or the scaffold if it has drawn nothing. A
  // server with no greeting answers with an empty document, which is a real
  // answer and the one case the seed is for: it is where an operator starts,
  // not something shown over the top of what they already have.
  useEffect(() => {
    let live = true;
    setRead({ state: "reading" });
    loadGreeting()
      .then((held) => {
        if (!live) return;
        // `reset`, not `set`: this is not an edit the operator made, and undo
        // must not offer to take them back to the blank the page opened on.
        history.reset(held.nodes.length > 0 ? held : seedGraph());
        setRead({ state: "ready" });
      })
      .catch((error: unknown) => {
        if (!live) return;
        // Said in the pane rather than in a snackbar that hides itself after
        // six seconds: with nothing drawn, this *is* the page, and an empty
        // canvas with no explanation reads as a server with no greeting.
        setRead({ state: "failed", why: String(error) });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const open = useMemo(() => graph.nodes.find((node) => node.id === designing), [graph, designing]);
  const design: Design | undefined = open?.kind === "greeting" ? open.design : undefined;

  const save = useCallback(() => {
    setSaving(true);
    saveGreeting(graph)
      .then(() => setNotice({ tone: "success", text: "Greeting saved." }))
      .catch((error: unknown) => setNotice({ tone: "error", text: `Not saved: ${String(error)}` }))
      .finally(() => setSaving(false));
  }, [graph]);

  if (read.state !== "ready") {
    return (
      <Reading
        failure={read.state === "failed" ? read.why : null}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }

  return (
    <WelcomeSubjectProvider value={subject}>
      <WelcomeConflictProvider value={conflicts}>
        <WelcomeOpenDesignProvider value={setDesigning}>
          {/* Relative, so the editor can cover exactly the editor and leave the
          rest of the admin chrome - the sidebar, the tabs - alone. */}
          <Stack sx={{ position: "relative", flex: 1, minHeight: 0 }}>
            <NodeEditor
              spec={welcomeSpec}
              graph={graph}
              onChange={setGraph}
              onReset={() => setGraph(seedGraph())}
              history={history}
              suggested={WELCOME_SUGGESTED}
              leading={
                <Segmented
                  value={mode}
                  options={[
                    { id: "blocks", label: "Blocks" },
                    { id: "canvas", label: "Node canvas" },
                  ]}
                  onChange={(id) => setMode(id as typeof mode)}
                />
              }
              view={mode === "blocks" ? <BlocksView graph={graph} /> : undefined}
              summary={summarise(graph, conflicts.shadowed.length)}
              actions={
                <>
                  <Button size="small">Test greeting</Button>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!status.complete || saving}
                    onClick={save}
                  >
                    {saving ? "Saving…" : "Save & broadcast"}
                  </Button>
                </>
              }
            />
            {design && open && (
              <DesignEditor
                design={design}
                name={designName(graph, open.id)}
                detail={designDetail(graph, open.id)}
                // The design declares its inputs; only the graph knows which of
                // them anything actually feeds.
                wired={wiredInputsOf(graph, open.id)}
                // What Preview shows in each slot: the snippet actually wired
                // to it, so previewing a greeting shows the greeting rather
                // than the names of its parts.
                values={designValues(graph, open.id)}
                onChange={(next) => setGraph(patchNode(graph, open.id, { design: next }))}
                onUndo={history.undo}
                onRedo={history.redo}
                // Through the graph, not the design: the port an input names
                // has a wire on it, and renaming one without moving the other
                // leaves a greeting quietly unfed.
                onRenameInput={(id, name) => setGraph(renameDesignInput(graph, open.id, id, name))}
                onRemoveInput={(id) => setGraph(removeDesignInput(graph, open.id, id))}
                onClose={() => setDesigning(null)}
              />
            )}
          </Stack>
        </WelcomeOpenDesignProvider>
      </WelcomeConflictProvider>
      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={notice?.tone} onClose={() => setNotice(null)} variant="filled">
          {notice?.text}
        </Alert>
      </Snackbar>
    </WelcomeSubjectProvider>
  );
}

/** How far the read of this server's greeting has got. */
type Read = { state: "reading" } | { state: "ready" } | { state: "failed"; why: string };

/** What the page holds before the server has answered: nothing at all. */
function emptyGraph(): WelcomeGraph {
  return { nodes: [], edges: [], enabled: true };
}

/**
 * The pane while the greeting is being read, and where the read fails.
 *
 * Deliberately not a canvas with a spinner over it: an empty canvas is itself
 * a claim about this server, and the one thing this page must not do is make
 * a claim it has not checked.
 */
function Reading({ failure, onRetry }: Readonly<{ failure: string | null; onRetry: () => void }>) {
  return (
    <Stack alignItems="center" justifyContent="center" gap={2} sx={{ flex: 1, minHeight: 0, p: "48px" }}>
      <Typography
        sx={(theme) => ({
          maxWidth: 520,
          textAlign: "center",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: failure === null ? theme.palette.nebula.muted : theme.palette.error.main,
        })}
      >
        {failure === null ? "Reading this server's greeting…" : `Could not read this server's greeting: ${failure}`}
      </Typography>
      {failure !== null && (
        <Button size="small" variant="contained" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Stack>
  );
}

/**
 * Which greetings shadow which.
 *
 * Once per graph rather than once per preview: settling it is a search over
 * every visitor the conditions can tell apart, and a canvas with four
 * greetings on it would otherwise run that search four times over.
 *
 * And once per *question* rather than once per edit, which is what the key is
 * for. Keyed on the graph itself, this re-ran the whole search on every
 * keystroke in every greeting - and prose cannot change who a greeting
 * reaches, so on a canvas with enough conditions for the search to cost
 * anything, all of that cost landed between one letter and the next.
 */
function useConflicts(graph: WelcomeGraph): Conflicts {
  const held = useRef<{ key: readonly unknown[]; value: Conflicts } | null>(null);
  const key = conflictKey(graph);
  if (!held.current || !sameConflictKey(held.current.key, key)) {
    held.current = { key, value: conflictsIn(graph) };
  }
  return held.current.value;
}

/**
 * Which greeting the editor is open on.
 *
 * The title alone; who it reaches goes under it, from `describeGreeting` - the
 * same sentence the node's own preview says, because that is what an operator
 * needs to keep in mind while they are looking at a design instead of at the
 * wires that decide who sees it.
 */
function designName(graph: WelcomeGraph, id: string): string {
  const order = greetingsOf(graph);
  const at = order.findIndex((greeting) => greeting.id === id);
  return order.length > 1 ? `Greeting #${at + 1}` : "This greeting";
}

/**
 * What each of a design's inputs currently says.
 *
 * Read off the wires: a text node on `in:<name>` is that input's value. Only
 * Preview needs this - everywhere else the editor is placing the input, not
 * reading it.
 */
function designValues(graph: WelcomeGraph, id: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.to !== id) continue;
    const name = inputOfPort(edge.port);
    if (name === null) continue;
    const from = graph.nodes.find((node) => node.id === edge.from);
    if (from?.kind === "text") values.set(name, from.body || from.html);
  }
  return values;
}

/** Who it reaches, for the line under the title. */
function designDetail(graph: WelcomeGraph, id: string): string {
  const condition = describeGreeting(graph, id);
  return condition ? `matches ${condition}` : "nothing wired to WHEN";
}

/**
 * The footer's sentence: what this canvas will do, in words.
 *
 * A graph may hold several greetings, so the line has to be about all of them.
 * The count of greetings that reach nobody is the part worth putting in the
 * footer rather than only on the node: it is the failure an operator would
 * otherwise have to scroll the canvas to find.
 */
function summarise(graph: WelcomeGraph, shadowed: number): string {
  const greetings = greetingsOf(graph);
  if (greetings.length === 0) return "No greeting on the canvas yet.";
  if (greetings.length === 1) {
    const condition = describeGreeting(graph, greetings[0].id);
    return condition
      ? `Shows when ${condition}`
      : "Nothing is wired to WHEN — this greeting shows to nobody.";
  }
  const unwired = greetings.filter((greeting) => describeGreeting(graph, greeting.id) === null).length;
  const parts = [`${greetings.length} greetings, tried in the order they are drawn`];
  if (unwired > 0) parts.push(`${unwired} with nothing wired to WHEN`);
  if (shadowed > 0) parts.push(`${shadowed} that reach nobody`);
  return parts.join(" — ");
}

/**
 * The same rule as prose.
 *
 * Not a second editor and deliberately read-only: it exists so an operator can
 * check what they drew without tracing wires, which is the one thing a canvas
 * is worse at than a list.
 */
function BlocksView({ graph }: Readonly<{ graph: WelcomeGraph }>) {
  const greetings = greetingsOf(graph);

  return (
    <Box
      sx={(theme) => ({
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        p: "18px",
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        borderBottom: `1px solid ${theme.palette.nebula.line}`,
        background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
      })}
    >
      <Stack gap={3} sx={{ maxWidth: 640 }}>
        {greetings.length === 0 && <Field label="Greetings">— none on the canvas —</Field>}
        {greetings.map((greeting, index) => {
          const snippets = snippetsOf(graph, greeting.id);
          return (
            <Stack key={greeting.id} gap={1.5}>
              {/* Numbered, because the order is what decides who sees which. */}
              {greetings.length > 1 && <Field label="Greeting">{`#${index + 1}`}</Field>}
              <Field label="Shown when">{describeGreeting(graph, greeting.id) ?? "— nothing wired —"}</Field>
              <Field label="They read">{greeting.body || "— empty —"}</Field>
              {snippets.length > 0 && (
                <Field label="Plus text">
                  {snippets.map((s) => (s.kind === "text" ? s.body : "")).join("\n")}
                </Field>
              )}
              <Field label="Dismissal">
                {greeting.kind === "greeting" && greeting.once
                  ? "Shown once, then remembered per account."
                  : "Shown on every connect."}
              </Field>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Box>
      <Typography
        sx={(theme) => ({
          mb: "5px",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: theme.palette.nebula.dim,
        })}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{children}</Typography>
    </Box>
  );
}
