// Composer.tsx: the floating message box. Enter sends (Shift+Enter: a new
// line), the 📎 menu, emoji, pasting or dropping files, replying, editing
// and voice messages. What you type is kept per chat as a draft.

import type { Chat, ChatQuote, Message } from '@pakchat/shared';
import { useEffect, useRef, useState } from 'react';

import { core, openChat } from '../core/core';
import { useSettings } from '../core/hooks';
import { recording as recordingNow, startRecording, useRecording } from '../core/recorder';
import { Avatar, photoOf } from '../ui/Avatar';
import { bodyLine, memberName } from '../ui/format';
import { Icon } from '../ui/Icon';
import { closeLayer, Dialog, openLayer, openMenu, toast } from '../ui/overlay';
import { getView, setView, useView } from '../ui/view';
import { EDIT_MS } from './messageActions';
import { Recorder } from './Recorder';
import { tr } from '../i18n';

/** The longest message, the same as the app's (longer ones are refused by the other side's PakChat). */
const MAX_TEXT = 4000;

export function Composer({ chat }: { chat: Chat }) {
  const view = useView();
  const settings = useSettings();
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => core.prefs[chat.id]?.draft ?? '');
  const rec = useRecording();
  const recording = rec?.chatId === chat.id;
  const files = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reply = view.replyTo?.chatId === chat.id ? view.replyTo : null;
  const editing = view.editing?.chatId === chat.id ? view.editing : null;
  // "Reply privately" to a group message: it's quoted here, in the chat with its author.
  const quoted = !reply && !editing && view.privateReply?.to === chat.id ? view.privateReply : null;
  // @mentions in groups: who was picked from the list (kept while their "@Name" stays in the words).
  const mentioned = useRef<string[]>([]);
  const [pickAt, setPickAt] = useState(0);

  // Editing: the message's words go in the box; done or cancelled, the draft comes back.
  useEffect(() => {
    if (editing) setText(editing.text ?? '');
    box.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (reply || quoted) box.current?.focus();
  }, [reply, quoted]);

  // Typing goes straight into the box from anywhere in the chat, like WhatsApp Web.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || t.closest('input, textarea, [contenteditable], .layer')) return;
      box.current?.focus();
    };
    addEventListener('keydown', key);
    const insert = (e: Event) => insertAtCaret((e as CustomEvent<string>).detail);
    const record = () => !editing && record1();
    addEventListener('pakchat:insert', insert);
    addEventListener('pakchat:record', record);
    return () => {
      removeEventListener('keydown', key);
      removeEventListener('pakchat:insert', insert);
      removeEventListener('pakchat:record', record);
    };
  });

  // The draft, kept a moment after you stop typing (and when you leave the chat).
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    if (editing) return;
    const id = setTimeout(() => saveDraft(chat.id, text), 600);
    return () => clearTimeout(id);
  }, [text, chat.id, editing]);
  useEffect(() => () => void saveDraft(chat.id, getView().editing ? (core.prefs[chat.id]?.draft ?? '') : latest.current), [chat.id]);

  // Leaving the chat ends "typing…" too.
  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (typingSent.current) core.client.typing(chat.id, false);
    },
    [chat.id],
  );

  // The box grows with the words, up to 6 lines, then scrolls.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  function insertAtCaret(s: string) {
    const el = box.current;
    if (!el) return setText((t) => t + s);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + s.length;
    });
  }

  function typed(next: string) {
    setText(next);
    const now = Date.now();
    if (next.trim() && now - typingSent.current > 3000) {
      typingSent.current = now;
      core.client.typing(chat.id, true);
    }
    // A pause in typing (or an emptied box) ends "typing…" for them, like the app.
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stopTyping, next.trim() ? 4000 : 0);
  }

  function stopTyping() {
    if (typingSent.current) core.client.typing(chat.id, false);
    typingSent.current = 0;
  }

  /** The mic button (or its keys): records here. A recording going on in another chat comes first. */
  function record1() {
    const other = recordingNow();
    if (other) {
      if (other.chatId !== chat.id) toast(tr('Send or delete your voice message first'), { label: tr('Go to it'), run: () => openChat(other.chatId) });
      return;
    }
    void startRecording(chat.id, reply ? { author: reply.author, id: reply.id } : null, {
      error: (why) => toast(why === 'mic' ? tr('To record voice messages, allow PakChat to use your microphone in your browser.') : tr('Couldn\'t send the voice message.')),
      // Sent as a reply: the quote above the box goes.
      sent: () => getView().replyTo?.chatId === chat.id && setView({ replyTo: null }),
    });
  }

  async function send() {
    const words = text.trim();
    if (!words) return;
    if ([...words].length > MAX_TEXT) return tooLong(words);
    if (editing) {
      if (Date.now() - editing.sentAt > EDIT_MS) toast(tr('This message can no longer be edited'));
      else if (words !== editing.text) await core.client.edit(chat.id, editing.id, words).catch(() => toast(tr('Couldn\'t edit. Try again.')));
      setView({ editing: null });
      setText(core.prefs[chat.id]?.draft ?? '');
      return;
    }
    setText('');
    if (stopTimer.current) clearTimeout(stopTimer.current);
    typingSent.current = 0;
    core.client.typing(chat.id, false);
    const replyTo = reply ? { author: reply.author, id: reply.id } : undefined;
    const quote = quoted ? quoteOf(quoted.m) : undefined;
    const mentions = chat.kind === 'group' ? mentioned.current.filter((id) => words.includes(`@${core.nameOf(id)}`)) : [];
    mentioned.current = [];
    setView({ replyTo: null, privateReply: null });
    await saveDraft(chat.id, '');
    try {
      await core.client.sendText(chat.id, words, { replyTo, quote, ...(mentions.length ? { mentions } : {}) });
    } catch {
      // Back as it was: the words, and what they answered.
      setText(words);
      setView({ replyTo: reply, privateReply: quoted });
      toast(tr('Couldn\'t send. Try again.'));
    }
  }

  // Typing "@" in a group lists the members whose names start with what follows.
  const at = chat.kind === 'group' ? /(^|\s)@([^\s@]*)$/.exec(text.slice(0, box.current?.selectionStart ?? text.length)) : null;
  const suggestions = at
    ? chat.members
        .filter((mb) => mb.userId !== core.myId)
        .map((mb) => ({ id: mb.userId, name: core.nameOf(mb.userId) }))
        .filter((p) => p.name && p.name.toLowerCase().startsWith(at[2].toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 6)
    : [];
  const chosen = Math.min(pickAt, Math.max(0, suggestions.length - 1));

  function mention(p: { id: string; name: string }) {
    const el = box.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPickAt(0);
    mentioned.current = [...new Set([...mentioned.current, p.id])];
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = before.length;
    });
  }

  const attach = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(
      [
        { label: tr('Document'), icon: 'doc', color: '#7F66FF', run: () => docs.current?.click() },
        { label: tr('Photos & videos'), icon: 'photo', color: '#007BFC', run: () => files.current?.click() },
        { label: tr('Camera'), icon: 'camera', color: '#FF2E74', run: () => void import('./attach').then((a) => a.openCamera()) },
        { label: tr('Audio'), icon: 'music', color: '#FA6533', run: () => audio.current?.click() },
        { label: tr('Contact'), icon: 'user', color: '#009DE2', run: () => void import('./attach').then((a) => a.sendContact(chat)) },
        { label: tr('Poll'), icon: 'poll', color: '#FFB938', run: () => void import('./attach').then((a) => a.sendPoll(chat)) },
        { label: tr('Event'), icon: 'calendar', color: '#FF2E74', run: () => void import('./attach').then((a) => a.sendEvent(chat)) },
      ],
      r.left,
      r.top - 10,
      { cls: 'attach', above: true },
    );
  };

  const emoji = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    void import('./EmojiPanel').then(({ openEmojiPicker }) => openEmojiPicker(r.left - 8, r.top - 12, (x) => insertAtCaret(x), true));
  };

  const pick = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (picked.length) setView({ files: picked });
  };

  return (
    <footer className="comp">
      {suggestions.length > 0 && (
        <div className="mentions" role="listbox">
          {suggestions.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === chosen} className={i === chosen ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), mention(p))}>
              <Avatar id={p.id} name={p.name} photo={photoOf(p.id)} size={32} />
              <span className="ellip">{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {(reply || editing || quoted) && (
        <div className="replybar">
          <div className="quote">
            <i />
            <div>
              <b>{editing ? 'Edit message' : quoted ? `${memberName(quoted.m.author)} · ${quoted.group}` : reply!.author === core.myId ? 'You' : memberName(reply!.author)}</b>
              <span className="qt">{bodyLine((editing ?? reply ?? quoted!.m)!)}</span>
            </div>
          </div>
          <button className="ib" aria-label={tr('Cancel')} onClick={() => (setView({ replyTo: null, editing: null, privateReply: null }), editing && setText(core.prefs[chat.id]?.draft ?? ''))}>
            <Icon name="close" size={22} />
          </button>
        </div>
      )}
      {recording ? (
        <Recorder />
      ) : (
        <div className="cpill">
          {!editing && (
            <button className="ib" aria-label={tr('Attach')} data-tip={tr('Attach')} onClick={attach}>
              <Icon name="plus" size={24} />
            </button>
          )}
          <button className="ib" aria-label={tr('Emojis')} data-tip={tr('Emojis')} onClick={emoji}>
            <Icon name="sticker" size={22} />
          </button>
          <textarea
            ref={box}
            className="ta"
            rows={1}
            value={text}
            placeholder={tr('Type a message')}
            spellCheck
            dir="auto"
            onChange={(e) => typed(e.target.value)}
            onKeyDown={(e) => {
              if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setPickAt((chosen + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
              } else if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                e.preventDefault();
                mention(suggestions[chosen]);
              } else if (e.key === 'Enter' && !e.shiftKey && settings.enterSends && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              } else if (e.key === 'Escape' && (reply || editing || quoted)) {
                setView({ replyTo: null, editing: null, privateReply: null });
              } else if (e.key === 'ArrowUp' && (e.ctrlKey || e.metaKey) && !text) {
                e.preventDefault();
                dispatchEvent(new Event('pakchat:edit-last'));
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                setView({ files: pasted });
              }
            }}
            onBlur={() => typingSent.current && core.client.typing(chat.id, false)}
          />
          {text.trim() ? (
            <button className="send" aria-label={tr('Send')} onClick={() => void send()}>
              <Icon name={editing ? 'check' : 'send'} size={22} />
            </button>
          ) : (
            <button className="ib" aria-label={tr('Voice message')} data-tip={tr('Voice message')} onClick={record1}>
              <Icon name="mic" size={22} />
            </button>
          )}
        </div>
      )}
      <input ref={files} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
      <input ref={docs} type="file" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
      <input ref={audio} type="file" accept="audio/*" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
    </footer>
  );
}

