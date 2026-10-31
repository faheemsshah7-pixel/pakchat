// PhonePage.tsx: the website on a phone. PakChat Web is for computers, so a
// phone gets the app: from Google Play once PakChat is public there, and
// until then as an APK straight from our server, with how to install it.

import { useEffect, useState } from 'react';

import { APK_URL, onAndroid, PLAY_URL } from '../device';
import { Icon, PlayBadge } from '../ui/Icon';
import { tr } from '../i18n';

export function PhonePage() {
  const [started, setStarted] = useState(false);
  // The newest APK's build number, put in the link, so the phone's browser never hands back
  // an older copy it kept (that one can't install over a newer PakChat).
  const [build, setBuild] = useState<number | null>(null);

  useEffect(() => {
    document.title = 'Get the PakChat app';
    fetch('/pakchat-apk.json', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ versionCode?: number }>) : null))
      .then((j) => typeof j?.versionCode === 'number' && setBuild(j.versionCode))
      .catch(() => {});
  }, []);

  const apk = !PLAY_URL;
  return (
    <div className="pp">
      <div className="ptop">
        <img className="lg" src="/icon-192.png" alt="" />
        <b>{tr('PakChat')}</b>
      </div>
      <div className="pmid">
        <div className="pill2">
          <Icon name="phone" size={16} />{' '}{tr('You\'re on a phone')}
        </div>
        <h1>{tr('Get the PakChat app')}</h1>
        <p>{tr('PakChat on the web is made for computers. On your phone, the app is faster, gets notifications, and is where your account lives.')}</p>
        {onAndroid || !apk ? (
          <a href={apk ? (build ? `${APK_URL}?v=${build}` : APK_URL) : PLAY_URL} download={apk ? 'PakChat.apk' : undefined} onClick={() => setStarted(true)}>
            <PlayBadge play={!apk} />
          </a>
        ) : (
          <p className="ios">{tr('The iPhone app comes later. For now, PakChat is on Android.')}</p>
        )}
        {apk && onAndroid && (
          <div className={`guide ${started ? 'on' : ''}`}>
            <b>{started ? tr('Downloading… then:') : tr('After it downloads:')}</b>
            <ol>
              <li>{tr('Open')}{' '}<b>{tr('PakChat.apk')}</b>{' '}{tr('from your notifications or Downloads.')}</li>
              <li>
                {tr('If Android asks, tap')}{' '}<b>{tr('Settings')}</b>{' '}{tr('and turn on')}{' '}<b>{tr('Allow from this source')}</b>{tr(', then go back.')}
              </li>
              <li>
                {tr('Tap')}{' '}<b>{tr('Install')}</b>{tr(', then')}{' '}<b>{tr('Open')}</b>.
              </li>
            </ol>
            <small>{tr('PakChat isn\'t on Google Play yet, so Android asks this once. The app tells you when there\'s an update.')}</small>
          </div>
        )}
      </div>
      <div className="pfoot">
        <Icon name="laptop" size={16} />{' '}{tr('On a computer? Open this page there to link it to your phone.')}
      </div>
    </div>
  );
}
