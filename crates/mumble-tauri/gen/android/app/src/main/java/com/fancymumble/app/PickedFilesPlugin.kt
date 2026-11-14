package com.fancymumble.app

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
internal class LocalCopyArgs {
    /** The `content://` address the system file picker handed back. */
    var uri: String = ""
}

/**
 * Turns what the system file picker hands back into a file the rest of the app
 * can use.
 *
 * Android's picker answers with a `content://` address, not a path: its last
 * part is a document id such as `image%3A1000000020`, not the file's name, and
 * nothing that reads files by path - the size, the preview, the uploader - can
 * open it. So a picked file is copied once into the app's cache, under the name
 * the provider reports for it, and the copy is what gets staged and sent.
 *
 * The copy is streamed, so a large video costs disk, not memory. Copies older
 * than a day are cleared when the plugin loads.
 */
@TauriPlugin
class PickedFilesPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val DIR = "picked"
        private const val MAX_AGE_MS = 24L * 60 * 60 * 1000
    }

    private val root: File get() = File(activity.cacheDir, DIR)

    override fun load(webView: WebView) {
        super.load(webView)
        val cutoff = System.currentTimeMillis() - MAX_AGE_MS
        root.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.deleteRecursively() }
    }

    @Command
    fun localCopy(invoke: Invoke) {
        val args = invoke.parseArgs(LocalCopyArgs::class.java)
        // Off the main thread: a picked video can take seconds to copy.
        Thread {
            try {
                val uri = Uri.parse(args.uri)
                val name = sanitize(displayName(uri) ?: uri.lastPathSegment ?: "file")
                // A folder per copy, so two picks of files with the same name
                // never overwrite each other and the name stays the file's own.
                val dir = File(root, System.nanoTime().toString()).apply { mkdirs() }
                val target = File(dir, name)
                val input = activity.contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("the provider gave no stream for ${args.uri}")
                input.use { from -> target.outputStream().use { to -> from.copyTo(to) } }
                invoke.resolve(
                    JSObject()
                        .put("path", target.absolutePath)
                        .put("name", name)
                        .put("size", target.length())
                )
            } catch (e: Exception) {
                invoke.reject("could not read the picked file: ${e.message}")
            }
        }.start()
    }

    /** The name the provider shows for the file, if it says one. */
    private fun displayName(uri: Uri): String? =
        activity.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
            ?.takeIf { it.isNotBlank() }

    /** A provider's name made safe to use as one file name. */
    private fun sanitize(name: String): String =
        name.replace(Regex("[/\\\\:*?\"<>|\\u0000]"), "_").trim().ifEmpty { "file" }
}
