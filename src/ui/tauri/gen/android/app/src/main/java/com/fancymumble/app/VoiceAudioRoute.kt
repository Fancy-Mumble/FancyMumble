package com.fancymumble.app

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Routes voice to where a group voice app belongs: a headset when one is
 * attached, the loudspeaker otherwise.
 *
 * Playback uses `USAGE_VOICE_COMMUNICATION`, which Android sends to the
 * *earpiece* unless something picks a communication device - so without
 * this every other speaker came out of the call receiver at the top of the
 * phone, too quiet to hear with the phone on a table. Communication mode is
 * also what engages the platform echo canceller for the `VoiceCommunication`
 * capture preset, which the loudspeaker needs.
 *
 * Held for as long as [ConnectionService] runs; [release] restores the mode.
 */
class VoiceAudioRoute(context: Context) {

    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private var previousMode = AudioManager.MODE_NORMAL
    private var active = false

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = route()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = route()
    }

    fun acquire() {
        if (active) return
        active = true
        previousMode = audio.mode
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.registerAudioDeviceCallback(deviceCallback, handler)
        route()
    }

    fun release() {
        if (!active) return
        active = false
        audio.unregisterAudioDeviceCallback(deviceCallback)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audio.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audio.isSpeakerphoneOn = false
        }
        audio.mode = previousMode
    }

    private fun route() {
        if (!active) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val candidates = audio.availableCommunicationDevices
            val pick = HEADSET_PREFERENCE.firstNotNullOfOrNull { type ->
                candidates.firstOrNull { it.type == type }
            } ?: candidates.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            if (pick != null) audio.setCommunicationDevice(pick)
        } else {
            val outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            val headset = outputs.any { it.type in HEADSET_PREFERENCE }
            // Below API 31 Bluetooth SCO needs startBluetoothSco(); a plain
            // speakerphone toggle is the part that matters here - off when a
            // headset is attached so the system routes to it, on otherwise.
            @Suppress("DEPRECATION")
            audio.isSpeakerphoneOn = !headset
        }
    }

    private companion object {
        val HEADSET_PREFERENCE = listOf(
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        )
    }
}
