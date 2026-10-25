// MoreBodies.tsx: the newer kinds of message inside a bubble.
//
//   OnceBody       ① a view once photo, video or voice message (once.tsx opens it)
//   RoundBody      a round video message, played in its circle
//   LocationBody   a little map; a live one moves, and says until when
//   ContactBody    contact cards, with Message and Add
//   LinkBody       a web address's preview card
//   EventBody      a planned call, with Join (or Add to calendar)
//   ChatQuoteView  "Replying privately" to a group message
import type { LinkPreview, Message, SharedContact } from '@pakchat/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { core, isOffline } from '../../core/core';
import { Cancelled, cancelDownload, download, FileBroken, FileGone, haveFile, tagOf } from '../../core/files';
import { useChat, useFileProgress, useNow } from '../../core/hooks';
import { stopLive } from '../../core/live';
import { stopAll } from '../../core/player';
import { defaultTimer } from '../../core/timer';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { clock, duration, whenLabel } from '../format';
import { startCall } from '../CallBar';
import { Icon } from '../icons';
import { Pressy, Txt } from '../kit';
import { toast } from '../overlays';
import { MapTiles } from './MapTiles';

const WIDE = 236;

const inkOf = (mine: boolean, theme: ReturnType<typeof useLook>['theme']) => (mine ? theme.bubbleMineText : theme.text);
const metaOf = (mine: boolean, theme: ReturnType<typeof useLook>['theme']) => (mine ? (theme.dark ? 'rgba(236,238,242,0.7)' : theme.sectionText) : theme.muted);

function problem(err: unknown, t: ReturnType<typeof useT>) {
  if (err instanceof Cancelled) return;
  toast(err instanceof FileGone ? t.fileGone : err instanceof FileBroken ? t.fileBroken : isOffline(err) ? t.offline : t.couldNot);
}

/** ① View once: a pill instead of the photo. Opens once (once.tsx); then it says "Opened". */
export function OnceBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const progress = useFileProgress(tagOf(m.chatId, m));
  const opened = mine ? !!m.openedBy?.length : !!m.opened;
  const what = f.kind === 'image' ? t.photoLabel : f.kind === 'video' ? t.videoLabel : t.voiceNote;

  function tap() {
    if (selecting) return onPick();
    if (mine) return toast(opened ? t.openedWord : t.onceMineNote);
    if (opened) return toast(t.onceGone);
    router.push({ pathname: '/once', params: { chat: m.chatId, author: m.author, id: m.id } });
  }

  return (
    <Pressy onPress={tap} onLongPress={onPick} label={`${t.viewOnce}, ${what}`} scale={0.97} testID="file-once">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingEnd: 8, minWidth: 180, marginBottom: 2 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            borderWidth: 2,
            borderStyle: opened ? 'dashed' : 'solid',
            borderColor: opened ? metaOf(mine, theme) : mine ? theme.bubbleMineText : theme.acc,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {progress !== undefined ? (
            <ActivityIndicator size="small" color={theme.acc} />
          ) : (
            <Txt size={16} weight="800" color={opened ? metaOf(mine, theme) : mine ? theme.bubbleMineText : theme.accInk}>
              1
            </Txt>
          )}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Txt size={15} weight="700" color={opened ? metaOf(mine, theme) : inkOf(mine, theme)}>
            {what}
          </Txt>
          <Txt size={12} color={metaOf(mine, theme)}>
            {opened ? t.openedWord : t.viewOnce}
          </Txt>
        </View>
      </View>
      {progress !== undefined && (
        <Pressy onPress={() => cancelDownload(m)} label={t.cancel} scale={0.9}>
          <Txt size={12} weight="700" color={theme.accInk}>
            {t.cancel}
          </Txt>
        </Pressy>
      )}
    </Pressy>
  );
}

