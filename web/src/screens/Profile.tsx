// Profile.tsx: WhatsApp Web's Profile panel (the rail's photo): my photo, name
// and about, changed here and picked up by the phone too, and my number.

import { useEffect, useRef, useState } from 'react';

import { core } from '../core/core';
import { useTopic } from '../core/hooks';
import { Avatar, photoOf } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { closeLayer, confirm, Dialog, openLayer, openMenu, type MenuItem, toast } from '../ui/overlay';
import { openEmojiPicker } from './EmojiPanel';
import { tr } from '../i18n';

const NAME_MAX = 25;
const ABOUT_MAX = 139;
const OFFLINE = "Couldn't save. Check your internet connection.";

export function Profile() {
  useTopic(['people', 'photos'], () => core.photosVersion + (core.client.me?.me.name ?? '') + (core.client.me?.me.about ?? ''));
  const me = core.client.me!;
  const file = useRef<HTMLInputElement>(null);
  const has = !!me.me.photo;
  const [busy, setBusy] = useState(false);

  const photoMenu = (x: number, y: number) => {
    const items: MenuItem[] = [];
    if (has) items.push({ label: tr('View photo'), icon: 'eye', run: () => viewPhoto(core.photoUrl(me.me.photo), me.me.name) });
    items.push({ label: tr('Upload photo'), icon: 'upload', run: () => file.current?.click() });
    if (has)
      items.push({
        label: tr('Remove photo'),
        icon: 'trash',
        run: () =>
          void (async () => {
            if (!(await confirm(tr('Remove your profile photo?'), '', 'Remove', true))) return;
            await core.updateMe({ photo: null }).catch(() => toast(OFFLINE));
          })(),
      });
    openMenu(items, x, y);
  };

  return (
    <>
      <header className="sh">
        <span>{tr('Profile')}</span>
      </header>
      <div className="sbody scroll pbody">
        <button
          className={`pphoto ${busy ? 'busy' : ''}`}
          aria-label={tr('Change profile photo')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            photoMenu(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
          }}
        >
          <Avatar id={me.userId} name={me.me.name} photo={photoOf(me.userId)} size={200} />
          <span className="pcover">
            <Icon name="camera" size={24} />
            {has ? tr('Change profile photo') : tr('Add profile photo')}
          </span>
          {busy && <span className="spin" />}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void cropPhoto(f).then(async (square) => {
              if (!square) return;
              setBusy(true);
              try {
                await core.setMyPhoto(square);
                toast(tr('Profile photo updated'));
              } catch {
                toast(OFFLINE);
              } finally {
                setBusy(false);
              }
            });
          }}
        />

        <EditLine label={tr('Name')} value={me.me.name} max={NAME_MAX} required save={(name) => core.updateMe({ name })} />
        <p className="pnote">{tr('This is not your username or PIN. This name will be visible to your PakChat contacts.')}</p>
        <EditLine label={tr('About')} value={me.me.about ?? ''} max={ABOUT_MAX} save={(about) => core.updateMe({ about })} />
        {(me.me.phone || me.me.email) && (
          <div className="pline">
            <span className="plabel">{me.me.phone ? tr('Phone') : tr('Email')}</span>
            <div className="prow">
              <span className="pval">{me.me.phone ? prettyPhone(me.me.phone) : me.me.email}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** "+923001234567" → "+92 300 1234567", the way Pakistani numbers are written. */
export function prettyPhone(p: string) {
  const m = /^\+92(\d{3})(\d{7})$/.exec(p);
  return m ? `+92 ${m[1]} ${m[2]}` : p;
}

/** A line with a pencil: click it to change the words in place, like WhatsApp Web's name and about. */
function EditLine({ label, value, max, required, save }: { label: string; value: string; max: number; required?: boolean; save: (v: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const left = max - [...text].length;
  const ok = !saving && (!required || text.trim().length > 0) && left >= 0;
  const done = async () => {
    if (!ok) return;
    const v = text.trim();
    if (v === value) return setEditing(false);
    setSaving(true);
    try {
      await save(v);
      setEditing(false);
    } catch {
      toast(OFFLINE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pline">
      <span className="plabel">{label}</span>
      {editing ? (
        <div className="prow editing">
          <input
            ref={input}
            value={text}
            maxLength={max + 10}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void done();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setText(value);
                setEditing(false);
              }
            }}
          />
          <span className={`pleft ${left < 0 ? 'over' : ''}`}>{left}</span>
          <button
            className="ib"
            aria-label={tr('Emoji')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openEmojiPicker(r.left - 120, r.bottom + 6, (em) => {
                const el = input.current;
                const at = el?.selectionStart ?? text.length;
                setText((t) => t.slice(0, at) + em + t.slice(el?.selectionEnd ?? at));
                el?.focus();
              });
            }}
          >
            <Icon name="emoji" size={20} />
          </button>
          <button className="ib pok" aria-label={tr('Save')} disabled={!ok} onClick={() => void done()}>
            <Icon name="check" size={22} />
          </button>
        </div>
      ) : (
        <div className="prow">
          <span className="pval">{value || <span className="muted">{tr('Add a few words about yourself')}</span>}</span>
          <button className="ib" aria-label={`Edit ${label.toLowerCase()}`} onClick={() => setEditing(true)}>
            <Icon name="edit" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

/** A profile photo, big, over everything (click or Esc closes it). */
export function viewPhoto(url: string | null, title: string) {
  if (!url) return;
  const close = () => closeLayer(id);
  function Big() {
    useEffect(() => {
      const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
      addEventListener('keydown', key);
      return () => removeEventListener('keydown', key);
    }, []);
    return (
      <div className="pview" onClick={close} role="dialog" aria-label={title}>
        <header>
          <b>{title}</b>
          <button className="ib" aria-label={tr('Close')} onClick={close}>
            <Icon name="close" size={24} />
          </button>
        </header>
        <img src={url!} alt="" onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
  const id: number = openLayer(<Big />, true);
}

const STAGE = 320;
const OUT = 640;

/** "Drag the image to adjust": crops a picked picture to a square. Null if cancelled. */
export function cropPhoto(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file);
    let finished = false;
    const finish = (b: Blob | null) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(src);
      closeLayer(id);
      resolve(b);
    };

    function Crop() {
      const img = useRef<HTMLImageElement>(null);
      const [size, setSize] = useState<{ w: number; h: number } | null>(null);
      const [zoom, setZoom] = useState(1);
      const [pos, setPos] = useState({ x: 0, y: 0 });
      const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

      const base = size ? Math.max(STAGE / size.w, STAGE / size.h) : 1;
      const s = base * zoom;
      // Keeps the picture covering the whole circle.
      const clamp = (p: { x: number; y: number }, sc = s) =>
        size ? { x: Math.min(0, Math.max(STAGE - size.w * sc, p.x)), y: Math.min(0, Math.max(STAGE - size.h * sc, p.y)) } : p;

      const zoomTo = (z: number) => {
        if (!size) return;
        const nz = Math.min(4, Math.max(1, z));
        const ns = base * nz;
        // Zoom around the middle.
        const cx = (STAGE / 2 - pos.x) / s;
        const cy = (STAGE / 2 - pos.y) / s;
        setZoom(nz);
        setPos(clamp({ x: STAGE / 2 - cx * ns, y: STAGE / 2 - cy * ns }, ns));
      };

      const save = () => {
        const el = img.current;
        if (!el || !size) return;
        const c = document.createElement('canvas');
        c.width = c.height = OUT;
        const g = c.getContext('2d')!;
        g.fillStyle = '#fff';
        g.fillRect(0, 0, OUT, OUT);
        g.drawImage(el, -pos.x / s, -pos.y / s, STAGE / s, STAGE / s, 0, 0, OUT, OUT);
        // Made at once (not toBlob's callback): the dialog closes, answering "cancelled", right after this.
        const bytes = atob(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
        finish(new Blob([Uint8Array.from(bytes, (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
      };

      return (
        <Dialog
          title={tr('Drag the image to adjust')}
          onClose={() => finish(null)}
          buttons={[{ label: tr('Cancel'), run: () => finish(null) }, { label: tr('Save'), fill: true, disabled: !size, run: save }]}
        >
          <div
            className="crop"
            style={{ width: STAGE, height: STAGE }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
          >
            <img
              ref={img}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                const b = Math.max(STAGE / w, STAGE / h);
                setSize({ w, h });
                setPos({ x: (STAGE - w * b) / 2, y: (STAGE - h * b) / 2 });
              }}
              onError={() => {
                toast(tr('This picture can\'t be used. Try another one.'));
                finish(null);
              }}
              style={size ? { width: size.w * s, height: size.h * s, transform: `translate(${pos.x}px, ${pos.y}px)` } : { opacity: 0 }}
            />
            <span className="cropring" />
          </div>
          <div className="zoom">
            <button className="ib" aria-label={tr('Zoom out')} onClick={() => zoomTo(zoom - 0.25)}>
              <Icon name="minus" size={20} />
            </button>
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label={tr('Zoom')} />
            <button className="ib" aria-label={tr('Zoom in')} onClick={() => zoomTo(zoom + 0.25)}>
              <Icon name="plus" size={20} />
            </button>
          </div>
        </Dialog>
      );
    }
    const id: number = openLayer(<Crop />, true);
  });
}
