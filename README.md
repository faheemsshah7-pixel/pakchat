# PakChat

A WhatsApp-style chat app for Pakistan, on the web: https://pakchat-f89d8.web.app

- `web/`: the web app (React + TypeScript + Vite)
- `app/`: the new Android app (see its README)
- `server/`: the new Phoenix server (see its README)
- `shared/`: the new shared core for the app and the website (see its README)
- `firestore.rules`: who can read and write what in the database
- `firestore.indexes.json`: sorted lists the database keeps ready (for the Calls list)
- `firebase.json`, `.firebaserc`: settings for putting the app online
- `LEARN.md`: notes on how everything works, step by step

## Run it on your laptop

```
cd web
npm install
npm run dev
```

## Put it online

From the `pakchat` folder:

```
npm --prefix web run build
npx firebase-tools deploy
```

This uploads the app to https://pakchat-f89d8.web.app, and the security rules and indexes to Firestore.
The first time, run `npx firebase-tools login` before that.
