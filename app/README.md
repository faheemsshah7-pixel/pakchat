# app — the PakChat phone app

React Native with Expo, in TypeScript. This is the main PakChat: your chats
live here on the phone (in SQLite), and the server only passes locked
messages along.

## Run it on an emulator or a plugged-in phone

The server must be running first (see `../server/README.md`).

```
npm install              # first time, and after an update
npx expo run:android     # builds the app and opens it
```

Expo Go can't open this app: it has its own native parts (Signal's encryption
in `modules/pakchat-signal`, Google sign-in), so it needs a real build.

## Which server it talks to

On the sign-in screen, tap **Server address**:

- an emulator: `http://10.0.2.2:4000` (that's "this Mac", seen from the emulator)
- a real phone on the same Wi-Fi: `http://<your Mac's address>:4000`
  (find it with `ipconfig getifaddr en0`)

## Alerts and SMS

Alerts when the app is closed need `google-services.json` from Firebase in this
folder (see "Phase 5: alerts" in `../LEARN.md`). Without it the app builds and
works, and Settings, Notifications says alerts aren't available.

Signing in by phone: until launch, the code shows in the server's Terminal.

## Checks (run all of them before handing anything over)

```
npm run typecheck
npm run lint
npm test                 # Vitest: the phone's database
```

## The two-phone test (Maestro)

Two emulators sign in with test accounts, chat, one goes offline, comes back
and catches up. Start the server with test sign-in on, start two emulators,
install the APK on both, then:

```
bash maestro/two-phones.sh
```

Test sign-in only works when the server was started with
`PAKCHAT_TEST_SIGN_IN=1`, on your Mac, for made-up `@test.pakchat` names.

## The files

```
src/app/          the screens (every file is one; _layout.tsx files hold them together)
src/core/         core.ts runs the PakChat client; hooks.ts gives screens their data;
                  files.ts, push.ts, backup.ts, phoneBook.ts for Phase 5
src/data/         sqliteStorage.ts: everything saved on the phone, and search
src/ui/           the building blocks: kit.tsx, icons, overlays (menus, sheets), motion
src/theme/        Sky and Graphite looks, the accent colours
src/i18n/         every word on screen, in English and Urdu
modules/          pakchat-signal: Signal's encryption, in Kotlin
plugins/          small changes Expo makes to the Android project
maestro/          the emulator tests
test/             Vitest tests
app.json          the app's name, icons, fonts, Android package name
AGENTS.md         notes for AI agents working in this folder
```

The `android/` folder is made by `npx expo prebuild` and isn't saved in git.
