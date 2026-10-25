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
- In `ChatRoom.tsx`, change `PAGE = 50` to `PAGE = 3`. Only the last 3 show (more as you scroll up).

## Step 2b: Ticks, online, typing

| You see | How it works |
| --- | --- |
| 🕓 | Your message is still on its way. Firestore marks it as a "pending write". |
| ✓ | The server has it. |
| ✓✓ grey | The other person's app received it. `Home.tsx` writes `deliveredAt.<their id>` in the chat. |
| ✓✓ blue | They opened the chat. `ChatRoom.tsx` writes `readAt.<their id>`. |
| online / last seen | `presence.ts` writes `lastSeen` into your profile once a minute while PakChat is on screen. Under 90 seconds old means "online". |
| typing… | When you type, `typing.ts` writes the time into `chats/<id>/typing/<your id>`, at most every 3 seconds. Under 6 seconds old means "typing…" (see Step 10). |

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
  in English and Urdu. Screens call `useT()` to get the words. Urdu uses the Noto Nastaliq
  Urdu font. The layout stays the same in Urdu (nothing flips to the other side): only the
  words change. Messages and names have `dir="auto"`, so Urdu in them still reads right-to-left.
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

## Step 10: Making it fast

Messages felt slow, so we measured. A test sends messages between two
people with the computer slowed down 4 times, like a normal phone, and with no internet delay
at all, so only the app's own work counts. Then we fixed what it found.

### What was slow, and the fix
| Problem | Fix |
| --- | --- |
| Every new message re-drew all 100 messages on screen, and every chat in the list. | `memo()` in `MessageBubble.tsx` and `ChatList.tsx`: React skips a message or chat that didn't change. |
| ...but everything looked "changed" anyway, because each update made new objects. | `ChatRoom.tsx` and `Home.tsx` keep the old object for anything that didn't change. `stable.ts` does the same for functions. |
| Every letter you typed re-drew the whole chat list (to update drafts). | `drafts.ts` only tells the list when a draft appears or disappears. |
| "typing…", ticks and messages all changed the same chat document. Firestore takes about one change per second per document, so in a busy chat messages waited their turn. | "typing…" has its own documents now (`typing.ts`), and the chat on screen is marked read once instead of "delivered" and then "read". |
| Comparing dates for the "Today" labels took thousands of steps per message. | `dayNumber()` in `time.ts`: a quick number to compare. |
| A chat loaded 100 messages. | 50 (`PAGE` in `ChatRoom.tsx`), and 50 more as you scroll up. |
| New messages glided down slowly, and all 100 faded in when you opened a chat. | They jump into place, and only new arrivals slide in, quickly. |

### "typing…" in its own documents
`chats/<chatId>/typing/<uid>` holds `{ members, at }`. Home listens to all of them at once
with a **collection group** query: "every `typing` document, in any chat, that lists me".
That kind of query needs an index (in `firestore.indexes.json`); for the first few minutes
after deploying, "typing…" won't show while Firebase builds it.

### Tried, and dropped: saving messages on the device
Firestore can keep a copy of everything on your device, so the app opens instantly. We tried
it: opening got faster, but every new message got about 4 times slower, because each one is
saved on the device first. So for now messages load from the server, and the app keeps what it
loaded in memory while it's open.

### Also
- `firebase.json` tells browsers to keep the app's files (`/assets/...`) for a year. Their names
  change whenever the code changes, so an old copy is never used by mistake.
- `index.html` starts connecting to the database while the app is still loading.

### Try this
- Open the same chat on your Mac and your phone, and send a few quick messages back and forth.
- In Chrome, press Cmd + Option + I, open **Performance**, record while a message arrives,
  and look for the short yellow (code) and purple (drawing) bars.


## Step 11: Photo zoom and the voice bar

### The photo viewer (`screens/PhotoViewer.tsx`)
A photo opens fitted inside the screen, the right shape, with room for the bar on top and the
caption below. To see details:
- the **+** and **−** buttons, or the + and − keys (0 fits it again)
- the mouse wheel, or pinching on a Mac trackpad
- double-clicking (or double-tapping) a spot: it zooms in there; do it again to zoom out
- two fingers on a phone

Zoomed in, drag to look around; it stops at the photo's edges. The trick: zooming only
changes the photo's CSS `transform` (`translate(...) scale(...)`), which the browser can draw
without laying out the page again, so it stays smooth.

It also fixed a bug: a photo opened from **Contact info** or **Group info** didn't show,
because ChatRoom.tsx returned those screens before it got to the viewer.

### The voice recording bar
The bin, red dot, timer and wave were at different heights. The composer lines things up at
the **bottom** (`align-items: flex-end`), so the text box can grow taller while the buttons
stay down. Recording has no text box, so `.composer.recording` lines them up in the
**middle** instead (in `index.css`). And now **Enter** sends the voice note, like Send.

### One voice note at a time
Pressing play on a voice note pauses the one already playing, like WhatsApp. `MediaBubbles.tsx`
remembers the playing one in `nowPlaying`, a variable outside the component, so every voice
note on the page shares it.

The speed (1×, 1.5×, 2×) is one setting for all voice notes, also like WhatsApp: set 1.5× on
one and the next one plays at 1.5× too. It's saved on the device (`localStorage`), and every
speed button reads it with `useSyncExternalStore`, so they all change together.

### Typing on a phone (`screen.ts`)
When you tap the message box, two things went wrong on phones:
1. **iPhones zoom in** on any text box whose writing is smaller than 16px. The message box was
   15.5px, so the whole page zoomed and looked cut in half. On phones it's 16px now.
2. **The keyboard covers half the screen.** Android can shrink the page to fit above it
   (`interactive-widget=resizes-content` in `index.html`). iPhones can't: they slide the page
   up instead. So `screen.ts` watches the *visual viewport* (the part of the screen you can
   actually see) and sets `--screen-height` and `--screen-top`, and on phones `.app` uses them.

`ChatRoom.tsx` also keeps you at the newest message when the chat gets less room.

### Try this
- Open a photo and pinch on your trackpad, then double-click a face.
- In `PhotoViewer.tsx`, change `MAX = 5` to `MAX = 10` to zoom further.

## Step 12: A design check against WhatsApp

We took screenshots of every main screen on a computer and a phone, measured them, and put
them next to WhatsApp's sizes (see the "PakChat vs WhatsApp Web" doc). Most of what we fixed
was small CSS:

- **Why the search icon still showed on phones.** `.hide-narrow { display: none }` lost to
  `button.icon { display: grid }`, because `button.icon` is more *specific* (a tag + a class
  beats one class). `button.hide-narrow` is just as specific and comes later, so it wins.
- **Photo grid:** `repeat(auto-fill, minmax(96px, 1fr))` means "as many columns as fit, each
  at least 96px". 3 fit on a phone, 6 on a computer.
- **A column in the middle:** `padding-inline: max(8px, calc((100% - 720px) / 2))` keeps the
  content 720px wide on a big screen, and gives 8px on each side on a small one.
- **Time at the end of a caption:** the time "floats" to the end of the line. It only fits on
  the caption's last line if the caption is *inline* text, like a normal message, not a block.

### Try this
- Change `720px` to `600px` and look at Contact info on your Mac.

## Step 13: Starred, pinned and disappearing messages

The first batch of WhatsApp features we didn't have yet. Each one is saved in a different
place, and *where* you save something decides who can see it:

| Feature | Saved in | Who sees it |
|---|---|---|
| Star | `users/<you>/prefs/<chatId>` → `starred: [ids]` | only you |
| Pin | `chats/<chatId>` → `pins: { id: copy }` | everyone in the chat |
| Disappearing | `chats/<chatId>` → `timer`, and each message's `expireAt` | everyone in the chat |

### Starred messages (`prefs.ts`, `StarredList.tsx`)
Star a message from its menu. A little ★ shows by its time. Find them again in the chat's
info, or **Starred messages** in the chat list's ⋮ menu (all chats). Your prefs only keep the
message *ids*, so `StarredList.tsx` fetches each message once with `getDoc`.

Tapping one opens the chat *at that message*. If it's older than the 50 messages we load,
ChatRoom loads more (`setLimit`) until it's there, then scrolls to it (the `focus` effect).

### Pinned messages (`pins.ts`)
Pin a message for 24 hours, 7 days or 30 days. It shows in a bar at the top for everyone;
tap the bar to jump to it. Up to 3: a 4th takes the oldest off. The chat keeps a small
*copy* of each pinned message, so the bar works even when the message isn't loaded.

New rule (`pinsOk` in `firestore.rules`): at most 3 pins, and in an "only admins can send"
group, only admins can pin.

