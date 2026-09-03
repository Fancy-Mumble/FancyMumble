/**
 * What the connected server can actually do.
 *
 * The client already knows most of this, but only ever one answer at a time and
 * only where a button decides whether to draw itself: a version gate in the
 * chat header, a plugin registry in the info panel, an SFU flag read inside the
 * screen-share hook. Nothing ever states the whole set, which is what somebody
 * looking at an unfamiliar server actually wants to know.
 *
 * So the gates live here once - the admin packs re-export these rather than
 * keeping their own copies - and `describeServerFeatures` reads them all into
 * one list. It is pure and takes plain facts; the store selection and the
 * wording are `@shared/serverinfo/features`'s job.
 */

import { fancyVersionDecode, fancyVersionEncode } from "../../utils/version";
import { isOnboardingSupported } from "../onboarding/onboardingStore";
import { isAccountSettingsSupported } from "../settings/accountStore";

/** Minimum server version for the plugin admin API (0.4.0). */
export const PLUGIN_ADMIN_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 0);

/** Minimum server version for the audit-log protocol (0.4.2). */
export const AUDIT_LOG_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 2);

/** Minimum server version that carries a screen share (0.2.12). */
export const SCREEN_SHARE_MIN_FANCY_VERSION = fancyVersionEncode(0, 2, 12);

/** The wire epoch on which every Fancy service has its own outer type. */
export const FANCY_PROTOCOL_EPOCH = 1;

export function isPluginAdminSupported(version: number | null | undefined): boolean {
  return version != null && version >= PLUGIN_ADMIN_MIN_FANCY_VERSION;
}

/**
 * Whether the connected server can answer an audit query.
 *
 * Two ways to be sure, because there are two kinds of server that can. An
 * epoch-0 server (the C++ fork) answers if its *product* version is new enough.
 * An epoch-1 server (Starling) announces the epoch and deliberately no version
 * at all - announcing one would invite clients to send epoch-0 natives it
 * cannot route - so speaking the epoch is itself the capability statement.
 *
 * Gating on the version alone hid the page from Starling for ever, and would
 * have gone on hiding it: no version is announced, and none ever will be.
 */
export function isAuditLogSupported(
  version: number | null | undefined,
  fancyProtocol?: number | null,
): boolean {
  if (fancyProtocol === FANCY_PROTOCOL_EPOCH) return true;
  return version != null && version >= AUDIT_LOG_MIN_FANCY_VERSION;
}

/** Whether this server is new enough to relay a screen share at all. */
export function isScreenShareSupported(version: number | null | undefined): boolean {
  return version != null && version >= SCREEN_SHARE_MIN_FANCY_VERSION;
}

/** The features the panel lists, in the order it lists them. */
export type ServerFeatureId =
  | "fancyExtensions"
  | "screenShare"
  | "fileSharing"
  | "customEmotes"
  | "liveDocs"
  | "calendar"
  | "persistentChat"
  | "htmlMessages"
  | "onboarding"
  | "accountSettings"
  | "pluginAdmin"
  | "auditLog";

/**
 * How sure the client is that a feature is there.
 *
 * `unknown` is a separate answer from `no` on purpose: a capability nothing has
 * asked about yet and one the server does not have look identical in a boolean,
 * and reporting the first as the second is how a panel like this starts lying.
 */
export type FeatureSupport = "yes" | "partial" | "no" | "unknown";

/** A phrase the panel supplies from the `server` catalogue. */
export type FeaturePhrase = "canonService" | "noRelay" | "noChannelEnabled" | "awaitingAnswer";

/** What the answer was read from, shown beside it. */
export type FeatureEvidence =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "phrase"; readonly phrase: FeaturePhrase }
  | { readonly kind: "channels"; readonly count: number };

export interface ServerFeature {
  readonly id: ServerFeatureId;
  readonly support: FeatureSupport;
  readonly evidence: FeatureEvidence | null;
}

/** Everything `describeServerFeatures` reads, gathered from the store. */
export interface ServerFacts {
  /** v2-encoded Fancy version, null on a server that announces none. */
  readonly fancyVersion: number | null;
  /** Which Fancy wire numbering the server speaks; null/0 = epoch 0. */
  readonly fancyProtocol: number | null;
  readonly sfuAvailable: boolean;
  readonly allowHtml: boolean;
  /** Which kind of file service answered, or null when neither did. */
  readonly fileService: "plugin" | "canon" | null;
  readonly fileServerPlugin: { readonly name: string; readonly version: string } | null;
  /** `null` until the file server has answered `GET /capabilities`. */
  readonly customEmotes: boolean | null;
  /** Version of the live-doc plugin, or null when it is not loaded. */
  readonly liveDocVersion: string | null;
  /** Version of the calendar plugin, or null when it is not loaded. */
  readonly calendarVersion: string | null;
  /** How many channels announced a persistence protocol. */
  readonly persistentChannels: number;
  /** Plugin ABI the server's host was built against, null until an admin
   *  plugin list arrives. */
  readonly hostAbiVersion: number | null;
}

