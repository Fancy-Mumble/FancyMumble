// NameCard - the user profile hover card, frame-matched to the web
// front-end's ProfilePreviewCard (ProfilePreviewCard.module.css): banner,
// ringed avatar overlapping it, styled name + registered badge, then
// status and bio. Shown by main.qml when hovering a user in the sidebar
// or a chat avatar (250ms delay, like the web's useHoverCardPosition).
//
// Purely presentational and mouse-transparent (the web card has
// pointer-events: none); feed it one member object from the channels
// JSON via `user`.
//
// Images (banner, avatar, bio) arrive as file URLs of spilled thumbnails
// (see src/media.rs) and are decoded only while the card is visible, with
// sourceSize caps - the hard RAM budget applies here too.
import QtQuick
import QtQuick.Effects

Rectangle {
    id: card

    /// A member object from the channels JSON: { name, session, me,
    /// registered, status, bio, bioImages, bannerColor, bannerImage,
    /// avatar, nameColor, nameBold, nameItalic, nameGradient,
    /// nameGlowColor, nameGlowSize, themeColors, cardGlass,
    /// cardBackground, cardBackgroundCustom }.
    property var user: null

    /// UserStats answer routed here by main.qml (`user_stats` signal);
    /// pills show only when the stats belong to the displayed user.
    property int statsSession: -1
    property int onlineSecs: -1
    property int idleSecs: -1
    readonly property bool statsValid:
        user !== null && user.session === statsSession

    readonly property string userName: user ? user.name : ""

    width: 260
    height: Math.min(360, body.y + body.height + 16)
    radius: 12
    color: "#1a1a2e" // --color-bg-secondary fallback used by the web card
    border.width: 1
    border.color: cardPalette && cardPalette.borderColor
                  ? cardPalette.borderColor : Qt.rgba(1, 1, 1, 0.06)

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

    // ---- Theme palette (port of utils/colorUtils.ts) -------------------
    // themeColors: stops 1-3 form the card gradient, color 4 the border,
    // color 5 the accent; text color is contrast-picked via APCA.

    function hexToHsl(hex) {
        const raw = hex.replace("#", "")
        const r = parseInt(raw.substring(0, 2), 16) / 255
        const g = parseInt(raw.substring(2, 4), 16) / 255
        const b = parseInt(raw.substring(4, 6), 16) / 255
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        const l = (max + min) / 2
        let h = 0, s = 0
        if (max !== min) {
            const d = max - min
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
            else if (max === g) h = ((b - r) / d + 2) / 6
            else h = ((r - g) / d + 4) / 6
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
    }

    function hslToHex(hsl) {
        const h = hsl.h / 360, s = hsl.s / 100, l = hsl.l / 100
        const to2 = v => Math.round(v * 255).toString(16).padStart(2, "0")
        if (s === 0) return "#" + to2(l) + to2(l) + to2(l)
        const hue2rgb = (p, q, t) => {
            const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
            if (tt < 1 / 6) return p + (q - p) * 6 * tt
            if (tt < 1 / 2) return q
            if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
            return p
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        return "#" + to2(hue2rgb(p, q, h + 1 / 3)) + to2(hue2rgb(p, q, h))
                   + to2(hue2rgb(p, q, h - 1 / 3))
    }

    function relativeLuminance(hex) {
        const raw = hex.replace("#", "")
        const lin = c => {
            const srgb = c / 255
            return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin(parseInt(raw.substring(0, 2), 16))
             + 0.7152 * lin(parseInt(raw.substring(2, 4), 16))
             + 0.0722 * lin(parseInt(raw.substring(4, 6), 16))
    }

    function apcaLightness(bgY, txtY) {
        const bgC = bgY > 0.022 ? bgY : bgY + Math.pow(0.022 - bgY, 1.414)
        const txtC = txtY > 0.022 ? txtY : txtY + Math.pow(0.022 - txtY, 1.414)
        if (bgC > txtC) {
            const sapc = (Math.pow(bgC, 0.56) - Math.pow(txtC, 0.57)) * 1.14
            return sapc < 0.1 ? 0 : (sapc - 0.027) * 100
        }
        const sapc = (Math.pow(bgC, 0.65) - Math.pow(txtC, 0.62)) * 1.14
        return sapc > -0.1 ? 0 : (sapc + 0.027) * 100
    }

    function textColorForGradient(colors) {
        if (colors.length === 0) return "#ffffff"
        let worstWhite = Infinity, worstBlack = Infinity
        for (const c of colors) {
            const bgY = relativeLuminance(c)
            worstWhite = Math.min(worstWhite, Math.abs(apcaLightness(bgY, 1.0)))
            worstBlack = Math.min(worstBlack, Math.abs(apcaLightness(bgY, 0.012)))
        }
        return worstWhite >= worstBlack ? "#ffffff" : "#111111"
    }

    function borderColorFromPalette(colors) {
        if (colors.length === 0) return ""
        const hsls = colors.map(hexToHsl)
        let sinSum = 0, cosSum = 0
        for (const c of hsls) {
            sinSum += Math.sin(c.h * Math.PI / 180)
            cosSum += Math.cos(c.h * Math.PI / 180)
        }
        let avgH = Math.atan2(sinSum, cosSum) * 180 / Math.PI
        if (avgH < 0) avgH += 360
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
        const avgS = Math.round(hsls.reduce((sum, c) => sum + c.s, 0) / hsls.length)
        const avgL = Math.round(hsls.reduce((sum, c) => sum + c.l, 0) / hsls.length)
        return hslToHex({ h: Math.round(avgH), s: clamp(avgS + 15, 20, 80),
                          l: clamp(avgL + 20, 30, 70) })
    }

    /// resolveCardBg + resolveThemePalette: null = default card look.
    readonly property var cardPalette: {
        if (!user) return null
        const okHex = s => /^#[0-9a-fA-F]{6}$/.test(s || "")
        // "custom" backgrounds are arbitrary CSS; only plain colors are
        // representable here, anything else keeps the default card.
        if (user.cardBackground === "custom" && okHex(user.cardBackgroundCustom))
            return { stops: [user.cardBackgroundCustom], alpha: 1,
                     borderColor: "", textColor: "", accentColor: "" }
        const colors = (user.themeColors || []).filter(okHex)
        if (colors.length === 0) return null
        const stops = colors.slice(0, 3)
        if (stops.length === 1) {
            const hsl = hexToHsl(stops[0])
            const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
            stops.push(hslToHex({ h: hsl.h, s: clamp(hsl.s - 5, 10, 90),
                                  l: clamp(hsl.l + (hsl.l > 50 ? -12 : 12), 10, 85) }))
        }
        return {
            stops: stops,
            alpha: user.cardGlass ? 0.55 : 1,
            borderColor: colors[3] || borderColorFromPalette(colors.slice(0, 3)),
            textColor: textColorForGradient(colors.slice(0, 3)),
            accentColor: colors[4] || "",
        }
    }

    function formatDuration(totalSeconds) {
        const d = Math.floor(totalSeconds / 86400)
        const h = Math.floor((totalSeconds % 86400) / 3600)
        const m = Math.floor((totalSeconds % 3600) / 60)
        const s = totalSeconds % 60
        const parts = []
        if (d > 0) parts.push(d + "d")
        if (h > 0) parts.push(h + "h")
        if (m > 0) parts.push(m + "m")
        if (parts.length === 0 || s > 0) parts.push(s + "s")
        return parts.slice(0, 2).join(" ")
    }

    onCardPaletteChanged: cardBgCanvas.requestPaint()

    // Theme-color gradient card background (135deg, up to 3 stops,
    // translucent when cardGlass) - the web resolveCardBg look.
    Canvas {
        id: cardBgCanvas
        anchors.fill: parent
        visible: card.cardPalette !== null
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const p = card.cardPalette
            if (!p) return
            const g = ctx.createLinearGradient(0, 0, width, height)
            const stops = p.stops
            for (let i = 0; i < stops.length; ++i) {
                const c = Qt.color(stops[i])
                g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1),
                               Qt.rgba(c.r, c.g, c.b, p.alpha).toString())
            }
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.roundedRect(0, 0, width, height, card.radius, card.radius)
            ctx.fill()
        }
    }

    // Banner (.previewBanner, 90px): image cover when set, else color
    Rectangle {
        id: banner
        width: parent.width
        height: 90
        topLeftRadius: card.radius
        topRightRadius: card.radius
        color: card.safeColor(card.user ? card.user.bannerColor : "", "#1a1a2e")

        Image {
            anchors.fill: parent
            visible: source.toString().length > 0
            source: card.user && card.user.bannerImage ? card.user.bannerImage : ""
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            cache: false
            sourceSize: Qt.size(520, 180) // 2x the painted 260x90
            layer.enabled: visible
            layer.effect: MultiEffect {
                maskEnabled: true
                maskSource: bannerMask
                maskThresholdMin: 0.5
                maskSpreadAtMin: 1.0
            }
        }
        Item {
            id: bannerMask
            anchors.fill: parent
            layer.enabled: true
            visible: false
            Rectangle {
                anchors.fill: parent
                topLeftRadius: card.radius
                topRightRadius: card.radius
                color: "#000000"
            }
        }
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

    // Avatar with ring, overlapping the banner (.previewAvatarWrapper):
    // the user's texture image when set, else the initial disc
    Rectangle {
        id: avatarWrap
        x: 16
        y: banner.height - 30
        width: 60
        height: 60
        radius: 30
        color: "#1a1a2e"
        readonly property string avatarSrc:
            card.user && card.user.avatar ? card.user.avatar : ""
        Rectangle {
            anchors.centerIn: parent
            width: 54
            height: 54
            radius: 27
            color: card.colorFor(card.userName)
            Text {
                anchors.centerIn: parent
                visible: avatarWrap.avatarSrc.length === 0
                text: card.userName.length > 0 ? card.userName[0].toUpperCase() : "?"
                color: "#ffffff"
                font.pixelSize: 24
                font.weight: Font.DemiBold
            }
            Image {
                anchors.fill: parent
                visible: avatarWrap.avatarSrc.length > 0
                source: avatarWrap.avatarSrc
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: false
                sourceSize: Qt.size(108, 108) // 2x the painted 54px disc
                layer.enabled: visible
                layer.effect: MultiEffect {
                    maskEnabled: true
                    maskSource: avatarMask
                    maskThresholdMin: 0.5
                    maskSpreadAtMin: 1.0
                }
            }
            Item {
                id: avatarMask
                anchors.fill: parent
                layer.enabled: true
                visible: false
                Rectangle { anchors.fill: parent; radius: 27; color: "#000000" }
            }
        }
    }

    // Name + registered badge, centred on the avatar (.previewNameInline)
    Row {
        id: nameRow
        anchors.left: avatarWrap.right
        anchors.leftMargin: 12
        anchors.right: parent.right
        anchors.rightMargin: 16
        anchors.verticalCenter: avatarWrap.verticalCenter
        spacing: 4

        // Two-stop 135deg text gradient (nameStyle.gradient): a gradient
        // fill masked by the glyphs; plain color text otherwise. Optional
        // glow (nameStyle.glow) via the effect's shadow.
        Item {
            id: nameItem
            readonly property var gradient: {
                const g = card.user ? card.user.nameGradient : null
                return g && g.length >= 2 ? g : null
            }
            readonly property string glowColor:
                card.safeColor(card.user ? card.user.nameGlowColor : "", "")
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(nameText.implicitWidth,
                            parent.width - (badge.visible ? badge.width + 4 : 0))
            height: nameText.implicitHeight

            Text {
                id: nameText
                width: parent.width
                text: card.userName
                elide: Text.ElideRight
                font.pixelSize: 16
                font.weight: card.user && card.user.nameBold ? Font.Bold : Font.DemiBold
                font.italic: card.user ? card.user.nameItalic : false
                color: card.safeColor(card.user ? card.user.nameColor : "",
                                      card.cardPalette && card.cardPalette.textColor
                                      ? card.cardPalette.textColor : "#ffffff")
                visible: nameItem.gradient === null
                layer.enabled: visible && nameItem.glowColor !== ""
                layer.effect: MultiEffect {
                    shadowEnabled: true
                    shadowColor: nameItem.glowColor
                    shadowBlur: 1.0
                    shadowVerticalOffset: 0
                    shadowHorizontalOffset: 0
                }
            }
            // Mask copy + gradient fill for the gradient variant.
            Text {
                id: nameMask
                width: parent.width
                text: nameText.text
                elide: nameText.elide
                font: nameText.font
                color: "#ffffff"
                visible: false
                layer.enabled: true
            }
            Canvas {
                anchors.fill: parent
                visible: nameItem.gradient !== null
                onVisibleChanged: requestPaint()
                onWidthChanged: requestPaint()
                onPaint: {
                    const ctx = getContext("2d")
                    ctx.reset()
                    if (!nameItem.gradient) return
                    const g = ctx.createLinearGradient(0, 0, width, height)
                    g.addColorStop(0, card.safeColor(nameItem.gradient[0], "#ffffff"))
                    g.addColorStop(1, card.safeColor(nameItem.gradient[1], "#ffffff"))
                    ctx.fillStyle = g
                    ctx.fillRect(0, 0, width, height)
                }
                layer.enabled: visible
                layer.effect: MultiEffect {
                    maskEnabled: true
                    maskSource: nameMask
                    maskThresholdMin: 0.5
                    maskSpreadAtMin: 1.0
                    shadowEnabled: nameItem.glowColor !== ""
                    shadowColor: nameItem.glowColor
                    shadowBlur: 1.0
                    shadowVerticalOffset: 0
                    shadowHorizontalOffset: 0
                }
            }
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

    // Activity pills under the name (.previewActivityBar): online time
    // (green, dot) and idle time (yellow, moon), from UserStats.
    Row {
        anchors.left: nameRow.left
        anchors.top: nameRow.bottom
        anchors.topMargin: 1
        spacing: 5
        visible: card.statsValid && (card.onlineSecs >= 0 || card.idleSecs > 0)

        Rectangle {
            visible: card.onlineSecs >= 0
            width: onlinePillRow.width + 16
            height: onlinePillRow.height + 4
            radius: 10
            color: Qt.rgba(34 / 255, 197 / 255, 94 / 255, 0.12)
            Row {
                id: onlinePillRow
                anchors.centerIn: parent
                spacing: 4
                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    width: 6
                    height: 6
                    radius: 3
                    color: "#4ade80"
                }
                Text {
                    text: card.formatDuration(Math.max(0, card.onlineSecs))
                    color: "#4ade80"
                    font.pixelSize: 11
                    font.weight: Font.Medium
                }
            }
        }

        Rectangle {
            visible: card.idleSecs > 0
            width: idlePillRow.width + 16
            height: idlePillRow.height + 4
            radius: 10
            color: Qt.rgba(250 / 255, 204 / 255, 21 / 255, 0.12)
            Row {
                id: idlePillRow
                anchors.centerIn: parent
                spacing: 4
                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "" // moon (quiet hours) glyph
                    font.family: "Segoe Fluent Icons"
                    font.pixelSize: 10
                    color: "#facc15"
                }
                Text {
                    text: card.formatDuration(card.idleSecs)
                    color: "#facc15"
                    font.pixelSize: 11
                    font.weight: Font.Medium
                }
            }
        }
    }

    // Body: status + bio (.previewBody)
    Column {
        id: body
        x: 16
        y: banner.height + 30 + 12 // below the avatar overlap + 12px padding
        width: parent.width - 32
        spacing: 6

        // .previewStatus (theme accent color when set)
        Text {
            width: parent.width
            visible: card.user ? card.user.status !== "" : false
            text: card.user ? card.user.status : ""
            color: {
                const p = card.cardPalette
                if (p && p.accentColor) return p.accentColor
                if (p && p.textColor) return p.textColor
                return Qt.rgba(1, 1, 1, 0.35)
            }
            font.pixelSize: 12
            elide: Text.ElideRight
        }
        // .previewBio (4-line clamp; theme-aware text color)
        Text {
            width: parent.width
            visible: card.user ? card.user.bio !== "" : false
            text: card.user ? card.user.bio : ""
            color: card.cardPalette && card.cardPalette.textColor
                   ? card.cardPalette.textColor : Qt.rgba(1, 1, 1, 0.55)
            font.pixelSize: 12
            lineHeight: 1.5
            wrapMode: Text.Wrap
            textFormat: Text.StyledText
            maximumLineCount: 4
            elide: Text.ElideRight
        }

        // Bio images (the web card renders the bio's HTML incl. <img>);
        // spilled thumbnails, first one only - the card is a preview.
        Item {
            readonly property var bioImage: {
                const list = card.user ? card.user.bioImages : null
                return list && list.length > 0 ? list[0] : null
            }
            readonly property real natW: bioImg.implicitWidth
            readonly property real natH: bioImg.implicitHeight
            readonly property real fitScale: natW > 0 && natH > 0
                ? Math.min(1, (card.width - 32) / natW, 170 / natH) : 0
            visible: bioImage !== null
            width: natW > 0 ? Math.round(natW * fitScale) : parent.width
            height: bioImage === null ? 0
                    : (natH > 0 ? Math.round(natH * fitScale) : 100)
            Image {
                id: bioImg
                anchors.fill: parent
                source: parent.bioImage ? parent.bioImage.thumb : ""
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                cache: false
                sourceSize: Qt.size(456, 340) // 2x the max painted box
                layer.enabled: parent.visible
                layer.effect: MultiEffect {
                    maskEnabled: true
                    maskSource: bioImgMask
                    maskThresholdMin: 0.5
                    maskSpreadAtMin: 1.0
                }
            }
            Item {
                id: bioImgMask
                anchors.fill: parent
                layer.enabled: true
                visible: false
                Rectangle { anchors.fill: parent; radius: 8; color: "#000000" }
            }
        }
    }
}
