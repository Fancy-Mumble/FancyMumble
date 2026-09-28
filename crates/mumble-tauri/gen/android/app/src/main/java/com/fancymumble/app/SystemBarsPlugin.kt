package com.fancymumble.app

import android.app.Activity
import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
internal class BarStyleArgs {
    /** True when the page behind the bars is light, so their icons go dark. */
    var light: Boolean = false
}

/**
 * The edges of the screen the page cannot see for itself.
 *
 * The app targets SDK 35+, so Android draws it edge to edge whether it asks
 * or not: the WebView runs under the status bar, under the gesture bar, and -
 * because `adjustResize` stops meaning anything once a window is edge to edge
 * - under the keyboard too. The page was meant to answer the first two with
 * `env(safe-area-inset-*)`, but the system WebView reports only the display
 * cutout there, never the bars, so the bottom inset is always 0 and the top one
 * is right only on a phone whose camera notch happens to be as tall as its
 * status bar.
 *
 * So this does the three things the page cannot:
 *
 * - publishes the bars' real insets as `--fm-safe-{top,right,bottom,left}` on
 *   `<html>`, in CSS pixels, for the page to pad itself with;
 * - shrinks the WebView by the keyboard's height, which is what `adjustResize`
 *   did before edge to edge took it away - so a focused input stays above the
 *   keyboard and the page's `100dvh` is the part you can see;
 * - sets the bar icons dark or light when the page says what it is painting
 *   behind them. Left alone they stay white, which on a light theme is a
 *   clock nobody can read.
 */
@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {

    private var webView: WebView? = null

    /** The last insets published, so a page that reloads can be sent them again. */
    private var published = FloatArray(4)

    override fun load(webView: WebView) {
        this.webView = webView
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            // The keyboard is taken off the WebView's height by its parent, so
            // the page shrinks rather than being drawn over.
            val parent = view.parent as? View
            if (parent != null && parent.paddingBottom != keyboard) {
                parent.setPadding(0, 0, 0, keyboard)
            }
            // The keyboard covers the gesture bar, so while it is up the page
            // has no bottom inset left to clear.
            val density = view.resources.displayMetrics.density
            published = floatArrayOf(
                bars.top / density,
                bars.right / density,
                maxOf(bars.bottom - keyboard, 0) / density,
                bars.left / density,
            )
            publish()
            // Passed on, so the WebView still sees the cutout for its own
            // `env()` values and nothing downstream loses the insets.
            ViewCompat.onApplyWindowInsets(view, insets)
        }
        ViewCompat.requestApplyInsets(webView)
    }

    /** Write the insets onto `<html>`, where every stylesheet can read them. */
    private fun publish() {
        val view = webView ?: return
        val (top, right, bottom, left) = published.toList()
        val script = "(function(s){" +
            "s.setProperty('--fm-safe-top','${top}px');" +
            "s.setProperty('--fm-safe-right','${right}px');" +
            "s.setProperty('--fm-safe-bottom','${bottom}px');" +
            "s.setProperty('--fm-safe-left','${left}px');" +
            "})(document.documentElement.style)"
        view.evaluateJavascript(script, null)
    }

    /**
     * Dark icons over a light page, light icons over a dark one.
     *
     * Also the page's way of saying it has loaded: the insets are sent again
     * with the answer, since a reloaded page has lost the ones it was given.
     */
    @Command
    fun setStyle(invoke: Invoke) {
        val args = invoke.parseArgs(BarStyleArgs::class.java)
        activity.runOnUiThread {
            val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            controller.isAppearanceLightStatusBars = args.light
            controller.isAppearanceLightNavigationBars = args.light
            publish()
        }
        invoke.resolve()
    }
}
