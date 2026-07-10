// MarkdownField - reusable WYSIWYG markdown chat input.
//
// Native counterpart of the web front-end's MarkdownInput
// (mumble-tauri/ui/src/components/chat/markdown/MarkdownInput.tsx): the
// value stays plain markdown while **bold**, *italic*, __underline__,
// ~~strike~~, `code`, ``` fences, ||spoilers||, URLs and <@id> mentions are
// decorated live by a MarkdownHighlighter working on the TextArea's
// document (caret/selection/IME/undo stay native - no overlay hack needed).
//
// Behaviour ported from the web editor:
//   - Enter submits, Shift+Enter inserts a newline
//   - Ctrl+B / Ctrl+I / Ctrl+U wrap the selection in **/*/__ markers
//   - Ctrl+Shift+H wraps the selection in ||spoiler|| markers
//   - auto-grows with content between 40px and 200px, then scrolls
//
// Styling matches MarkdownInput.module.css / ChatView .composerInput; the
// color properties can be overridden where another theme is needed.
import QtQuick
import QtQuick.Controls.Basic
import com.fancymumble.qt6ui

Item {
    id: root

    property alias text: area.text
    property alias placeholderText: area.placeholderText
    property alias readOnly: area.readOnly
    property alias inputFocus: area.activeFocus
    property real fieldRadius: 16

    // Dark-theme tokens (themes/dark.css); override for other themes.
    property color glassColor: Qt.rgba(1, 1, 1, 0.04)
    property color glassBorderColor: Qt.rgba(1, 1, 1, 0.06)
    property color focusBorderColor: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.3)
    property color textColor: "#ffffff"
    property color placeholderColor: Qt.rgba(1, 1, 1, 0.35)
    property color selectionBgColor: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.3)

    /// Emitted when the user presses Enter (without Shift).
    signal submitted()

    implicitWidth: 200
    implicitHeight: Math.max(40, Math.min(area.implicitHeight, 200))

    function clear() {
        area.clear()
    }

    function forceFocus() {
        area.forceActiveFocus()
    }

    /// Wrap the current selection (or the caret position) in markdown
    /// markers; keeps the selection on the wrapped text like the web editor.
    function wrapSelection(before, after) {
        const start = area.selectionStart
        const end = area.selectionEnd
        area.insert(end, after)
        area.insert(start, before)
        area.select(start + before.length, end + before.length)
    }

    // Glass wrapper (MarkdownInput.module.css .wrapper)
    Rectangle {
        anchors.fill: parent
        radius: root.fieldRadius
        color: area.activeFocus ? Qt.rgba(1, 1, 1, 0.08) : root.glassColor
        border.width: 1
        border.color: area.activeFocus ? root.focusBorderColor : root.glassBorderColor
    }

    Flickable {
        id: flick
        anchors.fill: parent
        // Content size is managed by the TextArea.flickable attachment
        // (which also keeps the caret scrolled into view); vertical-only so
        // long lines wrap instead of scrolling sideways.
        flickableDirection: Flickable.VerticalFlick
        boundsBehavior: Flickable.StopAtBounds
        clip: true
        TextArea.flickable: TextArea {
            id: area
            wrapMode: TextArea.Wrap
            font.pixelSize: 14
            color: root.textColor
            placeholderTextColor: root.placeholderColor
            selectionColor: root.selectionBgColor
            selectedTextColor: root.textColor
            leftPadding: 14
            rightPadding: 14
            topPadding: 10
            bottomPadding: 10
            background: null

            Keys.onPressed: (event) => {
                if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                        && !(event.modifiers & Qt.ShiftModifier)) {
                    event.accepted = true
                    root.submitted()
                    return
                }
                if (event.modifiers & Qt.ControlModifier) {
                    if (event.key === Qt.Key_B) {
                        event.accepted = true
                        root.wrapSelection("**", "**")
                    } else if (event.key === Qt.Key_I) {
                        event.accepted = true
                        root.wrapSelection("*", "*")
                    } else if (event.key === Qt.Key_U) {
                        event.accepted = true
                        root.wrapSelection("__", "__")
                    } else if (event.key === Qt.Key_H
                               && (event.modifiers & Qt.ShiftModifier)) {
                        event.accepted = true
                        root.wrapSelection("||", "||")
                    }
                }
            }
        }
    }

    // Live markdown decoration on the TextArea's document (parsing in Rust).
    MarkdownHighlighter {
        textDocument: area.textDocument
    }
}
