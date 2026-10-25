// RichText.tsx: a message's words, the way WhatsApp shows them.
//
// *bold*, _italic_, ~strike~ and `code`, bullets, numbered lines and quotes,
// @mentions in the accent colour, and tappable web addresses, emails and phone
// numbers. Tap a web address or an email to open it; tap a phone number (or hold
// any link) for a little sheet: Call, Open, Copy. Long messages show their start
// and "Read more". The reading itself is in core/richText.ts.
import * as Clipboard from 'expo-clipboard';
import { Fragment, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';

import { core } from '../../core/core';
import { parseRich, readMoreCut, type LinkKind, type Span } from '../../core/richText';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { MenuItem, Sheet, toast } from '../overlays';

type Link = { kind: LinkKind; target: string; text: string };

// ---- The link sheet (one for the whole chat screen) ----

let held: Link | null = null;
const listeners = new Set<() => void>();
function showLink(link: Link | null) {
  held = link;
  listeners.forEach((l) => l());
}

function open(link: Link) {
  Linking.openURL(link.target).catch(() => toast(link.text));
}

function tapLink(link: Link) {
  // A phone number asks first (WhatsApp does too): calling straight away on a tap is too easy to do by mistake.
  if (link.kind === 'phone') showLink(link);
  else open(link);
}

/** Put this once on a screen that shows messages: the sheet for a held link or a tapped phone number. */
export function LinkSheetHost() {
  const t = useT();
  const link = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => held,
  );
  // Keep the last link while the sheet slides away.
  const [last, setLast] = useState<Link | null>(null);
  if (link && link !== last) setLast(link);
  const shown = link ?? last;
  const close = () => showLink(null);
  const act = (work: () => void) => () => {
    close();
    work();
  };
  return (
    <Sheet visible={!!link} onClose={close} title={shown?.text}>
      {shown?.kind === 'phone' && <MenuItem icon="calls" label={fill(t.callNumber, { number: shown.text })} onPress={act(() => open(shown))} testID="link-call" />}
      {shown?.kind === 'url' && <MenuItem icon="globe" label={t.openLink} onPress={act(() => open(shown))} testID="link-open" />}
      {shown?.kind === 'email' && <MenuItem icon="send" label={t.sendEmail} onPress={act(() => open(shown))} testID="link-open" />}
      {shown && (
        <MenuItem
          icon="copy"
          label={t.copy}
          onPress={act(() => {
            void Clipboard.setStringAsync(shown.text);
            toast(t.copied);
          })}
          testID="link-copy"
        />
      )}
    </Sheet>
  );
}

// ---- The words ----

/** A message's words with their styles, links and mentions. `color` is the bubble's text colour. */
export function RichWords({ text, mentions, color, mine }: { text: string; mentions?: string[]; color: string; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const [more, setMore] = useState(false);
  const cut = more ? null : readMoreCut(text);
  const shown = cut === null ? text : text.slice(0, cut).trimEnd();
  const names = (mentions ?? []).map((id) => `@${core.plainName(id)}`).filter((n) => n.length > 1);
  const linkColor = mine ? theme.bubbleMineText : theme.accInk;
  const lines = parseRich(shown);

  const spans = (list: Span[], key: string) =>
    list.map((s, i) => {
      const style = {
        fontWeight: s.bold ? ('700' as const) : undefined,
        fontStyle: s.italic ? ('italic' as const) : undefined,
        textDecorationLine: s.strike ? ('line-through' as const) : s.link ? ('underline' as const) : undefined,
        fontFamily: s.code ? 'monospace' : undefined,
        color: s.link ? linkColor : undefined,
      };
      const words = withMentions(s.text, names, theme.mention);
      if (s.link) {
        const link = { ...s.link, text: s.text };
        return (
          <Text key={`${key}-${i}`} style={style} onPress={() => tapLink(link)} onLongPress={() => showLink(link)} suppressHighlighting={false}>
            {words}
          </Text>
        );
      }
      if (!style.fontWeight && !style.fontStyle && !style.textDecorationLine && !style.fontFamily) return <Fragment key={`${key}-${i}`}>{words}</Fragment>;
      return (
        <Text key={`${key}-${i}`} style={style}>
          {words}
        </Text>
      );
    });

  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {l.kind === 'bullet' && '•  '}
          {l.kind === 'number' && `${l.number}.  `}
          {l.kind === 'quote' ? (
            // A quote line: a bar and softer words (a Text can't hold a box, so the bar is a character).
            <Text style={{ color }}>
              <Text style={{ color: theme.muted }}>▍ </Text>
              <Text style={{ opacity: 0.8 }}>{spans(l.spans, `q${i}`)}</Text>
            </Text>
          ) : (
            spans(l.spans, `l${i}`)
          )}
        </Fragment>
      ))}
      {cut !== null && (
        <Text style={{ color: linkColor, fontWeight: '600' }} onPress={() => setMore(true)} testID="read-more">
          {`… ${t.readMore}`}
        </Text>
      )}
    </>
  );
}

/** Words with @mentions in the accent colour. */
function withMentions(text: string, names: string[], color: string): ReactNode {
  if (!names.length) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'g'));
  return parts.map((part, i) =>
    names.includes(part) ? (
      <Text key={i} style={{ color, fontWeight: '600' }}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

/** One to three emoji alone: big, with no bubble. */
export function BigEmoji({ text, count }: { text: string; count: number }) {
  return (
    <View style={{ paddingHorizontal: 4 }}>
      <Text style={{ fontSize: count === 1 ? 52 : count === 2 ? 44 : 38, lineHeight: count === 1 ? 64 : count === 2 ? 54 : 48 }}>{text.trim()}</Text>
    </View>
  );
}
