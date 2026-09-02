import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Snackbar, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { useServerLivery } from "../../useServerLivery";
import { Stack } from "../primitives";
import { NodeEditor, Segmented } from "./nodes";
import { WELCOME_SUGGESTED, WelcomeSubjectProvider, welcomeSpec } from "./welcome/spec";
import { seedGraph } from "./welcome/seed";
import { loadGreeting, saveGreeting, type CarriedMarkup } from "./welcome/greetingStore";
import {
  describe,
  greetingOf,
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
  const [graph, setGraph] = useState<WelcomeGraph>(seedGraph);
  const [mode, setMode] = useState<"blocks" | "canvas">("canvas");
  /**
   * The markup halves the canvas cannot edit, held so a save hands them
   * back untouched rather than blanking what somebody set through the API.
   */
  const [markup, setMarkup] = useState<CarriedMarkup>(() => new Map());
  const [saving, setSaving] = useState(false);
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
  // The tab this page is administering, never whichever server pushed last.
  const livery = useServerLivery(activeServerId);
  const active = sessions.find((session) => session.id === activeServerId);

  const subject: PreviewSubject = useMemo(
    () => ({
      name: users.find((u) => u.session === ownSession)?.name ?? "Lyn",
      channel: "#Gaming",
      server: livery?.displayName || active?.label || active?.host || "this server",
    }),
    [users, ownSession, livery, active],
  );

  const condition = describe(graph);
  const status = graphStatus(graph);

  // The server's graph replaces the seed as soon as it arrives. A server
  // that has drawn none answers with an empty document, which is a real
  // answer: the canvas then starts empty rather than showing an example the
  // operator never wrote and might save by accident.
  useEffect(() => {
    let live = true;
    loadGreeting()
      .then((held) => {
        if (!live) return;
        if (held.graph.nodes.length > 0) setGraph(held.graph);
        setMarkup(held.markup);
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

  const save = useCallback(() => {
    setSaving(true);
    saveGreeting(graph, markup)
      .then(() => setNotice({ tone: "success", text: "Greeting saved." }))
      .catch((error: unknown) => setNotice({ tone: "error", text: `Not saved: ${String(error)}` }))
      .finally(() => setSaving(false));
  }, [graph, markup]);

  return (
    <WelcomeSubjectProvider value={subject}>
      <NodeEditor
        spec={welcomeSpec}
        graph={graph}
        onChange={setGraph}
        onReset={() => setGraph(seedGraph())}
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
        summary={
          condition ? `Shows when ${condition}` : "Nothing is wired to WHEN — this greeting shows to nobody."
        }
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
 * The same rule as prose.
 *
 * Not a second editor and deliberately read-only: it exists so an operator can
 * check what they drew without tracing wires, which is the one thing a canvas
 * is worse at than a list.
 */
function BlocksView({ graph }: Readonly<{ graph: WelcomeGraph }>) {
  const greeting = greetingOf(graph);
  const condition = describe(graph);
  const snippets = snippetsOf(graph);

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
      <Stack gap={1.5} sx={{ maxWidth: 640 }}>
        <Field label="Shown when">{condition ?? "— nothing wired —"}</Field>
        <Field label="They read">
          {greeting?.kind === "greeting" ? greeting.body || "— empty —" : "— no greeting node —"}
        </Field>
        {snippets.length > 0 && (
          <Field label="Plus text">{snippets.map((s) => (s.kind === "text" ? s.body : "")).join("\n")}</Field>
        )}
        <Field label="Dismissal">
          {greeting?.kind === "greeting" && greeting.once
            ? "Shown once, then remembered per account."
            : "Shown on every connect."}
        </Field>
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
