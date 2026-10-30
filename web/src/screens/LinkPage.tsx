// LinkPage.tsx: "Scan to log in", WhatsApp Web's page in PakChat blue. The
// QR changes on its own (60 seconds, then 20), and after the last one shows
// "Click to reload QR code". "Log in with phone number" shows an 8-letter
// code to type on the phone instead.

import { useEffect, useState } from 'react';

import { showPairCode } from '@pakchat/shared';

import { core } from '../core/core';
import { useQr, useTopic } from '../core/hooks';
import { APP_URL, PLAY_URL } from '../device';
import { COUNTRIES, flag, fullNumber } from '../ui/countries';
import { Icon, PlayBadge } from '../ui/Icon';
import { Qr } from '../ui/Qr';
import { getLang, setLang, tr } from '../i18n';

export function LinkPage() {
  const { qr, expired } = useQr();
  const [stay, setStay] = useState(core.stayLoggedIn);
  const online = useOnline();
  const pair = useTopic(['qr'], () => core.pair);
  const [byPhone, setByPhone] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    document.title = 'PakChat Web';
  }, []);

  const back = () => {
    setByPhone(false);
    core.backToQr();
  };

  return (
    <div className="lp">
      <div className="lhd">
        <img className="lg" src="/icon-192.png" alt="" />
        <span>{tr('PakChat')}</span>
        <button className="ul lang" onClick={() => setLang(getLang() === 'ur' ? 'en' : 'ur')}>
          {getLang() === 'ur' ? 'English' : 'اردو'}
        </button>
      </div>

      {pair && !(pair.error === 'bad_phone') ? (
        <PairCode pair={pair} back={back} edit={() => (setTyped(pair.typed), setByPhone(true), core.editPhone())} />
      ) : byPhone || pair ? (
        <PhoneNumber typed={pair?.typed ?? typed} bad={pair?.error === 'bad_phone'} back={back} />
      ) : (
        <>
      <div className="card c1">
        <div className="cl">
          <h1>{tr('Scan to log in')}</h1>
          <ol className="steps">
            <li>
              <i>1</i>
              <span>
                {tr('Open')}{' '}<b>{tr('PakChat')}</b>{' '}{tr('on your phone')}
              </span>
            </li>
            <li>
              <i>2</i>
              <span>
                {tr('Tap')}{' '}<b>⋮</b> › <b>{tr('Linked devices')}</b> › <b>{tr('Link a device')}</b>
              </span>
            </li>
            <li>
              <i>3</i>
              <span>{tr('Point your phone at this screen to scan the code')}</span>
            </li>
          </ol>
        </div>
        <div className="cr">
          <div className="qrbox" data-qr={qr?.text}>
            {!online ? (
              <div className="qrcover">
                <Icon name="warning" size={28} />
                <span>{tr('No internet connection')}</span>
              </div>
            ) : expired ? (
              <button className="qrcover" onClick={() => void core.showQr()}>
                <span className="qrre">
                  <Icon name="sync" size={26} />
                </span>
                <span>{tr('Click to reload QR code')}</span>
              </button>
            ) : qr ? (
              <Qr text={qr.text} size={228} />
            ) : (
              <div className="qrwait">
                <span className="spin" />
              </div>
            )}
          </div>
        </div>
        <div className="cbot">
          <button
            className="stay"
            onClick={() => {
              setStay(!stay);
              core.stayLoggedIn = !stay;
            }}
            title={tr('If selected, you\'ll stay logged in to PakChat Web after closing the browser tab.')}
          >
            <span className={`chk ${stay ? '' : 'off'}`}>{stay && <Icon name="check" size={13} stroke={3} />}</span>
            {tr('Stay logged in on this browser')}
            <Icon name="info" size={16} />
          </button>
          <button className="ul" onClick={() => setByPhone(true)}>
            {tr('Log in with phone number')}{' '}<Icon name="chevron" size={16} />
          </button>
        </div>
      </div>

      <div className="card c2">
        <div>
          <h2>{tr('Don\'t have PakChat yet?')}</h2>
          <p>{tr('Make your account in the PakChat app on your phone, then link this computer to it.')}</p>
        </div>
        <a className="gp" href={APP_URL} target="_blank" rel="noreferrer">
          <PlayBadge play={!!PLAY_URL} />
        </a>
      </div>
        </>
      )}

      <div className="lfoot">
        <Icon name="lock" size={18} />{' '}{tr('Your personal messages are end-to-end encrypted')}
      </div>
    </div>
  );
}

