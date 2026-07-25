import { useEffect, useState } from "react";
import type { ChannelEntry, PchatProtocol } from "@core/types";
import { useChannelDescription } from "@core/lazyBlobs";
import { useAppStore } from "@core/store";
import { ChannelAttribute, isStructuralChannel } from "@core/utils/channelAttributes";
import { TrashIcon } from "@ui/icons";
import { Button, ModalSurface, RichTextEditor, TextField } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

export interface ChannelEditorSurfaceProps {
  channel: ChannelEntry | null;
  parentId: number;
  /** Pre-set the structural toggle when creating (a "create category" entry
   *  point). Ignored when editing, where the channel's own flag wins. */
  initialStructural?: boolean;
  onClose: () => void;
}

export default function ChannelEditorSurface({
  channel,
  parentId,
  initialStructural = false,
  onClose,
}: ChannelEditorSurfaceProps) {
  const channels = useAppStore((state) => state.channels);
  const sourceDescription = useChannelDescription(channel?.id, channel?.description_size);
  const [name, setName] = useState(channel?.name ?? "");
  const [description, setDescription] = useState("");
  const [position, setPosition] = useState(channel?.position ?? 0);
  const [selectedParentId, setSelectedParentId] = useState(channel?.parent_id ?? parentId);
  const [maxUsers, setMaxUsers] = useState(channel?.max_users ?? 0);
  const [temporary, setTemporary] = useState(channel?.temporary ?? false);
  const [hidden, setHidden] = useState(channel?.hidden ?? false);
  const [structural, setStructural] = useState(channel ? isStructuralChannel(channel) : initialStructural);
  const [password, setPassword] = useState("");
  const [pchatProtocol, setPchatProtocol] = useState<PchatProtocol>(channel?.pchat_protocol ?? "none");
  const [history, setHistory] = useState(channel?.pchat_max_history ?? 0);
  const [retention, setRetention] = useState(channel?.pchat_retention_days ?? 0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = channel === null;

  useEffect(() => {
    if (sourceDescription != null) setDescription(sourceDescription);
  }, [sourceDescription]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const values = {
        description: description || undefined,
        position,
        temporary,
        maxUsers,
        password: password || undefined,
        hidden,
        pchatProtocol,
        pchatMaxHistory: history,
        pchatRetentionDays: retention,
      };
      // Only STRUCTURAL is asserted, so the mask names just that one: every
      // other attribute stays as the server computed it.
      const attributes = structural ? [ChannelAttribute.Structural] : [];
      if (creating)
        await useAppStore.getState().createChannel(parentId, name.trim(), { ...values, attributes });
      else
        await useAppStore
          .getState()
          .updateChannel(channel.id, {
            name: name.trim(),
            parentId: selectedParentId,
            ...values,
            attributes,
            attributeMask: [ChannelAttribute.Structural],
          });
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!channel || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useAppStore.getState().deleteChannel(channel.id);
      onClose();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  };

  return (
    <ModalSurface
      title={creating ? "Create channel" : `Edit #${channel.name}`}
      eyebrow="CHANNEL MANAGEMENT"
      onClose={onClose}
      className={styles.channelEditorSurface}
    >
      <form
        className={styles.channelEditor}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={styles.channelEditorGrid}>
          <TextField
            label="Channel name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
          <TextField
            label="Position"
            type="number"
            min={0}
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
          />
          <label className={styles.selectField}>
            Parent channel
            <select
              value={selectedParentId}
              onChange={(event) => setSelectedParentId(Number(event.target.value))}
            >
              {channels
                .filter((candidate) => candidate.id !== channel?.id && !candidate.detached)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id === 0 ? "Root" : candidate.name}
                  </option>
                ))}
            </select>
          </label>
          <TextField
            label="Maximum users"
            hint="0 means unlimited"
            type="number"
            min={0}
            value={maxUsers}
            onChange={(event) => setMaxUsers(Number(event.target.value))}
          />
          <TextField
            label="Password"
            hint={creating ? "Optional" : "Leave empty to keep unchanged"}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <RichTextEditor
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Describe what this channel is for"
          ariaLabel="Channel description"
        />
        <div className={styles.channelEditorGrid}>
          <label className={styles.selectField}>
            Message history
            <select
              value={pchatProtocol}
              onChange={(event) => setPchatProtocol(event.target.value as PchatProtocol)}
            >
              <option value="none">Disabled</option>
              <option value="fancy_v1_full_archive">Full archive</option>
              <option value="signal_v1">Encrypted Signal history</option>
            </select>
          </label>
          <TextField
            label="History limit"
            hint="0 means unlimited"
            type="number"
            min={0}
            disabled={pchatProtocol === "none"}
            value={history}
            onChange={(event) => setHistory(Number(event.target.value))}
          />
          <TextField
            label="Retention days"
            hint="0 means forever"
            type="number"
            min={0}
            disabled={pchatProtocol === "none"}
            value={retention}
            onChange={(event) => setRetention(Number(event.target.value))}
          />
        </div>
        <div className={styles.channelChecks}>
          <label>
            <input
              type="checkbox"
              checked={temporary}
              onChange={(event) => setTemporary(event.target.checked)}
            />
            Temporary channel
          </label>
          <label>
            <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
            Hidden channel
          </label>
          <label>
            <input
              type="checkbox"
              checked={structural}
              onChange={(event) => setStructural(event.target.checked)}
            />
            Structural only
            <small>A heading for the channels beneath it. Cannot be joined and holds no users.</small>
          </label>
        </div>
        {error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}
        <footer className={styles.channelEditorActions}>
          {!creating &&
            channel.id !== 0 &&
            (confirmDelete ? (
              <>
                <span>Delete this channel permanently?</span>
                <Button variant="danger" onClick={() => void remove()} disabled={busy}>
                  Confirm delete
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>Keep channel</Button>
              </>
            ) : (
              <Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => setConfirmDelete(true)}>
                Delete channel
              </Button>
            ))}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : creating ? "Create channel" : "Save changes"}
          </Button>
        </footer>
      </form>
    </ModalSurface>
  );
}
