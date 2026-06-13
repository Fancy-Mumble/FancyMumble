/**
 * TranslationPopoutPage - borderless, always-on-top window dedicated to
 * authoring or improving fancy-mumble's UI translations.
 *
 * Workflow:
 *   1. Pick an existing language, or "Add new" - the latter opens a
 *      searchable list (from `language-flag-colors`) of every known
 *      language and creates a "---" placeholder bundle on confirm.
 *   2. The left pane lists every translation key grouped by namespace,
 *      together with the value in the source language (English).
 *   3. The right pane shows the source string and a textarea bound to
 *      the editing target language, plus a reference table of the same
 *      key in every other built-in language.
 *   4. The "Pick" button emits `translation-picker:start` to the main
 *      window.  The main window enables marker-mode i18n and lets the
 *      user click any UI text; the resulting (ns, key) is emitted back
 *      and auto-selected in the popout's left pane.
 *   5. Save persists to tauri-plugin-store; Export writes one JSON file
 *      per namespace into a chosen folder so the user can attach them
 *      to a PR.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BUILT_IN_LANGUAGES,
  I18N_NAMESPACES,
  SOURCE_LANGUAGE,
  registerLanguage,
  type I18nNamespace,
  type LocaleBundle,
} from "../i18n";
// Full 3-language bundles: imported here (and only here) so they ship in this
// lazy translator chunk rather than the app's startup bundle.
import { BUILT_IN_RESOURCES } from "../i18n/builtInBundles";
import {
  buildPlaceholderBundle,
  deleteCustomTranslation,
  flattenBundle,
  getNestedValue,
  loadCustomTranslations,
  saveCustomTranslation,
  setNestedValue,
  type CustomTranslation,
} from "../translations/storage";
import { ALL_LANGUAGES, lookupLanguage, type LanguageEntry } from "../translations/languageData";
import LanguageFlag from "../translations/LanguageFlag";
import { Autocomplete, type AutocompleteOption } from "../components/elements/Autocomplete";
import { SplitButton } from "../components/elements/SplitButton";
import type { SplitButtonOption } from "../components/elements/SplitButton";
import { CloseIcon, Link2Icon, Columns2Icon } from "../icons";
import ConfirmDialog from "../components/elements/ConfirmDialog";
import styles from "./TranslationPopoutPage.module.css";

type CustomMap = Record<string, CustomTranslation>;

interface SelectedEntry {
  ns: I18nNamespace;
  key: string;
}

/** Build a sorted list of every (ns, key) pair that appears in the source language. */
function buildKeyIndex(): Array<{ ns: I18nNamespace; key: string; source: string }> {
  const flat = flattenBundle(
    BUILT_IN_RESOURCES[SOURCE_LANGUAGE] as Partial<LocaleBundle>,
  );
  return flat.map(({ ns, key, value }) => ({ ns, key, source: value }));
}

const KEY_INDEX = buildKeyIndex();

function isBuiltIn(code: string): boolean {
  return (BUILT_IN_LANGUAGES as readonly string[]).includes(code);
}

/** Return the bundle for a given language code (built-in or custom). */
function getBundleFor(code: string, custom: CustomMap): Partial<LocaleBundle> | null {
  if (isBuiltIn(code)) {
    return BUILT_IN_RESOURCES[code as keyof typeof BUILT_IN_RESOURCES] as Partial<LocaleBundle>;
  }
  return custom[code]?.bundle ?? null;
}

