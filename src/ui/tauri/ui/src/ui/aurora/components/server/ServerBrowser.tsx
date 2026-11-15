import extensionStyles from "../../AuroraClientExtensions.module.css";
import styles from "../../AuroraClientSurfaces.module.css";
import { Button, IconButton, ModalSurface, PublicServerDirectory, TextField } from "../../components";
import {
  addServer,
  getSavedServers,
  getServerPassword,
  removeServer,
  updateServer,
} from "@core/serverStorage";
import { useAppStore } from "@core/store";
import type { PublicServer, SavedServer } from "@core/types";
import { ServerIcon, StarIcon, TrashIcon } from "@ui/icons";
import { useEffect, useState } from "react";

export function ServerBrowser({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"saved" | "public">("saved");
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [editing, setEditing] = useState<SavedServer | null>(null);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(64738);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const reload = () =>
    void getSavedServers()
      .then(setServers)
      .catch(() => setServers([]));
  useEffect(reload, []);

  const clearForm = () => {
    setEditing(null);
    setLabel("");
    setHost("");
    setPort(64738);
  };
  const edit = (server: SavedServer) => {
    setEditing(server);
    setLabel(server.label);
    setHost(server.host);
    setPort(server.port);
    setUsername(server.username);
  };
  const save = async () => {
    if (!host.trim() || !username.trim()) return;
    setBusy(true);
    try {
      const values = {
        label: label.trim() || host.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        cert_label: editing?.cert_label ?? null,
        favorite: editing?.favorite ?? false,
      };
      if (editing) await updateServer(editing.id, values);
      else await addServer(values);
      clearForm();
      reload();
    } finally {
      setBusy(false);
    }
  };
  const connectSaved = async (server: SavedServer) => {
    setBusy(true);
    try {
      await useAppStore
        .getState()
        .connect(
          server.host,
          server.port,
          server.username,
          server.cert_label,
          await getServerPassword(server.id),
        );
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const connectDirect = async () => {
    if (!host.trim() || !username.trim()) return;
    setBusy(true);
    try {
      await useAppStore.getState().connect(host.trim(), port, username.trim(), editing?.cert_label ?? null);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const connectPublic = async (server: PublicServer) => {
    setBusy(true);
    try {
      await useAppStore.getState().connect(server.ip, server.port, username.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const toggleFavorite = async (server: SavedServer) => {
    await updateServer(server.id, { favorite: !server.favorite });
    reload();
  };
  const displayedServers = servers
    .filter(
      (server) =>
        !query.trim() ||
        `${server.label} ${server.host} ${server.username}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort(
      (left, right) =>
        Number(!!right.favorite) - Number(!!left.favorite) || left.label.localeCompare(right.label),
    );

  return (
    <ModalSurface title="Servers" eyebrow="CONNECTION LIBRARY" onClose={onClose}>
      <div className={extensionStyles.serverTabs}>
        <Button variant={view === "saved" ? "secondary" : "bare"} onClick={() => setView("saved")}>
          Saved & direct
        </Button>
        <Button variant={view === "public" ? "secondary" : "bare"} onClick={() => setView("public")}>
          Public directory
        </Button>
      </div>
      {view === "public" ? (
        <PublicServerDirectory
          disabled={busy}
          username={username}
          onUsernameChange={setUsername}
          onConnect={connectPublic}
        />
      ) : (
        <div className={styles.split}>
          <div className={styles.serverList}>
            <TextField
              className={extensionStyles.serverListSearch}
              label="Search saved servers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, address, or identity"
            />
            {servers.length === 0 && (
              <div className={styles.blank}>
                <ServerIcon />
                <strong>No saved servers</strong>
                <span>Add your first connection on the right.</span>
              </div>
            )}
            {displayedServers.map((server) => (
              <article
                key={server.id}
                className={`${editing?.id === server.id ? styles.selectedCard : styles.card} ${extensionStyles.serverCard}`}
              >
                <span className={styles.cardIcon}>
                  <ServerIcon />
                </span>
                <div>
                  <strong>{server.label}</strong>
                  <small>
                    {server.host}:{server.port} · {server.username}
                  </small>
                </div>
                <IconButton
                  icon={<StarIcon fill={server.favorite ? "currentColor" : "none"} />}
                  label={server.favorite ? "Remove favorite" : "Add favorite"}
                  onClick={() => void toggleFavorite(server)}
                />
                <Button variant="bare" onClick={() => edit(server)}>
                  Edit
                </Button>
                <Button
                  variant="bare"
                  className={styles.primarySmall}
                  disabled={busy}
                  onClick={() => void connectSaved(server)}
                >
                  Connect
                </Button>
              </article>
            ))}
          </div>
          <div className={`${styles.editorPane} ${extensionStyles.stickyConnectionPane}`}>
            <small>{editing ? "EDIT CONNECTION" : "NEW CONNECTION"}</small>
            <h3>{editing ? editing.label : "Connect to a server"}</h3>
            <TextField
              label="Name"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="My community"
            />
            <TextField
              label="Address"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="voice.example.com"
            />
            <div className={styles.twoCols}>
              <TextField
                label="Port"
                type="number"
                value={port}
                min={1}
                max={65535}
                onChange={(event) => setPort(Number(event.target.value))}
              />
              <TextField
                label="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className={extensionStyles.connectionActions}>
              <Button
                onClick={() => void connectDirect()}
                disabled={busy || !host.trim() || !username.trim()}
              >
                Connect once
              </Button>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={busy || !host.trim() || !username.trim()}
              >
                {editing ? "Save changes" : "Save server"}
              </Button>
            </div>
            {editing && (
              <>
                <Button onClick={clearForm}>Cancel editing</Button>
                <Button
                  variant="danger"
                  leadingIcon={<TrashIcon />}
                  onClick={() =>
                    void removeServer(editing.id).then(() => {
                      clearForm();
                      reload();
                    })
                  }
                >
                  Remove server
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </ModalSurface>
  );
}
