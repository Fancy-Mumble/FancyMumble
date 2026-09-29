# Google Play release

How Fancy Mumble gets onto Google Play: what CI does, and the Play Console
steps that have to be done by hand.

## What CI does

The `build-android` job in `.github/workflows/ci.yml` builds a signed APK
(attached to GitHub releases, for sideloading) and a signed App Bundle
(`.aab`, the only format Play accepts), for arm64 and x86_64.

- **versionCode** is `(major*10000 + minor*100 + patch) * 10000 + suffix`,
  the suffix being the CI run number for a beta and 9999 for stable. Codes
  are unique per upload and sort by version, and a stable release sorts above
  all of its own betas.
- **Upload** runs on pushes to `beta` and `main` once the
  `PLAY_SERVICE_ACCOUNT_JSON` secret exists. Betas go to the *internal* track.
  Stable goes to the track in the `PLAY_STABLE_TRACK` repository variable,
  `alpha` (closed testing) by default. Set it to `production` once the
  account may publish there.
- The R8 `mapping.txt` goes up with each bundle so Play shows readable stack
  traces.

The bundle is also kept as the `fancy-mumble-Android-bundle` workflow
artifact, for a manual upload.

## One-time Play Console setup

1. **Create the app**: *Home → Create app*. Name "Fancy Mumble", default
   language, *App*, *Free*.
2. **App signing**: the first bundle upload asks about Play App Signing.
   Choose *Use a different key → Export and upload a key from Java keystore*
   and upload the existing release key (the `ANDROID_KEYSTORE_BASE64` secret)
   with the PEPK tool it offers. People who sideloaded the GitHub APK can then
   update from Play without uninstalling. If you let Google generate a key
   instead, those installs clash with the Play build and must uninstall first.
   Either way the key CI signs with becomes the *upload key*.
3. **First upload by hand**: *Testing → Internal testing → Create release*,
   drop in the `.aab` from the workflow artifact, save and roll out. Play takes
   API uploads only as drafts until an app has had a release, so for this
   stretch set the repository variable `PLAY_RELEASE_STATUS=draft`, then
   delete it.
4. **Service account for CI**: *Google Cloud Console* → create a service
   account and a JSON key. Then *Play Console → Users and permissions →
   Invite new user*, enter the service account's e-mail and give it *Release
   apps to testing tracks* (plus *Release to production* when wanted) on this
   app. Store the JSON as the repository secret `PLAY_SERVICE_ACCOUNT_JSON`.
5. **Closed testing requirement**: personal developer accounts created after
   13 November 2023 must run a closed test with at least 12 testers who stay
   opted in for 14 days before *Production* unlocks. Create the closed
   testing track (*alpha*), add the testers' Google accounts or a Google
   Group, share the opt-in link, and apply for production access afterwards.
   Organisation accounts skip this.

## App content (Policy → App content)

- **Privacy policy**:
  `https://github.com/Fancy-Mumble/FancyMumble/blob/main/PRIVACY.md`
- **Ads**: no ads.
- **App access**: all features work without an account of ours, but the
  reviewer needs a server to connect to. Give the address of a public test
  server, and a username and password if it needs one.
- **Content rating**: questionnaire, category *Communication*. "Users can
  interact or exchange content": *yes*. "Shares the user's location": *no*.
  Expect a rating around Teen / PEGI 12 because of unmoderated user
  communication.
- **Target audience**: 13+ (or 18+). Picking an age below 13 pulls in the
  Families policy.
- **News app**: no. **COVID app**: no. **Government app**: no.
- **Financial features**: none. **Health**: none.
- **Foreground service permissions**: declare
  - `FOREGROUND_SERVICE_MICROPHONE`: *keeps an active voice call running
    while the app is in the background*. Attach a short screen recording
    that joins a server, talks, and switches away from the app.
  - `FOREGROUND_SERVICE_REMOTE_MESSAGING`: *keeps the connection to the chat
    server open in the background so messages arrive*.

## Data safety form

The developers collect nothing, but Play counts data sent off the device to
servers the user picks as *shared*. The honest answers:

| Question | Answer |
| --- | --- |
| Collects or shares user data? | Yes |
| Encrypted in transit? | Yes (TLS to the server) |
| Users can request deletion? | Data lives on the device and on third-party servers; deleting the app removes local data |
| Personal info → Name (username) | Shared; app functionality; not optional |
| Messages → Other in-app messages | Shared; app functionality; optional |
| Photos and videos | Shared; app functionality; optional (user-sent images) |
| Audio → Voice or sound recordings | Shared; app functionality; not optional |
| Files and docs | Shared; app functionality; optional |
| Device or other IDs | Shared; app functionality; optional (FCM push token, only when a server supports push) |

Nothing is collected for analytics, advertising, or fraud prevention.

## Store listing

**Short description** (80 characters max):

> Modern Mumble voice chat: low latency, rich chat, E2E encrypted messages.

**Full description:**

> Fancy Mumble is a modern client for Mumble, the open-source, low-latency
> voice chat used by gaming groups, podcasts and communities.
>
> • Crystal-clear, low-latency voice with noise suppression
> • Rich text chat with images, link previews, reactions and voice messages
> • End-to-end encrypted private conversations
> • Works with any Mumble server, plus extra features on Fancy servers
> • Push notifications for new messages
> • No ads, no tracking, open source (MIT)
>
> Connect to your community's server or browse the public server list.

**Graphics** Play asks for:

- App icon 512×512 PNG (from `crates/mumble-tauri/icons/`).
- Feature graphic 1024×500 PNG/JPG.
- At least 2 phone screenshots (16:9 or 9:16, 320–3840 px on each side).
  7-inch and 10-inch tablet screenshots are optional.
- Category: *Communication*. Contact e-mail is required and is shown
  publicly.
