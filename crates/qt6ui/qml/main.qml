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
    title: "Fancy Mumble"

    Backend { id: backend }

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
    readonly property var currentChannel: {
        for (let i = 0; i < channels.length; ++i)
            if (channels[i].id === backend.self_channel) return channels[i]
        return null
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

    component CircleAvatar: Rectangle {
        property string name
        property real size: 28
        width: size
        height: size
        radius: size / 2
        color: colorFor(name)
        Text {
            anchors.centerIn: parent
            text: initial(parent.name)
            color: "#ffffff"
            font.weight: Font.DemiBold
            font.pixelSize: Math.max(9, Math.round(parent.size * 0.42))
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
                text: "Fancy Mumble"
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
                        text: "Fancy Mumble"
                        color: theme.textPrimary
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.48
                    }
                    Item { width: 1; height: 4 }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "Choose a server to connect"
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

                Column {
                    width: parent.width
                    spacing: 6
                    FieldLabel { text: "Server address" }
                    GlassField {
                        id: hostField
                        width: parent.width
                        placeholderText: "mumble.example.com"
                        text: "localhost"
                        enabled: !connecting
                    }
                }

                Row {
                    width: parent.width
                    spacing: 16
                    Column {
                        width: 110
                        spacing: 6
                        FieldLabel { text: "Port" }
                        GlassField {
                            id: portField
                            width: parent.width
                            placeholderText: "64738"
                            text: "64738"
                            inputMethodHints: Qt.ImhDigitsOnly
                            enabled: !connecting
                        }
                    }
                    Column {
                        width: parent.width - 126
                        spacing: 6
                        FieldLabel { text: "Username" }
                        GlassField {
                            id: userField
                            width: parent.width
                            placeholderText: "Your name"
                            enabled: !connecting
                        }
                    }
                }

                Column {
                    width: parent.width
                    spacing: 6
                    FieldLabel { text: "Password" }
                    GlassField {
                        id: passField
                        width: parent.width
                        placeholderText: "Leave empty if not required"
                        echoMode: TextInput.Password
                        enabled: !connecting
                        onAccepted: connectBtn.go()
                    }
                }

                // Gradient connect button (.button)
                Rectangle {
                    id: connectBtn
                    width: parent.width
                    height: 46
                    radius: 12
                    opacity: enabled ? (btnMouse.containsMouse ? 0.9 : 1) : 0.5
                    enabled: !connecting && hostField.text.length > 0 && userField.text.length > 0
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: theme.accent }
                        GradientStop { position: 1; color: theme.accentHover }
                    }

                    function go() {
                        if (!enabled)
                            return
                        window.selfName = userField.text
                        window.selfHost = hostField.text
                        backend.connect_to_server(hostField.text,
                                                  parseInt(portField.text || "64738"),
                                                  userField.text, passField.text)
                    }

                    Row {
                        anchors.centerIn: parent
                        spacing: 8
                        // .spinner: rotating arc while connecting
                        Canvas {
                            width: 18
                            height: 18
                            visible: connecting
                            anchors.verticalCenter: parent.verticalCenter
                            onPaint: {
                                const ctx = getContext("2d")
                                ctx.reset()
                                ctx.lineWidth = 2
                                ctx.strokeStyle = "rgba(255,255,255,0.3)"
                                ctx.beginPath()
                                ctx.arc(9, 9, 8, 0, 2 * Math.PI)
                                ctx.stroke()
                                ctx.strokeStyle = "#ffffff"
                                ctx.beginPath()
                                ctx.arc(9, 9, 8, -Math.PI / 2, 0)
                                ctx.stroke()
                            }
                            RotationAnimation on rotation {
                                running: connecting
                                loops: Animation.Infinite
                                from: 0
                                to: 360
                                duration: 600
                            }
                        }
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: connecting ? "Connecting..." : "Quick Connect"
                            color: "#ffffff"
                            font.pixelSize: 15
                            font.weight: Font.DemiBold
                        }
                    }
                    MouseArea {
                        id: btnMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: parent.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: connectBtn.go()
                    }
                }
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

                // Header (.header: 20px 16px 16px + border-bottom)
                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: headerCol.height + 36
                    Column {
                        id: headerCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.leftMargin: 16
                        anchors.rightMargin: 16
                        anchors.topMargin: 20
                        spacing: 2
                        Text {
                            text: selfHost !== "" ? selfHost : "Fancy Mumble"
                            color: theme.textPrimary
                            font.pixelSize: 18
                            font.weight: Font.DemiBold
                            font.letterSpacing: -0.18
                            elide: Text.ElideRight
                            width: parent.width
                        }
                        Row {
                            spacing: 6
                            Rectangle {
                                width: 8
                                height: 8
                                radius: 4
                                color: theme.online
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            Text {
                                text: "Connected"
                                color: theme.textSecondary
                                font.pixelSize: 11
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

                // Section title (.sectionTitle)
                Text {
                    Layout.fillWidth: true
                    Layout.leftMargin: 12
                    Layout.topMargin: 10
                    Layout.bottomMargin: 4
                    text: "Channels"
                    color: theme.textMuted
                    font.pixelSize: 11
                    font.weight: Font.DemiBold
                    font.capitalization: Font.AllUppercase
                    font.letterSpacing: 0.55
                }

                // Flat channel list (ModernChannelList.module.css)
                ListView {
                    id: channelList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.leftMargin: 8
                    Layout.rightMargin: 8
                    clip: true
                    spacing: 2
                    model: channels

                    delegate: Rectangle {
                        id: channelCard
                        required property var modelData
                        readonly property bool isCurrent: modelData.id === backend.self_channel
                        width: channelList.width
                        height: cardCol.height
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
                                            anchors.right: parent.right
                                            anchors.verticalCenter: parent.verticalCenter
                                            spacing: 8
                                            CircleAvatar {
                                                name: memberRow.modelData.name
                                                size: 20
                                                anchors.verticalCenter: parent.verticalCenter
                                            }
                                            Text {
                                                anchors.verticalCenter: parent.verticalCenter
                                                text: memberRow.modelData.name
                                                      + (memberRow.modelData.me ? " (me)" : "")
                                                color: theme.textPrimary
                                                font.pixelSize: 13
                                                elide: Text.ElideRight
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Self user + voice panel (.selfUserSection / .voicePanel)
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 56
                    color: theme.voicePanelBg
                    Rectangle {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: theme.glassBorder
                    }
                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 16
                        anchors.rightMargin: 16
                        spacing: 6

                        Item {
                            Layout.preferredWidth: 32
                            Layout.preferredHeight: 32
                            CircleAvatar { name: selfName; size: 28; anchors.centerIn: parent }
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
                        Column {
                            Layout.fillWidth: true
                            spacing: 0
                            Text {
                                width: parent.width
                                text: selfName
                                color: theme.textPrimary
                                font.pixelSize: 13
                                font.weight: Font.Medium
                                elide: Text.ElideRight
                            }
                            Text {
                                text: voiceOn ? "Voice connected" : "Voice off"
                                color: voiceOn ? theme.online : theme.textMuted
                                font.pixelSize: 11
                            }
                        }

                        SidebarButton {
                            glyph: voiceOn ? "" : "" // mic / mic-off
                            glyphColor: voiceOn ? theme.online : theme.textSecondary
                            bgColor: voiceOn
                                     ? Qt.rgba(34 / 255, 197 / 255, 94 / 255, 0.12)
                                     : theme.glass
                            borderColor: voiceOn
                                         ? Qt.rgba(34 / 255, 197 / 255, 94 / 255, 0.12)
                                         : theme.glassBorder
                            onActivated: {
                                window.voiceOn = !window.voiceOn
                                backend.set_voice_enabled(window.voiceOn)
                            }
                        }
                        SidebarButton {
                            glyph: "" // power (disconnect)
                            glyphColor: theme.danger
                            bgColor: theme.dangerBg
                            borderColor: theme.dangerBorder
                            onActivated: backend.disconnect_from_server()
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
            anchors.left: sidebar.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom

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
                        text: currentChannel ? currentChannel.name : "Fancy Mumble"
                        color: theme.textPrimary
                        font.pixelSize: 16
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: currentChannel
                              ? currentChannel.users.length
                                + (currentChannel.users.length === 1 ? " member" : " members")
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
                anchors.bottom: composer.top
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

                        // .bubble / .ownBubble
                        Rectangle {
                            id: bubble
                            width: bubbleContent.width + 28
                            height: bubbleContent.height + 16
                            topLeftRadius: 12
                            topRightRadius: 12
                            bottomLeftRadius: msgRow.own ? 12 : 4
                            bottomRightRadius: msgRow.own ? 4 : 12
                            color: msgRow.own ? "transparent" : theme.glassHover
                            border.width: msgRow.own ? 0 : 1
                            border.color: theme.glassBorder
                            Rectangle {
                                anchors.fill: parent
                                visible: msgRow.own
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
                                x: 14
                                y: 8
                                spacing: 2
                                Text {
                                    visible: !msgRow.own
                                    text: msgRow.sender
                                    color: colorFor(msgRow.sender)
                                    font.pixelSize: 12
                                    font.weight: Font.DemiBold
                                }
                                Row {
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
                        text: "No messages yet."
                        color: theme.textSecondary
                        font.pixelSize: 15
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

                    // WYSIWYG markdown input (live **bold** / *italic* /
                    // `code` decoration; Enter sends, Shift+Enter newline).
                    MarkdownField {
                        id: messageField
                        Layout.fillWidth: true
                        Layout.alignment: Qt.AlignBottom
                        placeholderText: "Write a message..."
                        onSubmitted: sendArea.send()
                    }

                    // .sendBtn: 40px gradient circle
                    Rectangle {
                        Layout.preferredWidth: 40
                        Layout.preferredHeight: 40
                        Layout.alignment: Qt.AlignBottom
                        radius: 20
                        enabled: messageField.text.trim().length > 0
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
        }
    }

    // ---- Signal wiring ---------------------------------------------------
    Connections {
        target: backend
        function onChat_message(channel, sender, text) {
            chatModel.insert(0, {
                kind: "msg",
                sender: sender,
                body: text,
                time: Qt.formatTime(new Date(), "hh:mm"),
                own: sender === window.selfName
            })
        }
        function onLog_message(line) {
            chatModel.insert(0, {
                kind: "log",
                sender: "",
                body: line,
                time: "",
                own: false
            })
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
