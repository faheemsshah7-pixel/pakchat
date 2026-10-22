// google.ts: asks Google for a signed "ID token" for one of the phone's Google accounts.
// Used to sign in, and to add a Gmail to an account made with a phone number.
import { GoogleOneTapSignIn, isCancelledResponse, isNoSavedCredentialFoundResponse, isSuccessResponse } from 'react-native-nitro-google-signin';

import { GOOGLE_WEB_CLIENT_ID } from './core';

let configured = false;

/** Google's token, or null if you closed the account chooser. Throws if Google said no. */
export async function googleIdToken(): Promise<string | null> {
  if (!configured) {
    GoogleOneTapSignIn.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    configured = true;
  }
  await GoogleOneTapSignIn.checkPlayServices();
  // Google's account chooser with every Google account on the phone, plus "Add another account".
  // (The quick sheet only listed accounts used here before, so a second Gmail never showed.)
  let res = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isNoSavedCredentialFoundResponse(res)) res = await GoogleOneTapSignIn.createAccount();
  if (isCancelledResponse(res)) return null;
  if (!isSuccessResponse(res) || !res.data.idToken) throw new Error('google');
  return res.data.idToken;
}
