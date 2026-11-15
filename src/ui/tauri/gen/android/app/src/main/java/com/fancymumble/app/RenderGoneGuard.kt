package com.fancymumble.app

import android.graphics.Bitmap
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat

/**
 * Keeps the app alive when the WebView's renderer process goes away.
 *
 * The page runs in a separate, sandboxed process that the system may kill on
 * its own - under memory pressure, with a big conversation of pictures open in
 * the background - or that may crash. A WebView whose client does not answer
 * `onRenderProcessGone` takes the whole app down with it: a "keeps stopping"
 * dialog, and an app that is simply gone. Answering it lets the activity
 * decide what to do instead (see `MainActivity.onWebViewCreate`).
 *
 * wry sets its own client after the activity's `onWebViewCreate` hook returns,
 * and that class is generated and final, so this wraps it: every method wry's
 * client answers is passed through unchanged, and only the one it does not
 * answer is added.
 */
class RenderGoneGuard private constructor(
    private val inner: WebViewClient,
    private val onGone: (WebView) -> Unit,
) : WebViewClient() {

    companion object {
        /**
         * Wrap the client [webView] has now. Posted from `onWebViewCreate`, so
         * it runs once wry has finished setting the WebView up.
         */
        fun install(webView: WebView, onGone: (WebView) -> Unit) {
            // The callback exists from API 26; below that there is nothing to
            // answer, and no way to read the client back to wrap it.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val inner = WebViewCompat.getWebViewClient(webView)
            if (inner is RenderGoneGuard) return
            webView.webViewClient = RenderGoneGuard(inner, onGone)
        }
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
        inner.shouldInterceptRequest(view, request)

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
        inner.shouldOverrideUrlLoading(view, request)

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
        inner.onPageStarted(view, url, favicon)

    override fun onPageFinished(view: WebView, url: String) = inner.onPageFinished(view, url)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) =
        inner.onReceivedError(view, request, error)

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        Logger.warn("WebView renderer gone (crashed=${detail.didCrash()}); starting the app again")
        onGone(view)
        // Handled: without this the platform ends the app.
        return true
    }
}
