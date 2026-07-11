#include "image_codec.h"

#include <QtCore/QBuffer>
#include <QtCore/QByteArray>
#include <QtCore/QCoreApplication>
#include <QtCore/QCryptographicHash>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QMimeData>
#include <QtCore/QStringList>
#include <QtCore/QTemporaryFile>
#include <QtCore/QUrl>
#include <QtGui/QClipboard>
#include <QtGui/QGuiApplication>

namespace {

/// Per-process on-disk cache for chat images (swept by media.rs on startup;
/// per-pid so concurrent instances never delete each other's files).
QString spillDir()
{
    return QDir::tempPath() + QStringLiteral("/qt6ui-chat-images/")
        + QString::number(QCoreApplication::applicationPid());
}

QString extForMime(const QString &mime)
{
    if (mime == QStringLiteral("image/jpeg")) return QStringLiteral(".jpg");
    if (mime == QStringLiteral("image/gif")) return QStringLiteral(".gif");
    if (mime == QStringLiteral("image/webp")) return QStringLiteral(".webp");
    if (mime == QStringLiteral("image/bmp")) return QStringLiteral(".bmp");
    if (mime == QStringLiteral("image/svg+xml")) return QStringLiteral(".svg");
    return QStringLiteral(".png");
}

} // namespace

QString image_to_jpeg_base64(const QImage &img, std::int32_t quality)
{
    QByteArray bytes;
    QBuffer buffer(&bytes);
    if (!buffer.open(QIODevice::WriteOnly))
        return {};
    if (!img.save(&buffer, "JPEG", static_cast<int>(quality)))
        return {};
    return QString::fromLatin1(bytes.toBase64());
}

QString bytes_to_base64(rust::Slice<const std::uint8_t> bytes)
{
    const QByteArray raw(reinterpret_cast<const char *>(bytes.data()),
                         static_cast<qsizetype>(bytes.size()));
    return QString::fromLatin1(raw.toBase64());
}

QString data_url_to_spill_file(const QString &dataUrl)
{
    // data:<mime>;base64,<payload>
    if (!dataUrl.startsWith(QStringLiteral("data:")))
        return {};
    const qsizetype comma = dataUrl.indexOf(QLatin1Char(','));
    if (comma < 0)
        return {};
    const QString header = dataUrl.mid(5, comma - 5);
    if (!header.endsWith(QStringLiteral(";base64")))
        return {};
    const QString mime = header.left(header.size() - 7);
    const QByteArray payload =
        QByteArray::fromBase64(dataUrl.mid(comma + 1).toLatin1());
    if (payload.isEmpty())
        return {};

    const QString dir = spillDir();
    if (!QDir().mkpath(dir))
        return {};
    const QByteArray digest =
        QCryptographicHash::hash(payload, QCryptographicHash::Sha1);
    const QString path =
        dir + QLatin1Char('/') + QString::fromLatin1(digest.toHex()) + extForMime(mime);
    if (!QFile::exists(path)) {
        QFile file(path);
        if (!file.open(QIODevice::WriteOnly))
            return {};
        if (file.write(payload) != payload.size()) {
            file.remove();
            return {};
        }
    }
    return path;
}

bool qimage_save_file(const QImage &img, const QString &path, std::int32_t quality)
{
    return img.save(path, nullptr, static_cast<int>(quality));
}

QString clipboard_image_path()
{
    const QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard == nullptr)
        return {};

    // A file copied in the file manager arrives as URLs, not raster data;
    // hand back the original path so nothing is re-encoded.
    // Extensions mirror IMAGE_EXTS in the web client's useDragDropAttachments.
    const QMimeData *mime = clipboard->mimeData();
    if (mime != nullptr && mime->hasUrls()) {
        static const QStringList kImageExts = {
            QStringLiteral("png"),  QStringLiteral("jpg"),  QStringLiteral("jpeg"),
            QStringLiteral("gif"),  QStringLiteral("webp"), QStringLiteral("avif"),
            QStringLiteral("bmp"),  QStringLiteral("svg"),  QStringLiteral("ico"),
        };
        const QList<QUrl> urls = mime->urls();
        for (const QUrl &url : urls) {
            if (!url.isLocalFile())
                continue;
            const QString path = url.toLocalFile();
            if (kImageExts.contains(QFileInfo(path).suffix().toLower()))
                return path;
        }
        return {};
    }

    // Raster data (screenshot, copied canvas...): stage it as a PNG the same
    // way the web client wraps clipboard blobs in a "clipboard.png" File.
    // Saved into the spill dir so the startup sweep reclaims it eventually.
    const QImage img = clipboard->image();
    if (img.isNull())
        return {};
    if (!QDir().mkpath(spillDir()))
        return {};
    QTemporaryFile file(spillDir() + QStringLiteral("/paste-XXXXXX.png"));
    file.setAutoRemove(false);
    if (!file.open())
        return {};
    if (!img.save(&file, "PNG")) {
        file.remove();
        return {};
    }
    const QString path = file.fileName();
    file.close();
    return path;
}
