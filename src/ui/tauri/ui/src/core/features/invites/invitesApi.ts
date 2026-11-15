/**
 * Talking to the server's invites service.
 *
 * Every request carries a fresh id and resolves with the `invites` event that
 * echoes it. A server without invites never answers, so every request has a
 * deadline, and running out of it reads as "not supported" rather than as an
 * error to show.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface InviteSupport {
  available: boolean;
  mayCreate: boolean;
  mayManage: boolean;
  /** The longest an invite may live, in seconds; 0 for no ceiling. */
  maxAgeS: number;
  /** The most people one may admit; 0 for no ceiling. */
  maxUses: number;
  /** The operator's `invite_address`, or empty to use the dialled one. */
  address: string;
  skipsPassword: boolean;
}

export interface Invite {
  code: string;
  /** 0: no particular channel. */
  channelId: number;
  createdMs: number;
  /** 0: never. */
  expiresMs: number;
  /** 0: unlimited. */
  maxUses: number;
  uses: number;
  creator: string;
  mine: boolean;
}

export type InviteRefusalReason = "unavailable" | "permission" | "invalid" | "notFound" | "limit" | "other";

type Answer =
  | ({ kind: "support"; requestId: string } & InviteSupport)
  | { kind: "created"; requestId: string; invite: Invite | null }
  | { kind: "list"; requestId: string; invites: Invite[] }
  | { kind: "revoked"; requestId: string; code: string }
  | { kind: "refused"; requestId: string; reason: InviteRefusalReason; detail: string };

/** The server said no, and why. `detail` is written for a person. */
export class InviteRefusedError extends Error {
  constructor(
    readonly reason: InviteRefusalReason,
    detail: string,
  ) {
    super(detail || reason);
    this.name = "InviteRefusedError";
  }
}

/** Nothing came back: the server does not do invites, or is not answering. */
export class InviteTimeoutError extends Error {
  constructor() {
    super("the server did not answer");
    this.name = "InviteTimeoutError";
  }
}

const DEADLINE_MS = 5000;

let counter = 0;
function nextRequestId(): string {
  counter += 1;
  return `inv-${Date.now().toString(36)}-${counter}`;
}

async function ask(command: string, args: Record<string, unknown>): Promise<Answer> {
  const requestId = nextRequestId();
  let settle: (answer: Answer) => void = () => undefined;
  const answered = new Promise<Answer>((resolve) => {
    settle = resolve;
  });
  // Listening before asking: an answer can only be missed if it arrives
  // before anybody is waiting for it.
  const off = await listen<Answer>("invites", (event) => {
    if (event.payload.requestId === requestId) settle(event.payload);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await invoke(command, { requestId, ...args });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new InviteTimeoutError()), DEADLINE_MS);
    });
    const answer = await Promise.race([answered, deadline]);
    if (answer.kind === "refused") throw new InviteRefusedError(answer.reason, answer.detail);
    return answer;
  } finally {
    if (timer) clearTimeout(timer);
    off();
  }
}

/** What this session may do with invites. `available: false` when the server has none. */
export async function fetchInviteSupport(): Promise<InviteSupport> {
  try {
    const answer = await ask("invite_support", {});
    if (answer.kind === "support") {
      const { kind: _kind, requestId: _id, ...support } = answer;
      return support;
    }
  } catch (reason) {
    if (!(reason instanceof InviteTimeoutError)) throw reason;
  }
  return NO_INVITES;
}

export const NO_INVITES: InviteSupport = {
  available: false,
  mayCreate: false,
  mayManage: false,
  maxAgeS: 0,
  maxUses: 0,
  address: "",
  skipsPassword: false,
};

/** Mint an invite. Zero asks for the most the server allows. */
export async function createInvite(options: {
  channelId: number;
  maxAgeS: number;
  maxUses: number;
}): Promise<Invite> {
  const answer = await ask("invite_create", options);
  if (answer.kind !== "created" || !answer.invite) throw new InviteRefusedError("other", "");
  return answer.invite;
}

/** The caller's own invites, or everybody's for an administrator. */
export async function listInvites(everyone: boolean): Promise<Invite[]> {
  const answer = await ask("invite_list", { everyone });
  if (answer.kind !== "list") throw new InviteRefusedError("other", "");
  return answer.invites;
}

export async function revokeInvite(code: string): Promise<void> {
  await ask("invite_revoke", { code });
}
