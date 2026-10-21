# signal-wasm — Signal for the website

libsignal (version 0.105.1, the same as the phone) has no ready-made browser
build. This small Rust crate wraps it and compiles it to **WebAssembly**, so the
website runs Signal's own code, not a copy of it.

The built files are already in `../src/web/wasm/`, so you only need this to
rebuild them (for example after moving to a newer libsignal).

## Rebuild

Once:

```
curl https://sh.rustup.rs -sSf | sh     # Rust
brew install protobuf                    # protoc, libsignal needs it to build
cargo install wasm-bindgen-cli --version 0.2.126
```

Then:

```
./build.sh
cd .. && npm test
```

`rust-toolchain.toml` picks the Rust version, and adds the WebAssembly target
by itself.

## What's in `src/lib.rs`

`SignalDevice` is one device: its keys, its sessions and its group keys, all
kept in memory and saved as JSON with `exportState()`. The TypeScript side
(`../src/web/wasmSignal.ts`) saves that after every change.

Two things differ from the phone, because a browser is not a phone:
- The time comes in from JavaScript (`nowMs`), because Rust can't read the
  clock inside WebAssembly.
- Random numbers come from the browser's `crypto.getRandomValues`.
