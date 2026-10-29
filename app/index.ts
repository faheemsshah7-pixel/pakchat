// index.ts: where the app starts. The background task (alerts when PakChat is
// closed) must be set up before anything else, then the screens load as usual.
// Only the clock for "Starting PakChat" (core/speed.ts, nothing else in it) comes first.
import './src/core/speed';
import './src/core/background';
import 'expo-router/entry';
