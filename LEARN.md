# Learning notes

## Step 1: Setup and phone login

### The tools
| Tool | What it is | Why we use it |
| --- | --- | --- |
| **TypeScript** | JavaScript with types, so mistakes show up before you run the code | The language of the web app |
| **React** | A way to build screens out of small pieces called components | Every screen is one component |
| **Vite** | Runs the app on your laptop and builds it for the web | `npm run dev` starts it |
| **npm** | Downloads libraries other people wrote | `npm install` reads `package.json` |
| **Firebase Auth** | Google's login service | Sends the SMS code and checks it |
| **Firestore** | Google's database | Stores user profiles (and later, messages) |

### The files that matter
```
web/
  index.html              the one HTML page; React fills it in
  package.json            the list of libraries we use
  src/
    main.tsx              starts React
    firebase.ts           connects to our Firebase project
    App.tsx               decides which screen to show
    index.css             colours and layout
    screens/
      Login.tsx           phone number -> SMS code -> logged in
      ProfileSetup.tsx    first login: asks for your name
      Home.tsx            says hello, has a log out button
```

### How login works
1. You type your number. `Login.tsx` turns `0300 1234567` into `+923001234567`.
2. An invisible reCAPTCHA checks you're not a robot.
3. `signInWithPhoneNumber` asks Firebase to text you a 6-digit code.
4. You type the code. `confirm(code)` checks it, and Firebase logs you in.
5. `App.tsx` notices (`onAuthStateChanged`) and shows the next screen.

### How the profile works
- The database is made of **collections** (like folders) holding **documents** (like files).
- Your profile is the document `users/<your id>`, with your name and phone.
- `App.tsx` listens to it **live** with `onSnapshot`. When `ProfileSetup.tsx` saves
  your name, the listener fires and you land on Home without any extra code.

### Security rules
`firestore.rules` runs on Google's server, not in the app. Even if someone edits the
app's code, the server still only lets you change your own profile.

### Try this
- Change the green in `index.css` and watch the page update instantly.
- Change "Salam" in `Home.tsx` to something else.
- Log out and log in again: it skips the name screen, because your profile is saved.

## Step 2: One-to-one chats

### What's new
```
web/src/
  phone.ts               "0300 1234567" -> "+923001234567" (Login and New chat both use it)
  chats.ts               finds people by number, sends messages
  screens/Home.tsx       shows the chat list, or one open chat
  screens/ChatList.tsx   your chats, newest on top, and the "New chat" box
  screens/ChatRoom.tsx   one conversation: bubbles, and the box to type in
firestore.rules          new rules for chats and messages
```

### How a chat is stored
```
chats/<chatId>                 one document per conversation
  members:     [uidA, uidB]
  names:       { uidA: 'Ali', uidB: 'Sara' }
  lastMessage: { text, senderId }
  updatedAt:   time of the last message
chats/<chatId>/messages/<id>   one document per message
  text, senderId, sentAt
```
The **chat id** is the two people's ids, sorted and joined with `_`. So Ali and Sara
always land in the same chat, whoever writes first. No need to search for it.

### How sending works
1. You press Send. `sendMessage` in `chats.ts` saves two things in one **batch**:
   the message, and the chat's `lastMessage`. Both save, or neither does.
2. Your bubble shows up at once, before the server even answers.
   Firestore shows your own writes straight away and syncs in the background.
3. Your friend's `ChatRoom` is listening with `onSnapshot`, so the message appears there.
   Their `ChatList` is listening too, so the chat jumps to the top with the new text.

No code "pushes" messages to anyone. Each screen just **listens** to the database,
and the database tells it when something changes.

### The rules, in plain words
- You can only see a chat if your id is in its chat id.
- You can only send a message as yourself, between 1 and 2000 letters.
- Nobody can add a third person to a chat, or edit or delete messages (yet).

### Try this
- Log in as two people at once: a normal window and a private window (Cmd + Shift + N).
- Watch Firestore in the Firebase console while you chat. You'll see `chats` appear.
- In `ChatRoom.tsx`, change `limitToLast(100)` to `limitToLast(3)`. Only the last 3 show.

## Step 2b: Ticks, online, typing

| You see | How it works |
| --- | --- |
| 🕓 | Your message is still on its way. Firestore marks it as a "pending write". |
| ✓ | The server has it. |
| ✓✓ grey | The other person's app received it. `Home.tsx` writes `deliveredAt.<their id>` in the chat. |
| ✓✓ blue | They opened the chat. `ChatRoom.tsx` writes `readAt.<their id>`. |
| online / last seen | `presence.ts` writes `lastSeen` into your profile once a minute while PakChat is on screen. Under 90 seconds old means "online". |
| typing… | `ChatRoom.tsx` writes `typing.<your id>` when you type, at most every 3 seconds. Under 6 seconds old means "typing…". |

