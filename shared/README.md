# shared — PakChat's core

The part the app (phase 4) and the website (phase 8) both use: locking and
unlocking with Signal, the chat list and messages, the send queue, groups,
edits, reactions and the rest, and talking to the Phoenix server. Screens are
not here. Each app draws its own and calls this.

## Run the tests

```
npm install
npm test             # 108 tests, with a pretend server (no setup)
npm run lint         # oxlint
npm run typecheck    # TypeScript
npm run check        # all three
```

The tests against the **real** server need two terminals:

```
cd server && MIX_ENV=test mix run --no-start test/e2e_server.exs   # terminal 1
cd shared && npm run test:server                                    # terminal 2
```

That server uses its own empty database (`pakchat_e2e`), never real accounts.

## How an app uses it

```ts
import { PakChat, HttpServer, phoenixConnection } from '@pakchat/shared';

const chat = new PakChat({
  signal,                     // Signal: the Kotlin module on the phone, wasmSignal() on the website
  storage,                    // where messages live: SQLite on the phone, IndexedDB on the website
  server: new HttpServer('https://…'),
  connect: phoenixConnection('wss://…/socket'),
});

if (!(await chat.load())) await chat.signIn(googleIdToken);
chat.start();
chat.on('message', (m) => redraw(m.chatId));
await chat.sendText(chatId, 'Assalam o Alaikum');
```

## The files

```
src/
  client.ts        PakChat: everything above, in one class
  signal.ts        what a Signal library must offer (SignalApi)
  storage.ts       what storage must offer (Storage), and MemoryStorage
  content.ts       what's inside a locked message, and strict checks on it
  rules.ts         edit for 15 minutes, delete for 60 hours, admins
  server.ts        the server's web addresses (HttpServer)
  connection.ts    the live WebSocket (phoenixConnection)
  web/             the website's Signal: libsignal built as WebAssembly
signal-wasm/       the Rust code that builds web/wasm (see its README)
test/
  signal.test.ts   phone library and website library talking to each other, and Signal's own test numbers
  chat.test.ts     one-to-one, several devices, offline, ticks, reinstalling
  groups.test.ts   group keys, joining, leaving, admins-only
  changes.test.ts  edits, deletes, reactions, polls, pins, timers
  fakeServer.ts    the pretend server (same rules as the real one)
  e2e/             the same ideas against the real Phoenix server
```

See step 25 in `LEARN.md` for how it all fits together.