function text(value: string): FeatureEvidence {
  return { kind: "text", text: value };
}

function phrase(value: FeaturePhrase): FeatureEvidence {
  return { kind: "phrase", phrase: value };
}

/** A plain yes/no with nothing more to say about it. */
function plain(id: ServerFeatureId, supported: boolean): ServerFeature {
  return { id, support: supported ? "yes" : "no", evidence: null };
}

function describeFancy(facts: ServerFacts): ServerFeature {
  if (facts.fancyVersion != null) {
    return {
      id: "fancyExtensions",
      support: "yes",
      evidence: text(`v${fancyVersionDecode(facts.fancyVersion)}`),
    };
  }
  if (facts.fancyProtocol === FANCY_PROTOCOL_EPOCH) {
    // Starling: the epoch is announced instead of a version, and saying so is
    // the difference between "not a Fancy server" and "a Fancy server that
    // numbers its wire differently".
    return {
      id: "fancyExtensions",
      support: "yes",
      evidence: text(`epoch ${facts.fancyProtocol}`),
    };
  }
  return { id: "fancyExtensions", support: "no", evidence: null };
}

/**
 * A share needs both a server new enough to carry one and a relay to carry it
 * through. Without the relay the client falls back to peer-to-peer, which
 * mostly does not survive contact with a NAT - hence `partial` rather than a
 * yes that would not hold up.
 */
function describeScreenShare(facts: ServerFacts): ServerFeature {
  if (!isScreenShareSupported(facts.fancyVersion)) {
    return { id: "screenShare", support: "no", evidence: null };
  }
  return facts.sfuAvailable
    ? { id: "screenShare", support: "yes", evidence: text("WebRTC SFU") }
    : { id: "screenShare", support: "partial", evidence: phrase("noRelay") };
}

function describeFileSharing(facts: ServerFacts): ServerFeature {
  if (facts.fileService === "canon") {
    return { id: "fileSharing", support: "yes", evidence: phrase("canonService") };
  }
  if (facts.fileService === "plugin") {
    const plugin = facts.fileServerPlugin;
    return {
      id: "fileSharing",
      support: "yes",
      evidence: plugin ? text(`${plugin.name} v${plugin.version}`) : null,
    };
  }
  return { id: "fileSharing", support: "no", evidence: null };
}

/**
 * Emotes are the file server's to serve, so no file server is a settled no.
 * With one, the answer is whatever `GET /capabilities` said - and the canon
 * service answers nothing at all, which is `unknown` and not a guess.
 */
function describeCustomEmotes(facts: ServerFacts): ServerFeature {
  if (facts.fileService === null) return plain("customEmotes", false);
  if (facts.customEmotes === null) {
    return { id: "customEmotes", support: "unknown", evidence: phrase("awaitingAnswer") };
  }
  return plain("customEmotes", facts.customEmotes);
}

/**
 * Persistence is announced per channel, never server-wide, so a Fancy server
 * where no channel enables it cannot be told apart from one that could not.
 */
function describePersistentChat(facts: ServerFacts, isFancy: boolean): ServerFeature {
  if (!isFancy) return plain("persistentChat", false);
  if (facts.persistentChannels > 0) {
    return {
      id: "persistentChat",
      support: "yes",
      evidence: { kind: "channels", count: facts.persistentChannels },
    };
  }
  return { id: "persistentChat", support: "unknown", evidence: phrase("noChannelEnabled") };
}

function describePluginAdmin(facts: ServerFacts): ServerFeature {
  return {
    id: "pluginAdmin",
    support: isPluginAdminSupported(facts.fancyVersion) ? "yes" : "no",
    evidence: facts.hostAbiVersion == null ? null : text(`ABI ${facts.hostAbiVersion}`),
  };
}

/** Every feature the panel lists, answered from what this connection knows. */
export function describeServerFeatures(facts: ServerFacts): readonly ServerFeature[] {
  const isFancy = facts.fancyVersion != null || facts.fancyProtocol === FANCY_PROTOCOL_EPOCH;
  return [
    describeFancy(facts),
    describeScreenShare(facts),
    describeFileSharing(facts),
    describeCustomEmotes(facts),
    {
      id: "liveDocs",
      support: facts.liveDocVersion == null ? "no" : "yes",
      evidence: facts.liveDocVersion == null ? null : text(`v${facts.liveDocVersion}`),
    },
    {
      id: "calendar",
      support: facts.calendarVersion == null ? "no" : "yes",
      evidence: facts.calendarVersion == null ? null : text(`v${facts.calendarVersion}`),
    },
    describePersistentChat(facts, isFancy),
    plain("htmlMessages", facts.allowHtml),
    plain("onboarding", isOnboardingSupported(facts.fancyVersion)),
    plain("accountSettings", isAccountSettingsSupported(facts.fancyVersion)),
    describePluginAdmin(facts),
    plain("auditLog", isAuditLogSupported(facts.fancyVersion, facts.fancyProtocol)),
  ];
}
