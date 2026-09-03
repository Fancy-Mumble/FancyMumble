/**
 * What the block browser promises, against what the engine actually does.
 *
 * A card says what a block is and what it can be wired to, and an operator
 * picks from it before the node exists. So the one thing that must not drift is
 * the port summary: a card claiming two inputs for a node that has one is a
 * card that sends somebody hunting for a port that was never drawn.
 */

import { describe as suite, expect, it } from "vitest";
import { welcomeSpec } from "../welcome/spec";
import { onboardingSpec } from "../onboarding/spec";
import type { GraphNode, NodeSpec } from "./index";

/** Both dialects, with the onboarding one handed a translator that says the key. */
const SPECS: readonly [string, NodeSpec<never>][] = [
  ["welcome", welcomeSpec as unknown as NodeSpec<never>],
  ["onboarding", onboardingSpec((key) => key) as unknown as NodeSpec<never>],
];

suite("block browser", () => {
  for (const [name, spec] of SPECS) {
    suite(name, () => {
      it("gives every block an id of its own", () => {
        // The favourite and the search key off the id; two blocks sharing one
        // would star and un-star each other.
        const ids = spec.blocks.map((block) => block.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("describes every block, in words that are not its name", () => {
        for (const block of spec.blocks) {
          expect(block.label.length).toBeGreaterThan(0);
          expect(block.description.length).toBeGreaterThan(0);
          expect(block.description).not.toBe(block.label);
          expect(block.category.length).toBeGreaterThan(0);
        }
      });

      it("summarises exactly the ports the node it makes turns out to have", () => {
        for (const block of spec.blocks) {
          const node = block.create(0, 0) as GraphNode & never;
          // A block whose ports are its own data cannot enumerate them here,
          // and says so with `dynamicPorts` rather than by being wrong.
          if (block.dynamicPorts) continue;
          expect({
            block: block.id,
            in: block.inputs.length,
            out: block.outputs.length,
          }).toEqual({
            block: block.id,
            in: spec.inputs(node).length,
            out: spec.outputs(node).length,
          });
        }
      });
    });
  }

  suite("welcome", () => {
    it("offers each gate as its own block, already set to that operator", () => {
      // The point of the seven: an operator searches for XOR rather than
      // adding a "logic gate" and then reading a dropdown.
      const gates = welcomeSpec.blocks.filter((block) => block.id.startsWith("gate:"));
      expect(gates.map((block) => block.label)).toEqual(["AND", "OR", "XOR", "NAND", "NOR", "XNOR", "NOT"]);
      for (const block of gates) {
        const node = block.create(0, 0);
        expect(node.kind).toBe("gate");
        expect(node.kind === "gate" && node.gate).toBe(block.id.slice("gate:".length));
      }
    });

    it("gives NOT one input where the rest take two", () => {
      const inputs = (id: string) => welcomeSpec.blocks.find((block) => block.id === id)?.inputs.length;
      expect(inputs("gate:not")).toBe(1);
      expect(inputs("gate:xnor")).toBe(2);
    });

    it("names a port the same as the port it stands for", () => {
      // Only where the block names one at all: a node with a single output
      // calls it nothing, and the card prints just what it carries.
      for (const block of welcomeSpec.blocks) {
        if (block.dynamicPorts) continue;
        const node = block.create(0, 0);
        const ports = welcomeSpec.inputs(node);
        block.inputs.forEach((summary, index) => {
          if (summary.name) expect(summary.name.toLowerCase()).toBe(ports[index]);
        });
      }
    });

    it("files the message blocks apart from the conditions and the logic", () => {
      const categories = new Set(welcomeSpec.blocks.map((block) => block.category));
      expect(categories.size).toBe(3);
      const greeting = welcomeSpec.blocks.find((block) => block.id === "greeting");
      const country = welcomeSpec.blocks.find((block) => block.id === "country");
      expect(greeting?.category).not.toBe(country?.category);
    });
  });
});
