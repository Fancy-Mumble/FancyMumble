package com.fancymumble.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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

        // Ask for everything the app needs from the start in one request: the
        // microphone, so the Oboe capture stream can open when the user
        // unmutes, and on Android 13+ notifications. Android shows one
        // permission dialog at a time and silently drops a second request
        // made while it is up - which is what happened to the notification
        // prompt the page used to raise a moment after this one, so a fresh
        // install never got to allow notifications at all.
        val wanted = buildList {
            add(Manifest.permission.RECORD_AUDIO)
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