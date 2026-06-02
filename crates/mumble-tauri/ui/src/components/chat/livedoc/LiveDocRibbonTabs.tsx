/**
 * LiveDocRibbonTabs - the per-tab control panels for the Word-style ribbon.
 *
 * Each tab is a row of captioned groups built from the shared widgets in
 * `liveDocRibbonWidgets`.  All commands operate on the live Tiptap `editor`
 * or the shared Yjs `doc`; no editor behaviour changes here - this only
 * re-surfaces the existing commands in a Word-like layout.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  CheckboxIcon,
  Columns2Icon,
  DatabaseIcon,
  EditIcon,
  FileTextIcon,
  ImageIcon,
  IndentIcon,
  LinkIcon,
  ListIcon,
  ListTreeIcon,
  NewspaperIcon,
  OutdentIcon,
  PaintBucketIcon,
  PaletteIcon,
  PilcrowIcon,
  PinIcon,
  QuoteIcon,
  SeparatorHorizontalIcon,
  SquareIcon,
  SubscriptIcon,
  SuperscriptIcon,
  WarningIcon,
} from "../../../icons";
import {
  useLiveDocPageSetup,
  setLiveDocPageSetup,
  useLiveDocDecoration,
  setLiveDocDecoration,
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  pageGeometryPx,
  type LiveDocPageSize,
  type LiveDocPageOrientation,
  type LiveDocPageMargin,
  type LiveDocPageBorder,
  type LiveDocRulerUnit,
  type LiveDocPageColumns,
} from "./useLiveDoc";
import { insertEditorImage } from "./liveDocImageInsert";
import { newRefId } from "./liveDocBookmark";
import LiveDocReferenceControls from "./LiveDocReferenceControls";
import LiveDocCustomMarginsDialog from "./LiveDocCustomMarginsDialog";
import { useLiveDocCitationStyle, setLiveDocCitationStyle } from "./useLiveDocSources";
import { CITATION_STYLES } from "./liveDocCitationStyles";
import type { CitationItemRef } from "./liveDocCitations";
import LiveDocSourceManager from "./LiveDocSourceManager";
import LiveDocCitationPicker from "./LiveDocCitationPicker";
import LiveDocPlaceholderChecker from "./LiveDocPlaceholderChecker";
import {
  RibbonButton,
  RibbonSelect,
  ColorTrigger,
  FontSizeWidget,
  TablePickerButton,
  ToolDropdown,
  FONT_FAMILIES,
} from "./liveDocRibbonWidgets";
import editorStyles from "./LiveDocEditor.module.css";
import styles from "./LiveDocRibbon.module.css";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Group({ caption, children }: { readonly caption: string; readonly children: ReactNode }) {
  return (
    <section className={styles.group}>
      <div className={styles.groupBody}>{children}</div>
      <div className={styles.groupCaption}>{caption}</div>
    </section>
  );
}

function Rows({ children }: { readonly children: ReactNode }) {
  return <div className={styles.groupRows}>{children}</div>;
}

function Row({ children }: { readonly children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Home: styles, font, paragraph
// ---------------------------------------------------------------------------

export function HomeTab({ editor }: { readonly editor: Editor }) {
  const { t } = useTranslation("chat");
  const textColorRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLInputElement>(null);

  const currentFamilyValue = (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  const currentFamily = FONT_FAMILIES.find((f) => f.value === currentFamilyValue) ?? FONT_FAMILIES[0];

  return (
    <>
      <Group caption={t("liveDoc.ribbon.groups.styles", { defaultValue: "Styles" })}>
        <Rows>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.h1")} icon="H1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
            <RibbonButton label={t("liveDoc.toolbar.h2")} icon="H2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          </Row>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.h3")} icon="H3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
            <RibbonButton label={t("liveDoc.toolbar.paragraph")} icon={<PilcrowIcon width={16} height={16} />} active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()} />
          </Row>
        </Rows>
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.font", { defaultValue: "Font" })}>
        <Rows>
          <Row>
            <ToolDropdown
              label={t("liveDoc.toolbar.fontFamily")}
              buttonText={currentFamily.label}
              triggerClassName={`${editorStyles.toolBtn} ${editorStyles.dropdownTrigger} ${styles.inlineTrigger}`}
              buttonStyle={{ fontFamily: currentFamily.value || undefined, minWidth: 108 }}
            >
              {(close) =>
                FONT_FAMILIES.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    className={`${editorStyles.dropdownItem} ${currentFamilyValue === f.value ? editorStyles.dropdownItemActive : ""}`}
                    style={{ fontFamily: f.value || undefined }}
                    onClick={() => {
                      if (f.value) editor.chain().focus().setFontFamily(f.value).run();
                      else editor.chain().focus().unsetFontFamily().run();
                      close();
                    }}
                  >
                    {f.label}
                  </button>
                ))
              }
            </ToolDropdown>
            <FontSizeWidget editor={editor} />
          </Row>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.bold")} icon={<strong>B</strong>} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
            <RibbonButton label={t("liveDoc.toolbar.italic")} icon={<em>I</em>} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <RibbonButton label={t("liveDoc.toolbar.underline")} icon={<u>U</u>} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            <RibbonButton label={t("liveDoc.toolbar.strike")} icon={<s>S</s>} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <RibbonButton label={t("liveDoc.toolbar.code")} icon={"</>"} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
            <RibbonButton label={t("liveDoc.toolbar.subscript")} icon={<SubscriptIcon width={16} height={16} />} active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()} />
            <RibbonButton label={t("liveDoc.toolbar.superscript")} icon={<SuperscriptIcon width={16} height={16} />} active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
            <ColorTrigger
              inputRef={textColorRef}
              label={t("liveDoc.toolbar.textColor")}
              current={(editor.getAttributes("textStyle").color as string) ?? null}
              onColor={(c) => editor.chain().focus().setColor(c).run()}
              onClear={() => editor.chain().focus().unsetColor().run()}
            >
              <PaletteIcon width={16} height={16} aria-hidden="true" />
            </ColorTrigger>
            <ColorTrigger
              inputRef={highlightRef}
              label={t("liveDoc.toolbar.highlightColor")}
              current={(editor.getAttributes("highlight").color as string) ?? null}
              onColor={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
              onClear={() => editor.chain().focus().unsetHighlight().run()}
            >
              <PaintBucketIcon width={16} height={16} aria-hidden="true" />
            </ColorTrigger>
          </Row>
        </Rows>
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.paragraph", { defaultValue: "Paragraph" })}>
        <Rows>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.bulletList")} icon={<ListIcon width={16} height={16} />} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
            <RibbonButton label={t("liveDoc.toolbar.orderedList")} icon="1." active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            <RibbonButton label={t("liveDoc.toolbar.taskList")} icon={<CheckboxIcon width={16} height={16} />} active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} />
            <RibbonButton label={t("liveDoc.toolbar.outdent")} icon={<OutdentIcon width={16} height={16} />} onClick={() => editor.chain().focus().outdentBlock().run()} />
            <RibbonButton label={t("liveDoc.toolbar.indent")} icon={<IndentIcon width={16} height={16} />} onClick={() => editor.chain().focus().indentBlock().run()} />
          </Row>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.alignLeft")} icon={<AlignLeftIcon width={16} height={16} />} active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
            <RibbonButton label={t("liveDoc.toolbar.alignCenter")} icon={<AlignCenterIcon width={16} height={16} />} active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
            <RibbonButton label={t("liveDoc.toolbar.alignRight")} icon={<AlignRightIcon width={16} height={16} />} active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
            <RibbonButton label={t("liveDoc.toolbar.alignJustify")} icon={<AlignJustifyIcon width={16} height={16} />} active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />
            <RibbonButton label={t("liveDoc.toolbar.blockquote")} icon={<QuoteIcon width={16} height={16} />} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <RibbonButton label={t("liveDoc.toolbar.codeBlock")} icon={"{ }"} active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
          </Row>
        </Rows>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Insert: pages, tables, illustrations, links, symbols
// ---------------------------------------------------------------------------

interface InsertTabProps {
  readonly editor: Editor;
  readonly onInsertCoverPage: () => void;
  readonly onInsertMathBlock: () => void;
}

export function InsertTab({ editor, onInsertCoverPage, onInsertMathBlock }: InsertTabProps) {
  const { t } = useTranslation("chat");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const promptForLink = useCallback(() => {
    const previous = (editor.getAttributes("link").href as string | null) ?? "";
    const url = window.prompt(t("liveDoc.toolbar.link"), previous);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor, t]);

  const insertBookmark = useCallback(() => {
    editor.chain().focus().insertBookmark({ bookmarkId: newRefId("bm"), label: "" }).run();
  }, [editor]);

  return (
    <>
      <Group caption={t("liveDoc.ribbon.groups.pages", { defaultValue: "Pages" })}>
        <RibbonButton variant="large" label={t("liveDoc.pageSetup.insertCoverPage")} caption={t("liveDoc.ribbon.coverPage", { defaultValue: "Cover Page" })} icon={<FileTextIcon width={22} height={22} />} onClick={onInsertCoverPage} />
        <RibbonButton variant="large" label={t("liveDoc.toolbar.pageBreak")} caption={t("liveDoc.ribbon.pageBreak", { defaultValue: "Page Break" })} icon={<SeparatorHorizontalIcon width={22} height={22} />} onClick={() => editor.chain().focus().setPageBreak().run()} />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.tables", { defaultValue: "Tables" })}>
        <TablePickerButton editor={editor} large />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.illustrations", { defaultValue: "Illustrations" })}>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void insertEditorImage(editor, file).catch((err) => console.warn("live-doc image insert failed:", err));
            }
            e.target.value = "";
          }}
        />
        <RibbonButton variant="large" label={t("liveDoc.toolbar.image")} caption={t("liveDoc.ribbon.picture", { defaultValue: "Picture" })} icon={<ImageIcon width={22} height={22} />} onClick={() => imageInputRef.current?.click()} />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.links", { defaultValue: "Links" })}>
        <Rows>
          <Row>
            <RibbonButton label={t("liveDoc.toolbar.link")} showLabel caption={t("liveDoc.ribbon.link", { defaultValue: "Link" })} icon={<LinkIcon width={16} height={16} />} active={editor.isActive("link")} onClick={promptForLink} />
          </Row>
          <Row>
            <RibbonButton label={t("liveDoc.references.insertBookmark")} showLabel caption={t("liveDoc.ribbon.bookmark", { defaultValue: "Bookmark" })} icon={<PinIcon width={16} height={16} />} onClick={insertBookmark} />
          </Row>
        </Rows>
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.symbols", { defaultValue: "Symbols" })}>
        <RibbonButton variant="large" label={t("liveDoc.toolbar.mathBlock")} caption={t("liveDoc.ribbon.equation", { defaultValue: "Equation" })} icon={<span style={{ fontSize: 22 }}>&#x2211;</span>} onClick={onInsertMathBlock} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Draw: pen tools
// ---------------------------------------------------------------------------

export function DrawTab({ onOpenDraw }: { readonly onOpenDraw: () => void }) {
  const { t } = useTranslation("chat");
  return (
    <Group caption={t("liveDoc.ribbon.groups.tools", { defaultValue: "Tools" })}>
      <RibbonButton
        variant="large"
        label={t("liveDoc.draw.title", { defaultValue: "Insert drawing" })}
        caption={t("liveDoc.ribbon.drawing", { defaultValue: "Drawing" })}
        icon={<EditIcon width={22} height={22} />}
        onClick={onOpenDraw}
      />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Design: page background (border + watermark)
// ---------------------------------------------------------------------------

const BORDERS: ReadonlyArray<LiveDocPageBorder> = ["none", "thin", "medium"];

export function DesignTab({ doc }: { readonly doc: Y.Doc }) {
  const { t } = useTranslation("chat");
  const decoration = useLiveDocDecoration(doc);
  return (
    <Group caption={t("liveDoc.ribbon.groups.pageBackground", { defaultValue: "Page Background" })}>
      <RibbonSelect<LiveDocPageBorder>
        fieldLabel={t("liveDoc.pageSetup.border")}
        ariaLabel={t("liveDoc.pageSetup.border")}
        value={decoration.border}
        width={90}
        options={BORDERS.map((b) => ({ value: b, label: t(`liveDoc.pageSetup.borderOptions.${b}`) }))}
        onPick={(border) => setLiveDocDecoration(doc, { border })}
      />
      <label className={styles.ribbonField}>
        <span className={styles.ribbonFieldLabel}>{t("liveDoc.pageSetup.watermark")}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <SquareIcon width={16} height={16} aria-hidden="true" />
          <input
            type="text"
            className={styles.textInput}
            value={decoration.watermark}
            maxLength={80}
            placeholder={t("liveDoc.pageSetup.watermarkPlaceholder")}
            onChange={(e) => setLiveDocDecoration(doc, { watermark: e.target.value })}
          />
        </span>
      </label>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Layout: page setup + header/footer
// ---------------------------------------------------------------------------

const SIZES: ReadonlyArray<LiveDocPageSize> = ["a4", "letter", "legal"];
const ORIENTATIONS: ReadonlyArray<LiveDocPageOrientation> = ["portrait", "landscape"];
const MARGINS: ReadonlyArray<LiveDocPageMargin> = ["normal", "narrow", "moderate", "wide", "mirrored"];
const RULER_UNITS: ReadonlyArray<LiveDocRulerUnit> = ["cm", "in"];

interface MarginsSelectProps {
  readonly doc: Y.Doc;
  readonly setup: ReturnType<typeof useLiveDocPageSetup>;
}

function MarginsSelect({ doc, setup }: MarginsSelectProps) {
  const { t } = useTranslation("chat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const isCustom = setup.marginX !== undefined || setup.marginY !== undefined;
  const geo = pageGeometryPx(setup);
  const displayLabel = isCustom
    ? t("liveDoc.pageSetup.marginOptions.custom")
    : t(`liveDoc.pageSetup.marginOptions.${setup.margin}`);

  return (
    <>
      <label className={styles.ribbonField}>
        <span className={styles.ribbonFieldLabel}>{t("liveDoc.pageSetup.margins")}</span>
        <ToolDropdown
          label={t("liveDoc.pageSetup.margins")}
          buttonText={displayLabel}
          triggerClassName={`${editorStyles.toolBtn} ${editorStyles.dropdownTrigger} ${styles.inlineTrigger}`}
          buttonStyle={{ minWidth: 104 }}
        >
          {(close) => (
            <>
              {MARGINS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${editorStyles.dropdownItem} ${!isCustom && setup.margin === m ? editorStyles.dropdownItemActive : ""}`}
                  onClick={() => { setLiveDocPageSetup(doc, { margin: m }); close(); }}
                >
                  {t(`liveDoc.pageSetup.marginOptions.${m}`)}
                </button>
              ))}
              <hr className={editorStyles.dropdownSep} />
              <button
                type="button"
                className={`${editorStyles.dropdownItem} ${isCustom ? editorStyles.dropdownItemActive : ""}`}
                onClick={() => { close(); setDialogOpen(true); }}
              >
                {t("liveDoc.pageSetup.marginOptions.customMargins")}
              </button>
            </>
          )}
        </ToolDropdown>
      </label>
      {dialogOpen && (
        <LiveDocCustomMarginsDialog
          rulerUnit={setup.rulerUnit}
          initialMarginXPx={geo.marginX}
          initialMarginYPx={geo.marginY}
          onApply={(x, y) => setLiveDocPageSetup(doc, { marginX: x, marginY: y })}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

interface LayoutTabProps {
  readonly doc: Y.Doc;
  readonly onInsertSectionBreak: () => void;
}

export function LayoutTab({ doc, onInsertSectionBreak }: LayoutTabProps) {
  const { t } = useTranslation("chat");
  const setup = useLiveDocPageSetup(doc);
  const headerFooter = useLiveDocHeaderFooter(doc);

  return (
    <>
      <Group caption={t("liveDoc.ribbon.groups.pageSetup", { defaultValue: "Page Setup" })}>
        <RibbonSelect<LiveDocPageSize>
          fieldLabel={t("liveDoc.pageSetup.size")}
          ariaLabel={t("liveDoc.pageSetup.size")}
          value={setup.size}
          width={92}
          options={SIZES.map((s) => ({ value: s, label: t(`liveDoc.pageSetup.sizes.${s}`) }))}
          onPick={(size) => setLiveDocPageSetup(doc, { size })}
        />
        <RibbonSelect<LiveDocPageOrientation>
          fieldLabel={t("liveDoc.pageSetup.orientation")}
          ariaLabel={t("liveDoc.pageSetup.orientation")}
          value={setup.orientation}
          width={104}
          options={ORIENTATIONS.map((o) => ({ value: o, label: t(`liveDoc.pageSetup.orientations.${o}`) }))}
          onPick={(orientation) => setLiveDocPageSetup(doc, { orientation })}
        />
        <MarginsSelect doc={doc} setup={setup} />
        <RibbonSelect<LiveDocRulerUnit>
          fieldLabel={t("liveDoc.pageSetup.rulerUnit")}
          ariaLabel={t("liveDoc.pageSetup.rulerUnit")}
          value={setup.rulerUnit}
          width={70}
          options={RULER_UNITS.map((u) => ({ value: u, label: t(`liveDoc.pageSetup.rulerUnitOptions.${u}`) }))}
          onPick={(rulerUnit) => setLiveDocPageSetup(doc, { rulerUnit })}
        />
        <RibbonButton label={t("liveDoc.pageSetup.insertSectionBreak")} showLabel caption={t("liveDoc.ribbon.sectionBreak", { defaultValue: "Breaks" })} icon={<Columns2Icon width={16} height={16} />} onClick={onInsertSectionBreak} />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.columns", { defaultValue: "Columns" })}>
        <RibbonSelect<string>
          fieldLabel={t("liveDoc.pageSetup.columns", { defaultValue: "Columns" })}
          ariaLabel={t("liveDoc.pageSetup.columns", { defaultValue: "Columns" })}
          value={String(setup.columns ?? 1)}
          width={90}
          options={([1, 2, 3] as LiveDocPageColumns[]).map((n) => ({
            value: String(n),
            label: t(`liveDoc.pageSetup.columnsOptions.${n}`, { defaultValue: String(n) }),
          }))}
          onPick={(v) => setLiveDocPageSetup(doc, { columns: Number(v) as LiveDocPageColumns })}
        />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.headerFooter", { defaultValue: "Header & Footer" })}>
        <Rows>
          <Row>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={headerFooter.enabled}
                onChange={(e) => setLiveDocHeaderFooter(doc, { enabled: e.target.checked })}
              />
              <span>{t("liveDoc.headerFooter.enable")}</span>
            </label>
          </Row>
          <Row>
            <label className={`${styles.toggle} ${headerFooter.enabled ? "" : styles.toggleDisabled}`}>
              <input
                type="checkbox"
                checked={headerFooter.showPageNumber}
                disabled={!headerFooter.enabled}
                onChange={(e) => setLiveDocHeaderFooter(doc, { showPageNumber: e.target.checked })}
              />
              <span>{t("liveDoc.headerFooter.pageNumbers")}</span>
            </label>
          </Row>
        </Rows>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// References: table of contents + captions/bookmarks/cross-refs
// ---------------------------------------------------------------------------

type CitationDialog = "manager" | "picker" | "checker" | null;

export function ReferencesTab({ editor, doc }: { readonly editor: Editor; readonly doc: Y.Doc | null }) {
  const { t } = useTranslation("chat");
  const styleId = useLiveDocCitationStyle(doc);
  const [dialog, setDialog] = useState<CitationDialog>(null);

  const insertCitation = (items: CitationItemRef[]) =>
    editor.chain().focus().insertCitation(items).run();
  const insertPlaceholder = (tag: string) =>
    editor.chain().focus().insertCitationPlaceholder(tag).run();

  return (
    <>
      <Group caption={t("liveDoc.ribbon.groups.citations", { defaultValue: "Citations & Bibliography" })}>
        {doc && (
          <RibbonSelect<string>
            fieldLabel={t("liveDoc.citations.style", { defaultValue: "Style" })}
            ariaLabel={t("liveDoc.citations.style", { defaultValue: "Style" })}
            value={styleId}
            width={150}
            options={CITATION_STYLES.map((s) => ({ value: s.id, label: s.label }))}
            onPick={(id) => setLiveDocCitationStyle(doc, id)}
          />
        )}
        <RibbonButton
          variant="large"
          label={t("liveDoc.citations.insertCitation", { defaultValue: "Insert Citation" })}
          caption={t("liveDoc.citations.insertCitationShort", { defaultValue: "Citation" })}
          icon={<QuoteIcon width={22} height={22} />}
          onClick={() => setDialog("picker")}
          disabled={!doc}
        />
        <RibbonButton
          variant="large"
          label={t("liveDoc.citations.manageSources", { defaultValue: "Manage Sources" })}
          caption={t("liveDoc.citations.manageSourcesShort", { defaultValue: "Sources" })}
          icon={<DatabaseIcon width={22} height={22} />}
          onClick={() => setDialog("manager")}
          disabled={!doc}
        />
        <RibbonButton
          variant="large"
          label={t("liveDoc.citations.bibliography", { defaultValue: "Bibliography" })}
          caption={t("liveDoc.citations.bibliographyShort", { defaultValue: "Bibliography" })}
          icon={<ListIcon width={22} height={22} />}
          onClick={() => editor.chain().focus().insertBibliography().run()}
        />
        <RibbonButton
          label={t("liveDoc.citations.checkPlaceholders", { defaultValue: "Check Placeholders" })}
          showLabel
          caption={t("liveDoc.citations.checkPlaceholdersShort", { defaultValue: "Check" })}
          icon={<WarningIcon width={16} height={16} />}
          onClick={() => setDialog("checker")}
        />
      </Group>

      <Group caption={t("liveDoc.ribbon.groups.tableOfContents", { defaultValue: "Table of Contents" })}>
        <RibbonButton
          variant="large"
          label={t("liveDoc.toolbar.tableOfContents")}
          caption={t("liveDoc.ribbon.toc", { defaultValue: "Contents" })}
          icon={<ListTreeIcon width={22} height={22} />}
          onClick={() => editor.chain().focus().insertTableOfContents().run()}
        />
      </Group>
      <Group caption={t("liveDoc.ribbon.groups.captions", { defaultValue: "Captions" })}>
        <LiveDocReferenceControls editor={editor} />
      </Group>

      {dialog === "manager" && doc && (
        <LiveDocSourceManager doc={doc} onClose={() => setDialog(null)} />
      )}
      {dialog === "picker" && doc && (
        <LiveDocCitationPicker
          doc={doc}
          onInsert={insertCitation}
          onInsertPlaceholder={insertPlaceholder}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "checker" && (
        <LiveDocPlaceholderChecker editor={editor} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Review: read-only document statistics
// ---------------------------------------------------------------------------

export function ReviewTab({ editor, pageCount }: { readonly editor: Editor; readonly pageCount: number }) {
  const { t } = useTranslation("chat");
  const text = editor.getText();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characters = text.length;
  return (
    <Group caption={t("liveDoc.ribbon.groups.proofing", { defaultValue: "Document" })}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{pageCount}</span>
          <span className={styles.statLabel}>{t("liveDoc.ribbon.pages", { defaultValue: "Pages" })}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{words}</span>
          <span className={styles.statLabel}>{t("liveDoc.ribbon.words", { defaultValue: "Words" })}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{characters}</span>
          <span className={styles.statLabel}>{t("liveDoc.ribbon.characters", { defaultValue: "Characters" })}</span>
        </div>
      </div>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// View: show panes + paper mode
// ---------------------------------------------------------------------------

interface ViewTabProps {
  readonly outlineOpen: boolean;
  readonly onToggleOutline: () => void;
  readonly paperMode: boolean;
  readonly onTogglePaperMode: () => void;
  readonly markdownMode: boolean;
  readonly onToggleMarkdown: () => void;
}

export function ViewTab({
  outlineOpen,
  onToggleOutline,
  paperMode,
  onTogglePaperMode,
  markdownMode,
  onToggleMarkdown,
}: ViewTabProps) {
  const { t } = useTranslation("chat");
  return (
    <Group caption={t("liveDoc.ribbon.groups.show", { defaultValue: "Show" })}>
      <RibbonButton
        variant="large"
        label={t("liveDoc.toolbar.outline")}
        caption={t("liveDoc.ribbon.outline", { defaultValue: "Outline" })}
        icon={<ListTreeIcon width={22} height={22} />}
        active={outlineOpen}
        onClick={onToggleOutline}
        disabled={markdownMode}
      />
      <RibbonButton
        variant="large"
        label={paperMode ? t("liveDoc.paperModeOff") : t("liveDoc.paperModeOn")}
        caption={t("liveDoc.ribbon.printLayout", { defaultValue: "Paper" })}
        icon={<NewspaperIcon width={22} height={22} />}
        active={paperMode}
        onClick={onTogglePaperMode}
        disabled={markdownMode}
      />
      <RibbonButton
        variant="large"
        label={t("liveDoc.markdown.title", { defaultValue: "Markdown" })}
        caption={t("liveDoc.markdown.title", { defaultValue: "Markdown" })}
        icon={<FileTextIcon width={22} height={22} />}
        active={markdownMode}
        onClick={onToggleMarkdown}
      />
    </Group>
  );
}