The ticks are just **comparisons of times**: a message is "read" if the other person's
`readAt` is later than the message's `sentAt`.

## Step 3: Groups, photos, voice notes

### Groups (`groups.ts`, `NewGroup.tsx`, `GroupInfo.tsx`)
A group is a chat with `type: 'group'`, a `title`, and an `admin`. Its id is random,
so the rules check its `members` list instead of the id. "Bilal added Sara" lines are
messages too, with `kind: 'system'`.

### Photos and voice notes (`media.ts`, `Composer.tsx`, `MediaBubbles.tsx`)
We're on Firebase's free plan, which has no file storage. So:
1. A photo is shrunk with a `<canvas>` until it's under 0.9 MB. A voice note is recorded
   with `MediaRecorder` (since Step 8: clear sound at 64 kbit/s, up to 5 minutes).
2. It's turned into text (a "data URL") and saved in `chats/<id>/media/<id>`.
   One document holds at most 1 MB, so a long voice note is cut into parts:
   `<id>`, `<id>_2`, `<id>_3`… The first part says how many there are (`parts`).
3. The message only points at it (`mediaId`), so the chat loads fast.
   Each bubble downloads its own photo or voice note when it's shown.

When we move to the paid plan, only `media.ts` changes, to use Firebase Storage.

## Step 4: Alerts, Urdu, block and report

- **Alerts** (`alerts.ts`): the browser's pop-up notifications. Turn them on from the ⋮ menu.
  On the free plan they only work while PakChat is open in a tab. The tab title also shows
  unread chats: "(2) PakChat".
- **Urdu** (`strings.ts`, `lang.ts`, `LangProvider.tsx`): every word lives in `strings.ts`,
  in English and Urdu. Screens call `useT()` to get the words. Urdu also flips the page
  to right-to-left (`dir="rtl"`) and uses the Noto Nastaliq Urdu font.
- **Block** (`safety.ts`): saves `users/<you>/blocked/<them>`. The **rules** check it, so a
  blocked person really can't message you, even with a hacked app.
- **Report**: saves the last 5 messages in `reports/`. Nobody can read reports from the app.
  You read them in the Firebase console: Firestore, then `reports`.

### The rules got stricter
Open `firestore.rules`. Every part has a comment. The main ideas:
- You can only read a chat you're in.
- Messages must carry your real id, your real name and the server's time.
- Only the group admin can add people. Anyone can leave, but can't remove others.
- Your profile's phone number must be the one you logged in with.

## Step 5: Putting it online

`npm --prefix web run build` makes the finished app in `web/dist`: plain HTML, CSS and
JavaScript files. `npx firebase-tools deploy` uploads them to **Firebase Hosting**, and uploads
`firestore.rules` too, so you never paste rules by hand again.
`firebase.json` says what to upload, and `.firebaserc` says which project.

### Try this
- Change a word in `strings.ts`, build, deploy, and see it on the live site.
- In the Firebase console, open **Hosting** to see every version you've uploaded.
  You can roll back to an older one with one click.

## Step 6: Sign in with Google, and finding friends by Gmail

Real SMS codes need Firebase's paid plan, so PakChat also lets you log in with Google.
- `Login.tsx` calls `signInWithPopup(auth, new GoogleAuthProvider())`. Google opens a small
  window, you pick your account, and Firebase logs you in. Test phone numbers still work too.
- `ProfileSetup.tsx` fills in your name from Google, and saves your Gmail in `users/<you>`.
- `phone.ts` has `contactKey()`: if what you typed has an `@`, it's a Gmail (made lower-case),
  otherwise it's a phone number. `findUser()` in `chats.ts` searches the right field, so the
  "Friend's number or Gmail" box works for both.
- The rules check that the Gmail in your profile is the one you logged in with, just like the phone number.

## Step 7: The new design and the five looks

### Two panels
On a computer, `Home.tsx` shows your chats on the left and the open chat on the right,
like WhatsApp Web. On a phone there's only room for one, so `index.css` hides the other
(look for `@media (max-width: 899px)`). `@media` means "only on screens this size".

### Looks (themes)
Every colour in `index.css` is a **variable**, like `var(--accent)`. Each look (Aurora,
Emerald, Midnight, Sunset, Ocean) is just a list of those variables at the top of the file.
- `theme.ts` puts `data-theme="aurora"` on the page, and the matching list wins.
- Your pick is saved in the browser (`localStorage`), so it's still there tomorrow.
- Aurora is the default. The login screens always use Aurora (`useFixedTheme`).
- The little previews in `ThemePicker.tsx` use the same trick: each one has its own
  `data-theme`, so it's drawn in that look's colours.

