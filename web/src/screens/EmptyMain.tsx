// EmptyMain.tsx: the right side when no chat is open.

import { Icon } from '../ui/Icon';
import { setView } from '../ui/view';
import { tr } from '../i18n';

export function EmptyMain() {
  return (
    <div className="empty">
      <div className="ill">
        <Icon name="laptop" size={64} stroke={1.3} />
      </div>
      <h2>{tr('PakChat Web')}</h2>
      <p>
        {tr('Send and receive messages, even when your phone is off.')}
        <br />
        {tr('Use PakChat on up to 4 linked devices at the same time.')}
      </p>
      <div className="eacts">
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'newChat' })}>
          <span className="eb">
            <Icon name="newChat" size={24} />
          </span>
          <span>{tr('New chat')}</span>
        </button>
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'newGroup' })}>
          <span className="eb">
            <Icon name="group" size={24} />
          </span>
          <span>{tr('New group')}</span>
        </button>
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'starred' })}>
          <span className="eb">
            <Icon name="star" size={24} />
          </span>
          <span>{tr('Starred')}</span>
        </button>
      </div>
      <div className="foot">
        <Icon name="lock" size={14} />{' '}{tr('Your personal messages are end-to-end encrypted')}
      </div>
    </div>
  );
}
