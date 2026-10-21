#!/bin/sh
# Rebuilds the website's Signal module from Signal's Rust code.
# Needs Rust (rustup.rs), protoc (brew install protobuf) and
# wasm-bindgen (cargo install wasm-bindgen-cli --version 0.2.126).
set -e
cd "$(dirname "$0")"
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir ../src/web/wasm --out-name signal \
  target/wasm32-unknown-unknown/release/pakchat_signal_wasm.wasm
echo "Done: ../src/web/wasm"
