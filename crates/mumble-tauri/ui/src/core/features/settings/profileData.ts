import { load } from "../../utils/store";
import type { FancyProfile } from "../../types";

export interface ProfileData {
  profile: FancyProfile;
  bio: string;
  avatarDataUrl: string | null;
}

const PROFILE_STORE = "profile.json";
const MIGRATION_KEY = "_migrated_per_identity";

const PROFILE_DEFAULTS: ProfileData = {
  profile: {},
  bio: "",
  avatarDataUrl: null,
};

function profileKey(identityLabel: string | null | undefined): string {
  return identityLabel ? `profile:${identityLabel}` : "data";
}

function serverProfileKey(identityLabel: string | null | undefined, serverId: string): string {
  return `${profileKey(identityLabel)}:server:${serverId}`;
}

export async function loadProfileData(identityLabel?: string | null): Promise<ProfileData> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  const key = profileKey(identityLabel);
  const data = await store.get<ProfileData>(key);
  return data ? { ...PROFILE_DEFAULTS, ...data } : { ...PROFILE_DEFAULTS };
}

export async function saveProfileData(data: ProfileData, identityLabel?: string | null): Promise<void> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  await store.set(profileKey(identityLabel), data);
}

export async function loadServerProfileData(
  serverId: string,
  identityLabel?: string | null,
): Promise<{ data: ProfileData; isOverride: boolean }> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  const override = await store.get<ProfileData>(serverProfileKey(identityLabel, serverId));
  if (override) return { data: { ...PROFILE_DEFAULTS, ...override }, isOverride: true };
  return { data: await loadProfileData(identityLabel), isOverride: false };
}

export async function saveServerProfileData(
  serverId: string,
  data: ProfileData,
  identityLabel?: string | null,
): Promise<void> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  await store.set(serverProfileKey(identityLabel, serverId), data);
}

export async function deleteServerProfileData(
  serverId: string,
  identityLabel?: string | null,
): Promise<void> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  await store.delete(serverProfileKey(identityLabel, serverId));
}

export async function deleteProfileData(identityLabel: string): Promise<void> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  await store.delete(profileKey(identityLabel));
}

export async function migrateProfilesToIdentities(identities: string[]): Promise<void> {
  const store = await load(PROFILE_STORE, { autoSave: true, defaults: {} });
  const migrated = await store.get<boolean>(MIGRATION_KEY);
  if (migrated) return;

  const globalData = await store.get<ProfileData>("data");
  if (globalData) {
    for (const label of identities) {
      const existing = await store.get<ProfileData>(profileKey(label));
      if (!existing) {
        await store.set(profileKey(label), globalData);
      }
    }
  }
  await store.set(MIGRATION_KEY, true);
}

// The cosmetic catalogues live in the shared profile-card package, which the
// channel viewer also paints from. Re-exported here so existing importers -
// and the Standard settings editor - keep one import path.
export { AVATAR_BORDERS, DECORATIONS, EFFECTS, FONTS, NAMEPLATES } from "@shared/profilecard/catalog";
