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
