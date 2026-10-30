// EmojiPanel.tsx: the emoji panel, loaded the first time it's opened.
// Recent ones first; search by group name; the phone's own set (emojiList.ts).

import { useMemo, useRef, useState } from 'react';

import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { EMOJI_GROUPS } from '../ui/emojiList';
import { closeLayer, openLayer, usePlace } from '../ui/overlay';
import { tr } from '../i18n';

const GROUPS: { key: (typeof EMOJI_GROUPS)[number]['key']; icon: IconName; title: string }[] = [
  { key: 'smileys', icon: 'smile', title: tr('Smileys & emotion') },
  { key: 'people', icon: 'user', title: tr('People & body') },
  { key: 'nature', icon: 'paw', title: tr('Animals & nature') },
  { key: 'food', icon: 'food', title: tr('Food & drink') },
  { key: 'activity', icon: 'ball', title: tr('Activity') },
  { key: 'travel', icon: 'car', title: tr('Travel & places') },
  { key: 'objects', icon: 'bulb', title: tr('Objects') },
  { key: 'symbols', icon: 'sym', title: tr('Symbols & flags') },
];

const RECENT_KEY = 'pakchat-recent-emoji';
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function remember(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 27)));
  } catch {
    // Private window: no recents.
  }
}

/**
 * Opens the panel above (x, y). `stay`: the composer's panel stays open while
 * you pick several; the reaction picker closes after one.
 */
export function openEmojiPicker(x: number, y: number, onPick: (e: string) => void, stay = false) {
  const id: number = openLayer(
    <Panel
      x={x}
      y={y}
      onPick={(e) => {
        remember(e);
        onPick(e);
        if (!stay) closeLayer(id);
      }}
    />,
  );
}

function Panel({ x, y, onPick }: { x: number; y: number; onPick: (e: string) => void }) {
  const { ref, style } = usePlace(x, y, { above: true });
  const [q, setQ] = useState('');
  const [on, setOn] = useState<string>('recent');
  const body = useRef<HTMLDivElement>(null);
  const rec = useMemo(recent, []);
  const words = q.trim().toLowerCase();
  const found = useMemo(() => (words ? EMOJI_GROUPS.filter((g) => GROUPS.find((x) => x.key === g.key)!.title.toLowerCase().includes(words)).flatMap((g) => g.list) : []), [words]);

  const go = (key: string) => {
    setOn(key);
    body.current?.querySelector(`[data-g="${key}"]`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div ref={ref} className="emoji pop" style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="cats">
        <button className={on === 'recent' ? 'on' : ''} onClick={() => go('recent')} aria-label={tr('Recent')}>
          <Icon name="clock" size={20} />
        </button>
        {GROUPS.map((g) => (
          <button key={g.key} className={on === g.key ? 'on' : ''} onClick={() => go(g.key)} aria-label={g.title}>
            <Icon name={g.icon} size={20} />
          </button>
        ))}
      </div>
      <label className="es" onMouseDown={(e) => e.stopPropagation()}>
        <Icon name="search" size={18} />
        <input value={q} placeholder={tr('Search emoji')} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div ref={body} className="ebody scroll">
        {words ? (
          <div className="eg">
            {found.map((e) => (
              <button key={e} onClick={() => onPick(e)}>
                {e}
              </button>
            ))}
          </div>
        ) : (
          <>
            {rec.length > 0 && (
              <>
                <div className="eh" data-g="recent">
                  {tr('Recent')}
                </div>
                <div className="eg">
                  {rec.map((e) => (
                    <button key={e} onClick={() => onPick(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
            {EMOJI_GROUPS.map((g) => (
              <div key={g.key}>
                <div className="eh" data-g={g.key}>
                  {GROUPS.find((x) => x.key === g.key)!.title}
                </div>
                <div className="eg">
                  {g.list.map((e) => (
                    <button key={e} onClick={() => onPick(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
