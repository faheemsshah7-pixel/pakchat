// Recorder.tsx: a voice message being recorded (core/recorder.ts does the
// recording). In its chat, it takes the composer's place. In any other chat,
// a small recorder sits under the chat list, like WhatsApp Web's, to pause,
// send or delete it, or go back to its chat.

import { useEffect } from 'react';

import { core, openChat } from '../core/core';
import { useChat, useViewing } from '../core/hooks';
import { loudness, pauseRecording, playRecording, recording, resumeRecording, stopRecording, useRecording } from '../core/recorder';
import { chatTitle, duration } from '../ui/format';
import { Icon } from '../ui/Icon';
import { tr } from '../i18n';

/** WhatsApp's keys while recording: Alt+P pauses or goes on, Ctrl+Enter sends, Escape deletes. */
function useRecordingKeys() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const r = recording();
      if (!r) return;
      if (e.altKey && (e.key.toLowerCase() === 'p' || e.code === 'KeyP')) {
        e.preventDefault();
        if (r.paused) resumeRecording();
        else pauseRecording();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        stopRecording(true);
      } else if (e.key === 'Escape' && !document.querySelector('.layer')) stopRecording(false);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
}

/** In the chat being recorded in: the composer's place. */
export function Recorder() {
  const r = useRecording();
  useRecordingKeys();
  if (!r) return null;
  return (
    <div className={`cpill rec ${r.paused ? 'paused' : ''}`}>
      <button className="ib" aria-label={tr('Delete recording')} onClick={() => stopRecording(false)}>
        <Icon name="trash" size={22} />
      </button>
      {r.paused ? (
        <button className="ib" aria-label={r.playing ? tr('Stop playing') : tr('Play recording')} onClick={playRecording}>
          <Icon name={r.playing ? 'pause' : 'play'} size={22} />
        </button>
      ) : (
        <span className="rdot" />
      )}
      <span className="rtime">{duration(r.ms)}</span>
      <span className="rwave">
        {loudness(r.level).map((v, i) => (
          <i key={i} style={{ height: 3 + (v / 255) * 24 }} />
        ))}
      </span>
      {r.paused ? (
        <button className="ib recgo" aria-label={tr('Continue recording')} data-tip={tr('Continue recording')} onClick={resumeRecording}>
          <Icon name="mic" size={22} />
        </button>
      ) : (
        <button className="ib" aria-label={tr('Pause recording')} data-tip={tr('Pause')} onClick={pauseRecording}>
          <Icon name="pause" size={22} />
        </button>
      )}
      <button className="send" aria-label={tr('Send voice message')} onClick={() => stopRecording(true)}>
        <Icon name="send" size={22} />
      </button>
    </div>
  );
}

/** Under the chat list while the recording's chat isn't open. */
export function MiniRecorder() {
  const r = useRecording();
  const viewing = useViewing();
  const chat = useChat(r?.chatId ?? null);
  const away = !!r && r.chatId !== viewing;
  if (!r || !away) return null;
  return <MiniKeys r={r} title={chat ? chatTitle(chat) : core.nameOf(r.chatId)} />;
}

function MiniKeys({ r, title }: { r: NonNullable<ReturnType<typeof recording>>; title: string }) {
  useRecordingKeys();
  return (
    <div className={`minirec ${r.paused ? 'paused' : ''}`} role="group" aria-label={tr('Voice message being recorded')}>
      <button className="ib" aria-label={tr('Delete recording')} data-tip={tr('Delete')} onClick={() => stopRecording(false)}>
        <Icon name="trash" size={20} />
      </button>
      <button className="mrwho" onClick={() => openChat(r.chatId)} aria-label={`Recording for ${title}. Go to chat`}>
        {r.paused ? <Icon name="mic" size={16} /> : <span className="rdot" />}
        <span className="ellip">
          <b>{duration(r.ms)}</b> · {title}
        </span>
      </button>
      {r.paused ? (
        <button className="ib" aria-label={tr('Continue recording')} data-tip={tr('Continue recording')} onClick={resumeRecording}>
          <Icon name="mic" size={20} />
        </button>
      ) : (
        <button className="ib" aria-label={tr('Pause recording')} data-tip={tr('Pause')} onClick={pauseRecording}>
          <Icon name="pause" size={20} />
        </button>
      )}
      <button className="send" aria-label={tr('Send voice message')} data-tip={tr('Send')} onClick={() => stopRecording(true)}>
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}
