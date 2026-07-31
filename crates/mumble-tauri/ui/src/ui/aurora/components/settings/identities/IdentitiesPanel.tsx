import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { deleteProfileData } from "@core/features/settings/profileData";
import { useAppStore } from "@core/store";
import { Button, TextField } from "../../primitives";
import IdentityRow from "./IdentityRow";
import { useIdentities } from "./useIdentities";
import styles from "./Identities.module.css";

const IDENTITY_FILTER = [{ name: "Fancy Mumble Identity", extensions: ["fmid"] }];

export interface IdentitiesPanelProps {
  /** Jumps to the profile section after choosing which identity to edit. */
  onEditProfile: (label: string) => void;
}

/**
 * The client certificates that identify you to servers.
 *
 * One identity per persona: servers recognise a registered user by certificate,
 * so keeping separate ones is how you stay unlinked across communities.
 */
export default function IdentitiesPanel({ onEditProfile }: IdentitiesPanelProps) {
  const { labels, error, setError, refresh } = useIdentities();
  const connectedCertLabel = useAppStore((state) => state.connectedCertLabel);
  const [newLabel, setNewLabel] = useState("");

  const run = (work: Promise<unknown>, after?: () => void) => {
    setError(null);
    void work
      .then(() => {
        after?.();
        refresh();
      })
      .catch((reason) => setError(String(reason)));
  };

  const create = () => {
    const label = newLabel.trim();
    if (!label) return;
    run(invoke("generate_certificate", { label }), () => setNewLabel(""));
  };

  const remove = (label: string) =>
    run(invoke("delete_certificate", { label }).then(() => deleteProfileData(label)));

  const exportIdentity = (label: string) => {
    setError(null);
    void save({ defaultPath: `${label}.fmid`, filters: IDENTITY_FILTER })
      .then((destPath) => (destPath ? invoke("export_certificate", { label, destPath }) : undefined))
      .catch((reason) => setError(String(reason)));
  };

  const importIdentity = () => {
    setError(null);
    void open({ multiple: false, filters: IDENTITY_FILTER })
      .then((selected) => (selected ? invoke("import_certificate", { srcPath: selected }) : undefined))
      .then(refresh)
      .catch((reason) => setError(String(reason)));
  };

  return (
    <>
      <p className={styles.intro}>
        Servers recognise you by your certificate, not your name. Keep a separate identity per community to
        stay unlinked between them, and export one to carry it to another device.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      {labels.length === 0 ? (
        <p className={styles.empty}>No identities yet. Create one below.</p>
      ) : (
        labels.map((label) => (
          <IdentityRow
            key={label}
            label={label}
            connected={label === connectedCertLabel}
            onExport={exportIdentity}
            onDelete={remove}
            onEditProfile={onEditProfile}
          />
        ))
      )}

      <div className={styles.createRow}>
        <TextField
          label="New identity"
          value={newLabel}
          placeholder="e.g. Gaming, Work"
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
          }}
        />
        <Button variant="primary" onClick={create} disabled={!newLabel.trim()}>
          Create
        </Button>
      </div>

      <div className={styles.footer}>
        <Button onClick={importIdentity}>Import from file…</Button>
      </div>
    </>
  );
}
