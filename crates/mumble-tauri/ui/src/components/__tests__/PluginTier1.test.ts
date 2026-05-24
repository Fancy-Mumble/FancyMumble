// Regression coverage for the Tier-1 plugin extension plumbing.
// Exercises the pure helpers in `plugins/tier1/` end-to-end against
// the wire format produced by the Rust mumble-plugin-api crate.

import { describe, it, expect } from "vitest";
import {
  parseClientManifest,
  collectSlashCommands,
  filterSlashCommands,
} from "../../plugins/tier1/manifest";
import {
  applyInteractionResponse,
  applyRegistryWithTrust,
  applyTrustDecision,
  applyTrustRevocation,
  decodeInteractionResponse,
  emptyPluginTier1Slice,
  manifestsFromRegistry,
  panelKey,
} from "../../plugins/tier1/store";
import {
  parseSlashLine,
  tokenise,
  extractSlashQuery,
} from "../../plugins/tier1/slashParser";
import { INTERACTION_RESPONSE_PAYLOAD_TYPE } from "../../plugins/tier1/types";
import {
  decodePluginInfo,
  evaluateTrust,
  recordFromDecision,
} from "../../plugins/tier1/trust";

const greetManifestInfoJson = JSON.stringify({
  description: "demo",
  capabilities: ["greeting"],
  debug_rows: [],
  client_manifest: {
    schema_version: 1,
    slash_commands: [
      {
        name: "greet",
        description: "Send a friendly greeting",
        options: [
          { name: "name", description: "Who", type: "string", required: true },
          { name: "loud", description: "Shout it", type: "boolean", required: false },
        ],
      },
    ],
    capabilities: ["slash-commands", "modals", "components", "notifications"],
  },
});

describe("parseClientManifest", () => {
  it("returns null on missing / malformed json", () => {
    expect(parseClientManifest(null)).toBeNull();
    expect(parseClientManifest("")).toBeNull();
    expect(parseClientManifest("{not json")).toBeNull();
  });

  it("returns null when info_json has no client_manifest key", () => {
    expect(parseClientManifest(JSON.stringify({ description: "x" }))).toBeNull();
  });

  it("decodes a well-formed manifest", () => {
    const m = parseClientManifest(greetManifestInfoJson);
    expect(m).not.toBeNull();
    expect(m?.slash_commands?.[0].name).toBe("greet");
    expect(m?.capabilities).toContain("slash-commands");
  });

  it("rejects manifests declaring a future schema version", () => {
    const future = JSON.stringify({
      client_manifest: { schema_version: 9999, slash_commands: [] },
    });
    expect(parseClientManifest(future)).toBeNull();
  });
});

describe("manifestsFromRegistry + collect/filter", () => {
  const registry = [
    { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    { pluginName: "no-manifest", infoJson: null },
  ];

  it("only keeps plugins with a valid manifest", () => {
    const map = manifestsFromRegistry(registry);
    expect(map.size).toBe(1);
    expect(map.has("fancy-greeter")).toBe(true);
  });

  it("collects and filters slash commands", () => {
    const map = manifestsFromRegistry(registry);
    const all = collectSlashCommands(map);
    expect(all).toHaveLength(1);
    expect(all[0].pluginName).toBe("fancy-greeter");
    expect(filterSlashCommands(all, "gr")).toHaveLength(1);
    expect(filterSlashCommands(all, "xyz")).toHaveLength(0);
  });
});

describe("slash line parser", () => {
  it("tokenises plain words", () => {
    expect(tokenise("/greet Alice")).toEqual(["greet", "Alice"]);
    expect(tokenise("not a slash")).toBeNull();
  });

  it("handles quoted strings", () => {
    expect(tokenise('/greet "Alice Cooper" true')).toEqual([
      "greet",
      "Alice Cooper",
      "true",
    ]);
  });

  it("extractSlashQuery only fires while typing the command name", () => {
    expect(extractSlashQuery("/gre")).toBe("gre");
    expect(extractSlashQuery("/greet Alice")).toBeNull();
    expect(extractSlashQuery("hello")).toBeNull();
  });

  it("parseSlashLine coerces option types", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine("/greet Alice true", entries);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind.options).toMatchObject({ name: "Alice", loud: true });
    expect(parsed?.errors).toHaveLength(0);
  });

  it("parseSlashLine reports missing required options", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine("/greet", entries);
    expect(parsed?.errors).toContain("missing required option <name>");
  });

  it("parseSlashLine accepts name=value named args", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine("/greet name=Alice loud=true", entries);
    expect(parsed?.errors).toHaveLength(0);
    expect(parsed?.kind.options).toMatchObject({ name: "Alice", loud: true });
  });

  it("parseSlashLine mixes named + positional in any order", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine("/greet loud=true Alice", entries);
    expect(parsed?.errors).toHaveLength(0);
    expect(parsed?.kind.options).toMatchObject({ name: "Alice", loud: true });
  });

  it("parseSlashLine rejects unknown named option", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine("/greet name=Alice nonsense=42", entries);
    expect(parsed?.errors).toContain('unknown option "nonsense"');
  });

  it("parseSlashLine quoted value with named key", () => {
    const map = manifestsFromRegistry([
      { pluginName: "fancy-greeter", infoJson: greetManifestInfoJson },
    ]);
    const entries = collectSlashCommands(map);
    const parsed = parseSlashLine('/greet name="Alice Cooper"', entries);
    expect(parsed?.errors).toHaveLength(0);
    expect(parsed?.kind.options).toMatchObject({ name: "Alice Cooper" });
  });
});

