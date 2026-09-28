import { load } from "./utils/store";

const STORE_FILE = "user-relations.json";
const KEY = "relations";
export const USER_RELATIONS_CHANGED_EVENT = "user-relations-changed";

export interface UserRelation {
  blocked: boolean;
  ignored: boolean;
  note: string;
}

type RelationMap = Record<string, UserRelation>;
const emptyRelation = (): UserRelation => ({ blocked: false, ignored: false, note: "" });

async function store() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

export async function getUserRelations(): Promise<RelationMap> {
  return (await (await store()).get<RelationMap>(KEY)) ?? {};
}

export async function getUserRelation(identity: string): Promise<UserRelation> {
  return { ...emptyRelation(), ...(await getUserRelations())[identity] };
}

export async function updateUserRelation(
  identity: string,
  patch: Partial<UserRelation>,
): Promise<UserRelation> {
  const relationStore = await store();
  const relations = await getUserRelations();
  const next = { ...emptyRelation(), ...relations[identity], ...patch };
  if (!next.blocked && !next.ignored && !next.note.trim()) delete relations[identity];
  else relations[identity] = next;
  await relationStore.set(KEY, relations);
  await relationStore.save();
  globalThis.dispatchEvent(
    new CustomEvent(USER_RELATIONS_CHANGED_EVENT, { detail: { identity, relation: next } }),
  );
  return next;
}

export function userRelationIdentity(user: { hash?: string; name: string }): string {
  return user.hash ? `hash:${user.hash}` : `name:${user.name.toLocaleLowerCase()}`;
}
