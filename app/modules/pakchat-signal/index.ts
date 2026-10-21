// The JavaScript side of our Signal module. The real work happens in Kotlin
// (android/src/main/java/.../PakchatSignalModule.kt), using Signal's own library.
// It does exactly what the shared core's SignalApi asks (shared/src/signal.ts).
import type { SignalApi } from '@pakchat/shared';
import { requireNativeModule } from 'expo';

export default requireNativeModule<SignalApi>('PakchatSignal');
