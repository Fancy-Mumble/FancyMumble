import { lazy, Suspense, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FancyProfile } from "../../types";
import { updatePreferences } from "../../preferencesStorage";
import {
  DECORATIONS,
  NAMEPLATES,
  EFFECTS,
  AVATAR_BORDERS,
} from "./profileData";
import { NameStyleSection } from "./NameStyleSection";
import { BannerEditorModal } from "./BannerEditorModal";
import { AvatarEditorModal } from "./AvatarEditorModal";
import { CardColorPicker } from "../../components/elements/CardColorPicker";
import styles from "./SettingsPage.module.css";
import panelStyles from "./ProfilePanel.module.css";
import { registerSettings } from "./settingsSearchRegistry";

// Lazy like ChannelEditorDialog/ChannelInfoPanel: BioEditor (Tiptap) is also
// dynamically imported there, and mixing static + dynamic imports of one
// module makes rolldown emit a cyclic chunk that crashes at evaluation time
// in release builds.  Keeping it lazy also keeps Tiptap out of this chunk.
const BioEditor = lazy(() => import("./BioEditor").then((m) => ({ default: m.BioEditor })));

registerSettings("profile")
  .add("profile.sectionUsername", ["name", "nickname"])
  .add("profile.sectionAvatar", ["picture", "photo"])
  .add("profile.sectionBanner")
  .add("profile.sectionBio", ["about", "description"])
  .add("profile.sectionStatus")
  .add("profile.sectionCardBackground")
  .add("profile.sectionAvatarBorder")
  .add("profile.sectionDecoration")
  .add("profile.sectionNameplate")
  .add("profile.sectionEffect");

