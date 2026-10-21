# PakChat: the complete build spec

Give this file to any agent that works on PakChat. It says what to build, how, in what order,
and the rules to follow. If something isn't covered here, **do what today's web app does**
(`web/src`), and if it still isn't clear, ask the owner one short question.

`roadmap.md` is the one-page version of this file. `whatsapp-gap.md` is the feature comparison,
and `LEARN.md` (in the repo) holds the owner's learning notes.

The phase numbers in this file follow the launch plan. If the plan and this file ever differ, the plan wins.

---

## 0. The owner's own steps (just for you)

Most of the work is done by the agent. These are the only things you do, in order:

1. **Deploy Batch 10**, if you haven't yet, using the three commands from its reply.
2. **Save this file and the launch plan** in your project files and your pakchat folder, and push them.
3. **Start phase 0:** open a new thread and say "phase 0, follow PAKCHAT-SPEC.md and the plan".
4. **Install the tools** on your MacBook Air with the commands the agent gives you (Elixir,
   Postgres, Expo). Check that the server and the app both start.
5. **Decide two things before phase 2:** who PakChat is for first (students and friend groups is the
   default), and whether you're happy to launch with basic encryption and add end-to-end later if the
   phase 1 test fails (the default is yes).
6. **For each phase from 1 to 9:** open a new thread, say "phase N, follow PAKCHAT-SPEC.md and the
   plan", then unzip, run and push what comes back. From phase 4, also install the test app (APK)
   on your Android phone and try it.
7. **Phase 5:** make an account with a phone sign-in provider (it needs your card).
8. **Phase 9:** pick the 50 to 200 people for the closed beta and collect what they report.
9. **Phase 10:** run the move-across script on your Mac when the agent asks. Say yes to switching
   Firebase off only once everyone has moved.
10. **Phase 11:** make the accounts that need your card: the server host and Google Play (a one-time
    fee). Then publish. The iPhone app and its yearly Apple fee come later.

---

## 1. Ground rules (always, no exceptions)

**Devices**
- Before doing anything on the owner's own device, ask which device they're on and confirm it by name.
- The owner's own Mac is a **MacBook Air**.
- **Never touch "Muhammad's MacBook Pro" in any way.** Don't request folders on it and don't run
  anything on it, even if it shows up as linked.
- Every request for access to a device says which device it is for.

**GitHub**
- The owner's repo is `github.com/faheemsshah7-pixel/pakchat`. The owner pushes from their Mac.
- **Never use the `shersubs29-blip` GitHub account or any of its repos.** It belongs to the owner's
  brother.
- Don't push anywhere unless the owner has connected their own account and asked for it.

**Secrets**
- Never ask for passwords, tokens or keys in chat.
- Secrets live only in files on the Mac that git ignores (`web/.env.local`, `server/.env`) or in the
  host's secret settings. Never commit them.
- Don't put AI model names or IDs in any file in the repo.

**Production**
- Never create test accounts on production, or write to it, while building or testing. That covers
  the live Firebase project `pakchat-f89d8`, and later the live Phoenix server and its database.
- Test against local copies only: Firebase emulators today, then a local Phoenix and Postgres.

**Working with the owner**
- The owner is learning, so keep instructions very simple and short.
- Comment the code so a learner can follow it, and add a step to `LEARN.md` for every phase.
  Keep its usual style: the tools, the files, how it works, and "Try this".
- No time estimates. The owner wants speed.
- Questions should be answerable in one word, with one line per option and your pick marked.
- Only start a phase when the owner asks for it.

