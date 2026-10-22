// index.ts: where the app starts. The background task (alerts when PakChat is
// closed) must be set up before anything else, then the screens load as usual.
import './src/core/background';
import 'expo-router/entry';