export function ProfilePanel({
  defaultUsername,
  setDefaultUsername,
  profile,
  onPatchProfile,
  bio,
  onBioChange,
  avatar,
  onAvatarChange,
  profileError,
  isExpert,
  activeIdentity,
  identities,
  connectedCertLabel,
  onSwitchIdentity,
  onGoToIdentities,
}: Readonly<{
  defaultUsername: string;
  setDefaultUsername: (v: string) => void;
  profile: FancyProfile;
  onPatchProfile: (patch: Partial<FancyProfile>) => void;
  bio: string;
  onBioChange: (v: string) => void;
  avatar: string | null;
  onAvatarChange: (v: string | null) => void;
  profileError: string | null;
  isExpert: boolean;
  activeIdentity: string | null;
  identities: string[];
  connectedCertLabel: string | null;
  onSwitchIdentity: (label: string | null) => void;
  onGoToIdentities: () => void;
}>) {
  const [showBannerEditor, setShowBannerEditor] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [showCustomCss, setShowCustomCss] = useState(false);
  const { t } = useTranslation("settings");

  const handleSaveUsername = useCallback(async () => {
    if (!defaultUsername.trim()) return;
    await updatePreferences({ defaultUsername: defaultUsername.trim() });
  }, [defaultUsername]);

  const nameStyle = profile.nameStyle ?? {};
  const patchNameStyle = (patch: Partial<NonNullable<FancyProfile["nameStyle"]>>) =>
    onPatchProfile({ nameStyle: { ...nameStyle, ...patch } });

  return (
    <>
      <h2 className={styles.panelTitle}>{t("profile.panelTitle")}</h2>

      {/* -- Identity selector (advanced mode only) ------------- */}
      {isExpert && identities.length > 0 && (
        <section className={panelStyles.identityBar}>
          <div className={panelStyles.identityBarRow}>
            <label className={panelStyles.identityBarLabel}>{t("profile.identityLabel")}</label>
            <select
              className={`${styles.select} ${panelStyles.identityBarRowSelect}`}
              value={activeIdentity ?? ""}
              onChange={(e) => onSwitchIdentity(e.target.value || null)}
            >
              {identities.map((label) => (
                <option key={label} value={label}>
                  {label}{label === connectedCertLabel ? t("profile.connectedSuffix") : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={onGoToIdentities}
            >
              {t("profile.manageIdentities")}
            </button>
          </div>
          {connectedCertLabel && activeIdentity !== connectedCertLabel && (
            <p className={panelStyles.infoBoxYellow}>
              {t("profile.viewingOtherIdentity")}
            </p>
          )}
        </section>
      )}

      {/* -- Default Username ----------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionUsername")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.usernameHint")}
        </p>
        <input
          className={styles.input}
          type="text"
          autoComplete="off"
          value={defaultUsername}
          onChange={(e) => setDefaultUsername(e.target.value)}
          onBlur={handleSaveUsername}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveUsername();
          }}
          placeholder={t("profile.usernamePlaceholder")}
        />
      </section>

      {/* -- Avatar --------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionAvatar")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.avatarHint")}
        </p>
        <div className={panelStyles.avatarRow}>
          {avatar && (
            <img
              src={avatar}
              alt={t("profile.avatarThumbAlt")}
              className={panelStyles.avatarThumb}
            />
          )}
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setShowAvatarEditor(true)}
          >
            {t("profile.editAvatar")}
          </button>
        </div>
      </section>

      {/* -- Banner --------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionBanner")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.bannerHint")}
        </p>
        {profile.banner?.image && (
          <img
            src={profile.banner.image}
            alt={t("profile.bannerThumbAlt")}
            className={panelStyles.bannerThumb}
          />
        )}
        {!profile.banner?.image && profile.banner?.color && (
          <div
            className={panelStyles.bannerThumb}
            style={{ background: profile.banner.color, height: 60 }}
          />
        )}
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setShowBannerEditor(true)}
        >
          {t("profile.editBanner")}
        </button>
      </section>

      {/* -- Bio ------------------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionBio")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.bioHint")}
        </p>
        <Suspense fallback={null}>
          <BioEditor
            value={bio}
            onChange={onBioChange}
            maxLength={2000}
            placeholder={t("profile.bioPlaceholder")}
          />
        </Suspense>
      </section>

      {/* -- Custom Status -------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionStatus")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.statusHint")}
        </p>
        <input
          className={styles.input}
          type="text"
          autoComplete="off"
          maxLength={80}
          value={profile.status ?? ""}
          onChange={(e) =>
            onPatchProfile({
              status: e.target.value || undefined,
            })
          }
          placeholder={t("profile.statusPlaceholder")}
        />
      </section>

      {/* -- Card Background ------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionCardBackground")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.cardBgHint")}
        </p>
        <CardColorPicker
          colors={profile.themeColors ?? []}
          onChange={(themeColors) => onPatchProfile({ themeColors, cardBackground: undefined })}
          glass={profile.cardGlass}
          onGlassChange={(cardGlass) => onPatchProfile({ cardGlass: cardGlass || undefined })}
        />
        {isExpert && !showCustomCss && (
          <button
            type="button"
            className={styles.ghostBtn}
            style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => setShowCustomCss(true)}
          >
            {t("profile.customCssOverride")}
          </button>
        )}
        {isExpert && showCustomCss && (
          <div className={styles.field} style={{ marginTop: 8 }}>
            <label className={styles.fieldLabel}>{t("profile.customCssLabel")}</label>
            <input
              className={styles.input}
              type="text"
              value={profile.cardBackgroundCustom ?? ""}
              onChange={(e) =>
                onPatchProfile({
                  cardBackground: e.target.value ? "custom" : undefined,
                  cardBackgroundCustom: e.target.value || undefined,
                })
              }
              placeholder="linear-gradient(135deg, #1a1a2e, #2d1b38)"
            />
          </div>
        )}
      </section>

      {/* -- Avatar Border -------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionAvatarBorder")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.avatarBorderHint")}
        </p>
        <div className={styles.optionGrid}>
          {AVATAR_BORDERS
            .filter((ab) => ab.id !== "custom" || isExpert)
            .map((ab) => {
              const isRainbow = ab.id === "rainbow";
              const borderStyle: React.CSSProperties = {
                border: ab.border || "2px solid var(--color-glass-border)",
                boxShadow: ab.shadow,
                outline: ab.outline,
                ...(isRainbow
                  ? {
                      backgroundImage:
                        "linear-gradient(var(--color-bg-secondary, #1a1a2e), var(--color-bg-secondary, #1a1a2e)), " +
                        "conic-gradient(#ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ef4444)",
                      backgroundOrigin: "border-box",
                      backgroundClip: "padding-box, border-box",
                    }
                  : {}),
              };
              return (
                <button
                  key={ab.id}
                  type="button"
                  className={`${panelStyles.avatarBorderCard} ${
                    (profile.avatarBorder ?? "default") === ab.id
                      ? styles.optionCardSelected
                      : ""
                  }`}
                  onClick={() =>
                    onPatchProfile({
                      avatarBorder: ab.id === "default" ? undefined : ab.id,
                    })
                  }
                >
                  <span className={panelStyles.borderPreview} style={borderStyle} />
                  <span className={styles.optionLabel}>{ab.label}</span>
                </button>
              );
            })}
        </div>
        {isExpert && profile.avatarBorder === "custom" && (
          <div className={styles.field} style={{ marginTop: 8 }}>
            <label className={styles.fieldLabel}>{t("profile.customCssBorderLabel")}</label>
            <input
              className={styles.input}
              type="text"
              value={profile.avatarBorderCustom ?? ""}
              onChange={(e) =>
                onPatchProfile({ avatarBorderCustom: e.target.value || undefined })
              }
              placeholder="3px solid #ff00ff"
            />
          </div>
        )}
      </section>

      {/* -- Profile Decoration --------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionDecoration")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.decorationHint")}
        </p>
        <div className={styles.optionGrid}>
          {DECORATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`${styles.optionCard} ${
                (profile.decoration ?? "none") === d.id
                  ? styles.optionCardSelected
                  : ""
              }`}
              onClick={() =>
                onPatchProfile({
                  decoration: d.id === "none" ? undefined : d.id,
                })
              }
            >
              <span className={styles.optionPreview}>{d.preview}</span>
              <span className={styles.optionLabel}>{d.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Nameplate ------------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionNameplate")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.nameplateHint")}
        </p>
        <div className={styles.optionGrid}>
          {NAMEPLATES.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`${panelStyles.nameplateCard} ${
                (profile.nameplate ?? "none") === n.id
                  ? styles.optionCardSelected
                  : ""
              }`}
              style={{ background: n.bg }}
              onClick={() =>
                onPatchProfile({
                  nameplate: n.id === "none" ? undefined : n.id,
                })
              }
            >
              <span className={styles.optionLabel}>{n.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Profile Effect ------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("profile.sectionEffect")}</h3>
        <p className={styles.fieldHint}>
          {t("profile.effectHint")}
        </p>
        <div className={styles.optionGrid}>
          {EFFECTS.map((fx) => (
            <button
              key={fx.id}
              type="button"
              className={`${styles.optionCard} ${
                (profile.effect ?? "none") === fx.id
                  ? styles.optionCardSelected
                  : ""
              }`}
              onClick={() =>
                onPatchProfile({
                  effect: fx.id === "none" ? undefined : fx.id,
                })
              }
            >
              <span className={styles.optionPreview}>{fx.preview}</span>
              <span className={styles.optionLabel}>{fx.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Name Style ----------------------------------------- */}
      <NameStyleSection
        nameStyle={nameStyle}
        onPatch={patchNameStyle}
        displayName={defaultUsername}
      />

      {/* Profile errors (e.g. too large) */}
      {profileError && (
        <section className={styles.section}>
          <p className={styles.error}>{profileError}</p>
        </section>
      )}

      {/* Banner editor modal */}
      {showBannerEditor && (
        <BannerEditorModal
          banner={profile.banner}
          onConfirm={(banner) => {
            onPatchProfile({ banner });
            setShowBannerEditor(false);
          }}
          onCancel={() => setShowBannerEditor(false)}
        />
      )}

      {/* Avatar editor modal */}
      {showAvatarEditor && (
        <AvatarEditorModal
          avatar={avatar}
          onConfirm={(newAvatar) => {
            onAvatarChange(newAvatar);
            setShowAvatarEditor(false);
          }}
          onCancel={() => setShowAvatarEditor(false)}
        />
      )}
    </>
  );
}

