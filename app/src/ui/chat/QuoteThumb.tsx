// QuoteThumb.tsx: the little picture at the end of a reply's quote (in the bubble and
// above the typing bar) when the message answered is a photo or video, like WhatsApp.
import type { Message } from '@pakchat/shared';
import { Image } from 'expo-image';

export function quoteThumb(m: Message | null | undefined): string | null {
  const f = m?.file;
  if (!f || m.deleted || f.once || (f.kind !== 'image' && f.kind !== 'video' && f.kind !== 'sticker')) return null;
  if (f.local && (f.kind === 'image' || f.kind === 'sticker')) return f.local;
  if (f.poster) return f.poster;
  return f.thumb ? `data:image/jpeg;base64,${f.thumb}` : null;
}

export function QuoteThumb({ m, size = 48 }: { m: Message; size?: number }) {
  const uri = quoteThumb(m);
  if (!uri) return null;
  return <Image source={{ uri }} style={{ width: size, height: size, alignSelf: 'stretch', minHeight: size }} contentFit={m.file?.kind === 'sticker' ? 'contain' : 'cover'} />;
}
