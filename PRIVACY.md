# Privacy Policy

Fancy Mumble is an open-source voice and chat client for Mumble servers. This
policy covers the Fancy Mumble apps for Android, Windows, macOS and Linux.

## What the developers collect

Nothing. The app has no analytics, no telemetry, no crash reporting and no
advertising. The developers do not run a service that receives your voice,
messages, contacts or usage data.

## Where your data goes

Fancy Mumble talks to the **servers you choose to connect to**. Those servers are
run by third parties (or by you), not by the Fancy Mumble developers, and
their operators decide how data is kept. When you connect, a server receives:

- your IP address, username and client certificate (your identity on that
  server),
- your voice while you transmit,
- the messages, images and files you send,
- your profile (avatar, description) if you set one.

Read the rules of the server you join; its operator's privacy policy applies to
what you send there.

A few other requests leave the app:

- **Public server list**: when you open the server browser, the list is
  fetched from `publist.mumble.info`, which sees your IP address.
- **Plugin registry**: browsing plugins fetches from
  `plugins.fancy-mumble.com`, which sees your IP address.
- **Push notifications (Android)**: if a server you use supports push, the
  app hands that server a Firebase Cloud Messaging token so it can notify you
  of new messages. Delivery goes through Google Firebase, under
  [Google's privacy policy](https://policies.google.com/privacy).
- **Updates (desktop)**: the desktop app checks GitHub for new releases.
  GitHub sees your IP address. The Google Play version is updated by Google
  Play instead.

## Permissions (Android)

- **Microphone**: to transmit your voice while you are connected and
  talking, and to record a voice message when you hold the record button.
  Audio is sent only to the server you are connected to. The app records a
  call only when you start a recording yourself, and saves it on your device.
- **Notifications**: to tell you about messages and calls.
- **Foreground service**: to keep a voice connection alive while the app is
  in the background.

## Data on your device

Settings, saved servers, your client certificate and message history are
stored on your device. Uninstalling the app removes them. End-to-end encrypted
conversations keep their keys on your device only.

## Children

Fancy Mumble is not directed at children under 13.

## Changes and contact

Changes to this policy are published in this file, and its history is in the
project's Git repository. For questions, open an issue at
<https://github.com/Fancy-Mumble/FancyMumble/issues>.

Last updated: 2026-09-29
