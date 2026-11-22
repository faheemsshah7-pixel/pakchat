// "Message yourself", like WhatsApp: what I send there shows two blue ticks at once (owner, 21 Nov),
// and so does what my website sends there, when it reaches the phone.
import { afterEach, describe, expect, test } from 'vitest';

import { World } from './people';

describe('message yourself', () => {
  let w: World;
  afterEach(() => w?.people.forEach((p) => p.client.stop()));

  test('read at once, here and on my website', async () => {
    w = new World();
    const sara = await w.person('Sara');
    const web = await w.website(sara);
    const chat = await sara.client.openDirect(sara.id);
    const m = await sara.client.sendText(chat.id, 'note to self');
    await w.settle();
    expect((await sara.storage.getMessage(chat.id, sara.id, m.id))?.status).toBe('read');
    expect((await web.storage.getMessage(chat.id, sara.id, m.id))?.status).toBe('read');

    // Anyone else's one-to-one chat still starts at one grey tick.
    const ali = await w.person('Ali');
    const other = await sara.client.openDirect(ali.id);
    const n = await sara.client.sendText(other.id, 'hi');
    await sara.client.idle();
    expect(['sent', 'delivered', 'read']).toContain((await sara.storage.getMessage(other.id, sara.id, n.id))?.status);
    expect((await sara.storage.getMessage(other.id, sara.id, n.id))?.status).not.toBe('read');
  });
});
