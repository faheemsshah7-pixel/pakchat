// Where the Phoenix server is.
//
// On the computer running both the app simulator and the server, localhost is
// fine. On a real phone, localhost means the phone itself, so swap this for the
// Mac's address on the wifi, e.g. 'http://192.168.1.5:4000'.
// Find it with: ipconfig getifaddr en0
export const SERVER_URL = 'http://localhost:4000';

/** Asks the server if it is alive. Returns true if it answered ok. */
export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    // No server, no wifi, wrong address: all the same to us here.
    return false;
  }
}
