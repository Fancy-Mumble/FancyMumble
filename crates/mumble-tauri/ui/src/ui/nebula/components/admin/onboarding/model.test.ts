/**
 * The onboarding questionnaire, as a drawing.
 *
 * What is checked here is the seam between the two shapes the page holds: a
 * config becomes a graph, the graph is wired and edited, and it becomes the
 * same config again. Everything the admin can do on the canvas either survives
 * that round trip or is named by `problemsOf` - and a wire the config could not
 * express is refused at the port rather than dropped silently on save.
 */

import { describe as suite, expect, it } from "vitest";
import type { OnboardingConfig } from "@core/types";
import { canConnect, connect, removeNode } from "../nodes/graph";
import {
  answersOf,
  configOf,
  defaultChannelsOf,
  graphOf,
  grantsOf,
  makeNode,
  onboardingWiring as wiring,
  positionsOf,
  problemsOf,
  publishable,
  questionsOf,
  summaryOf,
  type OnboardingGraph,
} from "./model";

const CONFIG: OnboardingConfig = {
  version: 1,
  enabled: true,
  revision: 7,
  default_channel_ids: [0],
  questions: [
    {
      id: "q1",
      text: "What brings you here?",
      multi_select: false,
      required: true,
      ask_before_join: true,
      answers: [
        { id: "a1", label: "Gaming", emoji: "🎮", channel_ids: [4], group_names: ["gamers"] },
        { id: "a2", label: "Movie nights", channel_ids: [2], group_names: [] },
      ],
    },
    {
      id: "q2",
      text: "Where are you from?",
      multi_select: true,
      required: false,
      ask_before_join: false,
      answers: [{ id: "a3", label: "Europe", channel_ids: [2], group_names: [] }],
    },
  ],
};

