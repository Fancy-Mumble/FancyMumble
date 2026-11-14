package com.fancymumble.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {

    companion object {
        private const val REQUEST_LAUNCH_PERMISSIONS = 1
        const val EXTRA_CHANNEL_ID = "channel_id"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure the "messages" notification channel exists before any
        // FCM message can arrive (required on Android 8+).
        FcmService.ensureChannel(this)

        // Ask at launch only for what the app needs before anyone does
        // anything: on Android 13+, notifications. The microphone is asked for
        // when voice is first turned on (`ConnectionServicePlugin
        // .requestMicrophone`), where the question makes sense - asked here,
        // it came up on every launch of a text-only user until denied twice.
        // The page raises no permission prompt of its own at launch, so this
        // one is never dropped for coming second.
        val wanted = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (wanted.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, wanted.toTypedArray(), REQUEST_LAUNCH_PERMISSIONS)
        }

        // The last word on the back gesture. The page answers it first - Tauri
        // hands it over while the page listens, which Nebula does whenever it
        // has a pane, sheet or dialog to step back from - so this only runs
        // at the root. There it sends the app to the background, as back does
        // in every other app, rather than finishing the activity: the
        // connection lives in ConnectionService and survives, and a finished
        // activity would have to reload the page. It still never reaches
        // history.back(), which is what used to disconnect.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                moveTaskToBack(true)
            }
        })

        // Handle channel navigation from notification tap at cold start.
        handleChannelIntent(intent)
    }

    /**
     * Come back from the page's renderer going away instead of crashing.
     *
     * The dead WebView is taken out and destroyed, as the platform asks, and
     * the app starts again from its launch screen. It cannot keep its
     * connection: the connection lives in this process, and the page cannot
     * be given a new WebView in it - Tauri builds the WebView once per app,
     * and building the activity again (`recreate()`) runs the whole app a
     * second time, which panics. So the process is ended on purpose, the
     * connection service with it (left running, the system would restart it
     * on its own into a process with no page), and the activity is started
     * fresh; a server set to connect on launch reconnects.
     */
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.post {
            RenderGoneGuard.install(webView) { gone ->
                (gone.parent as? ViewGroup)?.removeView(gone)
                gone.destroy()
                ConnectionService.stop(this)
                startActivity(Intent.makeRestartActivityTask(componentName))
                Runtime.getRuntime().exit(0)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleChannelIntent(intent)
    }

    /**
     * If the intent carries an [EXTRA_CHANNEL_ID], notify the Rust
     * backend via the Tauri plugin so the frontend can navigate to
     * the correct channel.
     */
    private fun handleChannelIntent(intent: Intent?) {
        val channelId = intent?.getIntExtra(EXTRA_CHANNEL_ID, -1) ?: -1
        if (channelId >= 0) {
            ConnectionServicePlugin.navigateToChannel(channelId)
            // Clear the extra so re-delivery does not re-navigate.
            intent?.removeExtra(EXTRA_CHANNEL_ID)
        }
    }
}