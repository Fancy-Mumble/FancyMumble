// Live markdown decoration for the chat input (the native counterpart of
// the web front-end's overlay-based MarkdownInput).
//
// A QSyntaxHighlighter applies character formats to the QTextDocument that
// backs a QML TextArea, so the raw markdown stays visible and editable while
// **bold** renders bold, `code` renders monospaced, and so on. Caret,
// selection, IME and undo remain fully native. The actual parsing lives in
// Rust (fancy-utils' markdown module) and is reached through the cxx bridge
// function `md_line_spans` declared in src/bridge.rs.
//
// Registered as the QML type `MarkdownHighlighter` in com.fancymumble.qt6ui
// (see qt6ui_register_qml_types, called from main.rs). Usage:
//
//     TextArea { id: input }
//     MarkdownHighlighter { textDocument: input.textDocument }
#pragma once

#include <QQuickTextDocument>
#include <QSyntaxHighlighter>

class MarkdownHighlighter : public QSyntaxHighlighter
{
    Q_OBJECT
    Q_PROPERTY(QQuickTextDocument *textDocument READ textDocument WRITE setTextDocument
                   NOTIFY textDocumentChanged)

public:
    explicit MarkdownHighlighter(QObject *parent = nullptr);

    QQuickTextDocument *textDocument() const { return m_textDocument; }
    void setTextDocument(QQuickTextDocument *doc);

Q_SIGNALS:
    void textDocumentChanged();

protected:
    void highlightBlock(const QString &text) override;

private:
    QQuickTextDocument *m_textDocument = nullptr;
};

// Registers the hand-written QML types of this crate. Plain C linkage so
// main.rs can call it without a cxx declaration.
extern "C" void qt6ui_register_qml_types();
