import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import styles from "./LiveDocCodeBlock.module.css";

type CodeBlockLowlightOptions = (typeof CodeBlockLowlight)["options"];

export default function LiveDocCodeBlock({
  node,
  updateAttributes,
  extension,
  editor,
}: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? "";
  const languages: string[] = (extension.options as CodeBlockLowlightOptions).lowlight.listLanguages();
  const isEditable = editor.isEditable;

  return (
    <NodeViewWrapper className={styles.codeBlock}>
      <div className={styles.header} contentEditable={false}>
        {isEditable ? (
          <select
            className={styles.languageSelect}
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value || null })}
          >
            <option value="">auto-detect</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        ) : (
          language && <span className={styles.languageLabel}>{language}</span>
        )}
      </div>
      <pre>
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
