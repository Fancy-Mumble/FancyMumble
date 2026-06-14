import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelEntry, PchatProtocol } from "../../../types";
import { useAppStore } from "../../../store";
import { Modal } from "../../elements/Modal";
import { useChannelDescription } from "../../../lazyBlobs";
const BioEditor = lazy(() => import("../../../pages/settings/BioEditor").then((m) => ({ default: m.BioEditor })));
import styles from "./ChannelEditorDialog.module.css";
import {
  PERM_WRITE,
  PERM_MAKE_CHANNEL,
  PERM_MAKE_TEMP_CHANNEL,
  PERM_DELETE_MESSAGE,
} from "../../../utils/permissions";

/** Check whether a channel's cached permissions include a specific bit.
 *  Returns `false` when permissions have not been queried yet. */
export function hasPermission(channel: ChannelEntry | undefined, bit: number): boolean {
  if (!channel) return false;
  if (channel.permissions == null) return false;
  return (channel.permissions & bit) !== 0;
}

/** Can the user edit this channel? (requires Write permission) */
export function canEditChannel(channel: ChannelEntry | undefined): boolean {
  return hasPermission(channel, PERM_WRITE);
}

/** Can the user create a sub-channel? (requires MakeChannel or MakeTempChannel) */
export function canCreateChannel(channel: ChannelEntry | undefined): boolean {
  return (
    hasPermission(channel, PERM_MAKE_CHANNEL) ||
    hasPermission(channel, PERM_MAKE_TEMP_CHANNEL)
  );
}

/** Can only create temporary channels (has MakeTempChannel but not MakeChannel). */
export function canOnlyCreateTemp(channel: ChannelEntry | undefined): boolean {
  return (
    !hasPermission(channel, PERM_MAKE_CHANNEL) &&
    hasPermission(channel, PERM_MAKE_TEMP_CHANNEL)
  );
}

/** Can the user delete this channel? (requires Write permission; root channel 0 cannot be deleted) */
export function canDeleteChannel(channel: ChannelEntry | undefined): boolean {
  if (!channel) return false;
  if (channel.id === 0) return false;
  return hasPermission(channel, PERM_WRITE);
}

/** Can the user delete persistent chat messages in this channel?
 *  Requires the dedicated DeleteMessage permission bit and a persistent-chat
 *  protocol to be active on the channel.
 *  Returns `false` when permissions have not been queried yet. */
export function canDeleteMessages(channel: ChannelEntry | undefined): boolean {
  if (!channel || channel.permissions == null) return false;
  if (!channel.pchat_protocol || channel.pchat_protocol === "none") return false;
  return (channel.permissions & PERM_DELETE_MESSAGE) !== 0;
}

// ---- Dialog types ------------------------------------------------

interface ChannelEditorProps {
  /** The channel being edited, or `null` when creating a new one. */
  readonly channel: ChannelEntry | null;
  /** Parent channel ID (required when creating). */
  readonly parentId: number;
  /** Whether the user can only create temporary channels. */
  readonly tempOnly?: boolean;
  readonly onClose: () => void;
}

// ---- Component ---------------------------------------------------

