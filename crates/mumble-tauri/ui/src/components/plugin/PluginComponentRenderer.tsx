// Recursive renderer for plugin-driven UI components in card (non-modal)
// context.  Modal-only components (text-input, file-upload, checkbox)
// silently render nothing here - the modal owns its own state machine
// and uses dedicated controls.  Radio-group and checkbox-group are
// rendered here as a stack of native radio/checkbox inputs that fire
// `sendPluginInteraction` immediately on change, matching how
// `string-select` works in this context.
//
// Shared layout/display primitives (container, section, separator,
// label, text-display, thumbnail, media-gallery, file) are rendered
// in both contexts via this module.

import { useMemo, useState } from "react";
import { marked } from "marked";
import { rebaseFileServerUrl, sendPluginInteraction, useAppStore } from "../../store";
import { useAclGroups } from "../../hooks/useAclGroups";
import { SafeHtml } from "../elements/SafeHtml";
import type {
  ButtonStyle,
  Component,
  Mentionable,
  SectionAccessory,
  SeparatorSpacing,
} from "../../plugins/tier1/types";
import styles from "./PluginInteractionLayer.module.css";

export interface RenderContext {
  readonly pluginName: string;
  readonly channelId: number | null;
}

/** Resolve a media URL emitted by a plugin component to a URL the browser
 *  can actually load.
 *
 *  Handled schemes:
 *  - `fancy-file://<file_id>` - resolved against the currently-connected
 *    file-server plugin's `baseUrl`, yielding `{baseUrl}/files/{file_id}`.
 *    Requires the file to have been uploaded with `mode: public`; the
 *    server-side capabilities advertise whether unsigned downloads are
 *    accepted.  Returns `null` if no file-server is configured.
 *  - `http://` / `https://` - rebased through {@link rebaseFileServerUrl}
 *    so that download URLs embedding the plugin's internal origin still
 *    resolve when the public surface is behind a reverse proxy.
 *  - Anything else - returned unchanged so the browser can show a
 *    broken-resource placeholder rather than silently dropping the
 *    reference. */
