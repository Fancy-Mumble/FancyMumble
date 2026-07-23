import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@core/store";
import { dataUrlToBytes, serializeProfile } from "@core/profileFormat";
import { AVATAR_BORDERS, DECORATIONS, EFFECTS, NAMEPLATES, deleteProfileData, deleteServerProfileData, loadProfileData, loadServerProfileData, saveProfileData, saveServerProfileData, type ProfileData } from "@core/features/settings/profileData";
import { Button, RichTextEditor, TextField } from "../primitives";
import styles from "./ProfileIdentitySettings.module.css";

function readImage(file: File | undefined): Promise<string | null> {
  if (!file) return Promise.resolve(null);
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("Choose an image file."));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}

function ImagePicker({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={styles.imagePicker}><span>{value ? <img src={value} alt="" /> : label.slice(0, 1)}</span><div><strong>{label}</strong><small>PNG, JPEG, WebP, GIF, or AVIF</small></div><input ref={input} hidden type="file" accept="image/*" onChange={(event) => { void readImage(event.target.files?.[0]).then(onChange); event.target.value = ""; }} /><Button onClick={() => input.current?.click()}>Choose</Button>{value && <Button variant="bare" onClick={() => onChange(null)}>Remove</Button>}</div>;
}

const emptyData: ProfileData = { profile: {}, bio: "", avatarDataUrl: null };

export default function ProfileIdentitySettings() {
  const connectedIdentity = useAppStore((state) => state.connectedCertLabel);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const activeServerLabel = useAppStore((state) => state.sessions.find((session) => session.id === state.activeServerId)?.label);
  const [identities, setIdentities] = useState<string[]>([]);
  const [identity, setIdentity] = useState<string | null>(connectedIdentity);
  const [data, setData] = useState<ProfileData>(emptyData);
  const [newIdentity, setNewIdentity] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [deleteIdentity, setDeleteIdentity] = useState<string | null>(null);
  const [serverOverride, setServerOverride] = useState(false);
  const refresh = async () => { const labels = await invoke<string[]>("list_certificates"); setIdentities(labels); setIdentity((current) => current && labels.includes(current) ? current : connectedIdentity && labels.includes(connectedIdentity) ? connectedIdentity : labels[0] ?? null); };
  useEffect(() => { void refresh().catch((reason) => setStatus(String(reason))); }, []);
  useEffect(() => {
    const request = activeServerId ? loadServerProfileData(activeServerId, identity) : loadProfileData(identity).then((data) => ({ data, isOverride: false }));
    void request.then((result) => { setData(result.data); setServerOverride(result.isOverride); }).catch(() => { setData(emptyData); setServerOverride(false); });
  }, [activeServerId, identity]);
  const patchProfile = (change: Partial<ProfileData["profile"]>) => setData((current) => ({ ...current, profile: { ...current.profile, ...change } }));
  const persist = async () => {
    setBusy(true); setStatus(null);
    try {
      if (serverOverride && activeServerId) await saveServerProfileData(activeServerId, data, identity);
      else await saveProfileData(data, identity);
      if (identity === connectedIdentity || (!identity && !connectedIdentity)) {
        await invoke("set_user_comment", { comment: serializeProfile(data.profile, data.bio) });
        if (data.avatarDataUrl) await invoke("set_user_texture", { texture: dataUrlToBytes(data.avatarDataUrl) });
      }
      setStatus(serverOverride ? `Profile override saved for ${activeServerLabel ?? "this server"}.` : identity === connectedIdentity ? "Profile saved and applied to this server." : "Profile saved for this identity.");
    } catch (reason) { setStatus(`Could not save: ${String(reason)}`); }
    finally { setBusy(false); }
  };
  const create = async () => { const label = newIdentity.trim(); if (!label) return; setBusy(true); try { await invoke("generate_certificate", { label }); setNewIdentity(""); await refresh(); setIdentity(label); } catch (reason) { setStatus(String(reason)); } finally { setBusy(false); } };
  const importIdentity = async () => { const source = await open({ multiple: false, filters: [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }] }); if (!source) return; await invoke("import_certificate", { srcPath: source }); await refresh(); };
  const exportIdentity = async (label: string) => { const destination = await save({ defaultPath: `${label}.fmid`, filters: [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }] }); if (destination) await invoke("export_certificate", { label, destPath: destination }); };
  const removeIdentity = async (label: string) => { await invoke("delete_certificate", { label }); await deleteProfileData(label); setDeleteIdentity(null); await refresh(); };
  const profile = data.profile;
  return <div className={styles.layout}>
    <section className={styles.editor}>
      <div className={styles.identityBar}><label>Profile identity<select value={identity ?? ""} onChange={(event) => setIdentity(event.target.value || null)}><option value="">Default profile</option>{identities.map((label) => <option key={label}>{label}</option>)}</select></label>{identity === connectedIdentity && <b>Connected</b>}</div>
      {activeServerId && <label className={styles.colors}><input type="checkbox" checked={serverOverride} onChange={(event) => { const enabled = event.target.checked; setServerOverride(enabled); if (!enabled) void deleteServerProfileData(activeServerId, identity).then(() => loadProfileData(identity)).then(setData); }} />Use a separate profile on {activeServerLabel ?? "this server"}</label>}
      <ImagePicker label="Avatar" value={data.avatarDataUrl} onChange={(avatarDataUrl) => setData((current) => ({ ...current, avatarDataUrl }))} />
      <ImagePicker label="Banner" value={profile.banner?.image} onChange={(image) => patchProfile({ banner: { ...profile.banner, image: image ?? undefined } })} />
      <TextField label="Status" value={profile.status ?? ""} maxLength={120} onChange={(event) => patchProfile({ status: event.target.value || undefined })} />
      <RichTextEditor label="Biography" value={data.bio} onChange={(bio) => setData((current) => ({ ...current, bio }))} placeholder="Tell people a little about yourself" ariaLabel="Biography" />
      <div className={styles.optionGrid}><label>Decoration<select value={profile.decoration ?? "none"} onChange={(event) => patchProfile({ decoration: event.target.value })}>{DECORATIONS.map((item) => <option value={item.id} key={item.id}>{item.preview} {item.label}</option>)}</select></label><label>Nameplate<select value={profile.nameplate ?? "none"} onChange={(event) => patchProfile({ nameplate: event.target.value })}>{NAMEPLATES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label>Profile effect<select value={profile.effect ?? "none"} onChange={(event) => patchProfile({ effect: event.target.value })}>{EFFECTS.map((item) => <option value={item.id} key={item.id}>{item.preview} {item.label}</option>)}</select></label><label>Avatar border<select value={profile.avatarBorder ?? "default"} onChange={(event) => patchProfile({ avatarBorder: event.target.value })}>{AVATAR_BORDERS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div>
      <div className={styles.colors}><TextField label="Name color" type="color" value={profile.nameStyle?.color ?? "#dfe7ef"} onChange={(event) => patchProfile({ nameStyle: { ...profile.nameStyle, color: event.target.value } })} /><TextField label="Banner color" type="color" value={profile.banner?.color ?? "#273545"} onChange={(event) => patchProfile({ banner: { ...profile.banner, color: event.target.value } })} /><label><input type="checkbox" checked={profile.cardGlass ?? false} onChange={(event) => patchProfile({ cardGlass: event.target.checked })} />Glass profile card</label></div>
      {status && <p className={styles.status}>{status}</p>}<Button variant="primary" disabled={busy} onClick={() => void persist()}>{busy ? "Saving…" : "Save profile"}</Button>
    </section>
    <aside className={styles.side}><div className={styles.preview} style={{ background: profile.banner?.image ? `linear-gradient(rgba(10,13,18,.28),rgba(10,13,18,.8)),url(${profile.banner.image}) center/cover` : profile.banner?.color ?? "#273545" }}>{data.avatarDataUrl ? <img src={data.avatarDataUrl} alt="Profile preview" /> : <span>YOU</span>}<h3 style={{ color: profile.nameStyle?.color }}>{useAppStore.getState().users.find((user) => user.session === useAppStore.getState().ownSession)?.name ?? "Your profile"}</h3><strong>{profile.status || "Available"}</strong><p>{data.bio || "Your biography preview will appear here."}</p></div><div className={styles.identities}><h4>Certificate identities</h4>{identities.map((label) => <div key={label}><span><strong>{label}</strong><small>{label === connectedIdentity ? "Used by this connection" : "Available"}</small></span><Button variant="bare" onClick={() => void exportIdentity(label)}>Export</Button><Button variant="bare" onClick={() => setDeleteIdentity(label)}>Delete</Button></div>)}<TextField label="New identity" value={newIdentity} onChange={(event) => setNewIdentity(event.target.value)} placeholder="work-laptop" /><Button disabled={!newIdentity.trim() || busy} onClick={() => void create()}>Create identity</Button><Button onClick={() => void importIdentity()}>Import identity</Button></div>{deleteIdentity && <div className={styles.confirm}><p>Delete identity “{deleteIdentity}” and its local profile?</p><Button variant="danger" onClick={() => void removeIdentity(deleteIdentity)}>Delete permanently</Button><Button onClick={() => setDeleteIdentity(null)}>Cancel</Button></div>}</aside>
  </div>;
}
