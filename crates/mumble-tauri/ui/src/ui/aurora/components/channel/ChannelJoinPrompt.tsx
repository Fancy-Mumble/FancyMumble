import { useState } from "react";
import type { ChannelEntry } from "@core/types";
import { useAppStore } from "@core/store";
import { Button, ModalSurface, TextField } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

export default function ChannelJoinPrompt({ channel, onClose }: { channel: ChannelEntry; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async () => {
    setBusy(true); setError(null);
    try { await useAppStore.getState().joinChannelWithPassword(channel.id, password); onClose(); }
    catch (reason) { setError(String(reason)); setBusy(false); }
  };
  return <ModalSurface title={`Join #${channel.name}`} eyebrow="RESTRICTED CHANNEL" onClose={onClose} className={styles.challengeSurface}><form className={styles.challengeForm} onSubmit={(event) => { event.preventDefault(); void join(); }}><p>This voice channel requires a password.</p><TextField label="Channel password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus error={error ?? undefined} /><footer><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={!password || busy}>{busy ? "Joining…" : "Join channel"}</Button></footer></form></ModalSurface>;
}
