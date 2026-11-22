// Signing in on another phone signs the old one out, like WhatsApp: the server forgets its key,
// and the old phone, refused when it connects, finds out and says so (owner, 21 Nov).
import { afterEach, describe, expect, test } from 'vitest';

import { PakChat } from '../src/client';
import { MemoryStorage } from '../src/storage';
import { World } from './people';
import { make } from './signals';

describe('signed in on another phone', () => {
  let w: World;
  afterEach(() => w?.people.forEach((p) => p.client.stop()));

  test('the old phone is told it was signed out', async () => {
    w = new World();
    const sara = await w.person('Sara');
    let told = 0;
    sara.client.on('signedOutElsewhere', () => told++);

    // Sara signs in on a new phone: the server drops the old phone's key.
    const fresh = new PakChat({ signal: make.node(), storage: new MemoryStorage(), server: w.server.api(), connect: w.server.connect, deviceName: 'Phone' });
    await fresh.signIn('google:Sara');

    // The old phone connects again (the app opened): refused, it asks, and is told once.
    sara.client.stop();
    sara.client.start();
    await w.settle();
    await new Promise((r) => setTimeout(r, 20));
    expect(told).toBe(1);
    fresh.stop();
  });

  test('a phone still signed in is never told', async () => {
    w = new World();
    const sara = await w.person('Sara');
    let told = 0;
    sara.client.on('signedOutElsewhere', () => told++);
    await sara.client.checkSession();
    expect(told).toBe(0);
  });
});
