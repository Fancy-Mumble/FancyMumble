import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { ChannelEntry, PchatProtocol } from "../../../types";
import { useAppStore } from "../../../store";
import { Modal } from "../../elements/Modal";
import { MemberPicker } from "../../elements/MemberPicker";
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

  // Hidden channel + expiry (meeting-room) settings.
  const [hidden, setHidden] = useState(channel?.hidden ?? false);
  const [expiryMode, setExpiryMode] = useState(channel?.expiry_mode ?? 0);
  // Duration is edited as value + unit; persisted/sent in seconds.
  const initialDurationSecs = channel?.expiry_duration_secs ?? 0;
  const [expiryUnit, setExpiryUnit] = useState<number>(
    initialDurationSecs % 86400 === 0 && initialDurationSecs > 0 ? 86400 : 1,
  );
  const [expiryValue, setExpiryValue] = useState<number>(
    initialDurationSecs > 0 ? initialDurationSecs / (initialDurationSecs % 86400 === 0 ? 86400 : 1) : 0,
  );
  const expiryDurationSecs = Math.max(0, Math.round(expiryValue * expiryUnit));

  // Invitees for a private (hidden) meeting room. Candidates are the registered
  // users currently visible; MemberPicker keys on a stable user_id.
  const users = useAppStore((s) => s.users);
  const inviteeCandidates = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of users) {
      if (u.user_id != null && u.user_id >= 0) map.set(u.user_id, u.name);
    }
    return [...map.entries()].map(([user_id, name]) => ({ user_id, name }));
  }, [users]);
  const [invitees, setInvitees] = useState<number[]>([]);

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
          hidden: hidden || undefined,
          expiryMode: expiryMode || undefined,
          expiryDurationSecs: expiryMode ? expiryDurationSecs || undefined : undefined,
          invitees: hidden && invitees.length > 0 ? invitees : undefined,
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
          hidden: hidden !== (channel.hidden ?? false) ? hidden : undefined,
          expiryMode: expiryMode !== (channel.expiry_mode ?? 0) ? expiryMode : undefined,
          expiryDurationSecs:
            expiryDurationSecs !== (channel.expiry_duration_secs ?? 0) ? expiryDurationSecs : undefined,
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
    hidden,
    expiryMode,
    expiryDurationSecs,
    invitees,
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

        {/* Hidden channel */}
        <div className={styles.checkboxRow}>
          <input
            id="ch-ed-hidden"
            className={styles.checkbox}
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
          />
          <label className={styles.checkboxLabel} htmlFor="ch-ed-hidden">
            {t("channelEditor.hiddenLabel")}
          </label>
        </div>

        {/* Invitees - only when creating a private (hidden) room */}
        {isCreate && hidden && (
          <div className={styles.field}>
            <label className={styles.label}>{t("channelEditor.inviteesLabel")}</label>
            <MemberPicker
              value={invitees}
              candidates={inviteeCandidates}
              onChange={setInvitees}
              placeholder={t("channelEditor.inviteesPlaceholder")}
              inputTestId="ch-ed-invitee-input"
            />
          </div>
        )}

        {/* Expiry */}
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ch-ed-expiry-mode">{t("channelEditor.expiryModeLabel")}</label>
            <select
              id="ch-ed-expiry-mode"
              className={styles.input}
              value={expiryMode}
              onChange={(e) => setExpiryMode(Number(e.target.value))}
            >
              <option value={0}>{t("channelEditor.expiryNone")}</option>
              <option value={1}>{t("channelEditor.expiryAbsolute")}</option>
              <option value={2}>{t("channelEditor.expirySliding")}</option>
            </select>
          </div>
          {expiryMode !== 0 && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ch-ed-expiry-value">{t("channelEditor.expiryAfterLabel")}</label>
              <div className={styles.row}>
                <input
                  id="ch-ed-expiry-value"
                  className={styles.input}
                  type="number"
                  min={0}
                  value={expiryValue}
                  onChange={(e) => setExpiryValue(Number(e.target.value))}
                />
                <select
                  id="ch-ed-expiry-unit"
                  className={styles.input}
                  value={expiryUnit}
                  onChange={(e) => setExpiryUnit(Number(e.target.value))}
                >
                  <option value={1}>{t("channelEditor.unitSeconds")}</option>
                  <option value={3600}>{t("channelEditor.unitHours")}</option>
                  <option value={86400}>{t("channelEditor.unitDays")}</option>
                  <option value={604800}>{t("channelEditor.unitWeeks")}</option>
                </select>
              </div>
            </div>
          )}
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