/** A little copy of a group message, for "Reply privately". */
function quoteOf(m: Message): ChatQuote {
  const f = m.file;
  const kind: ChatQuote['kind'] = m.kind === 'text' ? 'text' : m.kind === 'poll' ? 'poll' : f ? (f.kind === 'image' || f.kind === 'video' || f.kind === 'voice' ? f.kind : 'file') : 'other';
  return { chat: m.chatId, author: m.author, id: m.id, kind, ...(m.text ? { text: m.text.slice(0, 500) } : {}), ...(f?.thumb ? { thumb: f.thumb } : {}) };
}

async function saveDraft(chatId: string, text: string) {
  const now = core.prefs[chatId]?.draft ?? '';
  if (now === text) return;
  await core.setPrefs(chatId, text.trim() ? { draft: text, draftAt: Date.now() } : { draft: undefined, draftAt: undefined });
}

/** Recording a voice message: the red dot, the time, delete or send. */
/** WhatsApp Web's "Message too long": says by how much, and keeps the words to shorten. */
function tooLong(words: string) {
  const over = [...words].length - MAX_TEXT;
  const id: number = openLayer(
    <Dialog title={tr('Message too long')} onClose={() => closeLayer(id)} buttons={[{ label: tr('OK'), fill: true }]}>
      <p className="dtext">
        {tr('Messages can be up to')}{' '}{MAX_TEXT.toLocaleString()}{' '}{tr('characters. This one is')}{' '}{over.toLocaleString()}{' '}{tr('too long. Shorten it, or send it in parts.')}
      </p>
    </Dialog>,
    true,
  );
}

