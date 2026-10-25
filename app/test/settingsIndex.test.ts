// Search in Settings: the words you type find the settings, in English and Urdu.
import { expect, test } from 'vitest';

import { settingsMatching } from '../src/core/settingsIndex';
import { en, ur } from '../src/i18n/strings';

const titles = (q: string, t = en) => settingsMatching(q, t).map((e) => e.title);

test('a few letters find the settings, with the page each is on', () => {
  expect(titles('last')).toContain(en.lastSeenOnline);
  expect(settingsMatching('last seen', en)[0]).toMatchObject({ where: en.privacy, to: '/settings/privacy' });
  expect(titles('TONE')).toEqual(expect.arrayContaining([en.notificationTone, `${en.groups} · ${en.notificationTone}`]));
  expect(titles('less data')).toEqual([en.lessDataCalls]);
});

test('every word must match; nothing typed finds nothing', () => {
  expect(titles('backup password')).toEqual([en.backupPassword]);
  expect(titles('zzz')).toEqual([]);
  expect(titles('   ')).toEqual([]);
});

test('works in Urdu too', () => {
  expect(titles(ur.wallpaper, ur)).toContain(ur.wallpaper);
});