describe("decodeInteractionResponse + applyInteractionResponse", () => {
  function encode(obj: unknown): number[] {
    return Array.from(new TextEncoder().encode(JSON.stringify(obj)));
  }

  it("ignores non-tier1 payload types", () => {
    expect(decodeInteractionResponse("OtherType", encode({}))).toBeNull();
  });

  it("decodes a message response", () => {
    const r = decodeInteractionResponse(
      INTERACTION_RESPONSE_PAYLOAD_TYPE,
      encode({
        kind: "message",
        message_id: "m1",
        content: "Hello",
        components: [],
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("message");
  });

  it("applies a message response into the cards slice", () => {
    const r = decodeInteractionResponse(
      INTERACTION_RESPONSE_PAYLOAD_TYPE,
      encode({
        kind: "message",
        message_id: "m1",
        content: "Hi",
        components: [{ components: [{ type: "button", custom_id: "x", label: "X" }] }],
      }),
    );
    const next = applyInteractionResponse(
      emptyPluginTier1Slice,
      "fancy-greeter",
      r!,
      42,
    );
    expect(next.pluginCards).toHaveLength(1);
    expect(next.pluginCards[0].messageId).toBe("m1");
    expect(next.pluginCards[0].channelId).toBe(42);
  });

  it("show-modal replaces the active modal", () => {
    const next = applyInteractionResponse(
      emptyPluginTier1Slice,
      "fancy-greeter",
      {
        kind: "show-modal",
        custom_id: "greet:modal",
        title: "Greet",
        components: [],
      },
      null,
    );
    expect(next.pluginModal?.customId).toBe("greet:modal");
  });

  it("toast queues a notification with default level", () => {
    const next = applyInteractionResponse(
      emptyPluginTier1Slice,
      "fancy-greeter",
      { kind: "toast", message: "Sent" },
      null,
    );
    expect(next.pluginToasts).toHaveLength(1);
    expect(next.pluginToasts[0].level).toBe("info");
  });

  it("update-message patches an existing card", () => {
    const initial = applyInteractionResponse(
      emptyPluginTier1Slice,
      "fancy-greeter",
      { kind: "message", message_id: "m1", content: "Old" },
      null,
    );
    const next = applyInteractionResponse(initial, "fancy-greeter", {
      kind: "update-message",
      message_id: "m1",
      content: "New",
    }, null);
    expect(next.pluginCards[0].content).toBe("New");
  });
});

describe("trust gate", () => {
  const manifest = parseClientManifest(greetManifestInfoJson)!;

  it("evaluateTrust returns no-prompt when manifest declares no capabilities", () => {
    const bare = parseClientManifest(
      JSON.stringify({ client_manifest: { schema_version: 1 } }),
    )!;
    expect(evaluateTrust(bare, null, "0.1.0").kind).toBe("no-prompt");
  });

  it("evaluateTrust prompts when no prior record exists", () => {
    expect(evaluateTrust(manifest, null, "0.1.0").kind).toBe("needs-prompt");
  });

  it("evaluateTrust passes a matching prior record", () => {
    const record = recordFromDecision("allow", "0.1.0", manifest);
    const status = evaluateTrust(manifest, record, "0.1.0");
    expect(status.kind).toBe("decided");
  });

  it("evaluateTrust re-prompts on version change", () => {
    const record = recordFromDecision("allow", "0.1.0", manifest);
    expect(evaluateTrust(manifest, record, "0.2.0").kind).toBe("needs-prompt");
  });

  it("evaluateTrust re-prompts when capabilities expand", () => {
    const narrow = parseClientManifest(
      JSON.stringify({
        client_manifest: {
          schema_version: 1,
          slash_commands: [{ name: "x", description: "" }],
          capabilities: ["slash-commands"],
        },
      }),
    )!;
    const record = recordFromDecision("allow", "0.1.0", narrow);
    // Now the plugin declares more capabilities than before:
    expect(evaluateTrust(manifest, record, "0.1.0").kind).toBe("needs-prompt");
  });

  it("decodePluginInfo extracts author and homepage", () => {
    const info = decodePluginInfo(
      JSON.stringify({
        description: "demo",
        author: "Fancy Mumble",
        homepage: "https://example.invalid",
        capabilities: ["greeting"],
      }),
    );
    expect(info.author).toBe("Fancy Mumble");
    expect(info.homepage).toBe("https://example.invalid");
    expect(info.capabilityTags).toEqual(["greeting"]);
  });

  it("applyRegistryWithTrust filters denied plugins and queues new ones", () => {
    const trust = new Map();
    const { pluginManifests, pluginTrustQueue } = applyRegistryWithTrust(
      "server-a",
      [{ pluginName: "fancy-greeter", version: "0.1.0", infoJson: greetManifestInfoJson }],
      trust,
    );
    expect(pluginManifests.size).toBe(0);
    expect(pluginTrustQueue).toHaveLength(1);
    expect(pluginTrustQueue[0].pluginName).toBe("fancy-greeter");
  });

  it("applyRegistryWithTrust surfaces allowed plugins directly", () => {
    const trust = new Map([
      ["fancy-greeter", recordFromDecision("allow", "0.1.0", manifest)],
    ]);
    const { pluginManifests, pluginTrustQueue } = applyRegistryWithTrust(
      "server-a",
      [{ pluginName: "fancy-greeter", version: "0.1.0", infoJson: greetManifestInfoJson }],
      trust,
    );
    expect(pluginManifests.has("fancy-greeter")).toBe(true);
    expect(pluginTrustQueue).toHaveLength(0);
  });

  it("applyTrustDecision moves an allowed plugin into pluginManifests", () => {
    const { pluginTrustQueue } = applyRegistryWithTrust(
      "server-a",
      [{ pluginName: "fancy-greeter", version: "0.1.0", infoJson: greetManifestInfoJson }],
      new Map(),
    );
    const initial = { ...emptyPluginTier1Slice, pluginTrustQueue };
    const record = recordFromDecision("allow", "0.1.0", manifest);
    const next = applyTrustDecision(initial, "fancy-greeter", record, manifest);
    expect(next.pluginManifests.has("fancy-greeter")).toBe(true);
    expect(next.pluginTrustQueue).toHaveLength(0);
    expect(next.pluginTrust.get("fancy-greeter")?.decision).toBe("allow");
  });

  it("applyTrustRevocation drops manifest + panels", () => {
    const initial = applyTrustDecision(
      emptyPluginTier1Slice,
      "fancy-greeter",
      recordFromDecision("allow", "0.1.0", manifest),
      manifest,
    );
    const next = applyTrustRevocation(initial, "fancy-greeter");
    expect(next.pluginManifests.has("fancy-greeter")).toBe(false);
    expect(next.pluginTrust.has("fancy-greeter")).toBe(false);
  });
});

describe("settings panels", () => {
  const panelManifestInfoJson = JSON.stringify({
    client_manifest: {
      schema_version: 1,
      capabilities: ["settings-panel"],
      settings_panels: [
        {
          id: "status",
          title: "Status",
          rows: [{ label: "Port", value: "64741" }],
        },
      ],
    },
  });

  it("applyRegistryWithTrust seeds panels for trusted plugins", () => {
    const manifest = parseClientManifest(panelManifestInfoJson)!;
    const trust = new Map([
      ["fancy-greeter", recordFromDecision("allow", "0.1.0", manifest)],
    ]);
    const { pluginPanels } = applyRegistryWithTrust(
      "server-a",
      [{ pluginName: "fancy-greeter", version: "0.1.0", infoJson: panelManifestInfoJson }],
      trust,
    );
    const key = panelKey("fancy-greeter", "status");
    expect(pluginPanels.get(key)?.title).toBe("Status");
    expect(pluginPanels.get(key)?.rows[0]).toMatchObject({ label: "Port" });
  });

  it("update-panel response mutates panel rows", () => {
    const manifest = parseClientManifest(panelManifestInfoJson)!;
    const trust = new Map([
      ["fancy-greeter", recordFromDecision("allow", "0.1.0", manifest)],
    ]);
    const { pluginPanels } = applyRegistryWithTrust(
      "server-a",
      [{ pluginName: "fancy-greeter", version: "0.1.0", infoJson: panelManifestInfoJson }],
      trust,
    );
    const initial = { ...emptyPluginTier1Slice, pluginPanels };
    const next = applyInteractionResponse(initial, "fancy-greeter", {
      kind: "update-panel",
      panel_id: "status",
      rows: [{ label: "Active sessions", value: "3" }],
    }, null);
    const key = panelKey("fancy-greeter", "status");
    expect(next.pluginPanels.get(key)?.rows[0].value).toBe("3");
  });

  it("update-panel for unknown panel id is a no-op", () => {
    const next = applyInteractionResponse(emptyPluginTier1Slice, "fancy-greeter", {
      kind: "update-panel",
      panel_id: "nope",
      rows: [],
    }, null);
    expect(next.pluginPanels.size).toBe(0);
  });
});