export default function TranslationPopoutPage() {
  const [custom, setCustom] = useState<CustomMap>({});
  const [editingCode, setEditingCode] = useState<string>(SOURCE_LANGUAGE);
  const [bundle, setBundle] = useState<Partial<LocaleBundle>>(BUILT_IN_RESOURCES[SOURCE_LANGUAGE] as Partial<LocaleBundle>);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [nsFilter, setNsFilter] = useState<I18nNamespace | "all">("all");
  const [selected, setSelected] = useState<SelectedEntry | null>(null);
  const [pickerActive, setPickerActive] = useState(false);
  const [showAddLang, setShowAddLang] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);
  const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
  type PendingExport = { folder: string; files: Array<{ name: string; content: string }>; conflicts: string[] };
  const pendingExportRef = useRef<PendingExport | null>(null);
  const [previewLinked, setPreviewLinked] = useState(false);
  const savedDisplayCodeRef = useRef<string>(SOURCE_LANGUAGE);
  // Language shown in the main window (what the user reads to identify strings).
  // Starts at SOURCE_LANGUAGE so contributors immediately see the canonical text.
  const [displayCode, setDisplayCode] = useState<string>(SOURCE_LANGUAGE);
  // Reference languages shown next to the editor. Multi-select: the contributor
  // can compare against as many existing translations as they want.
  const [refLangs, setRefLangs] = useState<readonly string[]>(["de"]);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initial load of saved bundles.
  useEffect(() => {
    void loadCustomTranslations().then(setCustom);
  }, []);

  const displayBundle = useMemo<Partial<LocaleBundle> | null>(
    () => getBundleFor(displayCode, custom),
    [displayCode, custom],
  );

  // Picker-selected event handler: jump to the chosen key in the list.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ ns: string; key: string }>("translation-picker:selected", (e) => {
      const ns = e.payload.ns as I18nNamespace;
      if (!I18N_NAMESPACES.includes(ns)) return;
      setSelected({ ns, key: e.payload.key });
      setPickerActive(false);
      void emit("translation-picker:stop");
      flashStatus("ok", `Picked ${ns}.${e.payload.key}`);
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, []);

  // Picker-cancelled (ESC) event: just turn off picker state in the popout.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("translation-picker:cancelled", () => {
      setPickerActive(false);
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, []);

  // Switch the editing target whenever the user selects a different language.
  const switchEditingLanguage = useCallback((code: string) => {
    setEditingCode(code);
    setDirty(false);
    setSelected(null);
    const next = isBuiltIn(code)
      ? (BUILT_IN_RESOURCES[code as keyof typeof BUILT_IN_RESOURCES] as Partial<LocaleBundle>)
      : (custom[code]?.bundle ?? buildPlaceholderBundle(BUILT_IN_RESOURCES[SOURCE_LANGUAGE] as Partial<LocaleBundle>));
    setBundle(structuredClone(next) as Partial<LocaleBundle>);
  }, [custom]);

  // When the custom map loads later, refresh the bundle if we're on a custom language.
  useEffect(() => {
    if (!isBuiltIn(editingCode) && custom[editingCode]) {
      setBundle(structuredClone(custom[editingCode]!.bundle) as Partial<LocaleBundle>);
    }
  }, [custom, editingCode]);

  // When linked, keep the display language in sync with the editing language
  // so the main window always renders the translation being authored.
  useEffect(() => {
    if (previewLinked) setDisplayCode(editingCode);
  }, [previewLinked, editingCode]);

  // Push the DISPLAY language to the main window so the UI renders in the chosen
  // display language. This is independent of editingCode so contributors can keep
  // the UI in a familiar language while authoring a different translation.
  useEffect(() => {
    const payload = {
      code: displayCode,
      bundle: isBuiltIn(displayCode) ? null : displayBundle,
    };
    void emit("translation:apply", payload);
  }, [displayCode, displayBundle]);

  function flashStatus(kind: "ok" | "error", text: string) {
    setStatus({ kind, text });
    if (statusTimer.current) globalThis.clearTimeout(statusTimer.current);
    statusTimer.current = globalThis.setTimeout(() => setStatus(null), 3500);
  }

  const allLangsForDropdown = useMemo(() => {
    const codes = Array.from(
      new Set<string>([...BUILT_IN_LANGUAGES, ...Object.keys(custom)]),
    );
    return codes.map((code) => ({ code, entry: lookupLanguage(code) }));
  }, [custom]);

  // Reference-picker options: every language we know about, minus the
  // one being edited (no point comparing a language against itself).
  const refLangOptions = useMemo<AutocompleteOption<string>[]>(
    () =>
      allLangsForDropdown
        .filter(({ code }) => code !== editingCode)
        .map(({ code, entry }) => ({
          key: code,
          value: code,
          label: entry ? `${entry.englishName} (${code})` : code,
          startAdornment: <LanguageFlag entry={entry} size={16} />,
        })),
    [allLangsForDropdown, editingCode],
  );

  // Map the persisted code list back into the option objects the
  // MultiSelect expects.  Skip codes that no longer exist (e.g. a custom
  // language the user just deleted).
  const refLangValues = useMemo<AutocompleteOption<string>[]>(
    () =>
      refLangs
        .map((code) => refLangOptions.find((o) => o.value === code))
        .filter((o): o is AutocompleteOption<string> => o !== undefined),
    [refLangs, refLangOptions],
  );

  const filteredKeys = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return KEY_INDEX.filter((k) => {
      if (nsFilter !== "all" && k.ns !== nsFilter) return false;
      if (!f) return true;
      if (k.key.toLowerCase().includes(f)) return true;
      if (k.source.toLowerCase().includes(f)) return true;
      const dispVal = displayBundle ? getNestedValue(displayBundle, k.ns, k.key) : undefined;
      if (dispVal && dispVal.toLowerCase().includes(f)) return true;
      const transVal = getNestedValue(bundle, k.ns, k.key);
      return !!transVal && transVal.toLowerCase().includes(f);
    });
  }, [filter, nsFilter, bundle, displayBundle]);

  const grouped = useMemo(() => {
    const out: Record<I18nNamespace, typeof KEY_INDEX> = {
      common: [], chat: [], server: [], settings: [], sidebar: [],
    };
    for (const k of filteredKeys) out[k.ns].push(k);
    return out;
  }, [filteredKeys]);

  const selectedValue = useMemo(() => {
    if (!selected) return null;
    return getNestedValue(bundle, selected.ns, selected.key) ?? "";
  }, [selected, bundle]);

  const selectedSource = useMemo(() => {
    if (!selected) return null;
    return getNestedValue(
      BUILT_IN_RESOURCES[SOURCE_LANGUAGE] as Partial<LocaleBundle>,
      selected.ns,
      selected.key,
    ) ?? "";
  }, [selected]);

  const editingIsBuiltIn = isBuiltIn(editingCode);

  // -- Handlers -----------------------------------------------------

  const handleEditValue = useCallback((value: string) => {
    if (!selected || editingIsBuiltIn) return;
    setBundle((prev) => setNestedValue(prev, selected.ns, selected.key, value));
    setDirty(true);
  }, [selected, editingIsBuiltIn]);

  const handleTogglePicker = useCallback(async () => {
    if (pickerActive) {
      setPickerActive(false);
      await emit("translation-picker:stop");
    } else {
      setPickerActive(true);
      await emit("translation-picker:start");
    }
  }, [pickerActive]);

  const handleSave = useCallback(async () => {
    if (editingIsBuiltIn) {
      flashStatus("error", "Built-in languages cannot be overwritten");
      return;
    }
    const existing = custom[editingCode];
    const entry: CustomTranslation = existing
      ? { ...existing, bundle, updatedAt: Date.now() }
      : (() => {
          const lang = lookupLanguage(editingCode);
          return {
            code: editingCode,
            nativeName: lang?.nativeName ?? editingCode,
            englishName: lang?.englishName ?? editingCode,
            flagCountry: lang?.countryCode ?? null,
            bundle,
            updatedAt: Date.now(),
          } satisfies CustomTranslation;
        })();
    try {
      await saveCustomTranslation(entry);
      setCustom((prev) => ({ ...prev, [editingCode]: entry }));
      registerLanguage(editingCode, bundle);
      setDirty(false);
      flashStatus("ok", "Saved");
    } catch (e) {
      flashStatus("error", `Save failed: ${String(e)}`);
    }
  }, [editingIsBuiltIn, editingCode, custom, bundle]);

  const handleExportNamespace = useCallback(async () => {
    if (nsFilter === "all") return;
    const nsData = (bundle as Record<string, unknown>)[nsFilter];
    const json = JSON.stringify(nsData ?? {}, null, 2);
    const defaultName = `${editingCode}.${nsFilter}.json`;
    try {
      const path = await saveDialog({
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path ? path.split(/[\\/]/).pop() ?? defaultName : defaultName;
      a.click();
      URL.revokeObjectURL(url);
      flashStatus("ok", path ? `Saved as ${a.download}` : "Download started");
    } catch (e) {
      flashStatus("error", `Export failed: ${String(e)}`);
    }
  }, [nsFilter, bundle, editingCode]);

  const handleExportAll = useCallback(async () => {
    try {
      const folder = await openDialog({ directory: true, multiple: false });
      if (!folder) return;
      const folderPath = typeof folder === "string" ? folder : (folder as string[])[0];
      if (!folderPath) return;
      const files = I18N_NAMESPACES.map((ns) => ({
        name: `${editingCode}.${ns}.json`,
        content: JSON.stringify((bundle as Record<string, unknown>)[ns] ?? {}, null, 2),
      }));
      const conflicts: string[] = await invoke("check_files_exist", {
        folder: folderPath,
        names: files.map((f) => f.name),
      });
      if (conflicts.length > 0) {
        pendingExportRef.current = { folder: folderPath, files, conflicts };
        setShowOverwriteWarning(true);
        return;
      }
      await invoke("write_translation_files", { folder: folderPath, files });
      flashStatus("ok", `Exported ${files.length} files`);
    } catch (e) {
      flashStatus("error", `Export failed: ${String(e)}`);
    }
  }, [bundle, editingCode]);

  const doExport = useCallback(async () => {
    const pending = pendingExportRef.current;
    pendingExportRef.current = null;
    setShowOverwriteWarning(false);
    if (!pending) return;
    try {
      await invoke("write_translation_files", { folder: pending.folder, files: pending.files });
      flashStatus("ok", `Exported ${pending.files.length} files`);
    } catch (e) {
      flashStatus("error", `Export failed: ${String(e)}`);
    }
  }, []);

  const handleImportFiles = useCallback(async (fileList: FileList) => {
    if (editingIsBuiltIn) return;

    const validKeySet = new Set(KEY_INDEX.map((k) => `${k.ns}\0${k.key}`));
    let imported = 0;
    let skipped = 0;
    let nextBundle = bundle;

    for (const file of Array.from(fileList)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        flashStatus("error", `Invalid JSON: ${file.name}`);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        flashStatus("error", `Unexpected format in ${file.name}`);
        return;
      }

      const detectedNs = I18N_NAMESPACES.find(
        (ns) => file.name.endsWith(`.${ns}.json`) || file.name === `${ns}.json`,
      );

      const toFlatten = detectedNs
        ? ({ [detectedNs]: parsed } as Partial<LocaleBundle>)
        : (parsed as Partial<LocaleBundle>);

      for (const { ns, key, value } of flattenBundle(toFlatten)) {
        if (validKeySet.has(`${ns}\0${key}`)) {
          nextBundle = setNestedValue(nextBundle, ns, key, value);
          imported++;
        } else {
          skipped++;
        }
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";

    if (imported > 0) {
      setBundle(nextBundle);
      setDirty(true);
      flashStatus(
        "ok",
        skipped > 0
          ? `Imported ${imported} keys (${skipped} unknown skipped)`
          : `Imported ${imported} keys`,
      );
    } else {
      flashStatus(
        "error",
        skipped > 0
          ? `No valid keys found (${skipped} unknown keys skipped)`
          : "No translation keys found in file(s)",
      );
    }
  }, [editingIsBuiltIn, bundle]);

  const handleDeleteLanguage = useCallback(async () => {
    if (editingIsBuiltIn) return;
    try {
      await deleteCustomTranslation(editingCode);
      setCustom((prev) => {
        const next = { ...prev };
        delete next[editingCode];
        return next;
      });
      switchEditingLanguage(SOURCE_LANGUAGE);
      flashStatus("ok", "Deleted");
    } catch (e) {
      flashStatus("error", `Delete failed: ${String(e)}`);
    }
  }, [editingIsBuiltIn, editingCode, switchEditingLanguage]);

  const handleAddLanguage = useCallback((entry: LanguageEntry) => {
    setShowAddLang(false);
    if (isBuiltIn(entry.code) || custom[entry.code]) {
      switchEditingLanguage(entry.code);
      return;
    }
    const placeholder = buildPlaceholderBundle(
      BUILT_IN_RESOURCES[SOURCE_LANGUAGE] as Partial<LocaleBundle>,
    );
    const newEntry: CustomTranslation = {
      code: entry.code,
      nativeName: entry.nativeName,
      englishName: entry.englishName,
      flagCountry: entry.countryCode,
      bundle: placeholder,
      updatedAt: Date.now(),
    };
    setCustom((prev) => ({ ...prev, [entry.code]: newEntry }));
    setEditingCode(entry.code);
    setBundle(structuredClone(placeholder) as Partial<LocaleBundle>);
    setDirty(true);
    setSelected(null);
  }, [custom, switchEditingLanguage]);

  const doClose = useCallback(async () => {
    if (pickerActive) await emit("translation-picker:stop");
    try {
      await getCurrentWindow().close();
    } catch {
      /* ignore */
    }
  }, [pickerActive]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowCloseWarning(true);
    } else {
      void doClose();
    }
  }, [dirty, doClose]);

  // -- Render -------------------------------------------------------

  const editingLangEntry = lookupLanguage(editingCode);
  const displayLangEntry = lookupLanguage(displayCode);

  const exportOptions = useMemo<[SplitButtonOption, ...SplitButtonOption[]]>(() => {
    const exportAll: SplitButtonOption = {
      label: "Export all namespaces",
      hint: "Pick a folder - writes one JSON file per namespace",
      onSelect: () => void handleExportAll(),
    };
    if (nsFilter === "all") return [exportAll];
    return [
      {
        label: `Export "${nsFilter}"`,
        hint: "Save this namespace as a single JSON file",
        onSelect: () => void handleExportNamespace(),
      },
      exportAll,
    ];
  }, [nsFilter, handleExportAll, handleExportNamespace]);

  return (
    <div className={styles.root}>
      <div className={styles.header} data-tauri-drag-region>
        <span className={styles.headerTitle}>
          Translation helper {dirty && <span className={styles.dirtyBadge}>● unsaved</span>}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => void handleClose()}
          aria-label="Close"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      <div className={styles.toolbar}>
        {/* Row 1 - language selectors */}
        <div className={styles.toolbarRow}>
          {!previewLinked && (
            <>
              <span className={styles.toolbarLabel}>Display:</span>
              <LanguageFlag entry={displayLangEntry} />
              <select
                value={displayCode}
                onChange={(e) => setDisplayCode(e.target.value)}
                aria-label="Display language"
              >
                {allLangsForDropdown.map(({ code, entry }) => (
                  <option key={code} value={code}>
                    {entry ? `${entry.englishName} (${code})` : code}
                    {isBuiltIn(code) ? " - built-in" : ""}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            className={`${styles.btnIcon} ${previewLinked ? styles.btnActive : ""}`}
            onClick={() => {
              if (!previewLinked) {
                savedDisplayCodeRef.current = displayCode;
              } else {
                setDisplayCode(savedDisplayCodeRef.current);
              }
              setPreviewLinked((prev) => !prev);
            }}
            title={previewLinked
              ? "Split view: choose display and translate language independently"
              : "Link view: show the UI in the translate language (preview your work)"
            }
          >
            {previewLinked ? <Link2Icon width={14} height={14} /> : <Columns2Icon width={14} height={14} />}
          </button>

          <span className={styles.toolbarSep} />

          <span className={styles.toolbarLabel}>Translate:</span>
          <LanguageFlag entry={editingLangEntry} />
          <select
            value={editingCode}
            onChange={(e) => switchEditingLanguage(e.target.value)}
            aria-label="Translation language"
          >
            {allLangsForDropdown.map(({ code, entry }) => (
              <option key={code} value={code}>
                {entry ? `${entry.englishName} (${code})` : code}
                {isBuiltIn(code) ? " - built-in" : ""}
              </option>
            ))}
          </select>
          <button type="button" className={styles.btn} onClick={() => setShowAddLang(true)}>
            + Add language
          </button>
        </div>

        {/* Row 2 - filter, picker, and action buttons */}
        <div className={styles.toolbarRow}>
          <select
            value={nsFilter}
            onChange={(e) => setNsFilter(e.target.value as I18nNamespace | "all")}
            aria-label="Filter namespace"
          >
            <option value="all">All namespaces</option>
            {I18N_NAMESPACES.map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>

          <button
            type="button"
            className={`${styles.btn} ${pickerActive ? styles.btnActive : ""}`}
            onClick={() => void handleTogglePicker()}
            title="Click a UI element in the main window to find its key"
          >
            {pickerActive ? "Picking… (ESC to stop)" : "🎯 Pick from UI"}
          </button>

          <span className={styles.spacer} />

          <button
            type="button"
            className={styles.btn}
            onClick={() => fileInputRef.current?.click()}
            disabled={editingIsBuiltIn}
            title={
              editingIsBuiltIn
                ? "Select a custom language to import into"
                : "Import one or more JSON translation files (only keys present in the source language are applied)"
            }
          >
            Import
          </button>
          <SplitButton
            options={exportOptions}
            variant="secondary"
            dropDirection="down"
          />
          {!editingIsBuiltIn && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => setShowDeleteWarning(true)}
              title="Delete this saved translation"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void handleSave()}
            disabled={editingIsBuiltIn || !dirty}
          >
            Save
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) void handleImportFiles(e.target.files);
        }}
      />

      {showOverwriteWarning && (
        <ConfirmDialog
          title="Overwrite existing files?"
          body={`${pendingExportRef.current?.conflicts.length ?? 0} file(s) already exist in the selected folder and will be overwritten:\n\n${pendingExportRef.current?.conflicts.join(", ") ?? ""}`}
          confirmLabel="Overwrite"
          cancelLabel="Cancel"
          danger
          onConfirm={() => void doExport()}
          onCancel={() => { pendingExportRef.current = null; setShowOverwriteWarning(false); }}
        />
      )}

      {showCloseWarning && (
        <ConfirmDialog
          title="Unsaved changes"
          body="You have unsaved translations. Close anyway and discard your changes?"
          confirmLabel="Discard & Close"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => void doClose()}
          onCancel={() => setShowCloseWarning(false)}
        />
      )}

      {showDeleteWarning && (
        <ConfirmDialog
          title="Delete language"
          body={`This will permanently delete all saved translations for ${editingLangEntry?.englishName ?? editingCode}. This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={() => { setShowDeleteWarning(false); void handleDeleteLanguage(); }}
          onCancel={() => setShowDeleteWarning(false)}
        />
      )}

      <div className={styles.body}>
        <div className={styles.list}>
          <div className={styles.searchRow}>
            <input
              type="text"
              placeholder="Search key or text…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {(nsFilter === "all" ? I18N_NAMESPACES : [nsFilter]).map((ns) => {
            const items = grouped[ns];
            if (!items?.length) return null;
            return (
              <div key={ns}>
                <div className={styles.nsHeader}>{ns}</div>
                {items.map((k) => {
                  const v = getNestedValue(bundle, ns, k.key);
                  const dispVal = displayBundle ? getNestedValue(displayBundle, ns, k.key) : undefined;
                  const isActive =
                    selected?.ns === ns && selected.key === k.key;
                  const isMissing =
                    !editingIsBuiltIn && (v === undefined || v === "" || v === "---");
                  return (
                    <button
                      type="button"
                      key={`${ns}.${k.key}`}
                      className={[
                        styles.listItem,
                        isActive ? styles.listItemActive : "",
                        isMissing ? styles.listItemMissing : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setSelected({ ns, key: k.key })}
                    >
                      <span className={styles.listItemKey}>{k.key}</span>
                      <span className={styles.listItemValue}>
                        {dispVal && dispVal !== "---" ? dispVal : k.source}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className={styles.editor}>
          {!selected ? (
            <div className={styles.emptyState}>
              <p>Select a key on the left, or click <strong>Pick from UI</strong> and choose a string in the main window.</p>
            </div>
          ) : (
            <>
              <div className={styles.editorHeader}>
                <span className={styles.namespacePill}>{selected.ns}</span>
                <span className={styles.keyPath}>{selected.key}</span>
              </div>

              <div className={styles.sourceBlock}>
                <h4>Source ({SOURCE_LANGUAGE})</h4>
                <div className={styles.sourceValue}>{selectedSource}</div>
              </div>

              {displayCode !== SOURCE_LANGUAGE && displayCode !== editingCode && (
                <div className={styles.sourceBlock}>
                  <h4>Display ({displayCode})</h4>
                  <div className={styles.sourceValue}>
                    {(displayBundle ? getNestedValue(displayBundle, selected.ns, selected.key) : null) || (
                      <span className={styles.displayMissing}>(not translated)</span>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.editorArea}>
                <label htmlFor="translation-input">
                  Translation ({editingCode}{editingIsBuiltIn ? " - read-only built-in" : ""})
                </label>
                <textarea
                  id="translation-input"
                  value={selectedValue ?? ""}
                  onChange={(e) => handleEditValue(e.target.value)}
                  readOnly={editingIsBuiltIn}
                  placeholder="---"
                />
              </div>

              <div className={styles.refTable}>
                <div className={styles.refHeader}>
                  <h4>Reference</h4>
                  <div className={styles.refLangSelect}>
                    <Autocomplete
                      multiple
                      value={refLangValues}
                      options={refLangOptions}
                      onChange={(next) =>
                        setRefLangs(next.map((o) => o.value))
                      }
                      placeholder="Add reference languages…"
                      label="Reference languages"
                    />
                  </div>
                </div>
                {refLangs.length === 0 ? (
                  <div className={styles.refRow}>
                    <span className={`${styles.refValue} ${styles.refMissing}`}>
                      Pick one or more reference languages above to compare.
                    </span>
                  </div>
                ) : (
                  refLangs.map((code) => {
                    const refBundle = getBundleFor(code, custom);
                    const v = refBundle
                      ? getNestedValue(refBundle, selected.ns, selected.key)
                      : undefined;
                    const entry = lookupLanguage(code);
                    return (
                      <div key={code} className={styles.refRow}>
                        <LanguageFlag entry={entry} size={20} />
                        <span
                          className={
                            v
                              ? styles.refValue
                              : `${styles.refValue} ${styles.refMissing}`
                          }
                        >
                          {v || "(missing)"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.statusBar}>
        {status && (
          <span className={status.kind === "ok" ? styles.statusOk : styles.statusError}>
            {status.text}
          </span>
        )}
        <span className={styles.spacer} />
        <span>{filteredKeys.length} of {KEY_INDEX.length} keys</span>
      </div>

      {showAddLang && (
        <AddLanguageModal
          existing={new Set([...BUILT_IN_LANGUAGES, ...Object.keys(custom)])}
          onPick={handleAddLanguage}
          onClose={() => setShowAddLang(false)}
        />
      )}
    </div>
  );
}

interface AddLanguageModalProps {
  readonly existing: Set<string>;
  readonly onPick: (lang: LanguageEntry) => void;
  readonly onClose: () => void;
}

function AddLanguageModal({ existing, onPick, onClose }: AddLanguageModalProps) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ALL_LANGUAGES.slice(0, 200);
    return ALL_LANGUAGES.filter((l) =>
      l.englishName.toLowerCase().includes(needle) ||
      l.nativeName.toLowerCase().includes(needle) ||
      l.code.toLowerCase().includes(needle),
    );
  }, [q]);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <h3>Add language</h3>
        <input
          type="text"
          autoFocus
          placeholder="Search language by name or code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className={styles.langOptions}>
          {filtered.map((l) => {
            const isExisting = existing.has(l.code);
            return (
              <button
                key={`${l.code}-${l.englishName}`}
                type="button"
                className={styles.langOption}
                onClick={() => onPick(l)}
                title={isExisting ? "Already in the list - selecting it will switch to it" : undefined}
              >
                <LanguageFlag entry={l} size={20} />
                <span>
                  <strong>{l.englishName}</strong>
                  {" · "}
                  <span style={{ opacity: 0.7 }}>{l.nativeName}</span>
                </span>
                <span className={styles.langOptionMeta}>
                  {l.code}{isExisting ? " ✓" : ""}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 16, opacity: 0.6, textAlign: "center" }}>
              No languages match "{q}"
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
