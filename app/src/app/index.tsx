// index.tsx: the app's front door. It sends you to the chat list if you're
// signed in, and to the sign-in screen if not.
//
// It must look at both: the layout hides the chat list while you're signed
// out, so always pointing at it made the router bounce between here and there
// for ever (a blank screen on the phone).
import { Redirect } from 'expo-router';

import { useAuth } from '../core/hooks';

export default function Index() {
  const { state } = useAuth();
  if (state === 'loading') return null;
  return <Redirect href={state === 'signedIn' ? '/(tabs)' : '/sign-in'} />;
}
