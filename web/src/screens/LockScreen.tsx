// LockScreen.tsx: App lock's screen (the password), and the small dialogs
// for App lock's settings and for the secret code that opens locked chats.

import { useEffect, useState } from 'react';

import { core } from '../core/core';
import { useTopic } from '../core/hooks';
import { type AppLock, lockWaitUntil, rightCode, rightPassword, setAppLock, turnOffAppLock, unlockApp } from '../core/lock';
import { Icon } from '../ui/Icon';
import { closeLayer, Dialog, openLayer, toast } from '../ui/overlay';
import { logOut } from './shortcuts';
import { tr } from '../i18n';

const MIN_PASSWORD = 6;

export function LockScreen() {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const waitUntil = useTopic(['lock'], lockWaitUntil);
  const [now, setNow] = useState(() => Date.now());
  const waiting = waitUntil > now;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const go = async () => {
    if (!pw || busy || waiting) return;
    setBusy(true);
    const r = await unlockApp(pw);
    setBusy(false);
    if (r === 'ok') return;
    setPw('');
    setNow(Date.now());
    setError(r === 'wait' ? '' : tr('Incorrect password. Try again.'));
  };

  return (
    <div className="lockscreen">
      <div className="lg">
        <Icon name="lock" size={34} />
      </div>
      <h1>{tr('PakChat is locked')}</h1>
      <p>{tr('Enter your password to unlock')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input type="password" autoFocus value={pw} placeholder={tr('Password')} aria-label={tr('Password')} disabled={waiting} onChange={(e) => (setPw(e.target.value), setError(''))} />
        <button className="btn fill" type="submit" disabled={!pw || busy || waiting}>
          {tr('Unlock')}
        </button>
      </form>
      <p className="lerr" role="alert">
        {waiting ? `Too many tries. Try again in ${Math.ceil((waitUntil - now) / 1000)} seconds.` : error}
      </p>
      <button className="lnk" onClick={() => void logOut()}>
        {tr('Forgot password? Log out')}
      </button>
      <small>
        <Icon name="lock" size={14} />{' '}{tr('End-to-end encrypted')}
      </small>
    </div>
  );
}

/** App lock › on: a password (twice) for this computer. */
export function setUpAppLock(after: AppLock['after'] = 15) {
  function SetUp() {
    const [a, setA] = useState('');
    const [b, setB] = useState('');
    const ok = a.length >= MIN_PASSWORD && a === b;
    return (
      <Dialog
        title={tr('Set a password')}
        onClose={() => closeLayer(id)}
        buttons={[
          { label: tr('Cancel') },
          {
            label: tr('OK'),
            fill: true,
            disabled: !ok,
            run: () => void setAppLock(a, after).then(() => toast(tr('App lock is on'))),
          },
        ]}
      >
        <p className="dtext">{tr('PakChat will ask for this password when it opens on this computer and after it\'s not used for a while. If you forget it, you\'ll have to log out and link again.')}</p>
        <input className="dinput" type="password" autoFocus placeholder={`Password (at least ${MIN_PASSWORD} characters)`} value={a} onChange={(e) => setA(e.target.value)} />
        <input className="dinput" type="password" placeholder={tr('Confirm password')} value={b} onChange={(e) => setB(e.target.value)} />
        {b.length > 0 && a !== b && <p className="derr">{tr('Passwords don\'t match')}</p>}
      </Dialog>
    );
  }
  const id: number = openLayer(<SetUp />, true);
}

/** App lock › off: the password first. */
export function askToTurnOff() {
  function Off() {
    const [pw, setPw] = useState('');
    return (
      <Dialog
        title={tr('Turn off App lock?')}
        onClose={() => closeLayer(id)}
        buttons={[
          { label: tr('Cancel') },
          {
            label: tr('Turn off'),
            fill: true,
            disabled: !pw,
            run: () =>
              void rightPassword(pw).then(async (r) => {
                if (r === 'ok') {
                  await turnOffAppLock();
                  toast(tr('App lock is off'));
                } else toast(r === 'wait' ? tr('Too many tries. Wait a little and try again.') : tr('Incorrect password'));
              }),
          },
        ]}
      >
        <input className="dinput" type="password" autoFocus placeholder={tr('Password')} value={pw} onChange={(e) => setPw(e.target.value)} />
      </Dialog>
    );
  }
  const id: number = openLayer(<Off />, true);
}

/** Asks for the chat lock's secret code. True once the right one is typed. */
export function askSecretCode(title = 'Enter secret code'): Promise<boolean> {
  if (!core.lockCode) {
    toast(tr('Set a secret code on your phone first: Settings › Privacy › Chat lock › Secret code'));
    return Promise.resolve(false);
  }
  return new Promise((done) => {
    let answered = false;
    const finish = (ok: boolean) => {
      if (answered) return;
      answered = true;
      closeLayer(id);
      done(ok);
    };
    function Code() {
      const [code, setCode] = useState('');
      const [wrong, setWrong] = useState(false);
      useEffect(() => {
        const key = (e: KeyboardEvent) => e.key === 'Escape' && finish(false);
        addEventListener('keydown', key);
        return () => removeEventListener('keydown', key);
      }, []);
      const submit = async () => {
        if (await rightCode(code)) finish(true);
        else {
          setWrong(true);
          setCode('');
        }
      };
      return (
        <div className="dialog pop" role="dialog" aria-modal>
          <h3>{title}</h3>
          <p className="dtext">{tr('The secret code you set for locked chats on your phone.')}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input className="dinput" type="password" autoFocus placeholder={tr('Secret code')} aria-label={tr('Secret code')} value={code} onChange={(e) => (setCode(e.target.value), setWrong(false))} />
            {wrong && <p className="derr">{tr('Incorrect secret code')}</p>}
            <div className="btns">
              <button type="button" className="btn ghost" onClick={() => finish(false)}>
                {tr('Cancel')}
              </button>
              <button type="submit" className="btn fill" disabled={code.trim().length < 4}>
                {tr('Unlock')}
              </button>
            </div>
          </form>
        </div>
      );
    }
    const id: number = openLayer(<Code />, true);
  });
}
