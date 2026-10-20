// The JavaScript side of our Signal module. The real work happens in Kotlin
// (android/src/main/java/.../PakchatSignalModule.kt), using Signal's own library.
import { requireNativeModule } from 'expo';

import type { SignalApi } from '../../src/spike/types';

export default requireNativeModule<SignalApi>('PakchatSignal');
