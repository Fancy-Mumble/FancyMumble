// NameCard - the user profile hover card, frame-matched to the web
// front-end's ProfilePreviewCard (ProfilePreviewCard.module.css): banner,
// ringed avatar overlapping it, styled name + registered badge, then
// status and bio. Shown by main.qml when hovering a user in the sidebar
// or a chat avatar (250ms delay, like the web's useHoverCardPosition).
//
// Purely presentational and mouse-transparent (the web card has
// pointer-events: none); feed it one member object from the channels
// JSON via `user`.
import QtQuick

Rectangle {
    id: card

    /// A member object from the channels JSON: { name, me, registered,
    /// status, bio, bannerColor, nameColor, nameBold, nameItalic }.
    property var user: null

    readonly property string userName: user ? user.name : ""

    width: 260
    height: Math.min(360, body.y + body.height + 16)
    radius: 12
    color: "#1a1a2e" // --color-bg-secondary fallback used by the web card
    border.width: 1
    border.color: Qt.rgba(1, 1, 1, 0.06)

    // Same palette + hash as the web colorFor() (and main.qml).
    function colorFor(name) {
        const palette = ["#2AABEE", "#7c3aed", "#22c55e", "#f59e0b", "#ef4444", "#ec4899"]
        let hash = 0
        for (let i = 0; i < name.length; ++i)
            hash = name.codePointAt(i) + ((hash << 5) - hash)
        return palette[Math.abs(hash) % palette.length]
    }

    // Accept only simple #rgb/#rrggbb(aa) banner colors; anything else
    // falls back to the default banner.
    function safeColor(str, fallback) {
        return /^#[0-9a-fA-F]{3,8}$/.test(str || "") ? str : fallback
    }

    // Banner (.previewBanner, 90px)
    Rectangle {
        id: banner
        width: parent.width
        height: 90
        topLeftRadius: card.radius
        topRightRadius: card.radius
        color: card.safeColor(card.user ? card.user.bannerColor : "", "#1a1a2e")
    }

    // Dark wash below the banner (.previewCard::after)
    Rectangle {
        anchors.top: banner.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        color: Qt.rgba(0, 0, 0, 0.45)
        bottomLeftRadius: card.radius
        bottomRightRadius: card.radius
    }

    // Avatar with ring, overlapping the banner (.previewAvatarWrapper)
    Rectangle {
        id: avatarWrap
        x: 16
        y: banner.height - 30
        width: 60
        height: 60
        radius: 30
        color: "#1a1a2e"
        Rectangle {
            anchors.centerIn: parent
            width: 54
            height: 54
            radius: 27
            color: card.colorFor(card.userName)
            Text {
                anchors.centerIn: parent
                text: card.userName.length > 0 ? card.userName[0].toUpperCase() : "?"
                color: "#ffffff"
                font.pixelSize: 24
                font.weight: Font.DemiBold
            }
        }
    }

    // Name + registered badge, centred on the avatar (.previewNameInline)
    Row {
        anchors.left: avatarWrap.right
        anchors.leftMargin: 12
        anchors.right: parent.right
        anchors.rightMargin: 16
        anchors.verticalCenter: avatarWrap.verticalCenter
        spacing: 4

        Text {
            id: nameText
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(implicitWidth,
                            parent.width - (badge.visible ? badge.width + 4 : 0))
            text: card.userName
            elide: Text.ElideRight
            font.pixelSize: 16
            font.weight: card.user && card.user.nameBold ? Font.Bold : Font.DemiBold
            font.italic: card.user ? card.user.nameItalic : false
            color: card.safeColor(card.user ? card.user.nameColor : "", "#ffffff")
        }
        // .previewRegisteredBadge (shield-check)
        Text {
            id: badge
            anchors.verticalCenter: parent.verticalCenter
            visible: card.user ? card.user.registered : false
            text: "" // Segoe Fluent Icons: shield checkmark
            font.family: "Segoe Fluent Icons"
            font.pixelSize: 12
            color: "#3ba55d" // --color-success fallback used by the web card
        }
    }

    // Body: status + bio (.previewBody)
    Column {
        id: body
        x: 16
        y: banner.height + 30 + 12 // below the avatar overlap + 12px padding
        width: parent.width - 32
        spacing: 6

        // .previewStatus
        Text {
            width: parent.width
            visible: card.user ? card.user.status !== "" : false
            text: card.user ? card.user.status : ""
            color: Qt.rgba(1, 1, 1, 0.35)
            font.pixelSize: 12
            elide: Text.ElideRight
        }
        // .previewBio (4-line clamp)
        Text {
            width: parent.width
            visible: card.user ? card.user.bio !== "" : false
            text: card.user ? card.user.bio : ""
            color: Qt.rgba(1, 1, 1, 0.55)
            font.pixelSize: 12
            lineHeight: 1.5
            wrapMode: Text.Wrap
            textFormat: Text.StyledText
            maximumLineCount: 4
            elide: Text.ElideRight
        }
    }
}
