// Fancy Mumble Qt6 client - frame-matched to the Tauri front-end's dark
// theme (ui/src/themes/dark.css + theme.css + the *.module.css files).
// Design tokens are mirrored 1:1 in the `theme` object below; keep them in
// sync with the CSS when the web UI changes.
//
// The window is frameless (like the Tauri app: decorations=false) with a
// custom 40px titlebar, so dragging/resizing is implemented manually via
// startSystemMove()/startSystemResize().
//
// NOTE: cxx-qt 0.7 exposes Rust names verbatim (snake_case), so QML uses
// `backend.channels_json`, `backend.connect_to_server`, `onChat_message`,
// etc. - NOT camelCase.
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Effects
import QtQuick.Layouts
import com.fancymumble.qt6ui

ApplicationWindow {
    id: window
    visible: true
    width: 1024
    height: 768
    minimumWidth: 560
    minimumHeight: 400
    flags: Qt.Window | Qt.FramelessWindowHint
    color: theme.bgPrimary
    // All user-facing strings come from the shared locale bundles via
    // backend.t()/tr_n() (see src/i18n.rs) so translations are maintained
    // once for both clients.
    title: backend.t("common.brand")

    Backend {
        id: backend
        // No-op unless FANCY_QT6UI_E2E_PORT is set (e2e control channel).
        Component.onCompleted: backend.e2e_start()
    }

    // ---- Design tokens (themes/dark.css, theme.css) --------------------
    QtObject {
        id: theme
        readonly property color bgPrimary: "#0e0e16"
        readonly property color bgGradMid: "#1a1a2e"
        readonly property color bgGradEnd: "#16213e"
        readonly property color textPrimary: "#ffffff"
        readonly property color textSecondary: Qt.rgba(1, 1, 1, 0.55)
        readonly property color textMuted: Qt.rgba(1, 1, 1, 0.35)
        readonly property color accent: "#2aabee"
        readonly property color accentHover: "#229ed9"
        readonly property color accentGlow: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.3)
        readonly property color bgElevated: "#1e1e2e"
        readonly property color glassHeavy: Qt.rgba(1, 1, 1, 0.15)
        readonly property color overlayDarkest: Qt.rgba(0, 0, 0, 0.8)
        readonly property color accentMedium: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.15)
        readonly property color accentFill: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.25)
        readonly property color accentSelection: Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.3)
        readonly property color purple: "#7c3aed"
        readonly property color purpleSoft: Qt.rgba(122 / 255, 58 / 255, 237 / 255, 0.10)
        readonly property color glass: Qt.rgba(1, 1, 1, 0.04)
        readonly property color glassHover: Qt.rgba(1, 1, 1, 0.08)
        readonly property color glassBorder: Qt.rgba(1, 1, 1, 0.06)
        readonly property color danger: "#ef4444"
        readonly property color dangerBg: Qt.rgba(239 / 255, 68 / 255, 68 / 255, 0.1)
        readonly property color dangerBorder: Qt.rgba(239 / 255, 68 / 255, 68 / 255, 0.2)
        readonly property color dangerLight: "#fca5a5"
        readonly property color online: "#22c55e"
        readonly property color ownBubbleStart: Qt.rgba(45 / 255, 90 / 255, 138 / 255, 0.55)
        readonly property color ownBubbleEnd: Qt.rgba(56 / 255, 108 / 255, 158 / 255, 0.55)
        readonly property color titlebarBg: Qt.rgba(14 / 255, 14 / 255, 22 / 255, 0.85)
        readonly property color voicePanelBg: Qt.rgba(0, 0, 0, 0.15)
        // Windows 11 system icon font; falls back to the Win10 MDL2 set.
        readonly property string iconFont: "Segoe Fluent Icons"
    }

    // ---- Connection state -----------------------------------------------
    readonly property bool connected: backend.status === "connected"
    readonly property bool connecting: backend.status === "connecting"
    readonly property string connectError: {
        const s = backend.status
        if (s.indexOf("error:") === 0) return s.substring(6).trim()
        if (s.indexOf("rejected:") === 0) return s.substring(9).trim()
        return ""
    }
    property string selfName: ""
    property string selfHost: ""
    property bool voiceOn: false
    onConnectedChanged: if (!connected) voiceOn = false

    readonly property var channels: {
        try {
            return JSON.parse(backend.channels_json || "[]")
        } catch (e) {
            return []
        }
    }
    // "Hide empty channels" (web client's channelVisibility.ts option) is
    // applied per-delegate (visible/height) rather than by swapping the
    // ListView model: toggling then just flips a boolean on the already-
    // instantiated rows instead of destroying and rebuilding every channel
    // delegate (and its per-user Repeater), which was the toggle's CPU cost.
    readonly property var currentChannel: {
        for (let i = 0; i < channels.length; ++i)
            if (channels[i].id === backend.self_channel) return channels[i]
        return null
    }

    // ---- Saved servers (shared servers.json, same file as the full
    // client - see src/store.rs) ------------------------------------------
    property string serverSearch: ""
    property bool showAddForm: false
    readonly property var savedServers: {
        try {
            return JSON.parse(backend.saved_servers_json || "[]")
        } catch (e) {
            return []
        }
    }
    readonly property bool hasSavedServers: savedServers.length > 0
    // The add/quick-connect form shows when requested or nothing is saved yet.
    readonly property bool formVisible: showAddForm || !hasSavedServers
    // Favourites first (stable within groups: stored order is newest-first).
    readonly property var serverListModel: {
        let list = savedServers.slice()
        const q = serverSearch.trim().toLowerCase()
        if (q.length > 0) {
            list = list.filter(s => (s.label || "").toLowerCase().includes(q)
                                 || (s.host || "").toLowerCase().includes(q)
                                 || (s.username || "").toLowerCase().includes(q))
        }
        list.sort((a, b) => (b.favorite === true) - (a.favorite === true))
        return list
    }

    // ---- Pending image attachments (ChatView pendingAttachments +
    // useDragDropAttachments; staged via drag-drop, the attach button or
    // Ctrl+V, reviewed in the strip above the composer, sent as one
    // gallery captioned by the current draft) --------------------------
    property var pendingAttachments: []   // [{id, path, name}]
    property string galleryQuality: "full" // "full" | "compressed"
    property int attachSeq: 0

    // ---- Sidebar state (ChannelSidebar: search + Channels/Members tabs) --
    property string sidebarTab: "channels"
    readonly property string sidebarQuery: sidebarSearchInput.text.trim().toLowerCase()
    // Every connected user across all channels, for the Members tab
    // (sorted by name, filtered by the sidebar search).
    readonly property var allMembers: {
        let list = []
        for (let i = 0; i < channels.length; ++i)
            for (let j = 0; j < channels[i].users.length; ++j) {
                const u = channels[i].users[j]
                if (sidebarQuery.length === 0
                        || u.name.toLowerCase().includes(sidebarQuery))
                    list.push({ user: u, channelName: channels[i].name })
            }
        list.sort((a, b) => a.user.name.localeCompare(b.user.name))
        return list
    }

    // IMAGE_EXTS from the web client's useDragDropAttachments.
    readonly property var imageExts:
        ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"]

    function fileNameOf(path) {
        const parts = path.split(/[\\/]/)
        return parts[parts.length - 1] || path
    }

    function isImageName(name) {
        const dot = name.lastIndexOf(".")
        const ext = dot >= 0 ? name.substring(dot + 1).toLowerCase() : ""
        return imageExts.indexOf(ext) >= 0
    }

    /// Stage local image files for the next gallery message; non-images
    /// get a system pill (this client has no file-share flow).
    function stageImagePaths(paths) {
        const list = pendingAttachments.slice()
        for (let i = 0; i < paths.length; ++i) {
            const name = fileNameOf(paths[i])
            if (!isImageName(name)) {
                chatModel.insert(0, { kind: "log", sender: "",
                                      body: "Cannot share " + name,
                                      time: "", own: false, images: "[]" })
                continue
            }
            list.push({ id: ++attachSeq, path: paths[i], name: name })
        }
        pendingAttachments = list
    }

    /// Stage dropped/picked file URLs ("file:///C:/...").
    function stageFileUrls(urls) {
        const paths = []
        for (let i = 0; i < urls.length; ++i) {
            const u = urls[i].toString()
            if (u.indexOf("file:///") === 0)
                paths.push(decodeURIComponent(u.substring(8)))
        }
        if (paths.length > 0)
            stageImagePaths(paths)
    }

    function removeAttachment(id) {
        pendingAttachments = pendingAttachments.filter(a => a.id !== id)
    }

    // Same palette + hash as ui/src/utils/format.ts colorFor().
    function colorFor(name) {
        const palette = ["#2AABEE", "#7c3aed", "#22c55e", "#f59e0b", "#ef4444", "#ec4899"]
        let hash = 0
        for (let i = 0; i < name.length; ++i)
            hash = name.codePointAt(i) + ((hash << 5) - hash)
        return palette[Math.abs(hash) % palette.length]
    }

    function initial(name) {
        return name && name.length > 0 ? name[0].toUpperCase() : "?"
    }

    /// Look up a connected user's member object (from the channels JSON)
    /// by display name; null when not found.
    function findUser(name) {
        for (let i = 0; i < channels.length; ++i) {
            const users = channels[i].users
            for (let j = 0; j < users.length; ++j)
                if (users[j].name === name)
                    return users[j]
        }
        return null
    }

    /// Show the profile name card for `userObj` next to `item` after the
    /// web front-end's 250ms hover delay (useHoverCardPosition).
    function hoverNameCard(userObj, item) {
        if (!userObj)
            return
        const pt = item.mapToItem(mainView, item.width, item.height / 2)
        nameCardTimer.pendingUser = userObj
        nameCardTimer.pendingX = pt.x + 8
        nameCardTimer.pendingY = pt.y
        nameCardTimer.restart()
        // Fetch online/idle stats for the card's activity pills; the
        // answer lands via onUser_stats below.
        if (connected && userObj.session !== undefined)
            backend.request_user_stats(userObj.session)
    }

    function unhoverNameCard() {
        nameCardTimer.stop()
        nameCard.visible = false
    }

    function toggleMaximize() {
        if (window.visibility === Window.Maximized)
            window.showNormal()
        else
            window.showMaximized()
    }

    // ---- Reusable pieces ------------------------------------------------

    // BrandLogo.module.css: rounded gradient square (135deg blue->purple)
    // with a centred "M".
    component BrandMark: Item {
        property real size: 64
        width: size
        height: size
        Canvas {
            anchors.fill: parent
            onPaint: {
                const ctx = getContext("2d")
                ctx.reset()
                const g = ctx.createLinearGradient(0, 0, width, height)
                g.addColorStop(0, "#2aabee")
                g.addColorStop(1, "#7c3aed")
                ctx.fillStyle = g
                ctx.beginPath()
                ctx.roundedRect(0, 0, width, height, width * 0.25, width * 0.25)
                ctx.fill()
            }
        }
        Text {
            anchors.centerIn: parent
            anchors.verticalCenterOffset: parent.size * 0.03
            text: "M"
            color: "#ffffff"
            font.bold: true
            font.pixelSize: Math.round(parent.size * 0.5)
        }
    }

    // ConnectPage.module.css .input / ChatView .composerInput
    component GlassField: TextField {
        property real fieldRadius: 12
        font.pixelSize: 14
        color: theme.textPrimary
        placeholderTextColor: theme.textMuted
        selectionColor: theme.accentSelection
        selectedTextColor: theme.textPrimary
        leftPadding: 16
        rightPadding: 16
        topPadding: 12
        bottomPadding: 12
        background: Rectangle {
            radius: parent.fieldRadius
            color: parent.activeFocus ? theme.glassHover : theme.glass
            border.width: 1
            border.color: parent.activeFocus ? theme.accent : theme.glassBorder
        }
    }

    // Titlebar window-control button (TitleBar.module.css .controlBtn)
    component TitleButton: Rectangle {
        id: tbtn
        property string glyph
        property bool isClose: false
        signal activated
        width: 46
        height: 32
        color: tbtnMouse.containsMouse
               ? (isClose ? theme.danger : Qt.rgba(1, 1, 1, 0.05))
               : "transparent"
        Text {
            anchors.centerIn: parent
            text: tbtn.glyph
            font.family: theme.iconFont
            font.pixelSize: 10
            color: tbtnMouse.containsMouse ? theme.textPrimary : theme.textSecondary
        }
        MouseArea {
            id: tbtnMouse
            anchors.fill: parent
            hoverEnabled: true
            onClicked: tbtn.activated()
        }
    }

    // Form label (ConnectPage.module.css .label)
    component FieldLabel: Text {
        color: theme.textSecondary
        font.pixelSize: 13
        font.weight: Font.Medium
    }

    // 36x36 glass icon button (ChannelSidebar.module.css .voiceToggle)
    component SidebarButton: Rectangle {
        id: sbtn
        property string glyph
        property color glyphColor: theme.textSecondary
        property color bgColor: theme.glass
        property color borderColor: theme.glassBorder
        signal activated
        Layout.preferredWidth: 36
        Layout.preferredHeight: 36
        radius: 8
        color: sbtnMouse.containsMouse ? theme.glassHover : bgColor
        border.width: 1
        border.color: borderColor
        Text {
            anchors.centerIn: parent
            text: sbtn.glyph
            font.family: theme.iconFont
            font.pixelSize: 14
            color: sbtn.glyphColor
        }
        MouseArea {
            id: sbtnMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: sbtn.activated()
        }
    }

    // Colored initial disc; shows the user's avatar image instead when a
    // spilled texture file URL is provided (UserListItem parity). Decode is
    // capped to the disc size - avatars obey the RAM budget like chat images.
    component CircleAvatar: Rectangle {
        id: circleAvatar
        property string name
        property string source: ""
        property real size: 28
        width: size
        height: size
        radius: size / 2
        color: colorFor(name)
        Text {
            anchors.centerIn: parent
            visible: circleAvatar.source.length === 0
            text: initial(parent.name)
            color: "#ffffff"
            font.weight: Font.DemiBold
            font.pixelSize: Math.max(9, Math.round(parent.size * 0.42))
        }
        RoundedImage {
            anchors.fill: parent
            visible: circleAvatar.source.length > 0
            source: circleAvatar.source
            fillMode: Image.PreserveAspectCrop
            cornerRadius: circleAvatar.radius
            decodeCap: Qt.size(Math.round(circleAvatar.size * 2),
                               Math.round(circleAvatar.size * 2))
        }
    }

    // Image with rounded corners (QML Image has no radius; mask it like the
    // CSS border-radius on .thumb / .pendingAttachImg). The mask item must
    // be a sibling layer for MultiEffect to sample it as a texture.
    //
    // RAM: chat images live on disk (Rust spills them; the model only holds
    // file paths) and are decoded here only while this item exists - i.e.
    // while the message is on screen. `decodeCap` bounds the decoded texture
    // to the displayed size (aspect ratio is preserved for the Fit/Crop fill
    // modes) and `cache: false` keeps them out of the global pixmap cache.
    component RoundedImage: Item {
        id: rimg
        property alias source: rimgImage.source
        property alias fillMode: rimgImage.fillMode
        property alias status: rimgImage.status
        property alias implicitImageWidth: rimgImage.implicitWidth
        property alias implicitImageHeight: rimgImage.implicitHeight
        property alias decodeCap: rimgImage.sourceSize
        property real cornerRadius: 8
        Image {
            id: rimgImage
            anchors.fill: parent
            asynchronous: true
            autoTransform: true
            cache: false
            layer.enabled: true
            layer.effect: MultiEffect {
                maskEnabled: true
                maskSource: rimgMask
                maskThresholdMin: 0.5
                maskSpreadAtMin: 1.0
            }
        }
        Item {
            id: rimgMask
            anchors.fill: parent
            layer.enabled: true
            visible: false
            Rectangle {
                anchors.fill: parent
                radius: rimg.cornerRadius
                color: "#000000"
            }
        }
    }

    // ---- App background (global.css .app gradient + glows) --------------
    Canvas {
        id: bgCanvas
        anchors.fill: parent
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const w = width, h = height
            const lin = ctx.createLinearGradient(0, 0, w, h)
            lin.addColorStop(0, "#0e0e16")
            lin.addColorStop(0.5, "#1a1a2e")
            lin.addColorStop(1, "#16213e")
            ctx.fillStyle = lin
            ctx.fillRect(0, 0, w, h)
            let g = ctx.createRadialGradient(w + 100, -200, 0, w + 100, -200, 600)
            g.addColorStop(0, "rgba(42,171,238,0.15)")
            g.addColorStop(0.7, "rgba(42,171,238,0)")
            g.addColorStop(1, "rgba(42,171,238,0)")
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
            g = ctx.createRadialGradient(-100, h + 150, 0, -100, h + 150, 500)
            g.addColorStop(0, "rgba(124,58,237,0.15)")
            g.addColorStop(0.7, "rgba(124,58,237,0)")
            g.addColorStop(1, "rgba(124,58,237,0)")
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
        }
    }

    // ---- Titlebar (TitleBar.module.css, 40px) ---------------------------
    Rectangle {
        id: titleBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: 40
        color: theme.titlebarBg

        MouseArea {
            anchors.fill: parent
            onPressed: window.startSystemMove()
            onDoubleClicked: toggleMaximize()
        }

        Row {
            anchors.left: parent.left
            anchors.leftMargin: 16
            anchors.verticalCenter: parent.verticalCenter
            spacing: 12
            BrandMark {
                size: 20
                anchors.verticalCenter: parent.verticalCenter
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: backend.t("common.brand")
                color: theme.textPrimary
                font.pixelSize: 13
                font.weight: Font.DemiBold
                font.letterSpacing: -0.13
            }
        }

        Row {
            anchors.right: parent.right
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            spacing: 1

            TitleButton { glyph: ""; onActivated: window.showMinimized() }
            TitleButton {
                glyph: window.visibility === Window.Maximized ? "" : ""
                onActivated: toggleMaximize()
            }
            TitleButton { glyph: ""; isClose: true; onActivated: window.close() }
        }

        Rectangle {
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            height: 1
            color: theme.glassBorder
        }
    }

    // =====================================================================
    // Connect page (ConnectPage.module.css)
    // =====================================================================
    Item {
        anchors.top: titleBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: !connected

        Rectangle {
            id: connectCard
            anchors.centerIn: parent
            width: Math.min(400, parent.width - 48)
            height: cardColumn.height + 80 // 40px vertical padding
            radius: 20
            color: theme.glass
            border.width: 1
            border.color: theme.glassBorder

            Column {
                id: cardColumn
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width - 64 // 32px horizontal padding
                spacing: 16

                // Logo block
                Column {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 0
                    bottomPadding: 16
                    BrandMark {
                        size: 64
                        anchors.horizontalCenter: parent.horizontalCenter
                    }
                    Item { width: 1; height: 16 }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: backend.t("common.brand")
                        color: theme.textPrimary
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.48
                    }
                    Item { width: 1; height: 4 }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: backend.t("server.chooseServer")
                        color: theme.textSecondary
                        font.pixelSize: 14
                    }
                }

                // Error banner
                Rectangle {
                    width: parent.width
                    visible: connectError !== ""
                    height: visible ? errorRow.height + 24 : 0
                    radius: 12
                    color: theme.dangerBg
                    border.width: 1
                    border.color: theme.dangerBorder
                    Row {
                        id: errorRow
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: 16
                        anchors.rightMargin: 16
                        spacing: 10
                        Rectangle {
                            width: 20
                            height: 20
                            radius: 10
                            color: theme.danger
                            anchors.verticalCenter: parent.verticalCenter
                            Text {
                                anchors.centerIn: parent
                                text: "!"
                                color: "#ffffff"
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }
                        Text {
                            width: parent.width - 30
                            anchors.verticalCenter: parent.verticalCenter
                            text: connectError
                            color: theme.dangerLight
                            font.pixelSize: 13
                            wrapMode: Text.Wrap
                        }
                    }
                }

                // ---- Saved servers (ConnectPage parity) -----------------
                Column {
                    width: parent.width
                    spacing: 10
                    visible: !window.formVisible

                    Item {
                        width: parent.width
                        height: 20
                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            text: backend.t("server.list.heading")
                            color: theme.textMuted
                            font.pixelSize: 11
                            font.weight: Font.DemiBold
                            font.capitalization: Font.AllUppercase
                            font.letterSpacing: 0.55
                        }
                        Text {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            text: backend.t("server.list.addServer")
                            color: addServerMouse.containsMouse ? theme.accentHover : theme.accent
                            font.pixelSize: 12
                            font.weight: Font.Medium
                            MouseArea {
                                id: addServerMouse
                                anchors.fill: parent
                                anchors.margins: -4
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: window.showAddForm = true
                            }
                        }
                    }

                    GlassField {
                        width: parent.width
                        placeholderText: backend.t("server.list.searchPlaceholder")
                        onTextChanged: window.serverSearch = text
                    }

                    ListView {
                        id: savedList
                        width: parent.width
                        height: Math.min(contentHeight, 288)
                        clip: true
                        spacing: 8
                        model: window.serverListModel

                        delegate: Rectangle {
                            id: serverRow
                            required property var modelData
                            width: savedList.width
                            height: 56
                            radius: 12
                            color: rowMouse.containsMouse ? theme.glassHover : theme.glass
                            border.width: 1
                            border.color: theme.glassBorder

                            MouseArea {
                                id: rowMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                enabled: !connecting
                                onClicked: {
                                    window.selfName = serverRow.modelData.username
                                    window.selfHost = serverRow.modelData.host
                                    backend.connect_saved(serverRow.modelData.id)
                                }
                            }

                            Row {
                                anchors.left: parent.left
                                anchors.leftMargin: 10
                                anchors.right: favStar.left
                                anchors.rightMargin: 8
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 10
                                Rectangle {
                                    width: 36
                                    height: 36
                                    radius: 10
                                    anchors.verticalCenter: parent.verticalCenter
                                    gradient: Gradient {
                                        GradientStop { position: 0; color: theme.accent }
                                        GradientStop { position: 1; color: theme.purple }
                                    }
                                    Text {
                                        anchors.centerIn: parent
                                        text: initial(serverRow.modelData.label || serverRow.modelData.host)
                                        color: "#ffffff"
                                        font.weight: Font.DemiBold
                                        font.pixelSize: 15
                                    }
                                }
                                Column {
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 1
                                    Text {
                                        text: serverRow.modelData.label || serverRow.modelData.host
                                        color: theme.textPrimary
                                        font.pixelSize: 14
                                        font.weight: Font.Medium
                                    }
                                    Text {
                                        text: serverRow.modelData.username || ""
                                        color: theme.textSecondary
                                        font.pixelSize: 12
                                    }
                                }
                            }

                            Text {
                                id: favStar
                                anchors.right: parent.right
                                anchors.rightMargin: 12
                                anchors.verticalCenter: parent.verticalCenter
                                text: serverRow.modelData.favorite ? "★" : "☆"
                                color: serverRow.modelData.favorite ? "#f59e0b"
                                       : (starMouse.containsMouse ? theme.textSecondary : theme.textMuted)
                                font.pixelSize: 16
                                ToolTip.visible: starMouse.containsMouse
                                ToolTip.delay: 500
                                ToolTip.text: serverRow.modelData.favorite
                                              ? backend.t("server.list.removeFromFavorites")
                                              : backend.t("server.list.addToFavorites")
                                MouseArea {
                                    id: starMouse
                                    anchors.fill: parent
                                    anchors.margins: -6
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: backend.toggle_favorite(serverRow.modelData.id)
                                }
                            }
                        }
                    }

                    Text {
                        visible: savedList.count === 0
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: backend.t("server.list.noMatch").replace("{{query}}", window.serverSearch)
                        color: theme.textMuted
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }

                    Text {
                        visible: connecting
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: backend.t("server.actions.connecting")
                        color: theme.textSecondary
                        font.pixelSize: 12
                    }
                }

                // ---- Add / quick-connect form ---------------------------
                Text {
                    visible: window.formVisible && window.hasSavedServers
                    text: "‹ " + backend.t("server.backToSavedServers")
                    color: backMouse.containsMouse ? theme.accentHover : theme.accent
                    font.pixelSize: 13
                    MouseArea {
                        id: backMouse
                        anchors.fill: parent
                        anchors.margins: -4
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: window.showAddForm = false
                    }
                }

                Column {
                    width: parent.width
                    spacing: 6
                    visible: window.formVisible
                    FieldLabel { text: backend.t("server.fields.label") }
                    GlassField {
                        id: labelField
                        width: parent.width
                        placeholderText: backend.t("server.fields.labelPlaceholderFallback")
                        enabled: !connecting
                    }
                }

                Column {
                    width: parent.width
                    spacing: 6
                    visible: window.formVisible
                    FieldLabel { text: backend.t("server.fields.host") }
                    GlassField {
                        id: hostField
                        width: parent.width
                        placeholderText: backend.t("server.fields.hostPlaceholder")
                        text: "localhost"
                        enabled: !connecting
                    }
                }

                Row {
                    width: parent.width
                    spacing: 16
                    visible: window.formVisible
                    Column {
                        width: 110
                        spacing: 6
                        FieldLabel { text: backend.t("server.fields.port") }
                        GlassField {
                            id: portField
                            width: parent.width
                            placeholderText: backend.default_port.toString()
                            text: backend.default_port.toString()
                            inputMethodHints: Qt.ImhDigitsOnly
                            enabled: !connecting
                        }
                    }
                    Column {
                        width: parent.width - 126
                        spacing: 6
                        FieldLabel { text: backend.t("server.fields.username") }
                        GlassField {
                            id: userField
                            width: parent.width
                            placeholderText: backend.t("server.fields.usernamePlaceholder")
                            enabled: !connecting
                        }
                    }
                }

                Column {
                    width: parent.width
                    spacing: 6
                    visible: window.formVisible
                    FieldLabel { text: backend.t("sidebar.channelEditor.passwordLabel") }
                    GlassField {
                        id: passField
                        width: parent.width
                        placeholderText: backend.t("server.edit.passwordPlaceholderEmpty")
                        echoMode: TextInput.Password
                        enabled: !connecting
                        onAccepted: connectRow.doConnect(false)
                    }
                }

                // Quick Connect (secondary) + Connect & Save (primary),
                // like the wizard's final step in the full client.
                Row {
                    id: connectRow
                    width: parent.width
                    spacing: 10
                    visible: window.formVisible

                    readonly property bool formValid: !connecting
                                                      && hostField.text.length > 0
                                                      && userField.text.length > 0

                    function doConnect(save) {
                        if (!formValid)
                            return
                        window.selfName = userField.text
                        window.selfHost = hostField.text
                        const port = parseInt(portField.text) || backend.default_port
                        if (save) {
                            const id = backend.save_server(labelField.text, hostField.text, port,
                                                           userField.text, passField.text,
                                                           passField.text.length > 0)
                            if (id !== "") {
                                window.showAddForm = false
                                backend.connect_saved(id)
                                return
                            }
                        }
                        backend.connect_to_server(hostField.text, port,
                                                  userField.text, passField.text)
                    }

                    Rectangle {
                        width: (parent.width - 10) / 2
                        height: 46
                        radius: 12
                        color: quickMouse.containsMouse ? theme.glassHover : theme.glass
                        border.width: 1
                        border.color: theme.glassBorder
                        opacity: connectRow.formValid ? 1 : 0.5
                        Text {
                            anchors.centerIn: parent
                            text: connecting ? backend.t("server.actions.connecting")
                                             : backend.t("server.actions.quickConnect")
                            color: theme.textPrimary
                            font.pixelSize: 14
                            font.weight: Font.Medium
                        }
                        MouseArea {
                            id: quickMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: connectRow.formValid ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: connectRow.doConnect(false)
                        }
                    }

                    Rectangle {
                        width: (parent.width - 10) / 2
                        height: 46
                        radius: 12
                        opacity: connectRow.formValid ? (saveMouse.containsMouse ? 0.9 : 1) : 0.5
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0; color: theme.accent }
                            GradientStop { position: 1; color: theme.accentHover }
                        }
                        Text {
                            anchors.centerIn: parent
                            text: connecting ? backend.t("server.actions.connecting")
                                             : backend.t("server.actions.connectAndSave")
                            color: "#ffffff"
                            font.pixelSize: 14
                            font.weight: Font.DemiBold
                        }
                        MouseArea {
                            id: saveMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: connectRow.formValid ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: connectRow.doConnect(true)
                        }
                    }
                }
            }
        }

        // Switch back to the full (Tauri) interface. Writes the shared
        // ui-mode marker and hands off to the FancyMumble binary; only
        // quits once the full client actually spawned.
        Column {
            anchors.top: connectCard.bottom
            anchors.topMargin: 16
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 6

            Text {
                id: fullModeLink
                anchors.horizontalCenter: parent.horizontalCenter
                text: backend.t("common.minimal.switchToFull")
                color: fullModeMouse.containsMouse ? theme.accent : theme.textMuted
                font.pixelSize: 12
                font.underline: fullModeMouse.containsMouse
                MouseArea {
                    id: fullModeMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        fullModeError.visible = false
                        if (backend.switch_to_full_mode())
                            Qt.quit()
                        else
                            fullModeError.visible = true
                    }
                }
            }

            Text {
                id: fullModeError
                visible: false
                anchors.horizontalCenter: parent.horizontalCenter
                text: backend.t("common.minimal.fullClientNotFound")
                color: theme.dangerLight
                font.pixelSize: 11
            }
        }
    }

    // =====================================================================
    // Main view: sidebar + chat (ChannelSidebar / ChatView .module.css)
    // =====================================================================
    Item {
        id: mainView
        anchors.top: titleBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: connected

        // ---- Profile name card (hover, .profilePopover behaviour) --------
        Timer {
            id: nameCardTimer
            interval: 250 // web useHoverCardPosition open delay
            property var pendingUser: null
            property real pendingX: 0
            property real pendingY: 0
            onTriggered: {
                nameCard.user = pendingUser
                nameCard.anchorX = pendingX
                nameCard.anchorY = pendingY
                nameCard.visible = true
            }
        }

        NameCard {
            id: nameCard
            visible: false
            z: 100
            // Anchor point: right edge / vertical centre of the hovered row;
            // clamped to the view with a 10px margin like the web card.
            property real anchorX: 0
            property real anchorY: 0
            x: Math.min(anchorX, mainView.width - width - 10)
            y: Math.max(10, Math.min(anchorY - height / 2,
                                     mainView.height - height - 10))
        }

        // ---- Sidebar (320px frosted glass) ------------------------------
        Rectangle {
            id: sidebar
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            width: 320
            color: theme.glass

            ColumnLayout {
                anchors.fill: parent
                spacing: 0

                // Header (.header / .searchBar): magnifier + input + Ctrl+K
                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 62
                    Rectangle {
                        id: sidebarSearchBar
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.leftMargin: 16
                        anchors.rightMargin: 16
                        anchors.topMargin: 14
                        height: 34
                        radius: 10
                        color: sidebarSearchInput.activeFocus ? theme.glassHover : theme.glass
                        border.width: 1
                        border.color: sidebarSearchInput.activeFocus
                                      ? theme.accentSelection : theme.glassBorder
                        Row {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.right: searchRightSlot.left
                            anchors.rightMargin: 6
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 8
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "\uE721" // magnifier glyph
                                font.family: theme.iconFont
                                font.pixelSize: 12
                                color: theme.textMuted
                            }
                            TextInput {
                                id: sidebarSearchInput
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 24
                                font.pixelSize: 13
                                color: theme.textPrimary
                                selectionColor: theme.accentSelection
                                selectedTextColor: theme.textPrimary
                                clip: true
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    visible: sidebarSearchInput.text.length === 0
                                    text: backend.t("sidebar.channelSidebar.searchPlaceholder")
                                    color: theme.textMuted
                                    font.pixelSize: 13
                                }
                                Keys.onEscapePressed: {
                                    text = ""
                                    focus = false
                                }
                            }
                        }
                        // Ctrl+K chip (.searchShortcut) or clear button
                        Item {
                            id: searchRightSlot
                            anchors.right: parent.right
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            width: searchChip.visible ? searchChip.width : 16
                            height: parent.height
                            Rectangle {
                                id: searchChip
                                visible: sidebarSearchInput.text.length === 0
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.right: parent.right
                                width: chipLabel.width + 10
                                height: 18
                                radius: 4
                                color: theme.glass
                                border.width: 1
                                border.color: theme.glassBorder
                                Text {
                                    id: chipLabel
                                    anchors.centerIn: parent
                                    text: "Ctrl+K"
                                    color: theme.textMuted
                                    font.pixelSize: 10
                                }
                            }
                            Text {
                                visible: !searchChip.visible
                                anchors.centerIn: parent
                                text: "\uE711" // close glyph
                                font.family: theme.iconFont
                                font.pixelSize: 9
                                color: searchClearMouse.containsMouse
                                       ? theme.textPrimary : theme.textMuted
                                MouseArea {
                                    id: searchClearMouse
                                    anchors.fill: parent
                                    anchors.margins: -5
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: sidebarSearchInput.text = ""
                                }
                            }
                        }
                    }
                    Shortcut {
                        sequence: "Ctrl+K"
                        enabled: connected
                        onActivated: sidebarSearchInput.forceActiveFocus()
                    }
                    Rectangle {
                        anchors.bottom: parent.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: theme.glassBorder
                    }
                }

                // Tabs (SidebarTabs): Channels | Members, accent underline
                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 38
                    Row {
                        anchors.fill: parent
                        Repeater {
                            model: [
                                { key: "channels", label: backend.t("sidebar.sidebarTabs.channels") },
                                { key: "members", label: backend.t("sidebar.sidebarTabs.members") }
                            ]
                            delegate: Item {
                                id: sidebarTabItem
                                required property var modelData
                                readonly property bool active:
                                    window.sidebarTab === modelData.key
                                width: parent.width / 2
                                height: parent.height
                                Text {
                                    anchors.centerIn: parent
                                    text: sidebarTabItem.modelData.label
                                    color: sidebarTabItem.active
                                           ? theme.textPrimary : theme.textSecondary
                                    font.pixelSize: 13
                                    font.weight: sidebarTabItem.active
                                                 ? Font.DemiBold : Font.Normal
                                }
                                Rectangle {
                                    anchors.bottom: parent.bottom
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    width: parent.width * 0.6
                                    height: 2
                                    color: sidebarTabItem.active ? theme.accent : "transparent"
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: window.sidebarTab = sidebarTabItem.modelData.key
                                }
                            }
                        }
                    }
                    Rectangle {
                        anchors.bottom: parent.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: theme.glassBorder
                    }
                }

                // Section header (.sectionHeaderBar): chevron + CHANNELS +
                // hide-empty toggle (users-group icon, like the web action)
                RowLayout {
                    visible: window.sidebarTab === "channels"
                    Layout.fillWidth: true
                    Layout.leftMargin: 12
                    Layout.rightMargin: 12
                    Layout.topMargin: 10
                    Layout.bottomMargin: 4
                    spacing: 6
                    Text {
                        text: "\uE76C" // chevron glyph (expanded)
                        rotation: 90
                        font.family: theme.iconFont
                        font.pixelSize: 9
                        color: theme.textMuted
                    }
                    Text {
                        Layout.fillWidth: true
                        text: backend.t("sidebar.channelSidebar.channels")
                        color: theme.textMuted
                        font.pixelSize: 11
                        font.weight: Font.DemiBold
                        font.capitalization: Font.AllUppercase
                        font.letterSpacing: 0.55
                    }
                    Text {
                        id: hideEmptyBtn
                        text: "" // people (hide-empty toggle) glyph
                        font.family: theme.iconFont
                        font.pixelSize: 12
                        color: backend.hide_empty_channels ? theme.accent : theme.textMuted
                        ToolTip.visible: hideEmptyMouse.containsMouse
                        ToolTip.delay: 500
                        ToolTip.text: backend.hide_empty_channels
                                      ? backend.t("sidebar.channelSidebar.showAllChannels")
                                      : backend.t("sidebar.channelSidebar.hideEmptyChannels")
                        MouseArea {
                            id: hideEmptyMouse
                            anchors.fill: parent
                            anchors.margins: -4 // easier hit target
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: backend.persist_hide_empty_channels(!backend.hide_empty_channels)
                        }
                    }
                }

                // Flat channel list (ModernChannelList.module.css)
                ListView {
                    id: channelList
                    visible: window.sidebarTab === "channels"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.leftMargin: 8
                    Layout.rightMargin: 8
                    clip: true
                    // Row gap lives in the delegate height (+2 when shown, 0
                    // when hidden) so hidden empty channels leave no gap.
                    spacing: 0
                    // Stable model: filtering is done per-delegate below, so
                    // toggling hide-empty never resets the list.
                    model: channels

                    delegate: Rectangle {
                        id: channelCard
                        required property var modelData
                        readonly property bool isCurrent: modelData.id === backend.self_channel
                        // Sidebar search: match the channel name or any
                        // member name (SidebarSearchView behaviour, inline).
                        readonly property bool searchMatch: {
                            if (window.sidebarQuery.length === 0)
                                return true
                            if (modelData.name.toLowerCase().includes(window.sidebarQuery))
                                return true
                            for (let i = 0; i < modelData.users.length; ++i)
                                if (modelData.users[i].name.toLowerCase()
                                        .includes(window.sidebarQuery))
                                    return true
                            return false
                        }
                        // Hide-empty: drop memberless channels, but always keep
                        // the channel we're in. Collapses to height 0 so the row
                        // takes no space and no inter-row gap.
                        readonly property bool rowVisible: window.sidebarQuery.length > 0
                                                           ? searchMatch
                                                           : (!backend.hide_empty_channels
                                                              || modelData.users.length > 0
                                                              || isCurrent)
                        width: channelList.width
                        visible: rowVisible
                        height: rowVisible ? cardCol.height + 2 : 0
                        radius: 12
                        border.width: 1
                        border.color: isCurrent ? theme.accentFill : "transparent"
                        color: !isCurrent && cardMouse.containsMouse
                               ? theme.glassHover : "transparent"
                        // .channelCard.current gradient (accent -> purple)
                        Rectangle {
                            anchors.fill: parent
                            radius: parent.radius
                            visible: channelCard.isCurrent
                            gradient: Gradient {
                                GradientStop { position: 0; color: theme.accentMedium }
                                GradientStop { position: 1; color: theme.purpleSoft }
                            }
                            z: -1
                        }

                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: backend.join_channel(channelCard.modelData.id)
                        }

                        Column {
                            id: cardCol
                            width: parent.width

                            // .headerRow: chevron + name + member count pill
                            Item {
                                width: parent.width
                                height: 34
                                Row {
                                    anchors.left: parent.left
                                    anchors.leftMargin: 8
                                    anchors.right: countPill.left
                                    anchors.rightMargin: 6
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 6
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: "" // chevron, rotated = expanded
                                        rotation: 90
                                        font.family: theme.iconFont
                                        font.pixelSize: 10
                                        color: theme.textSecondary
                                        visible: channelCard.modelData.users.length > 0
                                    }
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: channelCard.modelData.name
                                        color: theme.textPrimary
                                        font.pixelSize: 14
                                        font.weight: Font.Medium
                                        elide: Text.ElideRight
                                        leftPadding: channelCard.modelData.depth * 10
                                    }
                                }
                                // .memberCount pill
                                Rectangle {
                                    id: countPill
                                    anchors.right: parent.right
                                    anchors.rightMargin: 8
                                    anchors.verticalCenter: parent.verticalCenter
                                    visible: channelCard.modelData.users.length > 0
                                    width: countText.width + 12
                                    height: 16
                                    radius: 10
                                    color: theme.glass
                                    Text {
                                        id: countText
                                        anchors.centerIn: parent
                                        text: channelCard.modelData.users.length
                                        color: theme.textMuted
                                        font.pixelSize: 11
                                    }
                                }
                            }

                            // .memberList (indented user rows)
                            Column {
                                width: parent.width
                                leftPadding: 30
                                rightPadding: 8
                                bottomPadding: channelCard.modelData.users.length > 0 ? 6 : 0
                                spacing: 1
                                Repeater {
                                    model: channelCard.modelData.users
                                    delegate: Rectangle {
                                        id: memberRow
                                        required property var modelData
                                        width: channelCard.width - 38
                                        height: 26
                                        radius: 8
                                        color: memberMouse.containsMouse
                                               ? theme.glassHover : "transparent"
                                        MouseArea {
                                            id: memberMouse
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            onContainsMouseChanged: {
                                                if (containsMouse)
                                                    hoverNameCard(memberRow.modelData, memberRow)
                                                else
                                                    unhoverNameCard()
                                            }
                                        }
                                        Row {
                                            anchors.left: parent.left
                                            anchors.leftMargin: 6
                                            anchors.right: memberIcons.left
                                            anchors.rightMargin: 6
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: 8
                                            CircleAvatar {
                                                name: memberRow.modelData.name
                                                source: memberRow.modelData.avatar || ""
                                                size: 20
                                                anchors.verticalCenter: parent.verticalCenter
                                            }
                                            Text {
                                                anchors.verticalCenter: parent.verticalCenter
                                                text: memberRow.modelData.name
                                                      + (memberRow.modelData.me
                                                         ? " " + backend.t("common.minimal.me") : "")
                                                color: theme.textPrimary
                                                font.pixelSize: 13
                                                elide: Text.ElideRight
                                            }
                                        }
                                        // .statusIcon: muted mic / deafened
                                        Row {
                                            id: memberIcons
                                            anchors.right: parent.right
                                            anchors.rightMargin: 8
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: 4
                                            Text {
                                                visible: memberRow.modelData.muted === true
                                                text: "\uEC54" // mic-off glyph
                                                font.family: theme.iconFont
                                                font.pixelSize: 11
                                                color: theme.textMuted
                                            }
                                            Text {
                                                visible: memberRow.modelData.deafened === true
                                                text: "\uE74F" // muted-speaker glyph
                                                font.family: theme.iconFont
                                                font.pixelSize: 11
                                                color: theme.textMuted
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Members tab (MembersTab): every connected user, searchable
                ListView {
                    visible: window.sidebarTab === "members"
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.leftMargin: 8
                    Layout.rightMargin: 8
                    Layout.topMargin: 8
                    clip: true
                    spacing: 1
                    model: window.sidebarTab === "members" ? window.allMembers : []
                    delegate: Rectangle {
                        id: memberTabRow
                        required property var modelData
                        width: ListView.view.width
                        height: 40
                        radius: 8
                        color: memberTabMouse.containsMouse ? theme.glassHover : "transparent"
                        MouseArea {
                            id: memberTabMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            onContainsMouseChanged: {
                                if (containsMouse)
                                    hoverNameCard(memberTabRow.modelData.user, memberTabRow)
                                else
                                    unhoverNameCard()
                            }
                        }
                        Row {
                            anchors.left: parent.left
                            anchors.leftMargin: 8
                            anchors.right: parent.right
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 10
                            CircleAvatar {
                                name: memberTabRow.modelData.user.name
                                source: memberTabRow.modelData.user.avatar || ""
                                size: 26
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 0
                                Text {
                                    text: memberTabRow.modelData.user.name
                                    color: theme.textPrimary
                                    font.pixelSize: 13
                                    font.weight: Font.Medium
                                }
                                Text {
                                    text: memberTabRow.modelData.channelName
                                    color: theme.textMuted
                                    font.pixelSize: 11
                                }
                            }
                        }
                    }
                }

                // Self user panel + action bar (.selfUserSection /
                // .voicePanel): avatar+dot, name + channel chip, mic state;
                // below: settings + red Disconnect (UserPanel parity).
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 104
                    color: theme.voicePanelBg
                    Rectangle {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: theme.glassBorder
                    }

                    RowLayout {
                        id: selfRow
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: 12
                        anchors.rightMargin: 12
                        height: 56
                        spacing: 8

                        Item {
                            Layout.preferredWidth: 32
                            Layout.preferredHeight: 32
                            CircleAvatar {
                                name: selfName
                                source: (findUser(selfName) || {}).avatar || ""
                                size: 30
                                anchors.centerIn: parent
                            }
                            // .onlineDot
                            Rectangle {
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                width: 10
                                height: 10
                                radius: 5
                                color: theme.online
                                border.width: 2
                                border.color: theme.bgPrimary
                            }
                        }

                        // Name + registered badge + current-channel chip
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 6
                            Text {
                                Layout.maximumWidth: 92
                                text: selfName
                                color: theme.textPrimary
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }
                            Text {
                                visible: (findUser(selfName) || {}).registered === true
                                text: "\uE73E" // shield-check badge
                                font.family: theme.iconFont
                                font.pixelSize: 10
                                color: "#3ba55d"
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.maximumWidth: chipText.implicitWidth + 16
                                visible: currentChannel !== null
                                height: 20
                                radius: 6
                                color: theme.accentMedium
                                border.width: 1
                                border.color: theme.accentFill
                                Text {
                                    id: chipText
                                    anchors.centerIn: parent
                                    width: Math.min(implicitWidth, parent.width - 12)
                                    text: currentChannel ? currentChannel.name : ""
                                    color: theme.textPrimary
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                }
                            }
                        }

                        // Mic toggle: red when muted, green when live
                        SidebarButton {
                            glyph: voiceOn ? "\uE720" : "\uEC54" // mic / mic-off
                            glyphColor: voiceOn ? theme.online : theme.danger
                            bgColor: voiceOn
                                     ? Qt.rgba(34 / 255, 197 / 255, 94 / 255, 0.12)
                                     : theme.dangerBg
                            borderColor: voiceOn
                                         ? Qt.rgba(34 / 255, 197 / 255, 94 / 255, 0.25)
                                         : theme.dangerBorder
                            onActivated: {
                                window.voiceOn = !window.voiceOn
                                backend.set_voice_enabled(window.voiceOn)
                            }
                        }
                    }

                    // Bottom action bar: settings + Disconnect pill
                    RowLayout {
                        anchors.top: selfRow.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: 12
                        anchors.rightMargin: 12
                        height: 44
                        spacing: 8

                        SidebarButton {
                            glyph: "\uE713" // gear (settings)
                            onActivated: settingsPage.open()
                        }
                        Item { Layout.fillWidth: true }
                        Rectangle {
                            Layout.preferredWidth: disconnectRow.width + 28
                            Layout.preferredHeight: 34
                            radius: 10
                            color: disconnectMouse.containsMouse ? theme.danger : theme.dangerBg
                            border.width: 1
                            border.color: theme.dangerBorder
                            Row {
                                id: disconnectRow
                                anchors.centerIn: parent
                                spacing: 6
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "\uE7E8" // power glyph
                                    font.family: theme.iconFont
                                    font.pixelSize: 12
                                    color: disconnectMouse.containsMouse
                                           ? "#ffffff" : theme.dangerLight
                                }
                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: backend.t("sidebar.channelSidebar.disconnect")
                                    color: disconnectMouse.containsMouse
                                           ? "#ffffff" : theme.dangerLight
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                }
                            }
                            MouseArea {
                                id: disconnectMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: backend.disconnect_from_server()
                            }
                        }
                    }
                }
            }

            // Sidebar right border
            Rectangle {
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 1
                color: theme.glassBorder
            }
        }

        // ---- Chat column -------------------------------------------------
        Item {
            id: chatColumn
            anchors.left: sidebar.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom

            // Native file drag-drop onto the chat stages images into the
            // pending-attachments tray (useDragDropAttachments).
            DropArea {
                id: chatDrop
                anchors.fill: parent
                enabled: connected
                onEntered: (drag) => {
                    if (!drag.hasUrls)
                        drag.accepted = false
                }
                onDropped: (drop) => {
                    if (drop.hasUrls) {
                        stageFileUrls(drop.urls)
                        drop.accept(Qt.CopyAction)
                    }
                }
            }

            // Header (.header: 16px 24px glass + border-bottom)
            Rectangle {
                id: chatHeader
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                height: headerInfo.height + 32
                color: theme.glass
                Column {
                    id: headerInfo
                    anchors.left: parent.left
                    anchors.leftMargin: 24
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Text {
                        text: currentChannel ? currentChannel.name : backend.t("common.brand")
                        color: theme.textPrimary
                        font.pixelSize: 16
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: currentChannel
                              ? backend.tr_n("sidebar.movePicker.member",
                                             currentChannel.users.length)
                              : ""
                        color: theme.textSecondary
                        font.pixelSize: 12
                    }
                }
                Rectangle {
                    anchors.bottom: parent.bottom
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: 1
                    color: theme.glassBorder
                }
            }

            // Messages (.messages: 16px 24px padding)
            ListView {
                id: chatView
                anchors.top: chatHeader.bottom
                anchors.bottom: pendingStrip.top
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: 24
                anchors.rightMargin: 24
                anchors.topMargin: 16
                anchors.bottomMargin: 16
                clip: true
                spacing: 10
                // Chat sticks to the bottom like the web UI (.messagesInner
                // margin-top:auto): index 0 renders at the bottom, so new
                // messages are inserted at 0.
                verticalLayoutDirection: ListView.BottomToTop
                model: ListModel { id: chatModel }
                onCountChanged: positionViewAtBeginning()

                delegate: Item {
                    id: msgRow
                    required property string kind
                    required property string sender
                    required property string body
                    required property string time
                    required property bool own
                    required property string images
                    readonly property var imageList: {
                        try {
                            return JSON.parse(images || "[]")
                        } catch (e) {
                            return []
                        }
                    }
                    readonly property bool hasText: body.trim().length > 0
                    // Pure-media messages lose the bubble chrome
                    // (.bubble.bubbleMedia: no padding/border/background).
                    readonly property bool mediaOnly: !hasText && imageList.length > 0
                    readonly property real maxBubbleWidth: chatView.width * 0.75 - 40

                    width: chatView.width
                    height: kind === "log" ? logPill.height : bubbleRow.height

                    // System/log lines styled like .dateDividerLabel pills.
                    Rectangle {
                        id: logPill
                        visible: msgRow.kind === "log"
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: logText.width + 24
                        height: logText.height + 8
                        radius: 12
                        color: theme.glassHover
                        border.width: 1
                        border.color: theme.glassBorder
                        Text {
                            id: logText
                            anchors.centerIn: parent
                            text: msgRow.kind === "log" ? msgRow.body : ""
                            color: theme.textSecondary
                            font.pixelSize: 11
                            font.weight: Font.DemiBold
                        }
                    }

                    Row {
                        id: bubbleRow
                        visible: msgRow.kind !== "log"
                        spacing: 8
                        layoutDirection: msgRow.own ? Qt.RightToLeft : Qt.LeftToRight
                        anchors.left: msgRow.own ? undefined : parent.left
                        anchors.right: msgRow.own ? parent.right : undefined

                        CircleAvatar {
                            id: senderAvatar
                            name: msgRow.sender
                            source: (findUser(msgRow.sender) || {}).avatar || ""
                            size: 32
                            visible: !msgRow.own
                            anchors.bottom: parent.bottom
                            MouseArea {
                                anchors.fill: parent
                                hoverEnabled: true
                                onContainsMouseChanged: {
                                    if (containsMouse)
                                        hoverNameCard(findUser(msgRow.sender), senderAvatar)
                                    else
                                        unhoverNameCard()
                                }
                            }
                        }

                        // .bubble / .ownBubble (.bubbleMedia drops the chrome)
                        Rectangle {
                            id: bubble
                            width: bubbleContent.width + (msgRow.mediaOnly ? 0 : 28)
                            height: bubbleContent.height + (msgRow.mediaOnly ? 0 : 16)
                            topLeftRadius: 12
                            topRightRadius: 12
                            bottomLeftRadius: msgRow.own ? 12 : 4
                            bottomRightRadius: msgRow.own ? 4 : 12
                            color: msgRow.own || msgRow.mediaOnly
                                   ? "transparent" : theme.glassHover
                            border.width: msgRow.own || msgRow.mediaOnly ? 0 : 1
                            border.color: theme.glassBorder
                            Rectangle {
                                anchors.fill: parent
                                visible: msgRow.own && !msgRow.mediaOnly
                                topLeftRadius: 12
                                topRightRadius: 12
                                bottomRightRadius: 4
                                bottomLeftRadius: 12
                                gradient: Gradient {
                                    GradientStop { position: 0; color: theme.ownBubbleStart }
                                    GradientStop { position: 1; color: theme.ownBubbleEnd }
                                }
                                z: -1
                            }

                            Column {
                                id: bubbleContent
                                x: msgRow.mediaOnly ? 0 : 14
                                y: msgRow.mediaOnly ? 0 : 8
                                spacing: 2
                                Text {
                                    visible: !msgRow.own
                                    text: msgRow.sender
                                    color: colorFor(msgRow.sender)
                                    font.pixelSize: 12
                                    font.weight: Font.DemiBold
                                }
                                Row {
                                    visible: msgRow.hasText
                                    spacing: 6
                                    Text {
                                        id: bodyText
                                        // Bodies arrive as HTML (see
                                        // sanitize_styled_text in Rust) so
                                        // **bold** etc. survive the round trip.
                                        text: msgRow.body
                                        color: theme.textPrimary
                                        font.pixelSize: 14
                                        lineHeight: 1.45
                                        wrapMode: Text.Wrap
                                        textFormat: Text.StyledText
                                        linkColor: theme.accent
                                        onLinkActivated: link => Qt.openUrlExternally(link)
                                        width: Math.min(implicitWidth, msgRow.maxBubbleWidth)
                                    }
                                    Text {
                                        anchors.bottom: bodyText.bottom
                                        text: msgRow.time
                                        color: msgRow.own
                                               ? Qt.rgba(1, 1, 1, 0.6) : theme.textSecondary
                                        opacity: msgRow.own ? 1 : 0.6
                                        font.pixelSize: 11
                                    }
                                }

                                // Inline media thumbnails (MediaPreview
                                // .mediaGrid / .thumbWrap: clickable, radius
                                // 8, capped at 320x240, hover scale)
                                Column {
                                    spacing: 6
                                    visible: msgRow.imageList.length > 0
                                    Repeater {
                                        model: msgRow.imageList
                                        delegate: Item {
                                            id: mediaThumb
                                            required property var modelData
                                            required property int index
                                            readonly property real natW: thumbImg.implicitImageWidth
                                            readonly property real natH: thumbImg.implicitImageHeight
                                            readonly property bool ready: thumbImg.status === Image.Ready
                                                                          && natW > 0 && natH > 0
                                            // max-width/max-height shrink to fit,
                                            // never upscale (CSS img semantics).
                                            readonly property real fitScale: ready
                                                ? Math.min(1, 320 / natW, 240 / natH,
                                                           msgRow.maxBubbleWidth / natW)
                                                : 1
                                            // .thumbPlaceholder is 160x120 while loading
                                            width: ready ? Math.max(1, Math.round(natW * fitScale)) : 160
                                            height: ready ? Math.max(1, Math.round(natH * fitScale)) : 120

                                            Rectangle {
                                                anchors.fill: parent
                                                radius: 8
                                                color: theme.glassHover
                                                visible: !mediaThumb.ready
                                            }
                                            RoundedImage {
                                                id: thumbImg
                                                anchors.fill: parent
                                                // The bubble only ever loads
                                                // the small thumbnail file;
                                                // the full image is decoded
                                                // by the lightbox on demand.
                                                source: mediaThumb.modelData.thumb
                                                fillMode: Image.PreserveAspectFit
                                                cornerRadius: 8
                                                // Thumbnails display at most
                                                // 320x240; decode at 2x for
                                                // hi-dpi, never full res.
                                                decodeCap: Qt.size(640, 480)
                                            }
                                            // .thumbWrap 1px glass border
                                            Rectangle {
                                                anchors.fill: parent
                                                radius: 8
                                                color: "transparent"
                                                border.width: 1
                                                border.color: theme.glassBorder
                                            }
                                            // .timeChip on pure-media messages
                                            Rectangle {
                                                visible: msgRow.mediaOnly
                                                         && mediaThumb.index === msgRow.imageList.length - 1
                                                anchors.right: parent.right
                                                anchors.bottom: parent.bottom
                                                anchors.margins: 6
                                                width: chipText.width + 14
                                                height: chipText.height + 4
                                                radius: 6
                                                color: Qt.rgba(0, 0, 0, 0.5)
                                                Text {
                                                    id: chipText
                                                    anchors.centerIn: parent
                                                    text: msgRow.time
                                                    color: Qt.rgba(1, 1, 1, 0.9)
                                                    font.pixelSize: 11
                                                    font.weight: Font.Medium
                                                }
                                            }

                                            scale: thumbMouse.containsMouse ? 1.03 : 1
                                            Behavior on scale { NumberAnimation { duration: 150 } }
                                            MouseArea {
                                                id: thumbMouse
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: lightbox.open(mediaThumb.modelData.full,
                                                                         msgRow.sender, msgRow.time)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

                // .empty state
                Column {
                    anchors.centerIn: chatView
                    visible: chatModel.count === 0
                    spacing: 12
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "" // chat glyph
                        font.family: theme.iconFont
                        font.pixelSize: 48
                        color: theme.textSecondary
                        opacity: 0.6
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: backend.t("chat.dmPopout.empty")
                        color: theme.textSecondary
                        font.pixelSize: 15
                    }
                }

            // Pending attachments preview above the composer
            // (.pendingAttachStrip: 8px 12px glass + border-top glass-hover)
            Rectangle {
                id: pendingStrip
                anchors.bottom: composer.top
                anchors.left: parent.left
                anchors.right: parent.right
                visible: window.pendingAttachments.length > 0
                height: visible
                        ? Math.max(attachFlow.implicitHeight, stripActions.height) + 16
                        : 0
                color: theme.glass
                Rectangle {
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: 1
                    color: theme.glassHover
                }

                // .pendingAttachItems (flex: 1, wrap, 8px gap)
                Flow {
                    id: attachFlow
                    anchors.left: parent.left
                    anchors.leftMargin: 12
                    anchors.right: stripActions.left
                    anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8

                    Repeater {
                        model: window.pendingAttachments

                        // .pendingAttachItem: thumb + meta + remove
                        delegate: Rectangle {
                            id: attachItem
                            required property var modelData
                            radius: 6
                            color: theme.glassBorder
                            width: Math.min(300, itemRow.width + 10)
                            height: 72
                            Row {
                                id: itemRow
                                x: 6 // padding: 4px 4px 4px 6px
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 8

                                // .pendingAttachThumb(Btn): 64px cover crop,
                                // click opens the shared lightbox preview
                                Item {
                                    width: 64
                                    height: 64
                                    anchors.verticalCenter: parent.verticalCenter
                                    Rectangle {
                                        anchors.fill: parent
                                        radius: 6
                                        color: theme.bgElevated
                                    }
                                    RoundedImage {
                                        anchors.fill: parent
                                        source: "file:///" + attachItem.modelData.path
                                        fillMode: Image.PreserveAspectCrop
                                        cornerRadius: 6
                                        // 64px thumb; decode at most 2x that.
                                        decodeCap: Qt.size(128, 128)
                                    }
                                    scale: thumbBtn.containsMouse ? 1.04 : 1
                                    Behavior on scale { NumberAnimation { duration: 120 } }
                                    MouseArea {
                                        id: thumbBtn
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: lightbox.open(
                                            "file:///" + attachItem.modelData.path,
                                            window.selfName, "")
                                    }
                                }

                                // .pendingAttachMeta: name + kind
                                Column {
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 2
                                    Text {
                                        text: attachItem.modelData.name
                                        color: theme.textPrimary
                                        font.pixelSize: 12
                                        font.weight: Font.DemiBold
                                        elide: Text.ElideRight
                                        width: Math.min(implicitWidth, 180)
                                    }
                                    Row {
                                        spacing: 4
                                        Text {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: "" // picture glyph
                                            font.family: theme.iconFont
                                            font.pixelSize: 11
                                            color: theme.textSecondary
                                        }
                                        Text {
                                            anchors.verticalCenter: parent.verticalCenter
                                            text: backend.t("chat.pendingAttachments.kindImage")
                                            color: theme.textSecondary
                                            font.pixelSize: 11
                                        }
                                    }
                                }

                                // .pendingAttachRemove: 24px X
                                Rectangle {
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: 24
                                    height: 24
                                    radius: 4
                                    color: removeMouse.containsMouse
                                           ? theme.glassHover : "transparent"
                                    Text {
                                        anchors.centerIn: parent
                                        text: "" // close glyph
                                        font.family: theme.iconFont
                                        font.pixelSize: 9
                                        color: removeMouse.containsMouse
                                               ? theme.textPrimary : theme.textSecondary
                                    }
                                    MouseArea {
                                        id: removeMouse
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: removeAttachment(attachItem.modelData.id)
                                    }
                                }
                            }
                        }
                    }
                }

                // .pendingAttachActions: quality toggle + send
                Row {
                    id: stripActions
                    anchors.right: parent.right
                    anchors.rightMargin: 12
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8

                    // .pendingAttachQuality segmented toggle
                    Rectangle {
                        anchors.verticalCenter: parent.verticalCenter
                        width: qualityRow.width
                        height: qualityRow.height
                        radius: 6
                        color: "transparent"
                        border.width: 1
                        border.color: theme.glassBorder
                        Row {
                            id: qualityRow
                            Repeater {
                                model: [
                                    { value: "full", key: "chat.pendingAttachments.qualityFull" },
                                    { value: "compressed", key: "chat.pendingAttachments.qualityCompressed" }
                                ]
                                delegate: Rectangle {
                                    id: qualityBtn
                                    required property var modelData
                                    readonly property bool active:
                                        window.galleryQuality === modelData.value
                                    width: qualityLabel.width + 20
                                    height: qualityLabel.height + 10
                                    radius: 5
                                    color: active ? theme.accent
                                         : qualityMouse.containsMouse
                                           ? theme.glassHover : "transparent"
                                    Text {
                                        id: qualityLabel
                                        anchors.centerIn: parent
                                        text: backend.t(qualityBtn.modelData.key)
                                        font.pixelSize: 11
                                        font.weight: Font.DemiBold
                                        color: qualityBtn.active || qualityMouse.containsMouse
                                               ? theme.textPrimary : theme.textSecondary
                                    }
                                    MouseArea {
                                        id: qualityMouse
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: window.galleryQuality = qualityBtn.modelData.value
                                    }
                                }
                            }
                        }
                    }

                    // .pendingAttachSend
                    Rectangle {
                        anchors.verticalCenter: parent.verticalCenter
                        width: stripSendRow.width + 24
                        height: stripSendRow.height + 12
                        radius: 6
                        color: stripSendMouse.containsMouse ? theme.glassHover : theme.accent
                        border.width: 1
                        border.color: theme.accentGlow
                        Row {
                            id: stripSendRow
                            anchors.centerIn: parent
                            spacing: 6
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "" // send glyph
                                font.family: theme.iconFont
                                font.pixelSize: 13
                                color: theme.textPrimary
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: backend.t("chat.pendingAttachments.send")
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                                color: theme.textPrimary
                            }
                        }
                        MouseArea {
                            id: stripSendMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: sendArea.send()
                        }
                    }
                }
            }

            // Composer (.composer: 12px 24px 16px glass + border-top)
            Rectangle {
                id: composer
                anchors.bottom: parent.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                height: messageField.implicitHeight + 28 // 12px top + 16px bottom
                color: theme.glass
                Rectangle {
                    anchors.top: parent.top
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: 1
                    color: theme.glassBorder
                }
                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 24
                    anchors.rightMargin: 24
                    anchors.topMargin: 12
                    anchors.bottomMargin: 16
                    spacing: 8

                    // .attachBtn: 40px glass circle opening the image picker
                    Rectangle {
                        Layout.preferredWidth: 40
                        Layout.preferredHeight: 40
                        Layout.alignment: Qt.AlignBottom
                        radius: 20
                        color: attachMouse.containsMouse ? theme.glassHover : theme.glass
                        border.width: 1
                        border.color: attachMouse.containsMouse
                                      ? theme.accentGlow : theme.glassBorder
                        Text {
                            anchors.centerIn: parent
                            text: "" // attach (paperclip)
                            font.family: theme.iconFont
                            font.pixelSize: 15
                            color: attachMouse.containsMouse
                                   ? theme.accent : theme.textSecondary
                        }
                        MouseArea {
                            id: attachMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: attachDialog.open()
                        }
                        ToolTip.visible: attachMouse.containsMouse
                        ToolTip.delay: 600
                        ToolTip.text: backend.t("chat.composer.attachTooltipImageOnly")
                    }

                    // WYSIWYG markdown input (live **bold** / *italic* /
                    // `code` decoration; Enter sends, Shift+Enter newline).
                    MarkdownField {
                        id: messageField
                        Layout.fillWidth: true
                        Layout.alignment: Qt.AlignBottom
                        placeholderText: backend.t("chat.composer.placeholderMobile")
                        onSubmitted: sendArea.send()
                        // Ctrl+V with an image on the clipboard stages it in
                        // the tray instead of pasting text (useChatSend
                        // handlePaste).
                        imagePasteHandler: () => {
                            const path = backend.paste_image_path()
                            if (path && path.length > 0) {
                                stageImagePaths([path])
                                return true
                            }
                            return false
                        }
                    }

                    // .sendBtn: 40px gradient circle
                    Rectangle {
                        Layout.preferredWidth: 40
                        Layout.preferredHeight: 40
                        Layout.alignment: Qt.AlignBottom
                        radius: 20
                        enabled: messageField.text.trim().length > 0
                                 || window.pendingAttachments.length > 0
                        opacity: enabled ? (sendArea.containsMouse ? 0.9 : 1) : 0.3
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0; color: theme.accent }
                            GradientStop { position: 1; color: theme.accentHover }
                        }
                        Text {
                            anchors.centerIn: parent
                            text: "" // send
                            font.family: theme.iconFont
                            font.pixelSize: 15
                            color: "#ffffff"
                        }
                        MouseArea {
                            id: sendArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: parent.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            function send() {
                                const text = messageField.text.trim()
                                // Staged images go out as one gallery with the
                                // draft as caption (sendPendingAttachments).
                                if (window.pendingAttachments.length > 0) {
                                    const paths = window.pendingAttachments.map(a => a.path)
                                    backend.send_images(JSON.stringify(paths), text,
                                                        window.galleryQuality === "compressed")
                                    window.pendingAttachments = []
                                    messageField.text = ""
                                    return
                                }
                                if (text.length === 0)
                                    return
                                backend.send_message(text)
                                messageField.text = ""
                            }
                            onClicked: send()
                        }
                    }
                }
            }

            // Image picker behind the attach button (same extensions the
            // drag-drop path accepts).
            FileDialog {
                id: attachDialog
                fileMode: FileDialog.OpenFiles
                nameFilters: [
                    "Images (*.png *.jpg *.jpeg *.gif *.webp *.avif *.bmp *.svg *.ico)"
                ]
                onAccepted: stageFileUrls(selectedFiles)
            }

            // Drag overlay shown while a file drag hovers the chat
            // (.dragOverlay / .dragOverlayInner)
            Item {
                anchors.fill: parent
                visible: chatDrop.containsDrag
                z: 50
                Rectangle {
                    anchors.fill: parent
                    color: Qt.rgba(0, 0, 0, 0.55)
                }
                Item {
                    anchors.centerIn: parent
                    width: dragHint.width + 64  // 32px padding each side
                    height: dragHint.height + 48 // 24px padding
                    // 2px dashed accent-glow border, 12px radius, glass fill
                    Canvas {
                        id: dragBorder
                        anchors.fill: parent
                        onWidthChanged: requestPaint()
                        onHeightChanged: requestPaint()
                        onPaint: {
                            const ctx = getContext("2d")
                            ctx.reset()
                            ctx.beginPath()
                            ctx.roundedRect(1, 1, width - 2, height - 2, 12, 12)
                            ctx.fillStyle = Qt.rgba(1, 1, 1, 0.04)
                            ctx.fill()
                            ctx.setLineDash([6, 4])
                            ctx.lineWidth = 2
                            ctx.strokeStyle = Qt.rgba(42 / 255, 171 / 255, 238 / 255, 0.3)
                            ctx.stroke()
                        }
                    }
                    Text {
                        id: dragHint
                        anchors.centerIn: parent
                        text: backend.t("chat.dragDrop.overlayHint")
                        color: theme.textPrimary
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                }
            }
        }
    }

    // ---- Settings page (SettingsPage.module.css parity) --------------------
    // Full-page view like the Tauri client: category sidebar (Back, search,
    // tabs) + content pane. Opened from the gear in the self-user panel;
    // the connect page keeps its inline "switch to full interface" link.
    Rectangle {
        id: settingsPage
        anchors.top: titleBar.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: false
        z: 150
        color: theme.bgPrimary

        property string selectedTab: "profile"
        property string tabSearch: ""
        // Local banner image staged for the next save: either the picked
        // file or the spilled copy of the current banner (path, no scheme).
        property string pendingBannerPath: ""

        readonly property var allTabs: [
            { key: "profile", label: backend.t("settings.tabs.profile"), glyph: "" },
            { key: "advanced", label: backend.t("settings.tabs.advanced"), glyph: "" }
        ]
        readonly property var visibleTabs: {
            const q = tabSearch.trim().toLowerCase()
            return q.length === 0
                   ? allTabs
                   : allTabs.filter(t => t.label.toLowerCase().includes(q))
        }

        /// Our own member object from the channels JSON (live profile).
        readonly property var me: findUser(selfName) || ({})

        function open() {
            // Prefill the profile form from the live profile.
            statusField.text = me.status || ""
            bannerColorField.text = safeSettingsColor(me.bannerColor)
            // Prefer the full-size spill so save round-trips don't
            // re-encode from the display thumbnail.
            const bannerUrl = me.bannerImageFull || me.bannerImage || ""
            pendingBannerPath = bannerUrl.indexOf("file:///") === 0
                                ? decodeURIComponent(bannerUrl.substring(8))
                                : ""
            // The bio arrives as StyledText HTML; edit it as plain text.
            bioField.text = (me.bio || "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]*>/g, "")
            selectedTab = "profile"
            visible = true
        }

        function safeSettingsColor(str) {
            return /^#[0-9a-fA-F]{3,8}$/.test(str || "") ? str : ""
        }

        /// Live preview object for the NameCard: the saved profile with
        /// the form's edits overlaid.
        readonly property var previewUser: !visible ? null : {
            name: selfName,
            session: -99,
            registered: me.registered === true,
            status: statusField.text,
            bio: bioField.text,
            bioImages: [],
            bannerColor: bannerColorField.text,
            bannerImage: pendingBannerPath.length > 0
                         ? "file:///" + pendingBannerPath.replace(/\\/g, "/") : "",
            avatar: me.avatar || "",
            nameColor: me.nameColor || "",
            nameBold: me.nameBold === true,
            nameItalic: me.nameItalic === true,
            nameGradient: me.nameGradient || [],
            nameGlowColor: me.nameGlowColor || "",
            nameGlowSize: me.nameGlowSize || 0,
            themeColors: me.themeColors || [],
            cardGlass: me.cardGlass === true,
            cardBackground: me.cardBackground || "",
            cardBackgroundCustom: me.cardBackgroundCustom || ""
        }

        // ---- Sidebar (.settingsSidebar) --------------------------------
        Rectangle {
            id: settingsSidebar
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            width: 200
            color: theme.glass

            Column {
                anchors.fill: parent
                anchors.margins: 12
                spacing: 10

                // Back
                Rectangle {
                    width: parent.width
                    height: 32
                    radius: 8
                    color: settingsBackMouse.containsMouse ? theme.glassHover : "transparent"
                    Row {
                        anchors.left: parent.left
                        anchors.leftMargin: 8
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 8
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "" // chevron-left glyph
                            font.family: theme.iconFont
                            font.pixelSize: 10
                            color: theme.textSecondary
                        }
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: backend.t("common.tabbedPage.back")
                            color: theme.textSecondary
                            font.pixelSize: 13
                        }
                    }
                    MouseArea {
                        id: settingsBackMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: settingsPage.visible = false
                    }
                }

                // "SETTINGS" heading
                Text {
                    leftPadding: 8
                    text: backend.t("common.minimal.settings").toUpperCase()
                    color: theme.textMuted
                    font.pixelSize: 11
                    font.weight: Font.DemiBold
                    font.letterSpacing: 0.55
                }

                // Search
                GlassField {
                    width: parent.width
                    fieldRadius: 8
                    font.pixelSize: 12
                    leftPadding: 10
                    rightPadding: 10
                    topPadding: 7
                    bottomPadding: 7
                    placeholderText: backend.t("common.minimal.settings") + "..."
                    onTextChanged: settingsPage.tabSearch = text
                }

                // Category list
                Repeater {
                    model: settingsPage.visibleTabs
                    delegate: Rectangle {
                        id: tabItem
                        required property var modelData
                        readonly property bool active:
                            settingsPage.selectedTab === modelData.key
                        width: parent.width
                        height: 36
                        radius: 8
                        color: active ? theme.accentMedium
                             : tabMouse.containsMouse ? theme.glassHover : "transparent"
                        Row {
                            anchors.left: parent.left
                            anchors.leftMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 10
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: tabItem.modelData.glyph
                                font.family: theme.iconFont
                                font.pixelSize: 14
                                color: tabItem.active ? theme.textPrimary : theme.textSecondary
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: tabItem.modelData.label
                                color: tabItem.active ? theme.textPrimary : theme.textSecondary
                                font.pixelSize: 13
                                font.weight: tabItem.active ? Font.DemiBold : Font.Normal
                            }
                        }
                        MouseArea {
                            id: tabMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: settingsPage.selectedTab = tabItem.modelData.key
                        }
                    }
                }
            }

            Rectangle {
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 1
                color: theme.glassBorder
            }
        }

        // ---- Profile tab (settings.profile.*) --------------------------
        Flickable {
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.left: settingsSidebar.right
            anchors.right: profilePreviewCol.left
            visible: settingsPage.selectedTab === "profile"
            contentHeight: profileCol.height + 80
            clip: true

            Column {
                id: profileCol
                x: 40
                y: 32
                width: Math.min(420, parent.width - 80)
                spacing: 18

                Text {
                    text: backend.t("settings.profile.panelTitle")
                    color: theme.textPrimary
                    font.pixelSize: 22
                    font.weight: Font.Bold
                }

                // -- Avatar ------------------------------------------
                Column {
                    width: parent.width
                    spacing: 6
                    Text {
                        text: backend.t("settings.profile.sectionAvatar")
                        color: theme.textPrimary
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: backend.t("settings.profile.avatarHint")
                        color: theme.textSecondary
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }
                    Row {
                        spacing: 12
                        topPadding: 6
                        CircleAvatar {
                            anchors.verticalCenter: parent.verticalCenter
                            name: selfName
                            source: settingsPage.me.avatar || ""
                            size: 56
                        }
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            width: editAvatarLabel.width + 32
                            height: 36
                            radius: 8
                            color: editAvatarMouse.containsMouse ? theme.glassHover : theme.glass
                            border.width: 1
                            border.color: theme.glassBorder
                            Text {
                                id: editAvatarLabel
                                anchors.centerIn: parent
                                text: backend.t("settings.profile.editAvatar")
                                color: theme.textPrimary
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                            }
                            MouseArea {
                                id: editAvatarMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: avatarDialog.open()
                            }
                        }
                    }
                }

                Rectangle { width: parent.width; height: 1; color: theme.glassBorder }

                // -- Banner ------------------------------------------
                Column {
                    width: parent.width
                    spacing: 6
                    Text {
                        text: backend.t("settings.profile.sectionBanner")
                        color: theme.textPrimary
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: backend.t("settings.profile.bannerHint")
                        color: theme.textSecondary
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }
                    Item {
                        width: parent.width
                        height: Math.round(width * 0.27)
                        Rectangle {
                            anchors.fill: parent
                            radius: 8
                            color: settingsPage.safeSettingsColor(bannerColorField.text) !== ""
                                   ? bannerColorField.text : "#1a1a2e"
                            border.width: 1
                            border.color: theme.glassBorder
                        }
                        RoundedImage {
                            anchors.fill: parent
                            visible: settingsPage.pendingBannerPath.length > 0
                            source: visible
                                    ? "file:///" + settingsPage.pendingBannerPath.replace(/\\/g, "/")
                                    : ""
                            fillMode: Image.PreserveAspectCrop
                            cornerRadius: 8
                            decodeCap: Qt.size(840, 300)
                        }
                    }
                    Row {
                        spacing: 8
                        topPadding: 6
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            width: editBannerLabel.width + 32
                            height: 36
                            radius: 8
                            color: editBannerMouse.containsMouse ? theme.glassHover : theme.glass
                            border.width: 1
                            border.color: theme.glassBorder
                            Text {
                                id: editBannerLabel
                                anchors.centerIn: parent
                                text: backend.t("settings.profile.editBanner")
                                color: theme.textPrimary
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                            }
                            MouseArea {
                                id: editBannerMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: bannerDialog.open()
                            }
                        }
                        GlassField {
                            id: bannerColorField
                            anchors.verticalCenter: parent.verticalCenter
                            width: 110
                            fieldRadius: 8
                            font.pixelSize: 12
                            leftPadding: 10
                            rightPadding: 10
                            topPadding: 8
                            bottomPadding: 8
                            placeholderText: backend.t("settings.bannerEditor.colorLabel")
                        }
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: settingsPage.pendingBannerPath.length > 0
                            text: backend.t("settings.bannerEditor.discardBtn")
                            color: bannerDiscardMouse.containsMouse
                                   ? theme.dangerLight : theme.textSecondary
                            font.pixelSize: 12
                            MouseArea {
                                id: bannerDiscardMouse
                                anchors.fill: parent
                                anchors.margins: -4
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: settingsPage.pendingBannerPath = ""
                            }
                        }
                    }
                }

                Rectangle { width: parent.width; height: 1; color: theme.glassBorder }

                // -- Status ------------------------------------------
                Column {
                    width: parent.width
                    spacing: 6
                    Text {
                        text: backend.t("settings.profile.sectionStatus")
                        color: theme.textPrimary
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: backend.t("settings.profile.statusHint")
                        color: theme.textSecondary
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }
                    GlassField {
                        id: statusField
                        width: parent.width
                        fieldRadius: 8
                        font.pixelSize: 13
                        placeholderText: backend.t("settings.profile.statusPlaceholder")
                    }
                }

                Rectangle { width: parent.width; height: 1; color: theme.glassBorder }

                // -- Bio ---------------------------------------------
                Column {
                    width: parent.width
                    spacing: 6
                    Text {
                        text: backend.t("settings.profile.sectionBio")
                        color: theme.textPrimary
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        width: parent.width
                        text: backend.t("settings.profile.bioHint")
                        color: theme.textSecondary
                        font.pixelSize: 12
                        wrapMode: Text.Wrap
                    }
                    Rectangle {
                        width: parent.width
                        height: 110
                        radius: 8
                        color: bioField.activeFocus ? theme.glassHover : theme.glass
                        border.width: 1
                        border.color: bioField.activeFocus ? theme.accent : theme.glassBorder
                        Flickable {
                            anchors.fill: parent
                            flickableDirection: Flickable.VerticalFlick
                            boundsBehavior: Flickable.StopAtBounds
                            clip: true
                            TextArea.flickable: TextArea {
                                id: bioField
                                wrapMode: TextArea.Wrap
                                font.pixelSize: 13
                                color: theme.textPrimary
                                placeholderText: backend.t("settings.profile.bioPlaceholder")
                                placeholderTextColor: theme.textMuted
                                selectionColor: theme.accentSelection
                                selectedTextColor: theme.textPrimary
                                background: null
                            }
                        }
                    }
                }

                // -- Apply -------------------------------------------
                Rectangle {
                    width: applyLabel.width + 40
                    height: 38
                    radius: 8
                    color: applyMouse.containsMouse ? theme.accentHover : theme.accent
                    Text {
                        id: applyLabel
                        anchors.centerIn: parent
                        text: backend.t("settings.bannerEditor.applyBtn")
                        color: "#ffffff"
                        font.pixelSize: 13
                        font.weight: Font.DemiBold
                    }
                    MouseArea {
                        id: applyMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: backend.save_profile(
                            statusField.text,
                            settingsPage.safeSettingsColor(bannerColorField.text),
                            settingsPage.pendingBannerPath,
                            bioField.text)
                    }
                }
            }
        }

        // Live profile preview (right column, like the Tauri settings)
        Column {
            id: profilePreviewCol
            anchors.right: parent.right
            anchors.rightMargin: 32
            anchors.top: parent.top
            anchors.topMargin: 32
            visible: settingsPage.selectedTab === "profile" && settingsPage.width > 760
            width: visible ? 260 : 0
            NameCard {
                user: settingsPage.previewUser
            }
        }

        FileDialog {
            id: avatarDialog
            fileMode: FileDialog.OpenFile
            nameFilters: ["Images (*.png *.jpg *.jpeg *.gif *.webp *.bmp)"]
            onAccepted: {
                const u = selectedFile.toString()
                if (u.indexOf("file:///") === 0)
                    backend.set_avatar(decodeURIComponent(u.substring(8)))
            }
        }
        FileDialog {
            id: bannerDialog
            fileMode: FileDialog.OpenFile
            nameFilters: ["Images (*.png *.jpg *.jpeg *.gif *.webp *.bmp)"]
            onAccepted: {
                const u = selectedFile.toString()
                if (u.indexOf("file:///") === 0)
                    settingsPage.pendingBannerPath = decodeURIComponent(u.substring(8))
            }
        }

        // ---- Advanced tab (the minimal client's own options) ------------
        Column {
            anchors.top: parent.top
            anchors.topMargin: 32
            anchors.left: settingsSidebar.right
            anchors.leftMargin: 40
            visible: settingsPage.selectedTab === "advanced"
            width: Math.min(420, parent.width - 280)
            spacing: 18

            Text {
                text: backend.t("settings.tabs.advanced")
                color: theme.textPrimary
                font.pixelSize: 22
                font.weight: Font.Bold
            }

            // Hide empty channels (same backend property as the sidebar
            // eye button, so the two controls stay in sync).
            Item {
                width: parent.width
                height: 24
                Text {
                    anchors.left: parent.left
                    anchors.right: emptyToggle.left
                    anchors.rightMargin: 10
                    anchors.verticalCenter: parent.verticalCenter
                    text: backend.t("sidebar.channelSidebar.hideEmptyChannels")
                    color: theme.textSecondary
                    font.pixelSize: 13
                    wrapMode: Text.Wrap
                }
                Rectangle {
                    id: emptyToggle
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    width: 34
                    height: 18
                    radius: 9
                    color: backend.hide_empty_channels ? theme.accent : theme.glassHover
                    border.width: 1
                    border.color: theme.glassBorder
                    Rectangle {
                        width: 14
                        height: 14
                        radius: 7
                        color: "#ffffff"
                        anchors.verticalCenter: parent.verticalCenter
                        x: backend.hide_empty_channels ? parent.width - width - 2 : 2
                        Behavior on x { NumberAnimation { duration: 120 } }
                    }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: backend.persist_hide_empty_channels(!backend.hide_empty_channels)
                    }
                }
            }

            Rectangle { width: parent.width; height: 1; color: theme.glassBorder }

            // Switch back to the full (Tauri) interface; only quits once
            // the full client actually spawned.
            Rectangle {
                width: parent.width
                height: 38
                radius: 10
                color: switchMouse.containsMouse ? theme.glassHover : theme.glass
                border.width: 1
                border.color: theme.glassBorder
                Text {
                    anchors.centerIn: parent
                    text: backend.t("common.minimal.switchToFull")
                    color: theme.textPrimary
                    font.pixelSize: 13
                }
                MouseArea {
                    id: switchMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        settingsSwitchError.visible = false
                        if (backend.switch_to_full_mode())
                            Qt.quit()
                        else
                            settingsSwitchError.visible = true
                    }
                }
            }
            Text {
                id: settingsSwitchError
                visible: false
                width: parent.width
                text: backend.t("common.minimal.fullClientNotFound")
                color: theme.dangerLight
                font.pixelSize: 11
                wrapMode: Text.Wrap
            }
        }
    }

    // ---- Image lightbox (MediaPreview .lightboxOverlay) -------------------
    Item {
        id: lightbox
        anchors.fill: parent
        visible: false
        z: 300
        property string src: ""
        property string senderName: ""
        property string timeText: ""

        function open(source, sender, time) {
            src = source
            senderName = sender
            timeText = time
            visible = true
            forceActiveFocus()
        }
        function close() {
            visible = false
            src = ""
        }
        Keys.onEscapePressed: close()

        Rectangle {
            anchors.fill: parent
            color: theme.overlayDarkest
        }
        // Clicking the backdrop closes (the media area swallows its clicks).
        MouseArea {
            anchors.fill: parent
            onClicked: lightbox.close()
        }

        Column {
            anchors.centerIn: parent

            // .lightboxMedia: max 90vw/90vh, radius 8, contain fit
            Item {
                id: lightboxFrame
                readonly property real natW: lightboxImg.implicitImageWidth
                readonly property real natH: lightboxImg.implicitImageHeight
                readonly property real fitScale: natW > 0 && natH > 0
                    ? Math.min(1, lightbox.width * 0.9 / natW,
                               lightbox.height * 0.9 / natH)
                    : 1
                anchors.horizontalCenter: parent.horizontalCenter
                width: natW > 0 ? Math.round(natW * fitScale) : 200
                height: natH > 0 ? Math.round(natH * fitScale) : 150

                MouseArea { anchors.fill: parent } // keep backdrop-close off the image
                RoundedImage {
                    id: lightboxImg
                    anchors.fill: parent
                    source: lightbox.src
                    fillMode: Image.PreserveAspectFit
                    cornerRadius: 8
                    // Full view decodes on demand, capped at the window size.
                    decodeCap: Qt.size(Math.max(1, Math.round(lightbox.width)),
                                       Math.max(1, Math.round(lightbox.height)))
                }

                // .lightboxClose: 32px frosted circle at (-12, -12)
                Rectangle {
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.topMargin: -12
                    anchors.rightMargin: -12
                    width: 32
                    height: 32
                    radius: 16
                    color: lightboxCloseMouse.containsMouse
                           ? Qt.rgba(1, 1, 1, 0.3) : theme.glassHeavy
                    Text {
                        anchors.centerIn: parent
                        text: "" // close glyph
                        font.family: theme.iconFont
                        font.pixelSize: 11
                        color: "#ffffff"
                    }
                    MouseArea {
                        id: lightboxCloseMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: lightbox.close()
                    }
                }
            }

            // .lightboxCaption: sender + time
            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                topPadding: 8
                spacing: 8
                visible: lightbox.senderName.length > 0
                Text {
                    text: lightbox.senderName
                    color: Qt.rgba(1, 1, 1, 0.85)
                    font.pixelSize: 13
                    font.weight: Font.DemiBold
                }
                Text {
                    text: lightbox.timeText
                    color: Qt.rgba(1, 1, 1, 0.5)
                    font.pixelSize: 12
                }
            }
        }
    }

    // ---- Signal wiring ---------------------------------------------------
    Connections {
        target: backend
        function onChat_message(channel, sender, text, images) {
            chatModel.insert(0, {
                kind: "msg",
                sender: sender,
                body: text,
                time: Qt.formatTime(new Date(), "hh:mm"),
                own: sender === window.selfName,
                images: images
            })
        }
        function onLog_message(line) {
            chatModel.insert(0, {
                kind: "log",
                sender: "",
                body: line,
                time: "",
                own: false,
                images: "[]"
            })
        }
        function onUser_stats(session, onlinesecs, idlesecs) {
            // Last answer wins; the card only shows pills when the stats
            // session matches the displayed user (statsValid).
            nameCard.statsSession = session
            nameCard.onlineSecs = onlinesecs
            nameCard.idleSecs = idlesecs
        }
    }

    // ---- Frameless-window resize handles ----------------------------------
    component ResizeGrip: MouseArea {
        property int edges
        visible: window.visibility !== Window.Maximized
        onPressed: window.startSystemResize(edges)
        z: 100
    }
    ResizeGrip { // left
        edges: Qt.LeftEdge
        cursorShape: Qt.SizeHorCursor
        anchors { left: parent.left; top: parent.top; bottom: parent.bottom
                  topMargin: 8; bottomMargin: 8 }
        width: 5
    }
    ResizeGrip { // right
        edges: Qt.RightEdge
        cursorShape: Qt.SizeHorCursor
        anchors { right: parent.right; top: parent.top; bottom: parent.bottom
                  topMargin: 8; bottomMargin: 8 }
        width: 5
    }
    ResizeGrip { // top
        edges: Qt.TopEdge
        cursorShape: Qt.SizeVerCursor
        anchors { top: parent.top; left: parent.left; right: parent.right
                  leftMargin: 8; rightMargin: 8 }
        height: 5
    }
    ResizeGrip { // bottom
        edges: Qt.BottomEdge
        cursorShape: Qt.SizeVerCursor
        anchors { bottom: parent.bottom; left: parent.left; right: parent.right
                  leftMargin: 8; rightMargin: 8 }
        height: 5
    }
    ResizeGrip { // top-left
        edges: Qt.TopEdge | Qt.LeftEdge
        cursorShape: Qt.SizeFDiagCursor
        anchors { top: parent.top; left: parent.left }
        width: 8; height: 8
    }
    ResizeGrip { // top-right
        edges: Qt.TopEdge | Qt.RightEdge
        cursorShape: Qt.SizeBDiagCursor
        anchors { top: parent.top; right: parent.right }
        width: 8; height: 8
    }
    ResizeGrip { // bottom-left
        edges: Qt.BottomEdge | Qt.LeftEdge
        cursorShape: Qt.SizeBDiagCursor
        anchors { bottom: parent.bottom; left: parent.left }
        width: 8; height: 8
    }
    ResizeGrip { // bottom-right
        edges: Qt.BottomEdge | Qt.RightEdge
        cursorShape: Qt.SizeFDiagCursor
        anchors { bottom: parent.bottom; right: parent.right }
        width: 8; height: 8
    }
}