/** "Enter phone number": the country, then the number. */
function PhoneNumber({ typed, bad, back }: { typed?: string; bad: boolean; back: () => void }) {
  const [country, setCountry] = useState(0);
  const [number, setNumber] = useState(typed ?? '');
  const c = COUNTRIES[country];
  const ok = number.replace(/\D/g, '').length >= 6;
  return (
    <div className="card cphone">
      <h1>{tr('Enter phone number')}</h1>
      <p>{tr('Select a country and enter your phone number.')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) void core.linkWithPhone(fullNumber(c, number));
        }}
      >
        <label className="pfield">
          <span className="pflag">{flag(c.code)}</span>
          <select aria-label={tr('Country')} value={country} onChange={(e) => setCountry(Number(e.target.value))}>
            {COUNTRIES.map((x, i) => (
              <option key={x.code} value={i}>
                {x.name}
              </option>
            ))}
          </select>
          <Icon name="down" size={18} />
        </label>
        <label className="pfield">
          <span className="pdial">+{c.dial}</span>
          <input autoFocus inputMode="tel" aria-label={tr('Phone number')} placeholder="300 1234567" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        {bad && <p className="perr">{tr('That doesn\'t look like a phone number. Check it and try again.')}</p>}
        <button className="btn fill pnext" type="submit" disabled={!ok}>
          {tr('Next')}
        </button>
      </form>
      <button className="ul" onClick={back}>
        {tr('Log in with QR code')}{' '}<Icon name="chevron" size={16} />
      </button>
    </div>
  );
}

/** "Enter code on phone": the 8 letters, and where to type them. */
function PairCode({ pair, back, edit }: { pair: NonNullable<typeof core.pair>; back: () => void; edit: () => void }) {
  const shown = showPairCode(pair.code);
  return (
    <div className="card cphone">
      <h1>{tr('Enter code on phone')}</h1>
      <p>
        {tr('Linking PakChat account')}{' '}<b>{pair.phone ?? pair.typed}</b>{' '}
        <button className="ul" onClick={edit}>
          {tr('(edit)')}
        </button>
      </p>
      {pair.error ? (
        <div className="pcode off">
          <p>{pair.error === 'expired' ? tr('The code ran out.') : tr('Couldn\'t reach PakChat. Check your internet.')}</p>
          <button className="btn fill" onClick={() => void core.linkWithPhone(pair.typed)}>
            {tr('Get a new code')}
          </button>
        </div>
      ) : !pair.ready ? (
        <div className="pcode">
          <span className="spin" />
        </div>
      ) : (
        <div className="pcode" data-code={pair.code} aria-label={`Code: ${shown}`}>
          {[...shown].map((ch, i) => (ch === '-' ? <span key={i} className="pdash" /> : <i key={i}>{ch}</i>))}
        </div>
      )}
      <ol className="steps">
        <li>
          <i>1</i>
          <span>
            {tr('Open')}{' '}<b>{tr('PakChat')}</b>{' '}{tr('on your phone')}
          </span>
        </li>
        <li>
          <i>2</i>
          <span>
            {tr('Tap')}{' '}<b>⋮</b> › <b>{tr('Linked devices')}</b> › <b>{tr('Link a device')}</b>
          </span>
        </li>
        <li>
          <i>3</i>
          <span>
            {tr('Tap')}{' '}<b>{tr('Link with phone number instead')}</b>{' '}{tr('and enter this code on your phone')}
          </span>
        </li>
      </ol>
      <button className="ul" onClick={back}>
        {tr('Log in with QR code')}{' '}<Icon name="chevron" size={16} />
      </button>
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return online;
}