/** A round video: its first frame in a circle; tap to play it there, with sound. */
export function RoundBody({ m, mine, selecting, onPick }: { m: Message; mine: boolean; selecting: boolean; onPick: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const f = m.file!;
  const here = haveFile(m);
  const progress = useFileProgress(tagOf(m.chatId, m));
  const [playing, setPlaying] = useState(false);
  const size = 200;
  const picture = f.poster ? { uri: f.poster } : f.thumb ? { uri: `data:image/jpeg;base64,${f.thumb}` } : null;

  async function tap() {
    if (selecting) return onPick();
    if (here) {
      if (!playing) stopAll();
      return setPlaying(!playing);
    }
    if (progress !== undefined) return cancelDownload(m);
    try {
      await download(m);
    } catch (err) {
      problem(err, t);
    }
  }

  return (
    <Pressy onPress={() => void tap()} onLongPress={onPick} label={t.roundVideo} scale={0.97} testID="file-round">
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: '#111', borderWidth: 3, borderColor: mine ? theme.acc : theme.glassLine }}>
        {playing && here ? (
          <RoundPlayer uri={f.local!} onEnd={() => setPlaying(false)} />
        ) : (
          picture && <Image source={picture} style={{ width: '100%', height: '100%' }} contentFit="cover" blurRadius={f.poster || here ? 0 : 6} />
        )}
        {!playing && (
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              {progress !== undefined || (mine && m.status === 'queued') ? <ActivityIndicator color="#FFFFFF" /> : <Icon name={here ? 'play' : 'download'} size={22} color="#FFFFFF" />}
            </View>
          </View>
        )}
      </View>
      {!!f.duration && (
        <View style={{ position: 'absolute', bottom: 8, alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Txt size={11.5} weight="700" color="#FFFFFF">
            {duration(f.duration)}
          </Txt>
        </View>
      )}
    </Pressy>
  );
}

function RoundPlayer({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls={false} pointerEvents="none" />;
}

/** A place on a little map. A live one shows until when, and mine has "Stop sharing". */
export function LocationBody({ m, mine }: { m: Message; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const now = useNow(30_000);
  const p = m.location!;
  const live = !!p.live;
  const on = live && p.live! > now;
  const label = p.name ?? (live ? t.liveLocation : t.location);

  function open() {
    const q = `${p.lat},${p.lng}`;
    void Linking.openURL(`geo:${q}?q=${q}(${encodeURIComponent(p.name ?? t.location)})`).catch(() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`).catch(() => {}));
  }

  return (
    <View style={{ width: WIDE, gap: 6, marginBottom: 2 }}>
      <Pressy onPress={open} label={label} scale={0.98} testID="location-map">
        <View style={{ borderRadius: 14, overflow: 'hidden' }}>
          <MapTiles lat={p.lat} lng={p.lng} zoom={16} width={WIDE} height={140}>
            <View pointerEvents="none" style={{ position: 'absolute', left: WIDE / 2 - 15, top: 70 - 34 }}>
              {on ? (
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.acc, borderWidth: 3, borderColor: '#FFFFFF', marginTop: 18 }} />
              ) : (
                <Icon name="place" size={30} color={theme.acc} stroke={2.4} />
              )}
            </View>
          </MapTiles>
        </View>
      </Pressy>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={live ? 'live' : 'place'} size={16} color={on ? '#18A86B' : metaOf(mine, theme)} />
        <View style={{ flex: 1 }}>
          <Txt size={14} weight="700" color={inkOf(mine, theme)} lines={1}>
            {live ? t.liveLocation : label}
          </Txt>
          <Txt size={12} color={metaOf(mine, theme)} lines={2}>
            {live ? (on ? fill(t.liveUntil, { time: clock(p.live!) }) : t.liveEnded) : (p.address ?? '')}
          </Txt>
        </View>
      </View>
      {mine && on && (
        <Pressy onPress={() => void stopLive(m.chatId)} label={t.stopSharing} scale={0.97} testID="live-stop">
          <View style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(229,72,77,0.14)' }}>
            <Txt size={14} weight="700" color="#E5484D">
              {t.stopSharing}
            </Txt>
          </View>
        </Pressy>
      )}
    </View>
  );
}

/** Contact cards: each with Message (if they're on PakChat) and Add. */
export function ContactBody({ m, mine }: { m: Message; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const cards = m.contacts ?? [];
  const [busy, setBusy] = useState<number | null>(null);

  async function message(c: SharedContact, i: number) {
    setBusy(i);
    try {
      let user = c.user;
      for (const typed of user ? [] : [...c.phones, ...(c.emails ?? [])]) {
        const found = await core.lookup(typed).catch(() => null);
        if (found) {
          user = found.id;
          break;
        }
      }
      if (!user) return toast(fill(t.notOnPakChatName, { name: c.name }));
      if (user === core.myId) return toast(t.thatsYou);
      const chat = await core.client.openDirect(user, defaultTimer());
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
    } catch {
      toast(t.couldNot);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 8, minWidth: 220, marginBottom: 2 }}>
      {cards.map((c, i) => (
        <View key={i} style={{ gap: 8, paddingBottom: i < cards.length - 1 ? 8 : 0, borderBottomWidth: i < cards.length - 1 ? 1 : 0, borderColor: mine ? 'rgba(255,255,255,0.2)' : theme.divider }} testID="contact-card">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="card" size={20} color={theme.accInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt size={15} weight="700" color={inkOf(mine, theme)} lines={1}>
                {c.name}
              </Txt>
              <Txt size={12.5} color={metaOf(mine, theme)} lines={1}>
                {c.phones[0] ?? c.emails?.[0] ?? ''}
              </Txt>
            </View>
          </View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: mine ? 'rgba(255,255,255,0.2)' : theme.divider }}>
            <Pressy onPress={() => void message(c, i)} label={t.message} scale={0.96} style={{ flex: 1 }} testID="card-message">
              <View style={{ alignItems: 'center', paddingTop: 8 }}>
                {busy === i ? (
                  <ActivityIndicator size="small" color={theme.acc} />
                ) : (
                  <Txt size={14} weight="700" color={mine ? theme.bubbleMineText : theme.accInk}>
                    {t.message}
                  </Txt>
                )}
              </View>
            </Pressy>
            <Pressy
              onPress={() => router.push({ pathname: '/contact', params: { name: c.name, ...(c.phones[0] ? { phone: c.phones[0] } : {}), ...(c.emails?.[0] ? { email: c.emails[0] } : {}) } })}
              label={t.addContact}
              scale={0.96}
              style={{ flex: 1 }}
              testID="card-add"
            >
              <View style={{ alignItems: 'center', paddingTop: 8 }}>
                <Txt size={14} weight="700" color={mine ? theme.bubbleMineText : theme.accInk}>
                  {t.addContact}
                </Txt>
              </View>
            </Pressy>
          </View>
        </View>
      ))}
    </View>
  );
}

/** A web address's card, under the words. Tap to open it. */
export function LinkBody({ link, mine }: { link: LinkPreview; mine: boolean }) {
  const { theme } = useLook();
  return (
    <Pressy onPress={() => void Linking.openURL(link.url).catch(() => {})} label={link.title ?? link.url} scale={0.98} testID="link-preview">
      <View style={{ width: WIDE, borderRadius: 12, overflow: 'hidden', backgroundColor: mine ? 'rgba(255,255,255,0.16)' : theme.glass, marginBottom: 6 }}>
        {link.thumb && <Image source={{ uri: `data:image/jpeg;base64,${link.thumb}` }} style={{ width: '100%', height: 120 }} contentFit="cover" />}
        <View style={{ padding: 9, gap: 2 }}>
          {!!link.title && (
            <Txt size={14} weight="700" color={inkOf(mine, theme)} lines={2}>
              {link.title}
            </Txt>
          )}
          {!!link.description && (
            <Txt size={12.5} color={metaOf(mine, theme)} lines={3}>
              {link.description}
            </Txt>
          )}
          <Txt size={11.5} color={mine ? theme.bubbleMineText : theme.accInk} lines={1}>
            {link.site ?? link.url}
          </Txt>
        </View>
      </View>
    </Pressy>
  );
}

/**
 * A planned call: what, when, and Join once it's time. Or an event from the 📎:
 * when it starts and ends, where, Join if it has a call, and Going / Not going.
 */
export function EventBody({ m, mine }: { m: Message; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const now = useNow(30_000);
  const p = m.plan!;
  const soon = p.at - now < 10 * 60_000;
  const over = now - (p.end ?? p.at) > (p.end ? 0 : 3 * 3_600_000);
  const hasCall = !p.general || !!p.call;
  const votes = Object.values(m.votes ?? {});
  const going = votes.filter((v) => v[0] === 0).length;
  const myAnswer = m.votes?.[core.myId]?.[0];
  // A call link goes to its own call; otherwise the call is in this chat.
  const join = () => {
    const code = p.link ? (/\/calllink\/([A-Za-z0-9_-]+)/.exec(p.link)?.[1] ?? p.link) : undefined;
    if (code) router.push({ pathname: '/calllink/[code]', params: { code } });
    else void startCall(m.chatId, p.video, t);
  };
  const answer = (i: number) => {
    if (m.deleted) return;
    void core.client.vote(m.chatId, { author: m.author, id: m.id }, myAnswer === i ? [] : [i]).catch((err) => toast(isOffline(err) ? t.offline : t.couldNot));
  };
  const openPlace = () => void Linking.openURL(`geo:0,0?q=${encodeURIComponent(p.place!)}`).catch(() => void Linking.openURL(`https://www.openstreetmap.org/search?query=${encodeURIComponent(p.place!)}`).catch(() => {}));
  const when = p.end ? `${whenLabel(p.at, t)} – ${new Date(p.end).toDateString() === new Date(p.at).toDateString() ? clock(p.end) : whenLabel(p.end, t)}` : whenLabel(p.at, t);
  const soft = mine ? 'rgba(255,255,255,0.18)' : theme.accSoft;
  const softInk = mine ? theme.bubbleMineText : theme.accInk;
  return (
    <View style={{ width: WIDE, gap: 8, marginBottom: 2 }} testID="event">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: theme.accSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={p.general ? 'calendar' : p.video ? 'video' : 'calls'} size={21} color={theme.accInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={15} weight="700" color={inkOf(mine, theme)} lines={2}>
            {p.title}
          </Txt>
          <Txt size={12.5} color={metaOf(mine, theme)}>
            {over && p.general ? `${t.eventOver} · ${when}` : when}
          </Txt>
        </View>
      </View>
      {!!p.place && (
        <Pressy onPress={openPlace} label={p.place} scale={0.98} testID="event-place">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="place" size={15} color={softInk} />
            <Txt size={13.5} color={softInk} lines={2} style={{ flex: 1 }}>
              {p.place}
            </Txt>
          </View>
        </Pressy>
      )}
      {!!p.about && (
        <Txt size={13.5} color={inkOf(mine, theme)} lines={4}>
          {p.about}
        </Txt>
      )}
      {hasCall && !over && (
        <Pressy onPress={() => (soon ? join() : toast(fill(t.callStartsAt, { when: whenLabel(p.at, t) })))} label={t.joinCall} scale={0.97} testID="event-join">
          <View style={{ alignItems: 'center', paddingVertical: 9, borderRadius: 12, backgroundColor: soon ? theme.acc : soft }}>
            <Txt size={14} weight="700" color={soon ? '#FFFFFF' : softInk}>
              {t.joinCall}
            </Txt>
          </View>
        </Pressy>
      )}
      {p.general && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[t.goingWord, t.notGoingWord].map((label, i) => {
              const on = myAnswer === i;
              return (
                <Pressy key={label} onPress={() => answer(i)} label={label} scale={0.96} style={{ flex: 1 }} testID={i === 0 ? 'event-going' : 'event-not-going'}>
                  <View style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: on ? theme.acc : soft, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                    {on && <Icon name="check" size={14} color="#FFFFFF" stroke={2.6} />}
                    <Txt size={13.5} weight="700" color={on ? '#FFFFFF' : softInk}>
                      {label}
                    </Txt>
                  </View>
                </Pressy>
              );
            })}
          </View>
          {going > 0 && (
            <Txt size={12} color={metaOf(mine, theme)}>
              {fill(t.nGoing, { n: going })}
            </Txt>
          )}
        </>
      )}
    </View>
  );
}

/** "Replying privately": the group message this answers, with the group's name. */
export function ChatQuoteView({ q, mine }: { q: NonNullable<Message['quote']>; mine: boolean }) {
  const t = useT();
  const { theme } = useLook();
  const who = q.author === core.myId ? t.youWord : core.name(q.author) || '…';
  const from = useChat(q.chat);
  const where = from ? core.chatTitle(from) : '';
  const what = q.text ?? (q.kind === 'image' ? t.photoLabel : q.kind === 'video' ? t.videoLabel : q.kind === 'voice' ? t.voiceNote : q.kind === 'poll' ? t.poll : t.document);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderStartWidth: 3,
        borderColor: theme.acc,
        borderRadius: 8,
        backgroundColor: mine ? (theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.55)') : theme.accSoft,
        paddingStart: 9,
        marginBottom: 5,
        marginTop: 2,
        overflow: 'hidden',
      }}
      testID="chat-quote"
    >
      <View style={{ flex: 1, paddingVertical: 5 }}>
        <Txt size={13} weight="700" color={theme.accInk} lines={1}>
          {where ? `${who} · ${where}` : who}
        </Txt>
        <Txt size={13} color={theme.muted} lines={2}>
          {what}
        </Txt>
      </View>
      {q.thumb && <Image source={{ uri: `data:image/jpeg;base64,${q.thumb}` }} style={{ width: 44, height: 52 }} contentFit="cover" />}
    </View>
  );
}
