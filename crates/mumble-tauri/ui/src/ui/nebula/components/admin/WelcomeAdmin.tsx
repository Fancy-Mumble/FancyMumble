import { useCallback, useEffect, useMemo, useState } from "react";
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
import { patchNode } from "./nodes";
import type { Design } from "./welcome/design";
import { conflictsIn } from "./welcome/solver";
import { seedGraph } from "./welcome/seed";
import { loadGreeting, saveGreeting } from "./welcome/greetingStore";
import {
  describeGreeting,
  greetingsOf,
  graphStatus,
  snippetsOf,
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
  const history = useGraphHistory<WelcomeGraph>(seedGraph);
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
   * Whether what is on screen came from the server.
   *
   * Until it has, the canvas is showing the seed - an example, not this
   * server's graph - so saving would overwrite whatever the operator
   * actually has with a demonstration. The save button waits for the load.
   */
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);
  // Whether this server will send the markup half of a greeting at all. The
  // preview needs it, and so does the operator: formatting a greeting on a
  // server with the setting off changes nothing anybody sees.
  const allowHtml = useAppStore((state) => state.serverConfig.allow_html);
  // The tab this page is administering, never whichever server pushed last.
  const livery = useServerLivery(activeServerId);
  const active = sessions.find((session) => session.id === activeServerId);

  const subject: PreviewSubject = useMemo(
    () => ({
      name: users.find((u) => u.session === ownSession)?.name ?? "Lyn",
      channel: "#Gaming",
      server: livery?.displayName || active?.label || active?.host || "this server",
      allowHtml,
      icon: livery?.iconSrc,
      banner: livery?.bannerSrc,
    }),
    [users, ownSession, livery, active, allowHtml],
  );

  const status = graphStatus(graph);
  /**
   * Which greetings shadow which.
   *
   * Once per graph, here, rather than in each preview: settling it is a search
   * over every visitor the conditions can tell apart, and a canvas with four
   * greetings on it would otherwise run that search four times per keystroke.
   */
  const conflicts = useMemo(() => conflictsIn(graph), [graph]);

  // The server's graph replaces the seed as soon as it arrives. A server
  // that has drawn none answers with an empty document, which is a real
  // answer: the canvas then starts empty rather than showing an example the
  // operator never wrote and might save by accident.
  useEffect(() => {
    let live = true;
    loadGreeting()
      .then((held) => {
        if (!live) return;
        // `reset`, not `set`: this is not an edit the operator made, and undo
        // must not offer to take them back to the seed the page opened on.
        if (held.nodes.length > 0) history.reset(held);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!live) return;
        // Left on the seed and said out loud. A page that silently showed
        // an example would look like a server with one greeting drawn.
        setNotice({
          tone: "error",
          text: `Could not read this server's greeting: ${String(error)}`,
        });
      });
    return () => {
      live = false;
    };
  }, []);

  const open = useMemo(() => graph.nodes.find((node) => node.id === designing), [graph, designing]);
  const design: Design | undefined = open?.kind === "greeting" ? open.design : undefined;

  const save = useCallback(() => {
    setSaving(true);
    saveGreeting(graph)
      .then(() => setNotice({ tone: "success", text: "Greeting saved." }))
      .catch((error: unknown) => setNotice({ tone: "error", text: `Not saved: ${String(error)}` }))
      .finally(() => setSaving(false));
  }, [graph]);

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
                    disabled={!status.complete || !loaded || saving}
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
                title={designTitle(graph, open.id)}
                onChange={(next) => setGraph(patchNode(graph, open.id, { design: next }))}
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

/**
 * Which greeting the editor is open on, and who it reaches.
 *
 * The same sentence the node's own preview says, because that is what an
 * operator needs to keep in mind while they are looking at a design instead of
 * at the wires that decide who sees it.
 */
function designTitle(graph: WelcomeGraph, id: string): string {
  const order = greetingsOf(graph);
  const at = order.findIndex((greeting) => greeting.id === id);
  const which = order.length > 1 ? `Greeting #${at + 1}` : "This greeting";
  const condition = describeGreeting(graph, id);
  return condition ? `${which} · matches ${condition}` : `${which} · nothing wired to WHEN`;
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