suite("onboarding graph", () => {
  it("draws the whole questionnaire and reads it back unchanged", () => {
    // The one assertion the two editors rest on: what the canvas compiles is
    // the document the rail was editing, field for field.
    expect(configOf(graphOf(CONFIG), CONFIG)).toEqual(CONFIG);
  });

  it("keeps the revision and version the server assigned", () => {
    const config = configOf(graphOf(CONFIG), CONFIG);
    expect(config.revision).toBe(7);
    expect(config.version).toBe(1);
  });

  it("asks the questions in the order they are wired, not the order they are drawn", () => {
    const graph = graphOf(CONFIG);
    // Drag the second question above the first: the flow is the wires.
    const moved: OnboardingGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === "q:q2" ? { ...node, y: -400 } : node)),
    };
    expect(questionsOf(moved).map((question) => question.text)).toEqual([
      "What brings you here?",
      "Where are you from?",
    ]);
  });

  it("collects a channel granted by two answers into one node", () => {
    const graph = graphOf(CONFIG);
    // Three channels are named - #0 where everyone starts, #4 and #2 - and #2
    // is named twice, by "Movie nights" and by "Europe". It is one node.
    expect(graph.nodes.filter((node) => node.kind === "channel")).toHaveLength(3);
    expect(graph.edges.filter((edge) => edge.to === "ch:2")).toHaveLength(2);
  });

  it("gives everyone the channels wired to the start node", () => {
    expect(defaultChannelsOf(graphOf(CONFIG)).map((node) => node.channelId)).toEqual([0]);
  });

  it("counts what the drawing does, for the status bar", () => {
    expect(summaryOf(graphOf(CONFIG))).toEqual({
      questions: 2,
      answers: 3,
      channels: 3,
      groups: 1,
      beforeJoin: 1,
    });
  });

  suite("wiring rules", () => {
    it("lets a question follow a question and an answer hang off one", () => {
      const graph = graphOf(CONFIG);
      expect(canConnect(graph, wiring, { from: "q:q1", fromPort: "then", to: "q:q2", port: "flow" })).toBe(
        true,
      );
      expect(canConnect(graph, wiring, { from: "q:q2", fromPort: "picks", to: "a:a1", port: "from" })).toBe(
        true,
      );
    });

    it("refuses the wire that would make an answer a step in the flow", () => {
      const graph = graphOf(CONFIG);
      // The mis-drag this canvas is most likely to see: `picks` carries the
      // answers a question offers, and `flow` carries what comes next.
      expect(canConnect(graph, wiring, { from: "q:q1", fromPort: "picks", to: "q:q2", port: "flow" })).toBe(
        false,
      );
      expect(canConnect(graph, wiring, { from: "q:q1", fromPort: "then", to: "a:a1", port: "from" })).toBe(
        false,
      );
    });

    it("refuses a group where only channels mean anything", () => {
      const graph = graphOf(CONFIG);
      // The config carries default *channels*, so a group wired to the start
      // would look configured and be dropped on save.
      expect(
        canConnect(graph, wiring, { from: "start", fromPort: "place", to: "gr:gamers", port: "in" }),
      ).toBe(false);
      expect(canConnect(graph, wiring, { from: "start", fromPort: "place", to: "ch:2", port: "in" })).toBe(
        true,
      );
      expect(
        canConnect(graph, wiring, { from: "a:a3", fromPort: "grants", to: "gr:gamers", port: "in" }),
      ).toBe(true);
    });

    it("refuses a flow that would loop back on itself", () => {
      const graph = graphOf(CONFIG);
      expect(canConnect(graph, wiring, { from: "q:q2", fromPort: "then", to: "q:q1", port: "flow" })).toBe(
        false,
      );
    });

    it("replaces what followed a question, and lets a channel be granted by many", () => {
      const graph = graphOf(CONFIG);
      const third = makeNode("question", 0, 0);
      const rewired = connect({ ...graph, nodes: [...graph.nodes, third] }, wiring, {
        from: "q:q1",
        fromPort: "then",
        to: third.id,
        port: "flow",
      });
      // One question follows another: q2 is no longer second, it is nowhere.
      expect(questionsOf(rewired).map((question) => question.id)).toEqual(["q:q1", third.id]);
      expect(problemsOf(rewired).some((problem) => problem.code === "offFlow")).toBe(true);

      const shared = connect(graph, wiring, { from: "a:a1", fromPort: "grants", to: "ch:2", port: "in" });
      expect(shared.edges.filter((edge) => edge.to === "ch:2")).toHaveLength(3);
    });

    it("carries the answers with a question when it goes", () => {
      const cut = removeNode(graphOf(CONFIG), "q:q1");
      // q2 was reached through q1, so nothing is on the flow any more.
      expect(questionsOf(cut)).toHaveLength(0);
      expect(configOf(cut, CONFIG).questions).toHaveLength(0);
    });
  });

  suite("what still has to be drawn", () => {
    it("is finished when the drawing is the config", () => {
      expect(problemsOf(graphOf(CONFIG))).toEqual([]);
    });

    it("names the question that offers nothing", () => {
      const graph = graphOf(CONFIG);
      const stripped: OnboardingGraph = {
        ...graph,
        edges: graph.edges.filter((edge) => !(edge.from === "q:q2" && edge.port === "from")),
      };
      expect(problemsOf(stripped)).toContainEqual({
        code: "questionAnswers",
        where: "Where are you from?",
      });
    });

    it("says so when a question is drawn but never asked", () => {
      const graph = graphOf(CONFIG);
      const loose = { ...graph, nodes: [...graph.nodes, makeNode("question", 0, 0)] };
      expect(problemsOf(loose).map((problem) => problem.code)).toContain("offFlow");
    });

    it("says so when nothing is wired to the start at all", () => {
      const graph = graphOf({ ...CONFIG, questions: [] });
      expect(problemsOf(graph).map((problem) => problem.code)).toContain("noQuestions");
    });

    it("names a channel node that names no channel", () => {
      const graph = graphOf(CONFIG);
      const blank = { ...graph, nodes: [...graph.nodes, makeNode("channel", 0, 0)] };
      expect(problemsOf(blank).map((problem) => problem.code)).toContain("channelUnset");
    });
  });

  it("keeps a half-written answer while it is being written, and drops it on save", () => {
    const graph = graphOf(CONFIG);
    const blank = makeNode("answer", 0, 0);
    const half = connect({ ...graph, nodes: [...graph.nodes, blank] }, wiring, {
      from: "q:q2",
      fromPort: "picks",
      to: blank.id,
      port: "from",
    });
    // The canvas compiles it faithfully - it is a row somebody is thinking
    // about, exactly as the rail keeps one.
    expect(configOf(half, CONFIG).questions[1].answers).toHaveLength(2);
    // Saving is where the blank rows go.
    expect(publishable(configOf(half, CONFIG)).questions[1].answers).toHaveLength(1);
  });

  it("leaves every node where it was put when the drawing is rebuilt", () => {
    const graph = graphOf(CONFIG);
    const moved: OnboardingGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === "q:q1" ? { ...node, x: 900, y: 640 } : node)),
    };
    const rebuilt = graphOf(configOf(moved, CONFIG), positionsOf(moved));
    const question = rebuilt.nodes.find((node) => node.id === "q:q1");
    expect([question?.x, question?.y]).toEqual([900, 640]);
  });

  it("reads an answer's grants off the wires, in the order they were drawn", () => {
    const graph = graphOf(CONFIG);
    expect(grantsOf(graph, "a:a1").map((node) => node.id)).toEqual(["ch:4", "gr:gamers"]);
    expect(answersOf(graph, "q:q1").map((node) => node.label)).toEqual(["Gaming", "Movie nights"]);
  });
});
