// EmptyMain.tsx: the right side when no chat is open.

import { Icon } from '../ui/Icon';
import { setView } from '../ui/view';

export function EmptyMain() {
  return (
    <div className="empty">
      <div className="ill">
        <Icon name="laptop" size={64} stroke={1.3} />
      </div>
      <h2>PakChat Web</h2>
      <p>
        Send and receive messages, even when your phone is off.
        <br />
        Use PakChat on up to 4 linked devices at the same time.
      </p>
      <div className="eacts">
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'newChat' })}>
          <span className="eb">
            <Icon name="newChat" size={24} />
          </span>
          <span>New chat</span>
        </button>
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'newGroup' })}>
          <span className="eb">
            <Icon name="group" size={24} />
          </span>
          <span>New group</span>
        </button>
        <button className="ea" onClick={() => setView({ tab: 'chats', side: 'starred' })}>
          <span className="eb">
            <Icon name="star" size={24} />
          </span>
          <span>Starred</span>
        </button>
      </div>
      <div className="foot">
        <Icon name="lock" size={14} /> Your personal messages are end-to-end encrypted
      </div>
    </div>
  );
}
