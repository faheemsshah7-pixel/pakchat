// Two-step PIN on the client side: reading the server's answers, and the calls it makes.

import { afterEach, describe, expect, test, vi } from 'vitest';

import { HttpServer, meFromWire, pinNeeded, pinRefused, ServerError } from '../src/server';

const device = { name: 'Phone', registrationId: 1, identityKey: 'i', signedPreKey: { keyId: 1, publicKey: 's', signature: 'g' }, kyberLastResort: { keyId: 1, publicKey: 'k', signature: 'g' } };
const keys = { preKeys: [], kyberPreKeys: [] };
const me = { id: 'u1', email: null, phone: '+923001234567', name: 'Ali', privacy: { last_seen: 'everyone', online: 'everyone', read_receipts: true }, pin: true };
const signed = { token: 't', user: me, device_id: 1, device_uuid: 'd' };

afterEach(() => vi.unstubAllGlobals());

/** A pretend server answering `status` and `body`; returns the requests it got. */
function answer(status: number, body: unknown) {
  const got: { url: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    got.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return got;
}

describe('two-step PIN', () => {
  test('a sign-in that needs the PIN says so, with its ticket', async () => {
    answer(403, { error: 'pin_needed', ticket: 'tk', google: true, reset_at: null });
    const err = await new HttpServer('http://x').signInWithPhone('+923001234567', '123456', device as never, keys as never).catch((e) => e);
    expect(pinNeeded(err)).toEqual({ ticket: 'tk', google: true, resetAt: null });
    expect(pinRefused(err)).toBeNull();
  });

  test('other errors are not a PIN', () => {
    expect(pinNeeded(new ServerError('forbidden', 403))).toBeNull();
    expect(pinNeeded(new Error('x'))).toBeNull();
    expect(pinRefused(new ServerError('bad_ticket', 401))).toBeNull();
  });

  test('a wrong PIN says the tries left, too many says the wait', () => {
    expect(pinRefused(new ServerError('wrong_pin', 403, { tries_left: 3 }))).toEqual({ triesLeft: 3 });
    expect(pinRefused(new ServerError('pin_locked', 429, { wait: 120 }))).toEqual({ wait: 120 });
  });

  test('the PIN, Google and the 7-day wait go with the ticket and the keys', async () => {
    const s = new HttpServer('http://x');
    let got = answer(200, signed);
    expect((await s.pinSignIn('tk', '246810', device as never, keys as never)).user.pin).toBe(true);
    expect(got[0].url).toBe('http://x/api/auth/pin');
    expect(got[0].body).toMatchObject({ ticket: 'tk', pin: '246810', device: { registration_id: 1 } });

    got = answer(200, signed);
    await s.pinGoogle('tk', 'gt', device as never, keys as never);
    expect(got[0]).toMatchObject({ url: 'http://x/api/auth/pin/google', body: { ticket: 'tk', id_token: 'gt' } });

    answer(200, { reset_at: '2026-11-25T08:00:00Z' });
    expect(await s.pinReset('tk', device as never, keys as never)).toEqual({ resetAt: '2026-11-25T08:00:00Z' });
    answer(200, signed);
    expect(await s.pinReset('tk', device as never, keys as never)).toMatchObject({ token: 't' });
  });

  test('turning it on, off and the reminder', async () => {
    const s = new HttpServer('http://x');
    let got = answer(200, me);
    expect((await s.setPin('246810')).pin).toBe(true);
    expect(got[0]).toMatchObject({ method: 'PUT', url: 'http://x/api/me/pin', body: { pin: '246810' } });

    got = answer(200, { ...me, pin: false });
    expect((await s.removePin('246810')).pin).toBe(false);
    expect(got[0]).toMatchObject({ method: 'DELETE', body: { current: '246810' } });

    got = answer(200, me);
    await s.setPin('112233', '246810');
    expect(got[0].body).toEqual({ pin: '112233', current: '246810' });

    answer(200, { right: false });
    expect(await s.checkPin('000000')).toBe(false);
  });

  test('an older server without the flag means off', () => {
    const { pin: _, ...old } = me;
    expect(meFromWire(old as never).pin).toBe(false);
  });
});
