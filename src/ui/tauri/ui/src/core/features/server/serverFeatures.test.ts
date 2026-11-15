import { describe, expect, it } from "vitest";
import { fancyVersionEncode } from "../../utils/version";
import {
  describeServerFeatures,
  FANCY_PROTOCOL_EPOCH,
  type ServerFacts,
  type ServerFeatureId,
} from "./serverFeatures";

/** A plain Mumble server: no Fancy anything, nothing else answered. */
const PLAIN: ServerFacts = {
  fancyVersion: null,
  fancyProtocol: null,
  sfuAvailable: false,
  allowHtml: false,
  fileService: null,
  fileServerPlugin: null,
  customEmotes: null,
  liveDocVersion: null,
  calendarVersion: null,
  persistentChannels: 0,
  hostAbiVersion: null,
};

function feature(facts: Partial<ServerFacts>, id: ServerFeatureId) {
  const found = describeServerFeatures({ ...PLAIN, ...facts }).find((f) => f.id === id);
  if (!found) throw new Error(`no such feature: ${id}`);
  return found;
}

describe("describeServerFeatures", () => {
  it("answers no to everything on a plain Mumble server", () => {
    for (const f of describeServerFeatures(PLAIN)) {
      expect([f.id, f.support]).toEqual([f.id, "no"]);
    }
  });

  it("reads a Fancy server's version, and Starling's epoch", () => {
    expect(feature({ fancyVersion: fancyVersionEncode(0, 4, 2) }, "fancyExtensions")).toEqual({
      id: "fancyExtensions",
      support: "yes",
      evidence: { kind: "text", text: "v0.4.2" },
    });
    // Starling announces the epoch and deliberately no version at all; a panel
    // that only read the version called it "not a Fancy server".
    expect(feature({ fancyProtocol: FANCY_PROTOCOL_EPOCH }, "fancyExtensions")).toEqual({
      id: "fancyExtensions",
      support: "yes",
      evidence: { kind: "text", text: "epoch 1" },
    });
  });

  it("calls a share without a relay limited, not working", () => {
    const version = fancyVersionEncode(0, 4, 2);
    expect(feature({ fancyVersion: version, sfuAvailable: true }, "screenShare").support).toBe("yes");
    expect(feature({ fancyVersion: version }, "screenShare")).toEqual({
      id: "screenShare",
      support: "partial",
      evidence: { kind: "phrase", phrase: "noRelay" },
    });
    // Too old to carry one at all, relay or no relay.
    const old = fancyVersionEncode(0, 2, 11);
    expect(feature({ fancyVersion: old, sfuAvailable: true }, "screenShare").support).toBe("no");
  });

  it("names whichever file service answered", () => {
    expect(
      feature(
        { fileService: "plugin", fileServerPlugin: { name: "fancy-file-server", version: "0.4.2" } },
        "fileSharing",
      ).evidence,
    ).toEqual({ kind: "text", text: "fancy-file-server v0.4.2" });
    expect(feature({ fileService: "canon" }, "fileSharing")).toEqual({
      id: "fileSharing",
      support: "yes",
      evidence: { kind: "phrase", phrase: "canonService" },
    });
  });

  it("keeps unanswered apart from unsupported", () => {
    // No file server is a settled no; one that has not answered
    // `GET /capabilities` yet - which the canon service never does - is not.
    expect(feature({}, "customEmotes").support).toBe("no");
    expect(feature({ fileService: "canon" }, "customEmotes").support).toBe("unknown");
    expect(feature({ fileService: "plugin", customEmotes: false }, "customEmotes").support).toBe("no");
    expect(feature({ fileService: "plugin", customEmotes: true }, "customEmotes").support).toBe("yes");
  });

  it("counts the channels that persist, and admits when none do", () => {
    const fancy = { fancyProtocol: FANCY_PROTOCOL_EPOCH };
    expect(feature({ ...fancy, persistentChannels: 3 }, "persistentChat")).toEqual({
      id: "persistentChat",
      support: "yes",
      evidence: { kind: "channels", count: 3 },
    });
    // Persistence is announced per channel, so a Fancy server where none is on
    // cannot be told apart from one that could not do it.
    expect(feature(fancy, "persistentChat").support).toBe("unknown");
    expect(feature({ persistentChannels: 3 }, "persistentChat").support).toBe("no");
  });

  it("gates the admin surfaces on the versions that introduced them", () => {
    expect(feature({ fancyVersion: fancyVersionEncode(0, 3, 9) }, "pluginAdmin").support).toBe("no");
    expect(feature({ fancyVersion: fancyVersionEncode(0, 4, 0) }, "pluginAdmin").support).toBe("yes");
    expect(feature({ fancyVersion: fancyVersionEncode(0, 4, 1) }, "auditLog").support).toBe("no");
    expect(feature({ fancyVersion: fancyVersionEncode(0, 4, 2) }, "auditLog").support).toBe("yes");
    // Starling has audit at the epoch, and none of the version-gated rest.
    expect(feature({ fancyProtocol: FANCY_PROTOCOL_EPOCH }, "auditLog").support).toBe("yes");
    expect(feature({ fancyProtocol: FANCY_PROTOCOL_EPOCH }, "pluginAdmin").support).toBe("no");
  });

  it("shows the plugin host's ABI when one has been reported", () => {
    expect(feature({ hostAbiVersion: 3 }, "pluginAdmin").evidence).toEqual({ kind: "text", text: "ABI 3" });
  });

  it("lists every feature exactly once", () => {
    const ids = describeServerFeatures(PLAIN).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
