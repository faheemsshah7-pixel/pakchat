# app — the PakChat phone app

React Native with Expo, in TypeScript. This becomes the main PakChat: the chats
live here on the phone, not on the server.

## Run it

```
npm install      # first time only
npx expo start
```

Then press:

- `a` to open it in an Android emulator,
- or scan the QR code with the **Expo Go** app on a real phone,
- or `w` to open it in the browser for a quick look.

Stop it with Ctrl+C.

## What the starter screen does

It shows the PakChat header and checks whether the Phoenix server is reachable.
If the server is not running it says "Not reachable" — that is correct, not a bug.

On a **real phone** `localhost` means the phone itself, so the check will fail
until you put the Mac's wifi address in `src/server.ts`:

```
ipconfig getifaddr en0      # e.g. 192.168.1.5
```

## The files

```
index.ts          the entry point; hands over to App.tsx
App.tsx           the first screen
src/server.ts     where the server is, and the health check
app.json          the app's name, icons, Android package name
assets/           icons and the splash image (still Expo's defaults)
AGENTS.md         notes for AI agents working in this folder
```

## Words you will keep seeing

- **Expo** is the toolkit around React Native. It runs the app without Android
  Studio or Xcode in the way.
- **Expo Go** is the app you install on a phone to open your project while
  building it. Later we make a real installable APK instead.
- **Metro** is the bundler, React Native's version of Vite.
- **A View** is a `div`. **Text** is the only way to show words. There is no
  CSS file: styles are plain objects in `StyleSheet.create`.

## Next

Phase 1 is the encryption spike, which is a throwaway app, not this one.
Phase 4 builds the real chat screens here, carried over from the website's design.