### The new pieces
| File | What it is |
| --- | --- |
| `Icon.tsx` | Line drawings (SVG) instead of emojis, so icons look the same everywhere |
| `Logo.tsx` | The logo: a chat bubble with the crescent and star |
| `doodles.svg` | The little drawings on the chat background (chai, a kite, a crescent…) |
| `colours.ts` | Gives each person their own colour, from their name |
| `Welcome.tsx` | What the right panel shows when no chat is open |
| `ThemePicker.tsx` | The "Choose a look" window |

### Try this
- Make your own look: copy the Ocean block in `index.css`, rename it `[data-theme='mine']`,
  change the colours, then add `'mine'` to `THEMES` in `theme.ts` and a name in `strings.ts`.
- Press Esc in a chat on a computer: it closes the chat, like WhatsApp Web.

## Step 8: The WhatsApp features

### Where each one lives
| What | Files |
| --- | --- |
| Reply, react, forward, copy, edit, delete, message info | `messages.ts`, `MessageBubble.tsx`, `Dialogs.tsx` |
| Emojis, big emojis, **bold** and _italic_, links | `emoji.ts`, `EmojiPicker.tsx`, `RichText.tsx` |
| The menu on a message or chat (right-click, or hold on a phone) | `Popover.tsx` |
| Pin, mute, archive, mark unread, clear, delete chat | `prefs.ts`, `ChatList.tsx` |
| Unread numbers and the "3 unread messages" line | `Home.tsx`, `ChatRoom.tsx` |
| Drafts | `drafts.ts` |
| Profile photo, about line, privacy | `profiles.ts`, `Settings.tsx` |
| Sounds, text size, the Enter key | `settings.ts`, `sound.ts` |
| Group photo, description, admins, invite links | `groups.ts`, `invites.ts`, `GroupInfo.tsx`, `JoinGroup.tsx` |
| Several photos at once, captions, paste, drag and drop | `PhotoSender.tsx`, `Composer.tsx` |
| Install as an app | `pwa.ts`, `public/manifest.webmanifest`, `public/sw.js` |

### Your private settings for a chat
Pinned, muted, archived and "unread" are **yours only**, so they're not in the chat document
(everyone in the chat can read that). They live in `users/<you>/prefs/<chatId>`, and the rules
let only you read or write there.

### Counting unread messages cheaply
Downloading every new message just to count them would use up the free plan's reads.
`getCountFromServer` asks the server "how many messages are newer than when I last read?"
and it costs one read, however many there are.

### Install as an app
`manifest.webmanifest` gives the app its name, icon and colours. `sw.js` (a "service worker")
is a small script the browser keeps; it makes the app open fast and lets Chrome offer
**Install**. It's the same website, just in its own window with its own icon.

## Step 9: Voice and video calls

The sound and picture go **straight between the two browsers**, using a browser feature
called **WebRTC**. They never pass through Firebase, so calls don't use up your free plan.
Firestore is only the "telephone exchange" that makes the other phone ring (`calls.ts`):

1. Asad presses the phone. His browser writes `calls/<id>` with `state: 'ringing'` and an
   **offer**: plain text describing his connection (what sound and video it can send, and his
   internet address).
2. Bushra's app is always listening for calls to her, so it rings (`sound.ts` makes the ringtone).
3. She presses Accept. Her browser writes an **answer** (her connection details): `state: 'accepted'`.
4. The two browsers connect to each other. **STUN** servers (free, from Google and Cloudflare)
   help each browser find its own internet address.
5. Someone hangs up: `state: 'ended'`, and the addresses are wiped. Asad's app writes
   "Video call 2:13" (or "Missed voice call") into the chat.

### Sound quality
The offer and answer are text, so `tune()` in `calls.ts` edits two lines before saving them:
`maxaveragebitrate=64000` asks for sound at 64 kbit/s (about 3 times WhatsApp), and `b=AS:450`
caps the video. **Use less data for calls** in Settings lowers the video to 150.

### The rules
Only the two people in a call can read it. You can only call as yourself, in your own chat with
that person, and not if either of you blocked the other. Only the person called can answer,
only the caller can cancel, and anyone can hang up once it's answered.

### Calls list
`CallsList.tsx` loads your last calls once when you open it. It asks for calls "from me, newest
first", which needs an **index** (a sorted list the database keeps ready).
`firestore.indexes.json` describes it, and `deploy` creates it. The first time, it takes a few
minutes to build, so the Calls list may say "Something went wrong" until it's ready.

### Good to know
- Calls are for chats with one person. Group calls need a server in the middle, which costs money.
- On a few mobile networks two phones can't reach each other directly. A paid **TURN** relay
  server fixes that; it would go in `ICE_SERVERS` in `calls.ts`.
- The browser asks for the microphone (and camera) the first time.

### Try this
- Call yourself from two browsers (say Chrome and Safari), logged in as two people.
- During a call, press the arrow at the top: the call shrinks to a green strip and you can keep chatting.