export function resolveMediaUrl(url: string, baseUrl: string | null): string | null {
  if (url.startsWith("fancy-file://")) {
    if (!baseUrl) return null;
    const fileId = url.slice("fancy-file://".length).split(/[?#]/, 1)[0];
    if (!fileId) return null;
    return `${baseUrl.replace(/\/+$/, "")}/files/${encodeURIComponent(fileId)}`;
  }
  return rebaseFileServerUrl(url);
}

/** React hook wrapping {@link resolveMediaUrl} that subscribes to the
 *  current `fileServerConfig.baseUrl` so the rendered URL updates if the
 *  user reconnects to a different file-server.  Returns `null` for
 *  unresolvable `fancy-file://` URLs. */
export function useFancyFileUrl(url: string): string | null {
  const baseUrl = useAppStore((s) => s.fileServerConfig?.baseUrl ?? null);
  return useMemo(() => resolveMediaUrl(url, baseUrl), [url, baseUrl]);
}

export function RenderComponent({
  component,
  ctx,
}: {
  readonly component: Component;
  readonly ctx: RenderContext;
}) {
  switch (component.type) {
    case "button":
      return <RenderButton component={component} ctx={ctx} />;
    case "string-select":
      return <RenderStringSelect component={component} ctx={ctx} />;
    case "user-select":
      return <RenderUserSelect component={component} ctx={ctx} />;
    case "role-select":
      return <RenderRoleSelect component={component} ctx={ctx} />;
    case "mentionable-select":
      return <RenderMentionableSelect component={component} ctx={ctx} />;
    case "channel-select":
      return <RenderChannelSelect component={component} ctx={ctx} />;
    case "text-display":
      return <RenderTextDisplay content={component.content} />;
    case "thumbnail":
      return <RenderThumbnail component={component} />;
    case "media-gallery":
      return <RenderMediaGallery component={component} />;
    case "file":
      return <RenderFile component={component} />;
    case "separator":
      return <RenderSeparator component={component} />;
    case "container":
      return <RenderContainer component={component} ctx={ctx} />;
    case "section":
      return <RenderSection component={component} ctx={ctx} />;
    case "label":
      return <RenderLabel component={component} ctx={ctx} />;
    case "radio-group":
      return <RenderRadioGroup component={component} ctx={ctx} />;
    case "checkbox-group":
      return <RenderCheckboxGroup component={component} ctx={ctx} />;
    case "text-input":
    case "file-upload":
    case "checkbox":
      // Modal-only components - skip in card context.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Interactive primitives
// ---------------------------------------------------------------------------

function btnClass(style: ButtonStyle | undefined): string {
  switch (style) {
    case "secondary":
      return styles.btnSecondary;
    case "success":
      return styles.btnSuccess;
    case "danger":
      return styles.btnDanger;
    case "link":
    case "primary":
    case undefined:
      return styles.btnPrimary;
  }
}

function RenderButton({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "button" }>;
  readonly ctx: RenderContext;
}) {
  if (component.style === "link" && component.url) {
    return (
      <a
        className={`${styles.btn} ${btnClass("link")}`}
        href={component.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {component.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.btn} ${btnClass(component.style)}`}
      disabled={component.disabled}
      onClick={() => {
        if (!component.custom_id) return;
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id },
          ctx.channelId,
        );
      }}
    >
      {component.label}
    </button>
  );
}

function RenderRadioGroup({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "radio-group" }>;
  readonly ctx: RenderContext;
}) {
  const initial = component.options.find((o) => o.default)?.value;
  const [selected, setSelected] = useState<string | undefined>(initial);
  return (
    <div className={styles.choiceList}>
      {component.options.map((o) => (
        <label key={o.value} className={styles.choiceRow}>
          <input
            type="radio"
            name={component.custom_id}
            value={o.value}
            checked={selected === o.value}
            onChange={() => {
              setSelected(o.value);
              void sendPluginInteraction(
                ctx.pluginName,
                {
                  kind: "component",
                  custom_id: component.custom_id,
                  values: [o.value],
                },
                ctx.channelId,
              );
            }}
          />
          <span>
            {o.label}
            {o.description && (
              <span className={styles.choiceDescription}>{o.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

function RenderCheckboxGroup({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "checkbox-group" }>;
  readonly ctx: RenderContext;
}) {
  const initial = new Set(
    component.options.filter((o) => o.default).map((o) => o.value),
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const toggle = (value: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(value);
    else next.delete(value);
    setSelected(next);
    void sendPluginInteraction(
      ctx.pluginName,
      {
        kind: "component",
        custom_id: component.custom_id,
        values: Array.from(next),
      },
      ctx.channelId,
    );
  };
  return (
    <div className={styles.choiceList}>
      {component.options.map((o) => (
        <label key={o.value} className={styles.choiceRow}>
          <input
            type="checkbox"
            checked={selected.has(o.value)}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          <span>
            {o.label}
            {o.description && (
              <span className={styles.choiceDescription}>{o.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

function RenderStringSelect({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "string-select" }>;
  readonly ctx: RenderContext;
}) {
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      defaultValue={multi ? [] : ""}
      onChange={(e) => {
        const values = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id, values },
          ctx.channelId,
        );
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick one"}
        </option>
      )}
      {component.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RenderUserSelect({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "user-select" }>;
  readonly ctx: RenderContext;
}) {
  const users = useAppStore((s) => s.users);
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      defaultValue={multi ? [] : ""}
      onChange={(e) => {
        const values = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id, values },
          ctx.channelId,
        );
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a user"}
        </option>
      )}
      {users.map((u) => (
        <option key={u.session} value={String(u.session)}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function RenderRoleSelect({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "role-select" }>;
  readonly ctx: RenderContext;
}) {
  const groups = useAclGroups();
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      defaultValue={multi ? [] : ""}
      onChange={(e) => {
        const values = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id, values },
          ctx.channelId,
        );
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a role"}
        </option>
      )}
      {groups.map((g) => (
        <option key={g.name} value={g.name}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

function RenderMentionableSelect({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "mentionable-select" }>;
  readonly ctx: RenderContext;
}) {
  const users = useAppStore((s) => s.users);
  const groups = useAclGroups();
  const multi = (component.max_values ?? 1) > 1;
  // Encode mentionables as `kind:value` strings on the wire.  The plugin
  // decodes them via the typed `fields` map when delivered through the
  // modal-submit path; for the click-through path we keep the legacy
  // values: string[] shape.
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      defaultValue={multi ? [] : ""}
      onChange={(e) => {
        const values = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id, values },
          ctx.channelId,
        );
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick someone"}
        </option>
      )}
      <optgroup label="Users">
        {users.map((u) => (
          <option key={`user:${u.session}`} value={`user:${u.session}`}>
            {u.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Roles">
        {groups.map((g) => (
          <option key={`role:${g.name}`} value={`role:${g.name}`}>
            {g.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function RenderChannelSelect({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "channel-select" }>;
  readonly ctx: RenderContext;
}) {
  const channels = useAppStore((s) => s.channels);
  const multi = (component.max_values ?? 1) > 1;
  return (
    <select
      className={styles.select}
      multiple={multi}
      disabled={component.disabled}
      defaultValue={multi ? [] : ""}
      onChange={(e) => {
        const values = multi
          ? Array.from(e.target.selectedOptions, (o) => o.value)
          : [e.target.value];
        void sendPluginInteraction(
          ctx.pluginName,
          { kind: "component", custom_id: component.custom_id, values },
          ctx.channelId,
        );
      }}
    >
      {!multi && (
        <option value="" disabled>
          {component.placeholder ?? "Pick a channel"}
        </option>
      )}
      {channels.map((c) => (
        <option key={c.id} value={String(c.id)}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Display primitives
// ---------------------------------------------------------------------------

function RenderThumbnail({
  component,
}: {
  readonly component: Extract<Component, { type: "thumbnail" }>;
}) {
  const [revealed, setRevealed] = useState(!component.spoiler);
  const resolved = useFancyFileUrl(component.media.url);
  const cls = component.spoiler && !revealed
    ? `${styles.thumbnailImg} ${styles.spoiler}`
    : styles.thumbnailImg;
  return (
    <img
      className={cls}
      src={resolved ?? ""}
      alt={component.description ?? ""}
      onClick={() => {
        if (component.spoiler) setRevealed(true);
      }}
    />
  );
}

function RenderMediaGallery({
  component,
}: {
  readonly component: Extract<Component, { type: "media-gallery" }>;
}) {
  return (
    <div className={styles.mediaGallery}>
      {component.items.map((item, i) => (
        <MediaGalleryTile key={i} item={item} />
      ))}
    </div>
  );
}

function MediaGalleryTile({
  item,
}: {
  readonly item: { readonly media: { readonly url: string }; readonly description?: string; readonly spoiler?: boolean };
}) {
  const [revealed, setRevealed] = useState(!item.spoiler);
  const resolved = useFancyFileUrl(item.media.url);
  const cls = item.spoiler && !revealed
    ? `${styles.mediaGalleryItem} ${styles.spoiler}`
    : styles.mediaGalleryItem;
  return (
    <div
      className={cls}
      onClick={() => {
        if (item.spoiler) setRevealed(true);
      }}
    >
      <img src={resolved ?? ""} alt={item.description ?? ""} />
    </div>
  );
}

function RenderFile({
  component,
}: {
  readonly component: Extract<Component, { type: "file" }>;
}) {
  const resolved = useFancyFileUrl(component.file.url);
  const sizeText =
    component.size != null
      ? ` · ${humanSize(component.size)}`
      : "";
  return (
    <a
      className={styles.fileTile}
      href={resolved ?? "#"}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span>{component.name ?? component.file.url}</span>
      <span className={styles.fileMeta}>{sizeText}</span>
    </a>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function RenderTextDisplay({ content }: { readonly content: string }) {
  // Plugins emit text-display content as markdown (GFM).  Parse it
  // synchronously and route through SafeHtml so DOMPurify strips
  // anything that would let a plugin smuggle script/XSS through.
  const html = useMemo(
    () => String(marked.parse(content, { async: false, gfm: true })),
    [content],
  );
  return <SafeHtml html={html} className={styles.textDisplay} />;
}

function RenderSeparator({
  component,
}: {
  readonly component: Extract<Component, { type: "separator" }>;
}) {
  const cls = [styles.separator];
  if (component.spacing === "large") cls.push(styles.separatorLarge);
  if (component.divider === false) cls.push(styles.separatorBlank);
  return <hr className={cls.join(" ")} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function RenderContainer({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "container" }>;
  readonly ctx: RenderContext;
}) {
  const [revealed, setRevealed] = useState(!component.spoiler);
  const style: React.CSSProperties = {};
  if (component.accent_color != null) {
    style.borderLeftColor = `#${component.accent_color.toString(16).padStart(6, "0")}`;
  }
  if (component.spoiler && !revealed) {
    return (
      <div
        className={`${styles.container} ${styles.spoiler}`}
        style={style}
        onClick={() => setRevealed(true)}
      >
        {component.components.map((c, i) => (
          <RenderComponent key={i} component={c} ctx={ctx} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.container} style={style}>
      {component.components.map((c, i) => (
        <RenderComponent key={i} component={c} ctx={ctx} />
      ))}
    </div>
  );
}

function RenderSection({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "section" }>;
  readonly ctx: RenderContext;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionMain}>
        {component.components.map((c, i) => (
          <RenderComponent key={i} component={c} ctx={ctx} />
        ))}
      </div>
      <RenderAccessory accessory={component.accessory} ctx={ctx} />
    </div>
  );
}

function RenderAccessory({
  accessory,
  ctx,
}: {
  readonly accessory: SectionAccessory;
  readonly ctx: RenderContext;
}) {
  return <RenderComponent component={accessory} ctx={ctx} />;
}

function RenderLabel({
  component,
  ctx,
}: {
  readonly component: Extract<Component, { type: "label" }>;
  readonly ctx: RenderContext;
}) {
  return (
    <div className={styles.label}>
      <span className={styles.labelTitle}>{component.label}</span>
      {component.description && (
        <span className={styles.labelDescription}>{component.description}</span>
      )}
      <RenderComponent component={component.component} ctx={ctx} />
    </div>
  );
}

// Avoid React unused-import warnings under noUncheckedSideEffectImports.
export type { Mentionable, SeparatorSpacing };
