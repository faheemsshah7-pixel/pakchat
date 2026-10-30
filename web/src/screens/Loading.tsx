// Loading.tsx: after the phone scans the QR, "Loading your chats" while the
// phone sends them over (`quiet`: just the logo, while the page opens).

import { useEffect, useState } from 'react';

import { useSync } from '../core/hooks';
import { Icon } from '../ui/Icon';
import { tr } from '../i18n';

export function Loading({ quiet }: { quiet?: boolean }) {
  const sync = useSync();
  const [shown, setShown] = useState(4);

  // The phone doesn't say how far along it is, so the bar creeps toward 90% and fills when part 1 lands.
  useEffect(() => {
    if (quiet) return;
    const id = setInterval(() => setShown((p) => (sync.parts > 0 ? 100 : Math.min(90, p + (90 - p) * 0.08))), 400);
    return () => clearInterval(id);
  }, [quiet, sync.parts]);

  return (
    <div className="loading">
      <div className="lg">
        <Icon name="chat" size={36} />
      </div>
      {!quiet && (
        <>
          <div className="lbar">
            <i style={{ width: `${Math.round(shown)}%` }} />
          </div>
          <b>
            {tr('Loading your chats')}{' '}<span>{Math.round(shown)}%</span>
          </b>
          <small className="lnote">{tr('Keep your phone connected to the internet until this finishes.')}</small>
        </>
      )}
      <p>
        <Icon name="lock" size={14} />{' '}{tr('End-to-end encrypted')}
      </p>
    </div>
  );
}
