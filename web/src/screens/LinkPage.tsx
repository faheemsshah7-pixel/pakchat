// LinkPage.tsx: "Scan to log in", WhatsApp Web's page in PakChat blue. The
// QR changes on its own (60 seconds, then 20), and after the last one shows
// "Click to reload QR code".

import { useEffect, useState } from 'react';

import { core } from '../core/core';
import { useQr } from '../core/hooks';
import { APP_URL, PLAY_URL } from '../device';
import { Icon, PlayBadge } from '../ui/Icon';
import { Qr } from '../ui/Qr';

export function LinkPage() {
  const { qr, expired } = useQr();
  const [stay, setStay] = useState(core.stayLoggedIn);
  const online = useOnline();

  useEffect(() => {
    document.title = 'PakChat Web';
  }, []);

  return (
    <div className="lp">
      <div className="lhd">
        <div className="lg">
          <Icon name="chat" size={18} />
        </div>
        <span>PakChat</span>
      </div>

      <div className="card c1">
        <div className="cl">
          <h1>Scan to log in</h1>
          <ol className="steps">
            <li>
              <i>1</i>
              <span>
                Open <b>PakChat</b> on your phone
              </span>
            </li>
            <li>
              <i>2</i>
              <span>
                Tap <b>⋮</b> › <b>Linked devices</b> › <b>Link a device</b>
              </span>
            </li>
            <li>
              <i>3</i>
              <span>Point your phone at this screen to scan the code</span>
            </li>
          </ol>
        </div>
        <div className="cr">
          <div className="qrbox" data-qr={qr?.text}>
            {!online ? (
              <div className="qrcover">
                <Icon name="warning" size={28} />
                <span>No internet connection</span>
              </div>
            ) : expired ? (
              <button className="qrcover" onClick={() => void core.showQr()}>
                <span className="qrre">
                  <Icon name="sync" size={26} />
                </span>
                <span>Click to reload QR code</span>
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
            title="If selected, you'll stay logged in to PakChat Web after closing the browser tab."
          >
            <span className={`chk ${stay ? '' : 'off'}`}>{stay && <Icon name="check" size={13} stroke={3} />}</span>
            Stay logged in on this browser
            <Icon name="info" size={16} />
          </button>
        </div>
      </div>

      <div className="card c2">
        <div>
          <h2>Don't have PakChat yet?</h2>
          <p>Make your account in the PakChat app on your phone, then link this computer to it.</p>
        </div>
        <a className="gp" href={APP_URL} target="_blank" rel="noreferrer">
          <PlayBadge play={!!PLAY_URL} />
        </a>
      </div>

      <div className="lfoot">
        <Icon name="lock" size={18} /> Your personal messages are end-to-end encrypted
      </div>
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
