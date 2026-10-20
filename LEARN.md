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

### Why an APK, not Expo Go
Expo Go only has the native code Expo ships with. libsignal is native code, so the app needs its own
build: the APK. From now on we use our own builds.

### Try this
- In the app, under **Try it yourself**, switch Sara off, send her a few messages from Ali and
  Bilal, and watch "3 waiting". Switch her on and they arrive.
- Look at **What the server saw last**: who it's from, who it's for, and gibberish.
- In `scenario.ts`, change `'Are you there?'` in `whileAway` to something else, and run the computer
  test (`cd app/spike-check && npm install && npm test`, it's a big download) to watch it fail.
