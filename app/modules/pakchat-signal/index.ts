// The JavaScript side of our Signal module. The real work happens in Kotlin
// (android/src/main/java/.../PakchatSignalModule.kt), using Signal's own library.
// It does exactly what the shared core's SignalApi asks (shared/src/signal.ts).
import type { SignalApi } from '@pakchat/shared';
import { requireNativeModule } from 'expo';

let signal: SignalApi | null = null;

/**
 * Finds the Kotlin module the first time it's asked for, not when the app
 * loads, so if it's missing the app can show the error instead of a blank screen.
 */
export function loadSignal(): SignalApi {
  signal ??= requireNativeModule<SignalApi>('PakchatSignal');
  return signal;
}