export default function ChannelEditorDialog({
  channel,
  parentId,
  tempOnly = false,
  onClose,
}: ChannelEditorProps) {
  const isCreate = channel === null;
  const { t } = useTranslation(["sidebar", "common"]);
  const createChannel = useAppStore((s) => s.createChannel);
  const updateChannel = useAppStore((s) => s.updateChannel);

  // Form state - initialised from existing channel or defaults.
  const [name, setName] = useState(channel?.name ?? "");
  const initialDescription = useChannelDescription(channel?.id, channel?.description_size);
  const [description, setDescription] = useState("");
  const [descriptionInitialised, setDescriptionInitialised] = useState(isCreate);
  useEffect(() => {
    if (descriptionInitialised) return;
    if (channel?.description_size == null || channel.description_size === 0) {
      setDescriptionInitialised(true);
      return;
    }
    if (initialDescription != null) {
      setDescription(initialDescription);
      setDescriptionInitialised(true);
    }
  }, [channel?.description_size, initialDescription, descriptionInitialised]);
  const [position, setPosition] = useState(channel?.position ?? 0);
  const [temporary, setTemporary] = useState(
    tempOnly ? true : (channel?.temporary ?? false),
  );
  const [maxUsers, setMaxUsers] = useState(channel?.max_users ?? 0);

  // Persistence settings
  const [pchatProtocol, setPchatProtocol] = useState<PchatProtocol>(
    channel?.pchat_protocol ?? "none",
  );
  const [pchatMaxHistory, setPchatMaxHistory] = useState(
    channel?.pchat_max_history ?? 0,
  );
  const [pchatRetentionDays, setPchatRetentionDays] = useState(
    channel?.pchat_retention_days ?? 0,
  );

  // Access password (set = change/add, empty when editing = remove)
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const pchatOpts =
        pchatProtocol !== "none"
          ? {
              pchatProtocol,
              pchatMaxHistory: pchatMaxHistory || undefined,
              pchatRetentionDays: pchatRetentionDays || undefined,
            }
          : { pchatProtocol };

      if (isCreate) {
        await createChannel(parentId, name.trim(), {
          description: description || undefined,
          position: position || undefined,
          temporary: temporary || undefined,
          maxUsers: maxUsers || undefined,
          password: password || undefined,
          ...pchatOpts,
        });
      } else {
        await updateChannel(channel.id, {
          name: name.trim() !== channel.name ? name.trim() : undefined,
          description:
            description !== (initialDescription ?? "") ? description : undefined,
          position: position !== channel.position ? position : undefined,
          temporary: temporary !== channel.temporary ? temporary : undefined,
          maxUsers: maxUsers !== channel.max_users ? maxUsers : undefined,
          password: password !== "" ? password : (channel.is_enter_restricted ? "" : undefined),
          ...pchatOpts,
        });
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    name,
    description,
    position,
    temporary,
    maxUsers,
    password,
    pchatProtocol,
    pchatMaxHistory,
    pchatRetentionDays,
    isCreate,
    channel,
    parentId,
    createChannel,
    updateChannel,
    onClose,
  ]);

  return (
    <Modal onClose={onClose} zIndex={10001} overlayClassName={styles.overlayBlur}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={isCreate ? t("channelEditor.ariaCreate") : t("channelEditor.ariaEdit")}>
        <h3 className={styles.title}>{isCreate ? t("channelEditor.titleCreate") : t("channelEditor.titleEdit")}</h3>

        {/* Name */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ch-ed-name">{t("channelEditor.nameLabel")}</label>
          <input
            id="ch-ed-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("channelEditor.namePlaceholder")}
            autoFocus
          />
        </div>

        {/* Description */}
        <div className={styles.field}>
          <span className={styles.label}>{t("channelEditor.descriptionLabel")}</span>
          <Suspense fallback={<div className={styles.label}>{t("channelEditor.loadingEditor")}</div>}>
            <BioEditor
              value={description}
              onChange={setDescription}
              placeholder={t("channelEditor.descriptionPlaceholder")}
            />
          </Suspense>
        </div>

        {/* Position & Max Users */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ch-ed-pos">{t("channelEditor.positionLabel")}</label>
            <input
              id="ch-ed-pos"
              className={styles.input}
              type="number"
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ch-ed-max">{t("channelEditor.maxUsersLabel")}</label>
            <input
              id="ch-ed-max"
              className={styles.input}
              type="number"
              value={maxUsers}
              onChange={(e) => setMaxUsers(Number(e.target.value))}
              min={0}
            />
            <span className={styles.hint}>{t("channelEditor.unlimited")}</span>
          </div>
        </div>

        {/* Temporary */}
        <div className={styles.checkboxRow}>
          <input
            id="ch-ed-temp"
            className={styles.checkbox}
            type="checkbox"
            checked={temporary}
            onChange={(e) => setTemporary(e.target.checked)}
            disabled={tempOnly}
          />
          <label className={styles.checkboxLabel} htmlFor="ch-ed-temp">
            {t("channelEditor.temporaryLabel")}
          </label>
        </div>

        {/* Access password */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ch-ed-password">{t("channelEditor.passwordLabel")}</label>
          <input
            id="ch-ed-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              isCreate
                ? t("channelEditor.passwordPlaceholderNew")
                : channel?.is_enter_restricted
                  ? t("channelEditor.passwordPlaceholderChange")
                  : t("channelEditor.passwordPlaceholderNew")
            }
            autoComplete="new-password"
          />
        </div>

        {/* Persistence settings */}
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>{t("channelEditor.persistenceTitle")}</h4>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="ch-ed-pchat">{t("channelEditor.protocolLabel")}</label>
            <select
              id="ch-ed-pchat"
              className={styles.select}
              value={pchatProtocol}
              onChange={(e) => setPchatProtocol(e.target.value as PchatProtocol)}
            >
              <option value="none">{t("channelEditor.protocolNone")}</option>
              <option value="fancy_v1_full_archive">{t("channelEditor.protocolFullArchive")}</option>
              <option value="signal_v1">{t("channelEditor.protocolSignalV1")}</option>
            </select>
          </div>

          {pchatProtocol !== "none" && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ch-ed-maxhist">
                  {t("channelEditor.maxHistoryLabel")}
                </label>
                <input
                  id="ch-ed-maxhist"
                  className={styles.input}
                  type="number"
                  value={pchatMaxHistory}
                  onChange={(e) => setPchatMaxHistory(Number(e.target.value))}
                  min={0}
                />
                <span className={styles.hint}>{t("channelEditor.unlimited")}</span>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ch-ed-ret">
                  {t("channelEditor.retentionLabel")}
                </label>
                <input
                  id="ch-ed-ret"
                  className={styles.input}
                  type="number"
                  value={pchatRetentionDays}
                  onChange={(e) => setPchatRetentionDays(Number(e.target.value))}
                  min={0}
                />
                <span className={styles.hint}>{t("channelEditor.forever")}</span>
              </div>
            </div>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} type="button">
            {t("common:actions.cancel")}
          </button>
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            type="button"
          >
            {submitting
              ? t("channelEditor.saving")
              : isCreate
                ? t("channelEditor.create")
                : t("channelEditor.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