### Disappearing messages (`disappearing.ts`)
Turn it on in Contact info (or Group info, admins only, or the chat's ⋮ menu). Every new
message gets `expireAt` = now + 24 hours (or 7 / 90 days). Then:

1. **On screen:** `useClockAt` sets a timer for the moment the next message runs out, and
   the chat re-draws without it. No checking every second.
2. **In the database:** we have no server on the free plan, so the next person to open the
   chat deletes it (`deleteExpired`). The rules allow anyone in the chat to delete a message,
   but *only once its time is up*: `expireAt < request.time`.

Like WhatsApp, this isn't a promise: people can still copy a message before it goes.

### Try this
- In `pins.ts`, change `MAX_PINS = 3` to `2`: now a 3rd pin takes the oldest off. (Going up
  to 4 would also need the rule's `<= 3` changed, or the server says no.)
- Turn on disappearing messages with a friend and look at a new message in the Firebase
  console: it has an `expireAt` field.

## Step 14: Videos, documents, location, contacts, and the Back button

The paperclip in the message box now opens a menu, like WhatsApp's: **Photos & videos**,
**Camera** (phones only), **Document**, **Location** and **Contact**.

| Feature | Files | Saved as |
|---|---|---|
| Video | `media.ts` (`prepareVideo`), `MediaBubbles.tsx`, `VideoViewer.tsx` | the video + its first picture, in `media` docs |
| Document | `Dialogs.tsx` (`DocumentSender`), `MediaBubbles.tsx` (`FileBubble`) | the file, in `media` docs, + `fileName`, `fileSize` |
| Location | `location.ts`, `CardBubbles.tsx` | `lat`, `lng` on the message (a live one also `liveUntil`) |
| Contact | `Dialogs.tsx` (`ContactDialog`), `CardBubbles.tsx` | `contact: { name, phone, uid }` on the message |

### Videos and documents: about 5 MB each
On the free plan we have no file storage, so files go into the database in pieces, like
voice notes (8 pieces of 900,000 letters = about 5 MB, see `MAX_FILE_BYTES`).
A bigger video, or one other phones might not play (an iPhone `.mov`), is played through
once and recorded again smaller (`shrinkVideo`): it draws each frame onto a small canvas
and records that with `MediaRecorder`. That takes as long as the video, so videos can be
up to 3 minutes. You see "Preparing video… 40%" meanwhile.

### Location (`location.ts`)
The browser finds you (`navigator.geolocation`, it asks first). The little map is made of
square pictures ("tiles") from OpenStreetMap, which is free and needs no key: `MapPreview`
works out which tiles are around you and puts them together. Tap it to open Google Maps.

**Live location** keeps moving the pin while PakChat is open on your device (a website
can't run in the background). `watchPosition` tells us when you move; we save at most every
10 seconds, and once a minute anyway, so the others see "Updated just now". The rules
(`movingLive`) only let the sender move it, and only until `liveUntil`.

### Contacts
Pick people from your chats, from your phone's contacts (Chrome on Android only), or type a
name and number. If they're on PakChat, the card's **Message** button opens a chat with them.

### The Back button (`back.ts`)
PakChat is one web page, so the phone's Back button used to leave it. Now PakChat keeps one
extra step in the browser's history (the "guard"). Back uses it up; we add it straight back
and close whatever is on top instead: a menu, a window, a photo, the info panel, the chat.
On the chat list there's nothing to close, so you stay.

Anything that Back should close says so with one line, for example in `Modal.tsx`:
`useBack(true, LEVEL.window, onClose)`. `LEVEL` decides the order: a menu closes before
the window under it, a window before the chat.

### Try this
- In `location.ts`, change `LIVE_CHOICES` to `[15, 60, 240]` and the 3rd label in
  `strings.ts` to "4 hours". (Over 8 hours would also need the rule's `481` changed.)
- In `fileColour` (`MediaBubbles.tsx`), give `ZIP` files their own colour.

## Step 15: The left bar, Calls, Status and the Settings window

PakChat now moves around like WhatsApp on a computer: a thin **bar down the left**
(`Rail.tsx`) with **Chats**, **Calls** and **Status**, then Archived and Starred, and Settings
and your photo at the bottom. On a phone the same bar sits along the bottom with just
Chats, Status and Calls (`index.css` moves it; `.wide-only` hides the rest). The bar hides
inside a chat, like WhatsApp's.

| Part | Files | Saved as |
|---|---|---|
| Calls tab | `CallsList.tsx` (left), `CallsMain.tsx` (right) | the calls you already had, read once when you open it |
| Favourites | `callExtras.ts`, `private.ts` | `users/<you>/private/calls` (only you can read it) |
| Call links | `callExtras.ts`, `CallDialogs.tsx` | `callLinks/<code>`, opened at `/call/<code>` |
| Scheduled calls | `callExtras.ts`, `CallDialogs.tsx`, `CardBubbles.tsx` | `scheduledCalls/<id>`, + a card in your chat |
| Status | `status.ts`, `StatusList.tsx`, `MyStatus.tsx`, `StatusViewer.tsx`, `StatusComposer.tsx` | `statuses/<id>` (+ `media` and `views` inside it) |
| Settings window | `Settings.tsx` | (the same settings as before) |

### The Calls tab
On the left: search ("Name, number"; type a number and you can call it), **Favourites**,
**Upcoming** (scheduled calls) and **Recent**. Calls in a row with the same person, the same
way, on the same day share one line, like WhatsApp: "Maaz (3)" (`groupCalls`). A red name is
a call you missed. The number on the bar counts missed calls since you last opened the tab
(`seenAt` in your private doc). Tap a line for **Call info**.

On the right, four big buttons: **Start call** (pick someone), **New call link** (anyone
with the link can call you; delete it to stop that), **Call a number** (a keypad) and
**Schedule call**. A scheduled call is a card in your chat, and when its time comes PakChat
plays a sound and shows "It's time for your call" to both of you (while PakChat is open).

### Status (photos, videos or words for 24 hours)
**Who sees it:** when you post, PakChat writes down the people you chat with one to one
(`audienceFor`), minus anyone you left out in **Status privacy**. That list is saved on the
status as `audience`, and the **rules** only let those people read it. That's why changing
your privacy doesn't change statuses you already posted (WhatsApp works the same way).

**24 hours:** the free plan can't run a timer on the server, so the app only shows statuses
younger than 24 hours, and your own app deletes yours after that (`listenToMine`).

**Seen and liked:** opening someone's status saves `statuses/<id>/views/<you>` (your name,
the time, and whether you tapped ♥). Only you and the owner can read that doc, so the owner
sees "Viewed by". Which ones *you* have seen is also kept on your device, to put them under
"Viewed updates" without reading the database again.

**Replying** sends a normal message in your chat with them, quoting "Status · …".

### The Settings window
Settings opens in the middle of the screen as its own window: the list on the left, the
page on the right, **Done** at the bottom. On a phone it fills the screen: first the list,
then the page you tap, and Back goes from the page to the list. The search box finds a page
by the settings inside it ("theme" finds Chats).

### Urdu keeps the same layout
Before, Urdu flipped the whole screen right-to-left. Now the layout stays the same and only
the words change (`LangProvider.tsx` always sets `dir="ltr"`). Urdu words still read
right-to-left by themselves.

### New rules and a new index
`firestore.rules` has rules for `callLinks`, `scheduledCalls`, `statuses` and
`users/<you>/private`. Statuses need a new **index** (`firestore.indexes.json`): a list of
statuses where you're in the audience, newest first. That's why this update deploys
everything, not just the website. Firebase takes a few minutes to build a new index, so
Status may say it can't load for those first minutes.

### Try this
- In `status.ts`, add a colour to `STATUS_COLOURS` (a gradient works too).
- In `callExtras.ts`, change `MAX_FAVOURITES` from 20 to 30.

## Step 16: Polls, stickers, @mentions, reply privately, message yourself

Five WhatsApp features, plus a faster first load.

| Feature | Files | Saved as |
|---|---|---|
| Polls | `polls.ts`, `Polls.tsx` | a message with `kind: 'poll'`, `options` and `votes` |
| Stickers | `stickers.ts`, `Stickers.tsx`, `EmojiPicker.tsx` | a message with `kind: 'sticker'` |
| @mentions | `mentions.ts`, `Composer.tsx`, `RichText.tsx` | `mentions: [uid, ...]` on the message (and on `lastMessage`) |
| Reply privately | `ChatRoom.tsx`, `Home.tsx` | `replyTo.from`: the group's name |
| Message yourself | `chats.ts`, `NewChat.tsx` | a chat with you twice: `chats/<you>_<you>` |
| Faster first load | `screens/lazy.ts`, `vite.config.ts` | (nothing saved) |

### Polls
Paperclip > **Poll**: a question and 2 to 12 answers (a new empty box appears as you fill
the last one), and **Allow multiple answers**. Everyone taps answers to vote; tap again to
take a vote back. **View votes** shows who picked what.

The votes live on the poll message as `votes: { uid: [answer numbers] }`. Each person writes
only `votes.<their uid>`, so two people voting at the same moment never undo each other. The
**rules** (`voting()` in `firestore.rules`) check that you change only your own vote, only real
answer numbers, no answer twice, and just one answer when the poll allows one.

### Stickers
Smiley > **Stickers** at the bottom. PakChat's own pack is an emoji with a few bold words,
drawn by the browser (`PACK` in `stickers.ts`), so sending one only sends its name, like
`pk:salam`. **Create** turns a photo into a sticker: a square from the middle with round
corners and a white edge (`makeSticker`), sent like a small photo. Your stickers ("My
stickers", and ones you save from a chat with **Save sticker**) are kept on this device only.

### @mentions (groups)
Type **@** in a group and its people show up; arrows and Enter (or a tap) pick one, and
"@Ali " goes into the message. When you send, `findMentions` looks for each "@Name" in the
words and saves who was mentioned. Then:
- the names show in colour, and tapping one opens your chat with them;
- the person's chat list shows **@** on the group until they open it;
- a group you muted still alerts you when someone mentions you (like WhatsApp).

### Reply privately (groups)
In a group, a message's menu has **Reply privately**. It opens your chat with the person
who wrote it, ready to answer that message. The quote says which group it came from
("Ali · Cousins"), and tapping it doesn't jump, because the message is in the group.

### Message yourself
**New chat > Message yourself** (or type your own number). It's a normal chat whose two
members are both you, so the rules already allowed it: `chats/<you>_<you>`. It's for notes,
links and photos you want to keep. No calls, typing, blocking or reporting there, and the
ticks are always blue.

### A faster first load (code splitting)
Before, the browser downloaded all of PakChat (about 1 MB) before showing anything, and the
build printed a yellow warning about it. Now:
- **Firebase and React have files of their own** (`vite.config.ts`). They only change when we
  update them, so after a new PakChat version your browser keeps them and downloads just our
  own code (about a quarter of the total).
- **Screens you don't need straight away load when first used** (`screens/lazy.ts`): Settings,
  Status, the call screen and call windows, the emoji panel and the photo viewer. React's
  `lazy()` and `<Suspense>` do this. A moment after PakChat opens, `warmUp()` fetches them
  quietly, so they're ready before you tap.
- When a new version goes online, the old files are gone. If PakChat was already open and
  can't find one, it reloads itself once into the new version (`reloadOnce()`).

### New rules
`firestore.rules` now accepts polls, stickers, `mentions` and `replyTo.from`, and has the new
`voting()` rule. That's why this update deploys the rules too, not just the website.

### Try this
- In `stickers.ts`, add your own sticker to `PACK`: an id like `pk:shabash`, an emoji, the
  words, and a colour.
- In `polls.ts`, change `MAX_OPTIONS` from 12 to 6 (the rules still allow up to 12).
- Send a poll in a group, vote from two devices at once, and watch the bars move.

## Step 17: View once, video messages, photo editing, HD, transcripts

Four WhatsApp features, and two older bugs fixed.

| Feature | Files | Saved as |
|---|---|---|
| View once | `once.ts`, `OnceViewer.tsx`, `MediaBubbles.tsx` | `once: true` on the message, `openedBy: { uid: time }`, `onceIn` on the media |
| Round video messages | `videoNotes.ts`, `VideoNoteRecorder.tsx` | a video message with `round: true` |
| Photo editing | `photoEdit.ts`, `PhotoEditor.tsx`, `PhotoSender.tsx` | (a normal photo: the edit is drawn into it) |
| HD photos | `media.ts` (`shrinkPhoto`), Settings > Chats | `hd: true` on the photo message |
| Voice message transcripts | `transcribe.ts`, `Composer.tsx`, Settings > Chats | `transcript: "..."` on the voice message |

### View once
Before sending a photo or video, tap **①** next to the caption (for a voice note: ① while
recording). The people you send it to see just "① Photo". They can open it **one time**:
1. Opening it loads it, then saves `openedBy.<their uid>` with the server's time.
2. From then on the **rules** stop them loading it again (`notOpenedYet()` in `firestore.rules`).
   That's why each part of the photo says which message it belongs to (`onceIn`).
3. When everyone it was sent to has opened it, the photo itself is **deleted** from the
   database (`everyoneOpened()` lets them). In a group, the app asks the server who has
   opened it, not its own copy, which can be a moment behind.

It has no caption, can't be forwarded, starred or downloaded, and a view once video saves no
first picture (the picture would give it away). Honest limit: a website can't stop
screenshots, and a changed copy of the app could keep what it loaded. WhatsApp says the same:
only send view once to people you trust.

### Round video messages
The round camera button next to the microphone records your front camera in a circle, up
to a minute. A ring fills up as you go. **■** stops so you can watch it back, **➤** sends,
the bin throws it away. It's saved like any other video (with a small first picture), at a
low bit rate so a minute fits: 550,000 bits a second for the picture, 48,000 for the sound.

### Photo editing (crop, rotate, draw, text)
The tools at the top of the photo window open the editor. The clever part is in
`photoEdit.ts`: an edit is a **list of changes**, not a new picture:
`{ turns, crop, strokes, labels }`. Every position is a fraction of the photo (0 to 1), so the
same edit fits the small picture on screen and the big one that's sent. Undo just goes back
to the list before. Turning left moves a point at (x, y) to (y, 1 − x). Only when you press
✓ is the photo drawn for real, at full size (`renderEdit`).

### HD photos
Normal photos are made at most 1280 pixels wide. HD keeps up to 2560, so they're sharper but
a few times bigger (they're cut into up to 3 parts in the database). Switch it on for one
photo with **HD** at the top, or for all of them in **Settings > Chats > Photo quality**.
A photo that's small already isn't marked HD, since there's nothing to make sharper.

### Voice message transcripts
**Settings > Chats > Voice message transcripts** (off at first). While you record, the
browser's own speech recognition (the "Web Speech API") writes down your words, in English or
Urdu. They're saved with the voice note, and the people you send it to tap **Show transcript**.
Search finds them too. Chrome, Edge and Safari can do it, Firefox can't (the switch says so).
It's off at first because Chrome sends your voice to Google to work out the words.

### Two older bugs, fixed
- **The chat list kept old bits of the last message.** Saving the chat with `merge: true` also
  merged *inside* `lastMessage`, so fields from the message before stayed. After "Delete for
  everyone", every new message in that chat still said "This message was deleted". Now
  `addMessage` (`chats.ts`) deletes the fields the new message doesn't have (`deleteField()`).
- **Some videos didn't play.** A recorded video's type can have a comma in it
  (`video/webm;codecs=vp8,opus`), and a comma ends the type part of a data URL, so the video
  came back broken. That hit videos PakChat made smaller before sending. Now only
  `video/webm` is kept (`blobToDataUrl`), and videos saved the old way are mended when they
  load (`mendType` in `media.ts`), so old ones play too.

### New rules
`firestore.rules` accepts `once`, `round`, `hd` and `transcript`, has the new `opening()` rule
(marking it opened: only the people it was sent to, only once, only for themselves, at the
server's time), and the view once checks on media. So this update deploys the rules too.

### Try this
- In `videoNotes.ts`, change `MAX_NOTE_SECONDS` to 30.
- In `photoEdit.ts`, add a colour to `COLOURS` (like `'#01411c'`, Pakistan green).
- Send a friend a view once photo (it isn't offered in Message yourself), and watch it say
  "Opened" on your side when they open it.

## Step 18: Wallpapers, notification tones, conversation tones, broadcast lists

| Feature | Files | Saved as |
|---|---|---|
| A wallpaper for each chat | `wallpaper.ts`, `WallpaperPicker.tsx` | `users/<you>/wallpapers/<chatId>` (or `/default` for all chats) |
| A notification tone for each chat | `sound.ts`, `ToneDialog` in `Dialogs.tsx` | `tone` in your prefs for that chat (`prefs.ts`) |
| Message and group tones | Settings > Notifications | `messageTone`, `groupTone` on this device (`settings.ts`) |
| Conversation tones | `sound.ts`, Settings > Chats | `conversationTones` (on or off), `toneVolume` (0 to 1) on this device |
| Broadcast lists | `broadcasts.ts`, `BroadcastInfo.tsx`, `NewGroup.tsx` | a chat with `type: 'broadcast'` that only you are in |

### Wallpapers
Open a chat's menu and pick **Wallpaper**, or **Settings > Chats > Wallpaper** for every chat.
Pick a colour (with or without the little drawings, "Doodles") or one of your photos (with
**Darken**, so the messages stand out). The preview at the top shows how it will look.
- A chat uses its own wallpaper, or else the one for all chats, or else the look's own.
  That's `own ?? all` in `useWallpaper`. ("??" means "if the left side is empty, use the right".)
- The doodles are drawn by `.wall::before` in `index.css`. A wallpaper only changes two
  "CSS variables": `--pattern` (white on a dark colour, brown on a light one) and
  `--pattern-opacity` (0 hides them). `isDark` works out if a colour is dark, counting green
  most, like our eyes do.
- A photo is darkened with a see-through black layer drawn on top of it
  (`linear-gradient(rgb(0 0 0 / 0.3), ...)`), so nothing has to change the photo itself.
- Wallpapers are saved in the database, so they follow you to any device. Only you can read
  yours (the rules), and they must be a colour like `#1b2a4a` or a picture, not too big.

### Notification tones
Seven sounds: Ping, Chime, Pop, Bell, Drops, Marimba and None. There are no sound files: each
one is a few short notes the browser plays itself (`MELODIES` in `sound.ts`). A note is a
pitch in Hz (880 is a high A), a start time, a length and a loudness that fades out.
- **Settings > Notifications** picks the tone for all chats and the one for all groups.
- **Chat info > Notification tone** picks one for just that chat ("Default" = the usual one).
- Picking a tone plays it, so you can hear it before you save.
Which plays: the chat's own, or else the group or message tone (`Home.tsx`, where alerts play).

### Conversation tones
While a chat is open, a soft "whoosh" when your message reaches the server, and a soft "pop"
when someone else's arrives (instead of the usual tone, which is for chats you aren't looking
at). **Settings > Chats** has the switch and a **How loud** slider. Letting go of the slider
plays one, so you can hear how loud it is. The loudness is a "gain" node: every note goes
through it, and `gain.value = 0.3` makes them all 30% as loud.

### Broadcast lists
**New broadcast** (the chat list menu, or the New chat screen). Pick 2 people or more, and
give it a name if you like. Each message you send to the list goes to each person **in your
own chat with them**, as if you'd sent it just to them. They can't see the list or who else
is on it, and their answers come to your chat with them, like WhatsApp.
- The list is a chat with `type: 'broadcast'`, `members: [you]` and `recipients: [...]`.
  Because you're the only member, nobody else can read it (the usual chat rules do that).
- `sendToList` sends a copy to each person, 5 at a time, then saves `copies: { uid: id }`
  on the list's message. That's how **Edit** and **Delete for everyone** find every copy.
- The ticks on your messages in the list come from your chats with each of them
  (`listAsChat`), so ✓✓ turns blue once everyone has read it, and Message info says who.
- **List info** renames it, adds or takes people off, and **Delete broadcast list** deletes the
  list and what you sent in it. The copies stay in each person's chat.
- No polls, replies, pins, disappearing messages or view once in a list: they need everyone
  to be in one chat.

### New rules
`firestore.rules` has the `wallpapers` rules, the `broadcastOk()` check (just you in it, 1 to
256 people, not you), the one-time `copies` on a list message, and lets you delete a
broadcast list (only a list: other chats are cleared or left). So this update deploys the
rules too.

### Try this
- In `wallpaper.ts`, add a colour to `WALL_COLOURS` (like `'#01411c'`, Pakistan green).
- In `sound.ts`, change the pitches in `marimba` and pick it in Settings to hear the change.
- Make a broadcast list with two friends and send "Eid Mubarak". Each gets it in their own chat.

## Step 19: Communities

| Part | Files | Saved as |
|---|---|---|
| The Communities tab | `Rail.tsx`, `Communities.tsx`, `Home.tsx` | |
| A community's page | `CommunityInfo.tsx` | `communities/<id>` |
| Making one | `NewGroup.tsx` (with `community`), `communities.ts` | the community and its announcements group, together |
| Its invite link | `communities.ts`, `JoinGroup.tsx` | `invites/<code>` with `communityId` |

### What a community is
Like WhatsApp: one name (a school, a family, a mohalla) with groups under it, and an
**Announcements** group that everyone in the community is in. Only admins post announcements.
- **Communities** is a new tab on the left bar (on a phone, along the bottom). It lists your
  communities, each with its announcements and the groups of it you're in.
- Tap a community (or **View all**) for its page: the description, its groups (the ones you're in,
  and **Other groups you can join** with a **Join** button), its people, and the invite link.
- Admins can make a **new group** in it, **add existing groups** they look after (everyone in
  those groups joins the community too), add or remove people, and make other admins.
- **Leave community** leaves its announcements and every group of it you're in, too. The owner
  can't leave: they **Deactivate** it instead. Then the community goes, and its groups carry on
  as normal groups.

### How it's saved
```
communities/<id>
  name, description, owner
  admins:  [uid, ...]       (the owner too)
  members: [uid, ...]       (up to 256: everyone is also in the announcements group)
  names:   { uid: 'Ali' }
  groups:  { chatId: 'Cricket' }   its groups, with their names
  announcementsId           the announcements group
```
The announcements group is a normal group with `announcements: true`, `communityId` and
"only admins can send". Adding someone to the community adds them to it **in the same batch**
(`writeBatch`), so the two never disagree. A community admin is also an admin there.

Why does the community keep its groups' **names**? Because you can only read a chat you're in.
To show "Other groups you can join", the names have to be somewhere you *can* read: the community.

### New rules
- Only the people in a community can see it. Only admins can change it, the owner always stays,
  and someone who isn't in it can only add themselves with the current invite code (like a
  group's invite link).
- A group can say it's part of a community (`communityId`) only if one of the community's admins
  links it, and the community lists it (`linkedHere`). The rules check the community "after"
  the write (`getAfter`), because the group and the community change in the same batch.
- Anyone in the community can join one of its groups (rule 7 in the chats rules), but only if the
  community lists that group. A group in a community can start with just you in it.
- The announcements group can't be taken out of its community.

### Try this
- In `communities.ts`, change `MAX_GROUPS` to 10, and see the error when you add an 11th group.
- Make a community for your family, add a group "Shaadi plans" to it, and share the invite link.

## Step 20: Group calls and sharing your screen

| Part | Files | Saved as |
|---|---|---|
| What both kinds of call share | `rtc.ts` (new) | |
| Sharing your screen in a call | `calls.ts`, `CallScreen.tsx` | nothing new: it goes straight between the browsers |
| Group calls | `groupCalls.ts` (new), `GroupCallScreen.tsx` (new) | `groupCalls/<id>`, `groupCalls/<id>/links/<from>_<to>` |
| The call buttons and "call in progress" bar in a group | `ChatRoom.tsx` | |

### Sharing your screen
In any call on a computer there's a **Share screen** button. The browser asks which screen,
window or tab, and the other side sees it whole, with "Ali is sharing their screen". Press
**Stop sharing** (or the browser's own button) and your camera comes back. Phone browsers can't
share their screen, so phones don't get the button.

How it works: every call now has a picture **slot** from the start, even a voice call.
In a voice call it's empty. Sharing puts your screen in it with `replaceTrack`, so nothing has to
connect again. (`addPictureSlot` and `takePictureSlot` in `rtc.ts`.)

There's also a small text channel between the two browsers (`sideChannel`, a WebRTC "data
channel"). Each side uses it to say "I'm sharing my screen", "my camera is off" or "my mic is off".
That's how the other side knows to show your photo instead of a black picture when your camera is off.

### Group calls
In a group, the phone and camera at the top now start a **group call** (up to 8 people).
- Everyone in the group gets a ring (in groups of up to 32 people, like WhatsApp), with **Join**
  and **Decline**. The chat gets a note: "Ali started a voice call".
- While it's on, the group's chat shows **Voice call in progress · 3 in the call · Join**,
  so you can join after declining or join late.
- On the call screen everyone is a tile: their camera, or their photo. A muted mic shows on the tile.
  Someone sharing their screen gets the big space at the top.
- **Leave** leaves. The last one to leave ends the call.

### How it's saved
```
groupCalls/<id>
  chatId, title, by, byName, video
  members: [uid, ...]        everyone in the group (only they can see or join it)
  names:   { uid: 'Ali' }
  joined:  { uid: when }     who's in it right now
  state:   'active', then 'ended'
  aliveAt                    "still on", every 2 minutes
groupCalls/<id>/links/<from>_<to>
  from, to, round, offer, answer, answerRound
```
A one-to-one call has one connection. A group call has one for **every two people** (a "mesh"):
4 people means 6 connections, and each browser sends its sound and picture to each of the others.
That's why there's a limit of 8. (Bigger calls need a server in the middle, which costs money.)

Who connects to whom? For every two people, the one whose id comes first A to Z writes the
**offer** in their link, and the other writes the **answer**. Because both of them can work that
out on their own, two people never both make an offer to each other.

What if everyone's app closes suddenly? Nobody is left to say the call ended. So one person in it
writes `aliveAt` every 2 minutes, and a call that's been quiet for 5 minutes counts as over.

### New rules
- Only the group's members can see its calls. You can only start one in a group you're in (and
  only as an admin, if only admins can send there), for the whole group.
- You can only add or take out **yourself** in `joined`, at the server's time, and there can't be
  more than 8.
- A link can only be read by its two people. Only the first one can write the offer, and only
  while they're in the call. The answer must say which offer it answers (`answerRound`), so an
  answer to an old offer is turned away.
- New index: `groupCalls` by `members` (array-contains) and `state`. That's why this deploy
  is a full one, not just hosting.

### Try this
- In `groupCalls.ts`, change `MAX_IN_CALL` to 3, and see "This call is full" when a 4th person joins.
- In a call on your computer, share a browser tab with a YouTube video in it.

## Step 21: Link previews, GIFs, a relay for calls, and locking the key

| Part | Files | Saved as |
|---|---|---|
| Link previews | `links.ts` (new), `Composer.tsx`, `Gifs.tsx` (`LinkCard`) | `preview` in the message |
| GIFs | `gifs.ts` (new), `Gifs.tsx` (new), `EmojiPicker.tsx` | a message with `kind: 'gif'` |
| A relay for calls | `rtc.ts` (`iceServers`), `web/.env.example` | nothing: it's a setting on your computer |
| The switch | Settings > Privacy > **Link previews** (`settings.ts`) | this device only |

### Link previews
Type or paste a web address and a card appears above the message box: the page's picture,
title and website. **X** leaves it out. Send, and the card goes inside the message.

A browser isn't allowed to read other websites by itself, so two free services help:
**microlink.io** reads the page (its title, a line about it, and its picture) and **wsrv.nl**
shrinks the picture to a small square. Only the *sender's* browser asks them. The thumbnail is
saved inside the message (a few KB), so the people you send it to don't contact anyone until
they tap the card. Settings > Privacy > **Link previews** turns it off.

### GIFs
The smiley panel now has **Emoji · GIFs · Stickers** at the bottom, like WhatsApp. GIFs come
from **KLIPY**, a free GIF library. (WhatsApp used Google's Tenor, but Google closed Tenor to apps
in 2026.) Search "eid mubarak" or "cricket", tap one, and it's sent.
It plays as a small silent video on a loop, which is much smaller than a real .gif file.
The message keeps only KLIPY's addresses for it, and the rules allow only KLIPY's addresses
(`static.klipy.com`), so nobody can slip a tracking picture from some other website into a chat.
KLIPY needs a key of PakChat's own (free). Until you add one, the GIF tab simply isn't there.
KLIPY asks that the search box says "Search KLIPY", so it does.

### A relay for calls
On some mobile networks and office Wi-Fi, two browsers can't reach each other directly, and a
call says "Couldn't connect". A **relay** (a "TURN server") fixes that: it passes the sound and
picture along. Relays cost money to run, but some have a free plan.
PakChat uses one only if you set it up (see "Things to do on other websites" below).
Without one, calls work as before.

### New rules
- A GIF message: its two addresses must be at `https://static.klipy.com/`, plus its size.
- A link's card: only on a text message, with a short title and description, and its picture
  must be *inside* it (`data:image/...`), never a web address.

### Things to do on other websites (once)
1. **GIFs: get a KLIPY key.** Sign up at https://partner.klipy.com/ , go to **API Keys** and
   create your platform (a website called PakChat). Copy the key. On your Mac, copy
   `web/.env.example` to `web/.env.local` (if you haven't yet) and put the key after
   `VITE_KLIPY_KEY=`. Build and deploy again, and the GIF tab appears.
   A new key is a *test* key: 100 GIF searches an hour for everyone together. When it works,
   press **request production access** in the same Partner Panel to lift that limit.
   (The key ends up inside the website, which is how it's meant to be used. Don't paste it in chat.)
2. **Lock the key.** The `apiKey` in `firebase.ts` is meant to be public, but anyone could
   copy it into their own website. Lock it to yours:
   - Open https://console.cloud.google.com/apis/credentials?project=pakchat-f89d8
   - Click the key called **Browser key (auto created by Firebase)**.
   - Under **Application restrictions** pick **Websites**, and add these three:
     `https://pakchat-f89d8.web.app/*`, `https://pakchat-f89d8.firebaseapp.com/*`, `http://localhost:5173/*`
   - Leave **API restrictions** as they are, and press **Save**.
   - After a few minutes, open PakChat and log in, to check it all still works.
3. **A relay (if people get "Couldn't connect").** Make a free account at metered.ca, make an
   app, and copy its **TURN credentials** address (it ends with `?apiKey=...`). On your Mac, copy
   `web/.env.example` to `web/.env.local` and put the address after `VITE_TURN_CREDENTIALS_URL=`.
   Build and deploy again. (`.env.local` stays on your Mac: git ignores it. The address does end
   up inside the website, which is how these relays are meant to be used. Don't paste it in chat.)

### Try this
- Send yourself a YouTube link in "Message yourself" and see its card.
- In `gifs.ts`, change `contentfilter: 'medium'` to `'high'` for an even safer GIF search.

## Step 22: Media, links and docs, group calls in Calls, the chat menu, smoother movement

| Part | Files | Saved as |
|---|---|---|
| Media, links and docs | `shared.ts` (new), `MediaPage.tsx` (new), `MediaGrid.tsx` | nothing new (`link: true` on messages with a web address) |
| The viewer's strip | `MediaViewer.tsx` (new), `PhotoViewer.tsx`, `VideoViewer.tsx` | nothing |
| Group calls in Calls | `groupCalls.ts` (`recentGroupCalls`), `callExtras.ts`, `CallsList.tsx`, `CallsMain.tsx` | `came` in a group call |
| The chat menu | `ChatList.tsx`, `Popover.tsx`, `exportChat.ts` (new), `Home.tsx` (`?chat=`) | nothing new |
| Smoother movement | `index.css` (part 10c), `ChatList.tsx` (`slideRows`) | nothing |
| A fix | `messages.ts` (`unsendMessage`) | |

### Media, links and docs
Open a chat's info: the **Media, links and docs** row opens a page with three tabs, like WhatsApp.
**Media** shows the photos, videos and GIFs in small squares, by month ("This month", "September"),
**Links** every message with a web address (with its card), **Docs** the documents.
At the end it counts them: "12 photos, 3 videos".

It doesn't only look at the messages the chat has loaded: `shared.ts` asks the database for just
those messages, 48 at a time, and the next 48 load as you scroll down. Asking for "messages
with a web address" needs the message to *say* it has one, so from now on a message with a link
gets `link: true` (`chats.ts`). Older ones don't, so the Links tab adds the ones the chat has loaded.

New **indexes** (`firestore.indexes.json`): the database needs one for each new kind of question,
like "this chat's messages whose kind is photo, video or GIF, newest first".

### The viewer
Tap a photo: **‹ ›** at the sides (or the ← → keys) go to the one before or after, and a **strip**
of small squares at the bottom shows them all (the one you're on is lit). **All media** opens the page.
A photo you've already seen opens straight away now, with no grey moment (`useMedia` remembers).

### Group calls in Calls
The Calls tab lists group calls too, with the group's picture: **Outgoing** (you started it),
**Incoming** (you joined), or **Missed** in red (you didn't join). Tap one for its details:
"Group voice call", how long it lasted, and who joined ("Joined: Ali, Sara").
To know who joined, a group call now keeps `came`: everyone who was in it at some point. The
rules let you add only yourself to it. (Calls from before Batch 10 don't say who joined.)

### The chat menu
Hover over a chat in the list and click its little arrow (or right-click it). The menu is in
WhatsApp's order: Open in new window, Mark as unread, Archive, Pin, Mute ›, then (after a line)
Contact info or Group info, Export chat, Clear chat, Delete chat or Leave group.
- **Mute ›** opens a small menu beside it: 8 hours, 1 week, Always (`sub` in `Popover.tsx`).
- **Open in new window** opens PakChat again in a small window at `/?chat=<id>`, and `Home.tsx`
  starts with that chat open.
- **Export chat** saves a text file, like WhatsApp's "without media":
  `17/10/2026, 8:52 pm - Ali: Salam!`. Photos and files say `<media not included>`.

### Smoother movement
Like WhatsApp: panels slide in from the side, New chat and New group slide in from the left,
on a phone a chat slides in from the right (and the list comes back from the left), a new message
grows up from its corner, windows grow in softly, the send button's icon pops when it changes, and
a full-screen photo grows in. When a new message moves a chat to the top, the other rows **slide**
down instead of jumping. That's a trick called FLIP (`slideRows` in `ChatList.tsx`): note where each
row was, let React move it, then animate it from the old place to the new one.

All of it is short (a fifth of a second) and only moves things or fades them, which the graphics
chip does by itself, so nothing gets slower. If someone turns on **Reduce motion** in their phone or
computer's settings, nothing moves at all.

### The fix
Batch 9's link cards and GIFs broke **Delete for everyone** on those messages: the rules only allow a
deleted message to keep a few plain fields, and the card (or GIF) was left in it. Now they're wiped too.

### Try this
- In `shared.ts`, change `PAGE = 48` to `12`, and watch the next page load as you scroll.
- In `index.css`, find `panel-in` and change `0.24s` to `1s`, to see the slide in slow motion.

## Step 23: Phase 1, the encryption test

| Part | Files |
|---|---|
| Our Signal module (Kotlin) | `app/modules/pakchat-signal/` (new): `SignalDevice.kt`, `PakchatSignalModule.kt`, `index.ts` |
| The pretend server and phones | `app/src/spike/relay.ts`, `phone.ts`, `types.ts` (new) |
| The test, and its screen | `app/src/spike/scenario.ts`, `SpikeScreen.tsx` (new), `App.tsx` |
| Keeping the APK small | `app/plugins/withSignalPackaging.js` (new), `app.json` |
| The same test on a computer | `app/spike-check/` (new, not part of the app) |

Before building the server, we checked the hardest part: can our app do real end-to-end
encryption, like WhatsApp? **Yes.** The test passes with Signal's own library.

### End-to-end encryption, in short
Each phone makes its own **keys**. The secret half never leaves the phone; the public half goes
to the server so others can find it. To message Sara, Ali's phone takes one of Sara's public key
**bundles** from the server, and with it locks the message so only Sara's phone can open it. The
server only carries locked bytes and can't read them.

This is the **Signal Protocol**, the same one WhatsApp uses. We don't write any of the maths
ourselves: we use **libsignal**, Signal's own library (version 0.105.1). It's written in Rust, and
Signal ships it ready-made for Android, so we wrap it in a small **Expo module** in Kotlin.
- `SignalDevice.kt` is one phone: its keys, and lock and unlock.
- `PakchatSignalModule.kt` lets JavaScript call it. JavaScript only ever gets a name like
  `"Ali:1"`, never a key.
- Every bundle also has a **Kyber** key. That's the new "post-quantum" lock Signal added, so even a
  future quantum computer can't open today's messages.

### Groups
Locking a group message once for every member would be slow in a big group. So groups use
**sender keys**: each member makes one key for the group and sends it to the others inside a
normal 1-to-1 locked message. After that, a group message is locked once, and the server copies it
to everyone (`sendGroup` in `phone.ts`).

### Offline and catching up
`relay.ts` is a pretend server that lives inside the app, and behaves like the real one will in
phase 2: if Sara is online it pushes the envelope straight away, and if not, it **holds** it. When
she reconnects she gets everything, oldest first. Only when her phone says "got it" (`ack`) does the
server **delete** it.

### What the test checks
Tap **Run the test** and it goes through 10 steps: three phones make keys, Ali and Sara chat,
the study group works, Sara goes offline while the others send 5 messages (including Bilal's first
ever message to her), Sara reconnects and opens all 5 in order, the server is left with nothing,
the server never saw the words, both phones show the same **safety number**, a changed message is
refused, and a message delivered twice shows once.

The same test also runs on a computer (`spike-check`), using Signal's library for Node. That's how
it was checked in the cloud before you got the APK.

### The shrinker
The first APK failed 9 of 10 steps on the phone. A release build runs a **shrinker** (R8) that deletes
code nothing seems to call, to make the app smaller. But libsignal's Rust core calls back into its
own Java code (for example to load a session's keys), and the shrinker can't see those calls, so it
deleted them. `modules/pakchat-signal/android/proguard-rules.pro` now tells it to keep all of
libsignal. The computer tests didn't catch this because they don't shrink anything.

### Why an APK, not Expo Go
Expo Go only has the native code Expo ships with. libsignal is native code, so the app needs its own
build: the APK. From now on we use our own builds.

### Try this
- In the app, under **Try it yourself**, switch Sara off, send her a few messages from Ali and
  Bilal, and watch "3 waiting". Switch her on and they arrive.
- Look at **What the server saw last**: who it's from, who it's for, and gibberish.
- In `scenario.ts`, change `'Are you there?'` in `whileAway` to something else, and run the computer
  test (`cd app/spike-check && npm install && npm test`, it's a big download) to watch it fail.

## Step 24: Phase 2, the Phoenix server

| Part | Files |
|---|---|
| Signing in and devices | `server/lib/pakchat/accounts.ex`, `accounts/google_token.ex`, `accounts/google_keys.ex` (new) |
| Signal's public keys | `server/lib/pakchat/keys.ex` (new) |
| Chats and groups | `server/lib/pakchat/chats.ex`, `chats/` (new) |
| The relay | `server/lib/pakchat/relay.ex`, `relay/` (new) |
| Online, last seen, privacy | `server/lib/pakchat/presence.ex`, `privacy.ex` (new) |
| Push alerts (pretend for now), rate limits | `server/lib/pakchat/push.ex`, `push/notify.ex`, `rate_limit.ex` (new) |
| The addresses the app calls | `server/lib/pakchat_web/router.ex`, `controllers/` |
| The live connection | `server/lib/pakchat_web/channels/` (new) |
| The tables | `server/priv/repo/migrations/` (new) |
| The tests | `server/test/` |

The server the app will talk to is built. It does as little as it can: it knows who people are
and which chats they're in, and it passes along locked messages it can't read.

### Signing in
The app signs in with Google and gets a **token** from Google: a few facts (your Gmail, name and
Google id) signed by Google. The server checks the signature with Google's public key, that Google
made it for PakChat, and that it hasn't run out (`google_token.ex`). Then it gives that phone its
own **session token**, which the phone sends with everything after (`Authorization: Bearer …`).
The server only keeps a **hash** of it (a fingerprint), so even someone who copied the database
couldn't use it.

Signing in on a new phone takes the account over, like WhatsApp: the old phone and any linked
devices are signed out.

### Devices and keys
Each phone or website is a **device** with its own Signal keys (step 23). The server keeps only
the public halves. Starting a chat with Sara means taking one of her **bundles**
(`POST /api/users/:id/bundles`). Each one-time key in it is handed out once and deleted
(`keys.ex`), and two people asking at the same moment never get the same one (that's what
`FOR UPDATE SKIP LOCKED` does). When the Kyber ones run out, her "last resort" Kyber key is used.

### Envelopes: hold until delivered, then delete
This is the heart of it (`relay.ex`):
1. Ali's phone locks the message once **for each device** that should get it: Sara's phone, Sara's
   website, and Ali's own website (so it stays in sync). Each locked copy is an **envelope**.
2. The chat's **counter** gives it the next number (`seq`). Every message in a chat gets one.
3. Each envelope is saved in the `pending_envelopes` table and pushed straight away to devices
   that are online. An offline phone gets a push alert with **nothing in it**, which just wakes the
   app up to collect (pretend for now; real ones come in phase 5).
4. The device says "got it" (`ack`) and the envelope is **deleted**. Anything never collected is
   deleted after 30 days by a background job (**Oban**) that runs every hour.

If Ali's phone forgets a device (Sara just linked her website), the server says **stale devices**
and lists the missing one. The phone fetches its keys and sends again. That's how no device is
ever left out.

When a phone reconnects on a weak network, it can say "I already have chat X up to 41". The
server deletes those and sends only 42 onwards. Nothing is downloaded twice.

### Groups
A group message is locked **once** with the sender's group key (step 23) and the server copies it
to every member's devices. The server knows who's in each group, so it enforces the rules: only
admins can change the group, add or remove people, or make links; "only admins can send" (but
everyone can still react); and a group always keeps an admin. Each change also goes to everyone as
a small **system note** ("Ali added Sara"), numbered in the same counter as the messages.

### Ticks, typing and online
- **Ticks** are tiny envelopes with no words: "Sara has read numbers 5 and 6". With read receipts
  off, neither side gets blue ticks in one-to-one chats, as in WhatsApp (groups always do).
- **Typing…** goes straight to the others' open connections and is **never saved**.
- **Online** comes from **Phoenix Presence**: each open connection registers itself, and it's
  removed the moment the connection drops. **Last seen** is saved when it closes.
- Privacy (`privacy.ex`): last seen for everyone, my contacts (people I have a chat with) or nobody;
  online for everyone or "same as last seen". If you hide your last seen, you can't see other
  people's. People who blocked each other see neither.

### Block and rate limits
Someone who blocked you never gets your messages, typing or ticks. Your phone isn't told; it just
stays on one tick. **Rate limits** (`rate_limit.ex`) stop anyone from trying thousands of Gmail
addresses, using up someone's keys, or flooding a chat. The limits are in `config/config.exs`.

### "Not yours" looks like "doesn't exist"
Ask for a chat you're not in and the answer is 404, the same as for a chat that doesn't exist. So
nobody can even find out which chats are real.

### Try this
- Run the tests: `cd server && mix test`. Then open
  `test/pakchat_web/channels/device_channel_test.exs` and read the test names: each one is a rule.
- In `config/config.exs`, change `lookup: {30, 60_000}` to `{3, 60_000}` and run the tests. Watch
  "looking up too many people is stopped" fail, because it expects 30. Change it back.
- Start the server (`mix phx.server`) and open http://localhost:4000/dev/dashboard. Under
  **Processes** you can see Oban and Presence running.

## Step 25: Phase 3, the shared core

| Part | Files |
|---|---|
| The core, used by the app and the website | `shared/src/` (new): `client.ts`, `signal.ts`, `storage.ts`, `content.ts`, `rules.ts`, `server.ts`, `connection.ts` |
| Signal for the website | `shared/signal-wasm/` (new, Rust), `shared/src/web/` (new) |
| The tests | `shared/test/` (new) |
| Small server additions | `server/lib/pakchat/relay.ex`, `server/lib/pakchat_web/params.ex`, `controllers/auth_controller.ex`, `server/test/e2e_server.exs` (new) |

The app and the website will look different, but underneath they do the same things: lock and
unlock messages, keep the chat list, send in order, retry when the network drops, handle groups,
edits and reactions. All of that is written **once**, here, in TypeScript. The screens come later.

### One class: `PakChat`
`client.ts` is the whole chat app without screens. You give it four things:
- **signal**: something that can lock and unlock (`SignalApi` in `signal.ts`). On the phone that's
  our Kotlin module from step 23. On the website it's the WebAssembly build below.
- **storage**: somewhere to keep chats and messages (`Storage` in `storage.ts`). On the phone that
  will be SQLite, on the website IndexedDB. The tests use `MemoryStorage`.
- **server** and **connect**: the web addresses and the live WebSocket from step 24.

Then the screens just call `sendText`, `react`, `markRead`… and listen with `on('message', …)`.

### What's inside a locked message
Before locking, a message is a small piece of JSON (`content.ts`), for example
`{"v":1,"id":"…","chat":"…","t":"text","text":"Hi"}`. `t` says what it is: a text, a poll, an
edit, a delete, a reaction, a vote, a pin, a timer change, or a group key. The server never sees
any of it. When one arrives, `parseContent` checks it strictly (the right fields, not too long) and
throws away anything odd. The chat id inside must match the envelope, so a server can't move a
message to a different chat.

### The rules live on every phone
The server can't read edits or deletes, so it can't check them. Every phone checks for itself
(`rules.ts`): you can edit your own message for 15 minutes and delete it for everyone for 60 hours;
a group admin can delete anyone's. A message from a tampered app that breaks a rule is ignored.

### Sending: the outbox
`sendText` saves the message (one grey tick, "queued") and puts it in the **outbox**. The outbox
sends one at a time, in order. If the network is down, it waits; if the server says "stale
devices", it fetches the new device's keys and tries again. So a message written in a lift
still goes, and in the right order.

### Receiving: once, in order
Everything that touches Signal or storage goes through one **lane**: one thing at a time. That
matters because Signal's keys change with every message. Each envelope's id is remembered, so one
that arrives twice is shown once. Only after it's saved does the phone say "got it" (`ack`), and
the server deletes it. An edit or reaction that arrives before its message waits, and is applied
when the message comes.

### Groups: keys when people join and leave
A group message is locked once with your **group key** (step 23). Your phone sends that key, inside
normal locked 1-to-1 messages, to every device in the group that hasn't got it yet, in the same
send as the message. When someone **leaves or is removed**, everyone throws their group key away
and makes a new one, so the person who left can't read anything after. Someone added later never
gets the old keys, so they can't read old messages.

If a phone can't open something (it was reinstalled, so its keys are new), it sends back an
unlocked "please send that again". The sender starts a fresh session and resends it.

### The website gets Signal too
The website is a linked device, like WhatsApp Web, so it needs real end-to-end encryption too.
Signal's library is written in **Rust** and has no ready-made browser version. So we built one:
`signal-wasm/` is a small Rust wrapper that compiles libsignal (the same 0.105.1 as the phone) to
**WebAssembly**, a format browsers can run at nearly full speed. It's about 1 MB.

To be sure it's right, the tests lock on one library and unlock on the other, every way round,
and check two published test values: Signal's own safety-number example, and the standard X25519
example from RFC 7748.

### The tests
- `npm test` runs 108 tests against a **pretend server** that can be nasty on purpose: it sends
  things twice, out of order, or back to front. Every chat test runs three ways: all phones, all
  websites, and mixed.
- `npm run test:server` runs 5 more against the **real** Phoenix server and Postgres (see
  `shared/README.md`). One of them found a real bug: after reconnecting, a send left over from the
  old connection held everything up for 10 seconds. Now a dropped connection gives up on its
  unanswered sends at once (`connection.ts`).

### What changed on the server
- A new kind, `control`, for "please send that again" and the resend.
- Group sends can list the devices they think are in the group, and get "stale devices" if that's
  out of date, the same as 1-to-1.
- Sign-in also returns the device's id for the live connection (`device_uuid`).

### Try this
- `cd shared && npm install && npm test`. Then open `test/chat.test.ts` and read the test names.
- In `src/rules.ts`, change `EDIT_MINUTES = 15` to `25` and run `npm test`. Watch "the time limits"
  fail, because a 20-minute-old edit now gets through. Change it back.
- In `test/chat.test.ts`, find `chaos = { shuffle: true, duplicate: true }`. That's the pretend
  server jumbling and doubling everything. The test still passes, because of the lane and the
  remembered ids.

## Step 26: Phase 4, the Android app

| Part | Files |
|---|---|
| The screens | `app/src/app/` (new): `sign-in.tsx`, `(tabs)/`, `chat/[id].tsx`, `info/[id].tsx`, `new-chat.tsx`, `new-group.tsx`, `search.tsx`, `settings/`… |
| Building blocks and movement | `app/src/ui/` (new): `kit.tsx`, `icons.tsx`, `motion.ts`, `overlays.tsx`, `ChatRow.tsx`, `chat/` |
| Talking to the shared core | `app/src/core/core.ts`, `app/src/core/hooks.ts` (new) |
| Chats kept on the phone, and search | `app/src/data/sqliteStorage.ts`, `app/test/sqliteStorage.test.ts` (new) |
| Keys kept on the phone | `app/modules/pakchat-signal/android/` (`AndroidKeyBackend.kt`, `SavedStore.kt`, `SignalDevice.kt`) |
| Look and words | `app/src/theme/`, `app/src/i18n/strings.ts` |
| Emulator tests | `app/maestro/` (new) |
| Server | `config/dev.exs` (listens on Wi-Fi), test sign-in in `accounts.ex` and `auth_controller.ex` |
| Gone | the Phase 1 test screen: `App.tsx`, `index.ts`, `src/server.ts`, `src/spike/`, `spike-check/` (the real app replaced it, and its checks now live in `shared/`) |

Phase 3 built the chat app without screens. This step gives it screens, on Android, in
**React Native** with **Expo**.

### Screens are files
With **Expo Router**, every file in `app/src/app/` is a screen, and its path is its address:
`chat/[id].tsx` is the screen for `/chat/123`, and `[id]` means "any chat id". `_layout.tsx` files
wrap the screens inside them: the top one decides whether you see the sign-in screen or the app,
and `(tabs)/_layout.tsx` draws the four tabs at the bottom.

### The phone's database answers first
Every screen reads from **SQLite** on the phone (`sqliteStorage.ts`), never from the network. So
the chat list shows straight away, even in a lift. When something new arrives, the core saves it
and calls `emit('chats')` or `emit('messages:<chat>')`; the hooks in `hooks.ts` hear that, read
the database again, and the screen updates. Search uses SQLite's **FTS5**, a ready-made word index:
it finds "notes" when you type "not", works in Urdu too, and never leaves the phone.

### The keys stay safe
Signal's keys live in the Kotlin module, in their own database that Android keeps out of backups.
Each value is locked with a key held by the **Android Keystore**, a safe inside the phone that even
the app can't read out. The app only ever asks it "lock this" or "unlock this".

### Signing in with Google
The phone shows its Google accounts (Android's **Credential Manager**). You pick one and Google
hands the app a signed **ID token**. The app sends it to our server, which checks Google's
signature and that the token was made for PakChat (`GOOGLE_CLIENT_IDS` in `server/.env`).
No password ever touches PakChat.

### How things move
Everything that moves uses **Reanimated springs** (`motion.ts`) instead of fixed-time animations.
A spring keeps your finger's speed: let go of a swipe and the row carries on and settles, rather
than jumping. Gestures (`usePanGesture`) run on the phone's UI thread, so they don't stutter even
while the JavaScript is busy. Animations play even when "Remove animations" is on in the phone's
settings, because skipping them left some screens invisible.

How bouncy a spring is depends on one ratio: its `damping` divided by `2 × √(stiffness × mass)`.
At 1 it glides in with no bounce at all. At 0.85 to 0.9 it settles with a tiny overshoot you feel more
than see, which is what most of PakChat uses. A sent message and the send button sit at about 0.7, one
small bounce. Under 0.6 it wobbles, which is what felt annoying in the first builds. The typing bar
has no animation of its own: it follows the keyboard frame by frame, so it never lags behind.

### Urdu, right to left
Pick اردو and every screen flips at once, without restarting. The layout engine (**Yoga**) has a
`direction: 'rtl'` switch: rows run from the right, `start` and `end` swap sides, and arrows are
turned around by hand (`<Icon flip />`). Urdu words use **Noto Nastaliq Urdu**, built into the app,
which needs much taller lines than English. Each bit of text picks its font from its own letters, so
an Urdu message in an English chat still looks right.

### Testing on two emulators
**Maestro** drives the app like a person: tap this, type that, wait until that shows. The emulators
have no Google account, so the server can make pretend `…@test.pakchat` accounts, but only when you
start it with `PAKCHAT_TEST_SIGN_IN=1`, and never for real Gmail addresses. `two-phones.sh` signs
in Ali and Sara, has them chat, turns Sara's network off, has Ali send three messages, turns it back
on, and checks they arrive in order. If a step fails, it prints a command like
`two-phones.sh from 7` that carries on from that step instead of starting over.

### Try this
- In `app/src/ui/motion.ts`, change `smooth`'s `damping: 26` to `8`, rebuild, and swipe a chat.
  It wobbles like jelly (the ratio drops from 0.9 to 0.28). Change it back.
- In `app/src/i18n/strings.ts`, change `quickOk: 'Theek hai'` to your own phrase. It shows up in
  the one-tap answers in every chat.
- Open the app, go to You > Language > اردو, and watch the tabs, the swipe arrows and the switches
  turn round.

## Step 27: Phase 5, files, alerts, phone numbers, contacts and backups

| Part | Files |
|---|---|
| Locked files | `server/lib/pakchat/files.ex`, `file_controller.ex`; `app/modules/pakchat-signal/android/` `FileLock.kt`, `FileTransfer.kt`; `app/src/core/files.ts`, `app/src/ui/chat/FileBody.tsx`, `app/src/app/viewer.tsx` |
| Alerts when the app is closed | `server/lib/pakchat/push/fcm.ex`; `app/src/core/push.ts`, `app/app.config.js` |
| Signing in by phone number | `server/lib/pakchat/phone.ex`, `phone_codes.ex`, `sms.ex`, `sms/`; `app/src/app/sign-in.tsx` |
| Gmail and number in one account | `accounts.ex`, `me_controller.ex`; `app/src/app/settings/account.tsx` |
| Contacts | `shared/src/contacts.ts`; `app/src/app/contact.tsx`, `app/src/core/phoneBook.ts`, `PhoneBook.kt` |
| Backups | `backup_controller.ex`; `app/src/core/backup.ts`, `settings/backup.tsx`, `restore.tsx`, `sqliteStorage.ts` |
| The lost-message fix | `shared/src/client.ts`, `shared/src/web/wasmSignal.ts`, `SignalDevice.kt` |

### Files are locked before they leave the phone
A photo is locked on the phone with a new random key (AES-256, plus an HMAC that notices any
change), the way Signal does it. Only the locked bytes go to the server. The key travels inside the
message, which is itself locked, so the server holds a file it can never open. The other phone gets
a **signed link**: a web address with a stamp only our server can make, that works for 6 hours, and
only for people in that chat. The Kotlin code locks and uploads a piece at a time, so a 100 MB video
never sits in memory. The biggest size is `FILE_MAX_MB` on the server, and the app asks for it, so it
can change after launch with no app update.

### Alerts when PakChat is closed, WhatsApp style
Android lets one service wake apps: **Firebase Cloud Messaging (FCM)**. The phone gets a push token
from Firebase and gives it to our server. Leaving PakChat disconnects at once. When a message comes
for a phone that isn't connected, the server sends a quiet **wake-up** through Firebase, with no
words in it. The phone wakes PakChat in the background (`app/src/core/background.ts`), which
connects, collects the message (the sender sees grey double ticks, never blue), unlocks it, and
shows the alert itself: the chat's name and "Sara: See you at 5". One alert per chat, updated as more
come, with "3 new messages" on top. Muted chats stay quiet, and tapping opens the chat. The words
never go through Firebase or our server.

The alert itself is drawn by our Kotlin code (`ChatAlerts.kt`), like WhatsApp's: the chat's messages
listed one under another, all chats bundled as "5 messages from 2 chats", and Reply, Mark as read and
Mute buttons. Those buttons start PakChat's JavaScript without any screens for a few seconds
(`AlertActionReceiver.kt`, then `background.ts`), which sends the reply or the blue ticks and lets go.

If a phone looks connected but doesn't collect a message within 3 seconds (its connection died
without noticing), the server wakes it anyway. Phones pause JavaScript timers in the background,
so the app waits with the phone's own clock instead (`wait` in the pakchat-signal module).

### Phase 5: alerts (free, about 10 minutes, once)
1. Go to console.firebase.google.com, **Add project**, name it PakChat (Analytics can be off).
2. **Add app**, Android, package name `com.pakchat.app`. Download `google-services.json` and put
   it in `~/Documents/pakchat/app/`. Git ignores it.
3. Project settings, **Service accounts**, **Generate new private key**. Keep that file outside the
   repo, for example in `~/pakchat-secrets/`.
4. In `server/.env` add `FCM_SERVICE_ACCOUNT=/Users/<you>/pakchat-secrets/<the file>.json`.
5. Restart the server and rebuild the app (`npx expo run:android`). Settings, Notifications
   should now say alerts are on.

### Signing in with a number
The server makes a 6-digit code, keeps only a hash of it for 10 minutes, and allows 5 tries. For now
`SMS=terminal` prints the code in the server's Terminal, which is free. At launch, `SMS=twilio` and
the Twilio keys in `server/.env` send real SMS, with no app change. `SMS_DAILY_CAP` stops a bill
running away.

### One account, two ways in
You can add a number to a Google account, or a Gmail to a phone account, in You, Ways to sign in.
If that Gmail or number already has its own PakChat account, it's refused as taken. You can remove
one only while the other is still there, so you can never lock yourself out.

### Contacts, WhatsApp style
Names you save are yours: they live on your phone, not on the server. Someone you haven't saved
shows as "~ Their name", and their chat starts with a "Not in your contacts" card. Saving asks where,
like WhatsApp: your Google account, the phone, or the SIM card. To find which of your phone's contacts
use PakChat, the app sends **hashes** of their numbers (SHA-256), not the numbers themselves.

### Backups
A backup is a copy of your chats' database with the keys and session left out, locked with a key
made from your backup password (PBKDF2, slow on purpose so guessing is slow), and uploaded. On a new
phone, sign in, type the password, and the chats come back. Forget the password and nobody, not even
us, can open it. Photos and videos aren't in the backup; they download again while the server still
has them (30 days).

### The lost-message fix
Before, if the app was killed just after unlocking a message but before saving it, the message
was gone: Signal's keys had moved on and couldn't open it again. Now the unlocked text is saved
together with the new key state, in one write, and only forgotten once the message is safely in the
chat. So opening the same envelope again gives the same text.

### Try this
- Send a photo, then look in `server/priv/files`: the file is there, but it's noise.
- In `server/.env`, set `FILE_MAX_MB=5` and restart the server. Try sending a big video: the app
  says it's too big, without an update. Set it back.
- Sign in with a number and watch the code appear in the server's Terminal.

## Step 28: Phase 6, calls, voice notes, status, GIFs, stickers and media

### Voice notes, WhatsApp style
Hold the mic to record and let go to send. Slide left to cancel, or slide up to the lock to keep
recording without holding. Locked, you can pause, listen back (tap the bars to jump), record more,
delete, or send. A single tap on the mic opens the same locked recording. Android can't pause a
recording and keep one playable file, so each pause ends a piece, and the pieces are joined into one
file by our Kotlin code (`AudioJoin.kt`, which copies the sound without re-encoding it). The bars are
the loudness, sampled ten times a second while recording, and travel inside the locked message.

### Calls go straight from phone to phone
The sound and video use WebRTC: the two phones send it to each other directly, locked by WebRTC
itself. Our server only passes the few call messages that set it up (`ring`, `join`, `offer`,
`answer`, `ice`, `leave`…), and those are locked with Signal like any message
(`app/src/core/calls.ts` explains each one). In a group call every two phones connect to each other,
so 8 phones is the most: each one sends to the seven others.

A call rings even when PakChat is closed or the phone is locked. The caller's `ring` wakes the other
phone with a push, and our Kotlin code (`CallAlerts.kt`) shows Android's own call alert, full screen
on a locked phone, with the ringtone. (WhatsApp uses Android's ConnectionService for this; we use the
call-style alert, which looks and rings the same, needs no extra permission and is simpler to keep
working.) While the call is on, a foreground service (`CallService.kt`) keeps the microphone going when
you leave the app, and `CallAudio.kt` moves the sound between the earpiece, the speaker, headphones
and Bluetooth.

### Phase 6: the call relay (optional, free, about 15 minutes)
Most calls connect directly. On some networks (some offices, some mobile data) the phones can't
reach each other, and the call needs a relay in the middle. The relay passes locked sound it can't
listen to. To run our own, free, on your Mac:
1. `brew install coturn`
2. Make a long random secret: `openssl rand -hex 32`
3. Start it: `turnserver -n --listening-port=3478 --use-auth-secret --static-auth-secret=<the secret> --realm=pakchat --no-tls --no-dtls`
4. In `server/.env` add `TURN_URLS=turn:192.168.100.2:3478?transport=udp,turn:192.168.100.2:3478?transport=tcp`
   and `TURN_SECRET=<the same secret>`, then restart the server.
The server hands each phone a password that only works for a day (made from the secret), so
the secret itself never leaves your Mac. Without these lines calls still work wherever phones can
reach each other.

### Status
Your status is a chat of its own, with the people allowed to see it as members (Settings, Status
privacy). Each status is a locked message that's gone after 24 hours. Watching one sends a read
receipt (that's the "seen by" list), a ❤️ is a reaction, and a reply goes to your normal chat with
them, with a little copy of the status. The server never sees who watched whose status.

### GIFs and stickers
GIFs come from KLIPY, a free GIF library. Our server asks KLIPY (so KLIPY never sees who's
searching), the phone downloads the small video it picked, and sends it locked like any video. To
switch GIFs on, get a free key at klipy.com (developers) and put `KLIPY_KEY=<the key>` in
`server/.env`. Without it, the GIF tab just hides.

Stickers are pictures with a see-through background, shown big without a bubble. The 16 PakChat
stickers are drawn by `app/scripts/make-stickers.py` (Urdu with its English spelling under it);
change the list there and run it again to make new ones. You can also make one from any photo (the
+ in the Stickers tab), and hold a sticker someone sent you to save it.

### Photos are made smaller, unless HD
A phone photo is often 4 MB. Before sending, it's made at most 1600 pixels wide and saved as a JPEG
at 75%, usually about 300 KB, which looks the same on a phone and sends much faster. Switch on HD
quality in the send sheet to send it as it is.

### Media, links and docs
Open a chat's Info, Media, links and docs. It's read from the phone's own database (SQLite's
`json_extract` looks inside each saved message), so it works offline and the server never knows.
Tap a photo for the viewer: swipe, or use the arrows, and the strip at the bottom jumps anywhere.

### Try this
- Call from one emulator to the other with the app closed on the second: it rings.
- In `app/scripts/make-stickers.py`, change a sticker's colours, run `python3 scripts/make-stickers.py`
  in `app/`, rebuild, and send it.
- Send the same photo twice, once with HD on. Compare their sizes in Info, Media, links and docs.
- Set Settings, Privacy, Default message timer to 24 hours, then start a new chat: it starts with
  disappearing messages on.

## Step 29: Phase 7, the WhatsApp extras, Communities and the locks

### First: what "React" and "native compile" mean
PakChat on the phone is made of two kinds of code.

- **The React part** (`app/src`, files ending in `.ts` and `.tsx`). This is every screen, button and
  list, and the "brain" (`core/`) that locks messages and talks to the server. It's written in
  TypeScript and drawn by React Native. We can check it on the build computer without a phone: the
  type checker (`tsc`) finds mistakes like a wrong name, the linter (`eslint`) finds risky code, and
  the tests (`vitest`) run the real code. That's why the React part was "already tested".
- **The native part** (`app/modules/pakchat-signal/android`, files ending in `.kt`, plus C++ inside
  some libraries). This is code in Android's own language, Kotlin, for things JavaScript can't do by
  itself: the alarm clock for scheduled messages, blocking screenshots, the live location alert,
  speech-to-text, making a .zip. It only gets **compiled** (turned into machine code the phone runs)
  when the APK is built.

**Building the APK** (`./gradlew assembleRelease` in `app/android`) does both at once: Gradle
downloads the Android libraries, compiles the Kotlin and C++, packs the React part into one
JavaScript file, and zips it all into `app-release.apk`. It takes 20 to 40 minutes the first time
because it compiles a lot of code. If a Kotlin file has a mistake, this is the step that finds it.

### The Communities tab (Settings moved to the ⋮ menu)
The fourth tab is now **Communities**, like WhatsApp. A community is a group of groups: one
**Announcements** group where only admins write (it has a 📢), and the other groups under it. The
community page shows the groups you're in and the ones you can join with one tap. Admins can add
groups they run, make a new one, or hold a group to take it out.

On the server, a community is just a chat with `kind: community`, and each group points to it
(`community_id`). The server knows which groups belong together, but still can't read any of them.
Settings and your profile are now in the chat list's ⋮ menu, Settings.

### Invite links (with limits)
Group info, Invite via link makes a link like `…/join/AbC123`. Anyone with it sees the group's name
and picture and can join. You can make it stop **after a time** (an hour, a day, 7 or 30 days) or **after a
number of people** join, and reset it to make the old link stop working (that's also where the limits are set). The server keeps the code,
the end time and the count (`invite_expires_at`, `invite_max_uses`), and turns people away when it's
used up.

### Broadcast lists
A broadcast list sends one message to many people at once, but each person gets it in their normal
chat with you, as if you'd sent it only to them. They can't see each other. The list itself lives
only on your phone (`core/broadcasts.ts`). The server just sees ordinary messages. Each sent message
shows **"12 of 20 read"**: your phone adds up the ticks from each person's chat. Tap it to see who.
A photo is uploaded once and then reused for everyone, so it doesn't upload 20 times.

### View once
A view once photo, video or voice note opens one time. While it's open, screenshots and screen
recording are blocked (Android's `FLAG_SECURE`, in `Privacy.kt`). When you leave, the file is
deleted from the phone, so it can't be opened again, saved or forwarded. The sender sees "Opened".

### Round video messages
Hold the 📷 in the message bar to record a round video with the front camera, up to a minute. Let go
to send it, or slide left to cancel. Tap the 📷 instead for the normal camera.

### Location and live location
Send where you are, or drag the map to pick a place. The map is made of OpenStreetMap's free little
square pictures (`MapTiles.tsx`), so there's no Google Maps key and nothing to pay.
**Live location** shares where you are for 15 minutes, an hour or 8 hours. Each move (at most every 30
seconds or 25 metres) goes as a small locked message. Android only lets an app follow you in the
background while it shows an alert, so you'll see "Sharing live location" with a Stop button
(`LiveLocation.kt`).

### Contact cards, starred messages, export chat
- **Contacts:** pick someone from your phone's contacts and send their name and number as a card. If
  they're on PakChat, the card has Message.
- **Starred:** the starred list got tidier (it's the same feature as before).
- **Export chat** (chat menu): makes a `.txt` file like WhatsApp's (`25/10/2026, 14:05 - Ali: hi`),
  or a `.zip` with the photos and files too (at most 100 files or 200 MB), and opens the share sheet.
  It's made on your phone, so the server never sees it.

### The new message bar, attach menu and editor
The message bar now looks like WhatsApp's: 😊 on the left, the box, 📎 and 📷, then the mic or send.
The 📎 opens our own menu (Gallery, Camera, Document, Audio, Location, Contact, Poll). Picking photos
opens a full-screen editor: crop and turn, draw, add words and stickers, trim a video, add a caption, or make it view once.

**Private badge:** before sending, every photo is redrawn as a fresh copy. The hidden details a camera
puts inside photos (EXIF: where it was taken, the phone model, the time) aren't copied, so they never
leave your phone. The editor shows "Private" to say so.

### Scheduled messages and Undo send
- **Scheduled:** hold send, pick a time. The message waits on your phone, and Android's alarm clock
  (`Scheduled.kt`) wakes PakChat at that time, even if it's closed or the phone restarted, and sends
  it. The chat shows "1 scheduled message" with edit, send now and delete. Works in every chat.
- **Undo send:** after you send, there's an Undo for 5 seconds. The message really waits those 5
  seconds on your phone before it goes, so Undo means nobody ever got it. (Settings, Chats can turn
  this off.)

### Link previews, reply privately, report, voice transcripts
- **Link previews:** when you write a web address, *your* phone reads the page and makes a little
  card (title, words, picture) that goes inside the locked message. The other person's phone never
  visits the page, and our server never sees the address. Settings, Chats can turn it off.
- **Reply privately:** hold a message in a group, Reply privately, and it opens your one-to-one chat
  with that person, quoting it.
- **Report:** the server can't read messages, so a report carries only the last few messages (at most
  5) that *your* phone chose to send with it, like WhatsApp. They're saved in the server's `reports`
  table for whoever runs PakChat.
- **Voice transcripts:** tap "Show words" under a voice note. Android's own speech recognition does it
  on the phone (`Transcribe.kt`), so the voice never leaves it. It needs Android 13 or newer with
  on-device recognition; otherwise the button doesn't show.

### Wallpapers and tones
- **Wallpaper:** Settings, Chats, Wallpaper for every chat, or a chat's Info for just that chat:
  doodles, none, 8 colours, 6 gradients or your own photo (copied into PakChat, so it stays if you
  delete it from the gallery). In dark mode a photo can be dimmed with a slider.
- **Notification tone:** 6 PakChat tones, for all chats or one chat. Android lets each alert
  "channel" have only one sound, so each tone gets a channel of its own.
- **Conversation tones:** the little sounds while you're in a chat (a "pop" when yours goes, a soft
  one when theirs arrives), with a loudness slider in Settings, Notifications.

### Call links and scheduled calls
- **Call link** (Calls tab, the link button): a link anyone can use to join a call. It never rings
  anyone: people join when they want, and the page shows who's in it now. Behind the scenes it's a
  special group chat whose calls don't ring. If two people start at the same moment, the phones
  agree (the smaller id wins) so everyone ends up in one call, not two.
- **Scheduled call** (Calls tab, or the chat menu): pick a chat, a time, voice or video. Everyone gets
  an event message, and each phone sets its own reminder for that time. It shows under "Upcoming".

### App lock and chat lock
**App lock** (Settings, App lock): PakChat opens only with your fingerprint or face. There's
no PIN on purpose, because anyone who knows your phone's PIN could get in. A wrong try waits 30
seconds. It locks again when you leave: at once, after 30 seconds, after a minute, or when the phone's
screen goes off. Going to our own gallery, camera or share sheet doesn't count, so it doesn't lock
while you're picking a photo. It only turns on if the phone has a fingerprint or face set up, and it
warns you first: **if the fingerprint stops working, the only way back is to reinstall PakChat and
restore your backup.**

**Chat lock** (a chat's Info, Chat lock), two ways:
- **Locked chats folder** (WhatsApp's way): the chat leaves the list and goes into "Locked chats",
  which appears when you pull the chat list down. Add a **secret code** to hide the folder too; then
  it only opens by typing the code in search. "Clear locked chats" deletes them if you forget the code.
- **In the list** (our way): the chat stays where it is with a 🔒, showing only "Locked chat" or "New
  message", and opens with your fingerprint.

Either way its alerts just say "New message", its words don't show in search, and it locks again when
you leave it (at once, or after 30 seconds or a minute). The secret code is never saved, only its
fingerprint (a SHA-256 hash), so even someone reading the phone's storage can't find it. Locked chats'
photos never go to the phone's gallery: PakChat keeps all its files to itself.

### Try this
- Make an invite link that stops after 1 person. Join from the second emulator, then try a third
  account: the link says it's used up.
- Make a broadcast list with both emulators' accounts, send a message, open it on one: "1 of 2 read".
- Schedule a message 2 minutes ahead, close PakChat completely, and wait: it still goes.
- Lock a chat "in the list", send it a message from the other phone, and look at the alert: it says
  only "New message".
- Turn on App lock with "at once", go home and come back: it asks for your fingerprint. Now attach a
  photo and come back from the gallery: it doesn't ask.

## Step 30: Build 2, closer to WhatsApp

Build 2 fixes what testing found and copies more of WhatsApp's behaviour, screen by screen. Two
things need the server updated first: **`mix ecto.migrate`** (community join requests and
suggestions, and who may see your profile photo), and the APK is built after **`expo prebuild`**,
because two new Android settings came with it (the camera's recent photos, and screen sharing).

### Fixes from testing
- The camera shows your newest photos and videos in a row; tap to send one, hold to pick several.
  The chat list has its own camera button too: take or pick, choose the chat, edit and send.
- Hold send to schedule a message for any minute (Undo send is gone: messages go at once).
- The locked chats row slides in when you pull the list down, the app lock asks only once, and a
  locked chat opens straight from the list.
- The video viewer is clean like WhatsApp's, the video editor's trim strip is under the video, and
  the sticker crop button says "Done".

### Looks
- **Chat header:** a flat bar, no rounded card, like WhatsApp.
- **Wallpaper:** fills the whole chat, behind the header and the message box. The picker is
  WhatsApp's: a small phone preview, then My photos, Doodles, None, Colours and Gradients, each opening
  full screen to swipe through. From a chat it asks "For this chat" or "For all chats".

### Photos (people, groups and communities)
Tap your photo in Settings, or a group's or community's photo in its Info if you're an admin: Choose
from gallery, or Remove photo. The photo is cropped square, made 640×640 and uploaded. Like
WhatsApp's, photos are **not** end-to-end locked: the server only gives your photo to people allowed
to see it (Settings, Privacy, Profile photo: Everyone, My contacts or Nobody). Each phone keeps a copy
in its cache (`core/photos.ts`), so a photo is fetched once.

### Communities and Archive
- **Communities** work like WhatsApp's: exiting a community leaves all its groups; members can
  suggest groups and admins approve them; a group can ask admins to approve new members ("Request
  to join"); only the owner can deactivate a community. In Chats, a community's groups sit together
  under its name.
- **Archive:** "Keep chats archived" (on by default) keeps archived chats there when someone writes,
  and quiet, except a group message that @mentions you or replies to you. Hold chats in Archived to
  pick several, then Unarchive (with Undo), Mute or Delete.

### Chats
- **Message yourself:** the first row in New chat. It's called "Your name (You)": notes, links and
  files to keep, on all your devices. No calls or blocking there.
- **Mute** for 8 hours, 1 week or Always. When the time is up the chat unmutes by itself (a timer,
  and a check each time PakChat opens; alerts check the time too, so a late timer never matters).
- **Muted groups** still alert you for an @mention or a reply to you, and show an **@** on the row,
  like WhatsApp. One-to-one chats stay quiet when muted.
- **Broadcast lists:** hold a message you sent for Info, Copy, Edit (words, for 15 minutes) and
  Delete. "Delete for everyone" takes back every copy in every chat.

### Calls
- **New call** (the button at the bottom of Calls): search your contacts and call one, or "Call a
  number" that's on PakChat.
- **Favourites** at the top of Calls, with "Add favourite": call them in one tap.
- Calls one after another with the same person, the same way, on the same day are one row ("Ali
  (3)"). Tap a row for **Call info**: each call, in or out, voice or video, the time and how long.
- The Calls tab shows how many **missed calls** you haven't looked at yet.
- **Share screen** in a video call. Android asks first ("Start recording or casting?") and shows its
  own alert while you share; everyone sees your screen whole, instead of your camera. Behind the
  scenes the camera's picture is swapped for the screen's, so nothing has to reconnect.
- **Use less data for calls** (Settings, Storage and data): thinner sound and a smaller, slower
  picture, for little mobile data.

### Settings
- **Search** (the 🔍 at the top): type "tone", "last seen" or "backup" and every matching setting
  shows with its page.
- **Groups' tone** (Settings, Notifications): a separate tone for group messages.

### Try this
- Mute a group for 8 hours, then from the other phone @mention this one in it: you still get the
  alert, and the row shows @.
- Start a video call, tap Share screen, and open your gallery: the other phone sees it. Tap "Stop
  sharing": your camera comes back.
- Call the other phone twice and miss a call: Calls shows "(2)" and a 1 on the tab until you open it.
- In Settings, search "less": "Use less data for calls" comes up.

## Step 31: The last build of Phase 7, and R8

### Why build 2 closed as soon as it opened
When PakChat starts, its code files load one after another, and each file first loads the files it
needs. Build 2 made the picture part (`kit.tsx`) read live data, so it now needed `hooks.ts`. But the
calls code also needed the picture part, for the letters on a caller's picture. That made a loop:
calls → pictures → hooks → calls. So `hooks.ts` ran while the calls code was only half loaded, used
it, found nothing there, and Android closed the app.

The fix: the letters and colours moved to their own small file (`ui/letters.ts`) that needs nothing
else, and so did tone names (`core/tones.ts`). A new test (`test/importOrder.test.ts`) loads the
files in the same order the phone does, from every file, and fails if anything uses a half-loaded
file. The automated checks before only read the code; this one walks it the way the phone does.

### What's new
- **Round pictures**, like WhatsApp. Communities keep a rounded square, which is how WhatsApp tells
  them apart.
- **Tap a picture** in the chat list: it pops up bigger, with Message, Voice call, Video call and
  Info. Tap the photo (or the big one in Info) to see it full screen, or "No profile photo".
- **Delete chat** now really takes a chat off the list (until someone writes again). For a group
  you're still in it asks: **Clear chat** (stay in it) or **Exit and delete**. After you leave a
  group it offers **Delete group** or **Clear chat**, and a left group shows Delete group in its
  info and at the bottom of the chat. **Clear chat** is also in the ⋮ menu when you select chats.

### R8: a smaller app
Android apps are written in Java and Kotlin, and turned into `.dex` files. Most of that code comes
from libraries, and PakChat only uses part of each one. **R8** is Google's tool that reads all of it,
throws away what's never used, and gives what's left short names. The app gets smaller and a bit
quicker to start.

The risk: some code is only reached **by name** from native code (C++ and Rust: calls, encryption,
animations). R8 can't see those uses, so it might throw that code away, and the app would crash only
when you made a call or opened a chat. So:
- Every library's own "keep" rules were checked, and we added our own (in `app.json`,
  `extraProguardRules`) for WebRTC (calls), libsignal (encryption), worklets and Reanimated
  (animations), Nitro (Google sign-in) and our own native module.
- After building, a checker compares the new APK with the old one: every class and method that a
  native library asks for by name (377 names) and every screen and service in the manifest must still
  be there.
- **Resource shrinking** (removing unused pictures and sounds) stays off. React Native finds images,
  and Android finds our alert tones, by name while the app runs, which that tool can't see.

### Try this
- Make a call, a video call and share your screen: calls are the part R8 could break.
- Send messages both ways, and open an old chat: that's the encryption.
- Lock a chat, get an alert, and schedule a message: alerts and alarms run in the background.

## Step 32: Faster, like WhatsApp

### "Online" only when the app is open
Before, a phone that woke up in the background just to collect a message counted as online, so you
saw "online" when your message got its two grey ticks. Now each phone tells the server whether
PakChat is on screen: when it connects, and again whenever you open or leave the app. The server
shows someone as online only while the app is on screen on one of their devices. A phone woken in
the background stays offline, and its "last seen" doesn't move. The server still knows that phone
is connected, so it doesn't send it a needless wake-up alert.

### Opening a chat
- Screens now slide in from the side in a fifth of a second, while the one under them moves back a
  little, like WhatsApp. Android's own animation took almost half a second.
- While the chat slides in, only the messages on screen are drawn. The older ones above are drawn
  straight after, so the phone isn't doing two things at once.

### The keyboard
The chat used to change its height on every frame while the keyboard slid up, so the phone measured
and placed every message again 60 times a second. Now the messages and the typing bar just move up
with the keyboard (cheap), and the height changes once, when the keyboard has stopped.

### Photos and videos
Drag a full-screen photo or video up or down to close it, like WhatsApp: it follows your finger,
shrinks a little, the black fades so you see the chat behind, and it closes when you let go. If you
don't drag far enough, it springs back. This works for profile photos too.

### Screen sharing
Sharing your screen froze the call on both phones, and could close PakChat on the Realme. The
phone tried to send its whole screen at full size (almost 3000 pixels tall on a Pixel 8 Pro), and
its video encoder (the part that squeezes video small enough to send) couldn't take that size. Now
the shared screen goes at most 1280 pixels on its longer side, about what WhatsApp sends, and it's
always the whole screen (newer Android first offers "one app", whose picture freezes once you leave
that app). Also, the call timer no longer shows "-1:-1" for a moment as a call connects.

### If PakChat ever closes by mistake
The next time it opens, it says so and offers **Copy details**: exactly what went wrong, to paste
to whoever is fixing it. It catches crashes in the Java and Kotlin code and JavaScript errors as
they happen, and reads Android's own record for crashes deep in C++ (calls and video).

### Try this
- Have a friend close PakChat, then send them a message: you see two grey ticks and no "online".
  When they open PakChat, "online" appears; when they leave it, you see "last seen" with that time.
- Open and close a few chats and Archived, and tap the typing bar: compare with WhatsApp on the
  same phone.
- Open a photo, drag it down a little and let go, then drag it down further.
- In a video call, share your screen from each phone in turn: the other phone should see it move.

## Step 33: build 5, the last fixes of phase 7

### Screen sharing on Android 11 (the Realme)
Pressing Share closed PakChat on the Realme. The "Copy details" from step 32 showed why on its first
try: the calls library (react-native-webrtc) waits up to 10 seconds for screen sharing to start
using a Java feature (`orTimeout`) that phones only have from Android 12. On Android 11 that line
doesn't exist, so the app crashed. `app/scripts/fix-webrtc.js` runs after every `npm install` and
changes that one line in the library to a plain timer that every Android has.

To be sure nothing else like it is hiding, every call the finished app makes into Android or Java
was listed and compared with Android 11's list. Everything else newer than Android 11 is only used
after checking the phone's Android version first.

### "PakChat is running" while sharing
While you share your screen, Android needs a notification on screen. The library builds one but
looks for a small icon called `ic_notification`, which PakChat didn't have, so Android showed its
own "PakChat is running" notice instead. Now there's a small screen icon, and the notification
says "Screen sharing".

### Locked chats
- Coming back from a chat inside Locked chats asked for your fingerprint again. Now the folder stays
  open behind its chats, and locks again when you're back on the chat list (or leave PakChat), like
  WhatsApp.
- With a secret code, typing it in search no longer jumps straight into the folder. "Locked chats"
  appears at the top of the results, like WhatsApp, and you tap it to open.

### Try this
- On the Realme, share your screen in a video call; the Pixel should see it.
- Lock a chat, open Locked chats, open the chat, go back: the list is still open. Go back to the
  chat list and pull down to Locked chats again: it asks.
- Hide Locked chats with a secret code, type the code in search, and tap "Locked chats".