**Saving tokens** (the owner's limits matter)
- Use one fresh thread or session per phase, starting from this file.
- Read only the files the task needs. Don't re-read the whole repo.
- While working, test only the parts that changed. Run the full test suite once, before delivering.
- Write what you learn into the notes files (this one, `LEARN.md`, `whatsapp-gap.md`), so the next
  agent doesn't have to rediscover it.

---

## 2. What PakChat is

PakChat is a messaging app for the **public in Pakistan**, built **the WhatsApp way** but with
PakChat's own look and feel.

Today it's a website (https://pakchat-f89d8.web.app) on Firebase, with real users. The goal is:

- **A phone app is the main device.** It's built in React Native, for Android first and then
  iPhone, and it keeps the chats on the phone.
- **A Phoenix server only relays.** It holds a message until it's delivered, then deletes it.
- **Everything is end-to-end encrypted** with the Signal Protocol. Nobody can read chats, not even
  whoever runs the server.
- **The website becomes a linked device.** You scan a QR code with the phone app, like WhatsApp
  Web. On a phone, the website shows "Get the PakChat app" with store buttons.

**"My way": PakChat's own touches (keep all of these)**
- Five looks: **Aurora** (the default, and always used on the sign-in screens), Emerald,
  Midnight, Sunset and Ocean.
- The logo (a chat bubble with the crescent and star), and the chat background doodles (chai, a
  kite, a crescent…).
- **English and Urdu.** Urdu keeps the same layout, mirrored for right-to-left.
- PakChat's own sticker pack, plus stickers you make from a photo.
- **Light on mobile data, and fine on cheap Android phones and slow networks.**
- Short, subtle movement like WhatsApp's, turned off when Reduce motion is on.

---

## 3. Architecture

```
 Phone app (React Native)  ── always-open connection ──┐
   chats stored on the phone (SQLite, encrypted)       │
                                                        ▼
 Website (React, linked device) ── connection ──► Phoenix server ──► Postgres
   history synced from the phone                  (relay only:        (accounts, devices, keys,
                                                   holds encrypted      groups, waiting messages)
                                                   messages until
                                                   delivered)
                                                        │
             encrypted files ◄── upload/download ──► File storage (S3-style)
             alerts when closed ◄── Google's / Apple's push service
             calls: phone to phone (WebRTC), through a TURN relay when needed
```

### The stack

| Part | Use | Notes |
| --- | --- | --- |
| Server | **Elixir + Phoenix** | Channels for each device's connection, Presence for who's online |
| Server database | **Postgres** (with Ecto) | Never stores message contents in readable form |
| Background jobs | **Oban** | Push alerts, cleaning up expired messages and files |
| Files | S3-style storage | Holds files that are already encrypted. Signed upload and download links come from the server |
| Phone app | **React Native with Expo**, TypeScript | Android first, iPhone after |
| On the phone | SQLite, encrypted (SQLCipher) | Chat history, with full-text search (FTS5) |
| Website | Today's React 19 + Vite + TypeScript app | Switches from Firebase to Phoenix. History lives in IndexedDB |
| Shared code | TypeScript package `shared/` | The protocol, encryption, chat logic and storage interfaces, used by both app and website |
| Encryption | The Signal Protocol | Use a maintained, well-tested library (the official libsignal if its bindings fit; otherwise a maintained TypeScript implementation). **Never write your own crypto.** |
| Alerts | FCM (Android), APNs (iPhone) | Keep the Firebase project only for FCM (and Hosting, if the website stays at its current address) |
| Calls | WebRTC + a TURN relay (coturn) | Short-lived relay passwords come from the server |
| Lint and format | oxlint (web), `mix format` + Credo (server) | The same rules as today |

### Repo layout

```
pakchat/
  server/     Phoenix app (Elixir)
  shared/     TypeScript: protocol, encryption, chat logic (npm workspace)
  app/        React Native (Expo): Android and iPhone
  web/        React website: the linked device
  LEARN.md    the owner's learning notes (one step per phase)
  PAKCHAT-SPEC.md, README.md
  firebase.json, firestore.rules, firestore.indexes.json   (until the move in phase 10)
```

---

## 4. How it works

### Accounts and devices
- **Sign-in** is with Google, as today. The app gets a Google ID token, and the server checks it
  and gives that device its own session token. Phone-number sign-in is added in phase 5 (see the open
  decisions).
- **Devices.** Each account has one phone (the main device) plus up to 4 linked devices.
  - Every device has its own Signal identity key.
  - To link a website, you scan its QR code with the phone app. The phone approves it and sends it
    the history, encrypted.
- **Finding people** works by Gmail, as today, and by phone number from phase 5. Lookups are rate-limited.

### Sending (store and forward)
1. The sender's device encrypts the message **separately for each of the other person's devices,
   and for the sender's own other devices** (so they stay in sync), using the Signal Protocol.
2. These "envelopes" go to the server over the device's channel. The server can only see who it's
   for, a type, and the time.
3. **If the device is online**, the server pushes the envelope to it straight away.
   **If it's offline**, the server saves it in `pending_envelopes` and sends a push alert with no
   content in it. The app wakes up, connects and collects its messages.
4. The device confirms it has the envelope, and the **server deletes it.** Anything nobody
   collects is deleted after **30 days**.
5. **Groups** use Signal's "sender keys": a message is encrypted once and the server copies it to
   every member's device.
   - The server knows who's in a group, so it can enforce who may send, admins, "only admins can
     send", and invite links.
   - It never knows what was said.
6. **Edits, deletes for everyone, reactions, poll votes, pins and disappearing-timer changes** are
   all encrypted messages too, and each device applies them to its own copy. They keep the same
   rules and time limits as today's app (`web/src/messages.ts` and friends).

### Ticks, typing and online
- **Delivered and read ticks** are small envelopes holding a message ID and a status, with no
  content.
- **Typing…** is a live event only, never stored.
- **Online and last seen** come from Phoenix Presence. The server only shows them to the people the
  owner's privacy settings allow.

### Files (photos, videos, voice notes, documents)
- The device encrypts each file with a fresh random key, then uploads the locked file through a
  signed link from the server.
- The key, a hash of the file, its size and type, and a tiny blurred preview all travel inside the
  encrypted message.
- The receiver downloads the file, checks the hash and decrypts it.
- The server deletes files after 30 days. Forwarding re-uses the same file while it still exists.
- The size limit is a server setting. **Start at 100 MB.** It can go up to 2 GB later.
- **Auto-download settings** (Wi-Fi, mobile data, never) are there to save data. This is new.

### Calls
- Calls use WebRTC, going phone to phone when possible and through the TURN relay when not. The
  call set-up messages travel over the channel, encrypted.
- **Ringing when the app is closed:**
  - Android: a high-priority FCM alert and ConnectionService.
  - iPhone: PushKit and CallKit.
- **Group calls** connect everyone to everyone, up to 8 people, as today. A call server for bigger
  calls comes later.
- Call links, scheduled calls, screen sharing (on a computer) and the Calls list stay, as today.

### Status
- Status updates are encrypted and sent to the contacts the privacy settings allow. The server
  deletes them after 24 hours.

### Storage on the device, and backups
- **App:** SQLite, encrypted on the phone. Files are kept in the app's own storage, and search
  runs on the phone.
- **Website:** IndexedDB, filled by history sync from the phone.
- **Backups** are encrypted with a password or key only the user knows, then uploaded. The server
  can't read them. Restoring on a new phone brings the chats back.

### Safety
- **Verify security code:** a QR code or number to compare with a contact, like WhatsApp's.
- **Block:** the server stops relaying anything from people you've blocked.
- **Report:** the reporter's own device sends the last few messages of that chat with the report,
  as WhatsApp does. The server can't read chats any other way.
- **Rate limits** apply to sign-ups, sending, lookups and invite links.
- **Link previews** are made by the sender's device. The website may need a small fetch-only proxy
  on the server that keeps no logs, because browsers block reading other sites directly.
- **GIF search** (KLIPY) goes through the server, so the key never ships inside the app.
- **Chat lock and app lock** (phone): a fingerprint or PIN opens a locked chat or the whole app.
  This is new.

### What the server stores (Postgres)
- `users`: name, photo, about, Gmail and phone (for finding people), privacy settings, last seen.
- `devices`, plus the Signal public keys: identity keys and one-time pre-keys. Public keys only.
- `groups`, `group_members` and `communities`: titles, photos, admins, settings and invite codes.
- `pending_envelopes`: encrypted bytes, which device it's for, and when it expires.
- `files`: an ID, size and expiry time. The contents are encrypted and stored in file storage.
- `push_tokens`, `blocks`, `reports`, `call_links` and `scheduled_calls`.
- **Never stored:** message text, captions, file keys, or anything else readable from a chat.

---

## 5. Features: everything today's PakChat has must carry over

These all exist in today's web app (`web/src`). Use it as the reference for how each one looks
and behaves.

**Chats**
- Chats with one person, and groups with admins and invite links.
- Ticks (sent, delivered and read), typing…, and online and last seen.
- Reply, react, forward, edit, delete for everyone, star, pin and search.
- Disappearing messages, mute, archive, block and report, and drafts.
- Polls, stickers (PakChat's pack, plus ones you make from a photo), and GIFs from KLIPY with search.
- @mentions and "reply privately" in groups, and messaging yourself.
- Link previews, and Export chat.
- Broadcast lists, and communities (with an announcements group, groups to join, and invite links).

**Media**
- Photos (including HD), videos, voice notes (with transcripts) and documents.
- Location (including live location), and contact cards.
- View-once photos, videos and voice notes, and round video messages.
- Photo editing: crop, rotate, draw and text.
- "Media, links and docs" for each chat (tabs, grouped by month).
- A photo viewer with ‹ › arrows and a strip along the bottom.

**Calls**
- Voice and video calls with one person, and group calls of up to 8 people.
- Screen sharing (on a computer), call links, scheduled calls, and the Calls tab with favourites
  and group calls.

**Status**
- Photos, videos and words that last 24 hours, with seen, likes, replies, mute and privacy.

**The app itself**
- WhatsApp's chat menu: open in new window (website), mark unread, archive, pin, mute ›, info,
  export, clear, and delete or leave.
- The five looks, a wallpaper and a notification tone for each chat, and conversation tones with a
  loudness slider.
- English and Urdu, and the privacy settings.
- The left bar on a computer (a bottom bar on phones), Settings as a window, and Back that steps
  back through screens.

**New in the rebuild**
- End-to-end encryption, and alerts and ringing calls when the app is closed.
- Big files, and auto-download settings.
- Linked devices with QR, encrypted backups, and "Verify security code".
- Chat lock and app lock.
- Channels: later, and optional.

---

## 6. Design and feel

- **Copy today's web app's design** (`web/src/index.css`, `web/src/screens`) into the phone app,
  shaped for a phone in the way WhatsApp's own phone app is.
- **Every colour is a theme variable.** The five looks are just sets of values.
- **Urdu is right-to-left** with the same layout, mirrored.
- **Movement is short and subtle:**
  - Panels slide, rows slide when a chat moves up, and new messages grow from their corner.
  - It's all off when Reduce motion is on.
- **Speed matters more than anything:**
  - Messages show the moment you press send, and send later if you're offline.
  - The app opens fast on a cheap Android phone.
  - Long chats scroll smoothly (use virtualised lists).
- **Data:** previews are tiny, photos are compressed (except HD), and auto-download follows the
  settings.
- **Accessibility:** good contrast in every look, labels for screen readers, and buttons big enough
  to tap.

---

## 7. The phases

Each phase ends with a delivery and a new step in `LEARN.md`. Today's Firebase PakChat stays live
and untouched until phase 10. The Google Play launch (phase 11) comes last, after everything is
built and tested a lot.

The build runs in three stages: phases 0 to 5 build the core app, phases 6 to 8 finish the features
and the website, and phases 9 to 11 test it with real people, move users across and launch.

### Phase 0: Set up
- Create `server/`, `shared/` and `app/` next to `web/`, with npm workspaces.
- Write simple install steps for the MacBook Air: Elixir (Homebrew), Postgres (Postgres.app or
  Homebrew), and the Expo tools.
- `LEARN.md`: what Elixir, Phoenix, Postgres and React Native are.
- **Done when:** `mix phx.server` and `npx expo start` both run on the Mac.

### Phase 1: Encryption spike
- Before building the server, prove the hardest part. Using a maintained Signal library on React
  Native, make two phones and one group exchange encrypted messages, and have one phone go offline
  and catch up.
- Use test data only.
- **Done when:** messages decrypt on both phones and in the group after a reconnect.
- **If it can't be made to work:** stop and tell the owner. The fallback is to launch with
  transport encryption first and add end-to-end encryption in a later release.
- **Result (20 Oct): it works.** All 10 steps passed on the owner's Pixel (release APK) and in the cloud tests. What the next agents need to know:
  - We use Signal's official **libsignal 0.105.1**, wrapped in a local Expo module
    (`app/modules/pakchat-signal`, Kotlin). Signal now publishes it on its own Maven server
    (`build-artifacts.signal.org/libraries/maven`), not Maven Central; `app/plugins/withSignal.js` adds
    that server, turns on core library desugaring (libsignal needs it), and drops libsignal's test
    and desktop native libraries from the APK.
  - Every bundle includes a Kyber (post-quantum) pre-key; libsignal requires one now.
  - Watch out: `SessionBuilder(store, remote, local)` but `SessionCipher(store, local, remote)`.
  - Release builds shrink code with R8, which deleted libsignal's JNI callbacks (the stores) even with
    libsignal's own rules. `modules/pakchat-signal/android/proguard-rules.pro` keeps all of
    `org.signal.libsignal.**`. Always test the release APK, not only the unit tests.
  - JavaScript talks to it through the `SignalApi` interface (`app/src/spike/types.ts`). Phase 3's
    shared core should keep that interface, so the same logic runs on the phone and in tests.
  - Tests: Kotlin unit tests (`./gradlew :pakchat-signal:testDebugUnitTest`, need Java 21) and the
    full scenario in Node with `@signalapp/libsignal-client` (`app/spike-check`, `npm test`).
  - libsignal has no browser build. The website (phase 8) will need another plan for its
    encryption, such as WebAssembly or a maintained compatible library. Decide it in phase 3.
  - In the cloud, Maven Central rate-limits builds. Use Google's mirror
    (`maven-central.storage-download.googleapis.com/maven2`) in a Gradle init script.

### Phase 2: The Phoenix server
- Google sign-in, device sessions, profiles, and finding people by Gmail.
- Chats with one person and groups (admins, invite links, only admins can send).
- Channels, `pending_envelopes`, delete on delivery and after 30 days, and push alerts (stubbed
  for now).
- Every chat gets a counter assigned by the server. A device asks for "everything after N", so
  reconnecting on a weak network is simple and safe.
- Ticks, typing… and Presence (online and last seen, following the privacy settings).
- Rate limits, and block.
- **Done when:**
  - ExUnit tests prove that nobody can send to, or read for, a chat or device they don't belong to.
  - They prove that envelopes vanish once they're delivered.
  - They prove the privacy settings are obeyed.
- **Result (21 Oct): done.** 55 ExUnit tests pass, `mix format` and `mix credo --strict` are clean, and a
  real WebSocket test (Phoenix's JS client) sent, received and acked an envelope. What the next agents need to know:
  - `server/README.md` lists every address. JSON uses snake_case and base64 for bytes. A key bundle has the
    same fields as the spike's `Bundle` type, in snake_case (`pre_key_id`, `kyber_pre_key`…); `pre_key` is
    null when the one-time keys run out, and the Kyber key falls back to the last-resort one.
  - Sign-in: `POST /api/auth/google` with `id_token`, `device` (public keys) and optional `pre_keys` /
    `kyber_pre_keys`. It returns a session token (only its SHA-256 is stored). Signing in again replaces
    every device. The server needs `GOOGLE_CLIENT_IDS` in `server/.env`; phase 4 must create the Android
    OAuth client (and use the web client id as the token's audience).
  - Linked devices: `Accounts.add_linked_device/2` exists (max 4, device ids 2 to 127), but has no address yet.
    Phase 8 puts the QR flow in front of it.
  - The live connection: `/socket/websocket?token=…`, join `device:<device uuid>` with optional
    `{after: {chat_id: N}}`. Events in: `send`, `ack {ids}`, `sync {after}`, `receipt`, `typing`, `watch`,
    `unwatch`. Events out: `envelopes`, `typing`, `presence`. See the top of `device_channel.ex`.
  - `send` takes `{chat_id, kind, envelopes: [{user_id, device_id, type, body}], group: {type, body}}`.
    One-to-one chats must cover every device of both people except the sender's own; otherwise the reply is
    `stale_devices` with `missing` and `extra`. Groups send one `group` body (type 7) that the server copies.
  - An envelope can arrive twice (live and from the waiting list, around a reconnect). The shared core must
    drop envelope ids it has seen.
  - Receipts and group notes come as `data` (plain JSON the server already knows); messages come as `body`.
  - "Only admins can send" lets `kind: "reaction"` through. The server can't check that a "reaction" really is
    one, so phase 3 must also ignore non-reactions from non-admins in those groups.
  - Push is a stub (`Pakchat.Push.Notify` only logs). Phase 5 sends real FCM alerts there.
  - In the cloud: Erlang and Elixir come prebuilt from builds.hex.pm (Ubuntu 24.04, OTP 28, Elixir 1.19), and
    Postgres 16 is preinstalled (`service postgresql start`, password `postgres`).

### Phase 3: The shared core
- The Signal Protocol: one-to-one sessions, several devices per person, and sender keys for groups.
- Edits, deletes, reactions, votes and pins as encrypted messages.
- The storage interface (SQLite on the phone, IndexedDB on the website), the send queue, and retries.
- **Done when:** Vitest tests show messages decrypt correctly across devices, out of order, after
  a reconnect, in groups as people join and leave, and against the library's known test vectors.

### Phase 4: The Android app, core
- Sign-in, the chat list, chats, groups, the composer, and Settings (looks, Urdu, privacy).
- History stored on the phone, and search.
- Every screen reads from the phone's own database first, and the network only updates it.
- Test builds (APK) for the owner's phone.
- **Design first (owner's decision, 20 Oct):** before building screens, work out a serious,
  polished app design with the owner. It must look great and be easy to use, not a copy of the
  website squeezed onto a phone. Agree on it, then build.
- **Done when:** two test phones (emulators) chat, go offline, come back and catch up, with
  Maestro tests covering it. The owner installs the APK and it works on their phone.

### Phase 5: Files, phone sign-in and backup
- Encrypted files with signed links, big files (100 MB to start), and auto-download settings.
- Real push alerts when the app is closed.
- Phone-number sign-in, with a daily cap on codes because each one costs money. Google sign-in
  stays too.
- Encrypted backups and restore on a new phone.
- **Done when:** a 100 MB file sends and plays, a sign-in code arrives by phone number and signs
  in, and a new phone restores its chats from a backup.

### Phase 6: Calls and media
- The media viewer, videos, and "Media, links and docs".
- Voice and video calls that ring when the app is closed, and group calls up to 8. Use a hosted call
  service (such as LiveKit) if it keeps calls private, otherwise the TURN relay in section 3. Ask
  the owner before choosing. Include the Calls tab.
- Status, disappearing messages, polls, GIFs, and stickers (including ones made from a photo).
- **Done when:** a call rings on a locked phone, a group call with 4 people works, and each item
  is checked off in `whatsapp-gap.md`.

### Phase 7: The rest of the features
- Everything else in section 5 that isn't done yet: communities, broadcast lists, view once, round
  videos, photo editing, live location, contact cards, starred, export chat, chat lock and app lock.
- **Done when:** every item in section 5 works in the app, checked off one by one in
  `whatsapp-gap.md`.

### Phase 8: The website as a linked device
- Link with a QR code, history sync from the phone, and up to 4 linked devices.
- "Verify security code".
- On a phone, the website shows "Get the PakChat app".
- **Done when:** the website links to a phone, shows its history, sends and receives, and keeps
  working when the phone is off.

### Phase 9: Long closed beta
- 50 to 200 real people (friends, family, a university group) use the finished app for as long as
  it takes.
- Watch crashes, battery and data use, messages that arrive late, twice or never, how it behaves
  on cheap Android phones, and whether people come back after a week.
- Fix what they report. Today's Firebase PakChat stays live the whole time.
- **Done when:** crashes, delays and data use are acceptable, and people come back after a week.

### Phase 10: Move everyone across
- **Accounts:** a one-off script the owner runs on the Mac rebuilds users, groups and communities in
  Postgres from Firestore, matching people by their Google account.
  - Its Firebase service-account key stays on the Mac and is never pasted in chat.
- **Chats:** the first time someone signs in to the new app, it reads their old chats from
  Firestore (they're allowed to read them) and saves them on the phone, files included. This
  happens once.
- **The website:** pakchat-f89d8.web.app starts serving the new linked website.
- **Then** Firestore and Firebase sign-in are switched off. Deleting the old data can't be undone,
  so it waits for the owner's word.
- **Done when:** a test copy of today's data moves across with nothing lost, tried on a Firebase
  emulator copy and never on production.

### Phase 11: Launch on Google Play
- **Hosting:** the server and Postgres (with daily backups), close to Pakistan, plus a small server
  for the TURN relay if one is used.
- **Legal:**
  - A privacy policy and terms, in English and Urdu.
  - "Delete my account", in the app and on a web page, which Google Play requires.
  - Before going big, check Pakistan's rules for messaging apps (PTA).
- **Running it:** crash reports (for example Sentry), uptime alerts, spam and abuse limits, and the
  report flow.
- **The store:** Google Play, with a one-time fee, the Data safety form, and a listing in English
  and Urdu.
- **Done when:** PakChat is on Google Play and real people sign up.

### After launch, when the numbers say so
- The iPhone app and the App Store (a yearly fee).
- Channels.
- A call server for group calls of more than 8 people.
- More Phoenix servers, which Phoenix spreads across easily.

---

## 8. Testing (before every delivery)

- **Server:** ExUnit for every channel event and endpoint, especially "you can't touch what isn't
  yours".
- **Shared:** Vitest, with heavy coverage of encryption.
- **Website:** Playwright with 2 or 3 test people, against a local server, like today's tests.
- **App:** Maestro flows on an Android emulator, plus an APK for the owner to try.
- **Before delivering:** run every test, lint and the production build. If anything fails,
  fix it; never skip or switch off a test.
- Use local test data only. Never use production.

---

## 9. Delivering work to the owner

**Agents in the PakChat project (Claude threads):**
- **Each phase gets its own thread** (owner's decision, 20 Oct). When the owner says "phase N go"
  in the project chat, start a new thread for that phase.
- Build and test in the cloud, then put **one zip** at
  `/mnt/project-files/apps/pakchat/pakchat-update.zip`, also saved as `pakchat-<step>.zip`.
- Attach it to the reply, and give the owner one code block:

```
cd ~/Documents/pakchat && unzip -o "$(ls -t ~/Downloads/pakchat-update*.zip | head -1)"
<the command to build or run this step>
git add -A && git commit -m "<what this step did>" && git push
```

- For the app, also attach the APK to install.
- Mirror the source to `/mnt/project-files/apps/pakchat/source` as a backup.

**Any other agent:** give the owner a zip, or a branch on their own repo if they've given access,
plus the same three steps.

**The owner's Mac:**
- A MacBook Air with macOS, VS Code, Node 22 and git 2.50.
- The repo lives in `~/Documents/pakchat`.

**Today's website (until phase 10):**
- It's built and deployed with `npm --prefix web run build && npx firebase-tools deploy`.
- Use `deploy --only hosting` when only the website changed.

---

## 10. Open decisions (ask the owner when the phase needs it)

| Question | The default, unless the owner says otherwise |
| --- | --- |
| Phone-number sign-in? (SMS costs money per code) | Yes, in phase 5, before launch. Google sign-in stays too, and codes have a daily cap |
| Where to host the server | Pick in phase 11. Compare two cheap hosts close to Pakistan that support always-open connections |
| File size limit | 100 MB to start |
| Where backups go | Encrypted, in our own file storage |
| Web address | Keep pakchat-f89d8.web.app. A custom domain is optional |
| Store name and app ID | "PakChat", `com.pakchat.app` (check it's free) |
| Channels | Later, after launch |
| First audience | **Decided 21 Oct: everyone** (the public, not just students) |
| If the phase 1 encryption test fails | Launch with transport encryption first and add end-to-end later (ask the owner) |

---

## 11. Today's app, for reference

- **Live:** https://pakchat-f89d8.web.app, on the Firebase Spark plan with Firestore and no Storage.
  Media is stored as Firestore documents in parts.
- **Code:** `web/src`, about 19,000 lines, in React 19, Vite 8 and TypeScript, linted with oxlint.
  `LEARN.md` steps 1 to 22 explain every part.
- **Firestore collections:**
  - `users` (with `blocked`, `prefs`, `private`, `wallpapers`), `avatars`, `reports`, `invites`
    and `communities`.
  - `calls`, `groupCalls` (with `links`), `callLinks` and `scheduledCalls`.
  - `statuses` (with `media`, `views`).
  - `chats` (with `messages`, `media`, `typing`).
- **The message shape:** see `Message` in `web/src/chats.ts`. Phase 10 maps these fields into the
  new encrypted message format.
- **Secrets on the Mac only:** the KLIPY key and the TURN relay URL, both in `web/.env.local`.
- **Tests:** Playwright scripts against the Firebase emulators.
