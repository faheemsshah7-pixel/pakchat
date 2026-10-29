// chat/[id].tsx: one chat.
//
// The messages come from the phone's database (useMessages) and new ones slide
// up from the bottom as they arrive. Hold a message to pick it (then reply,
// react, star, copy, edit, pin, forward or delete); swipe one to reply.
import type { ChatQuote, Gif, LinkPreview, Message, Place, Ref, SharedContact } from '@pakchat/shared';
import { EDIT_MINUTES, UNSEND_HOURS, roleOf } from '@pakchat/shared';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler, FlatList, StyleSheet, TextInput, View, type ListViewToken } from 'react-native';
import Animated, { KeyboardState, useAnimatedKeyboard, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { core, MESSAGE_TEXT } from '../../core/core';
import { haveFile, loadLimits, sendPicked, takeHandOff, TooBig, type Picked } from '../../core/files';
import { startLive } from '../../core/live';
import { allowExactAlarms, exactAlarms, plan, SOONEST_MS } from '../../core/scheduled';
import { addShortcut } from '../../core/shortcut';
import { saveSticker, sendGif, sendSticker, unsaveSticker } from '../../core/stickers';
import { lapTimer, startTimer, stopTimer, timing } from '../../core/speed';
import { sendVoice, type Recorded } from '../../core/voice';
import { calls } from '../../core/calls';
import { slowPhone } from '../../core/phone';
import { dismissChatAlert } from '../../core/push';
import { defaultTimer } from '../../core/timer';
import { useChat, useChatPrefs, useCore, useMessages, useNow, usePeople, usePerson, usePresence, useSettings, useStable, useStarred, useStickerSaved, useTyping } from '../../core/hooks';
import { Backdrop } from '../../ui/chat/Backdrop';
import { chatOpen, leftChat } from '../../core/lock';
import { LeftGroupChoices } from '../../ui/DeleteChats';
import { AddToListSheet } from '../../ui/AddToListSheet';
import { LockedGate } from '../../ui/LockedGate';
import { ExportSheet } from '../../ui/ExportSheet';
import { ScheduleCallSheet } from '../../ui/ScheduleCallSheet';
import { fill, useT } from '../../i18n';
import { useLook } from '../../theme/ThemeProvider';
import { Bubble, DayLabel, TypingDots } from '../../ui/chat/Bubble';
import { startCall } from '../../ui/CallBar';
import { albumsIn } from '../../ui/chat/albums';
import { AttachMenu, type AttachKind } from '../../ui/chat/AttachMenu';
import { CameraSheet } from '../../ui/chat/CameraSheet';
import { EmojiPicker } from '../../ui/chat/EmojiPicker';
import { LinkSheetHost } from '../../ui/chat/RichText';
import { Composer } from '../../ui/chat/Composer';
import { ContactShare } from '../../ui/chat/ContactShare';
import { fromAudio, fromFiles, fromGallery } from '../../ui/chat/attachments';
import { LocationSheet } from '../../ui/chat/LocationSheet';
import { MediaComposer, type Ready } from '../../ui/chat/MediaComposer';
import { PollSheet } from '../../ui/chat/PollSheet';
import { EventSheet } from '../../ui/chat/EventSheet';
import type { RoundVideo } from '../../ui/chat/RoundRecorder';
import { ScheduledBar } from '../../ui/chat/ScheduledBar';
import { ReportSheet } from '../../ui/ReportSheet';
import { MuteSheet } from '../../ui/MuteSheet';
import { SchedulePicker } from '../../ui/SchedulePicker';
import { dayLabel, lastSeen, sameDay, TIMERS, timerLabel, whenLabel } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { Avatar, Button, Glass, IconButton, Pressy, Screen, Txt } from '../../ui/kit';
import { Marquee } from '../../ui/Marquee';
import { arrive, thud, tick } from '../../ui/motion';
import { Dialog, MenuItem, Popup, Sheet, toast } from '../../ui/overlays';

type Item = { key: string; kind: 'msg'; m: Message; first: boolean; album?: Message[] } | { key: string; kind: 'day'; text: string } | { key: string; kind: 'unread'; text: string } | { key: string; kind: 'typing' };

const keyOf = (m: Pick<Message, 'author' | 'id'>) => `${m.author}/${m.id}`;
const quoteKind = (m: Message): ChatQuote['kind'] =>
  m.kind === 'text' ? 'text' : m.kind === 'poll' ? 'poll' : m.kind !== 'file' || !m.file ? 'other' : m.file.kind === 'image' ? 'image' : m.file.kind === 'video' ? 'video' : m.file.kind === 'voice' ? 'voice' : 'file';
/** The height of the bar across the top. */
const BAR = 60;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * A locked chat (Chat lock) asks for your fingerprint or face first, and locks
 * again once you leave it (core/lock.ts). Until then nothing of it is read.
 */
/** Asked once per run of PakChat to allow exact alarms (scheduled messages on time). */
let askedExact = false;

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prefs = useChatPrefs(id);
  const lock = !!prefs.lock;
  const open = useCore(['lock', 'prefs'], () => !lock || chatOpen(id));
  useEffect(() => (lock ? () => leftChat(id) : undefined), [id, lock]);
  if (!open) return <LockedGate chatId={id} />;
  return <ChatScreen />;
}

function ChatScreen() {
  // jump: "author/id" of a message to scroll to and flash (from search, or a photo's "Show in chat").
  // reply: "author/id" of a message to answer (a photo's Reply, in the viewer).
  const { id, quote: quoteParam, media, jump, reply: replyParam } = useLocalSearchParams<{ id: string; quote?: string; media?: string; jump?: string; reply?: string }>();
  const t = useT();
  const { theme } = useLook();
  const insets = useSafeAreaInsets();
  const chat = useChat(id);
  const { list, more, hasMore } = useMessages(id);
  const typing = useTyping(id);
  const starred = useStarred();
  const prefs = useChatPrefs(id);
  const settings = useSettings();
  usePeople();
  const other = chat ? core.otherPerson(chat) : null;
  const presence = usePresence(other);
  // WhatsApp's "Not in your contacts" card, for a one-to-one chat with someone I haven't saved.
  const stranger = !!other && other !== core.myId && !core.isContact(other);
  const [blocking, setBlocking] = useState(false);

  const [picked, setPicked] = useState<Map<string, Message>>(new Map());
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  // "Reply privately" from a group: the group message this answers.
  const [quote, setQuote] = useState<ChatQuote | null>(() => {
    try {
      return quoteParam ? (JSON.parse(quoteParam) as ChatQuote) : null;
    } catch {
      return null;
    }
  });
  const [reportOf, setReportOf] = useState<Message | null | undefined>(undefined);
  const [exportOpen, setExportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // ⋮ › Search: the box in the bar, with up and down (below).
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [muting, setMuting] = useState(false);
  const [pickMenu, setPickMenu] = useState(false);
  const [attach, setAttach] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  // Picked photos, videos and files, in the editor before they go (MediaComposer.tsx).
  // Opened from the chat list's 📷 (send-to.tsx): the editor starts with what was taken.
  const [outgoing, setOutgoing] = useState<Picked[] | null>(() => (media ? takeHandOff() : null));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // Hold "send" › Schedule message: the words wait here while you pick a time.
  const [asking, setAsking] = useState<{ text: string; mentions: string[]; link?: LinkPreview } | null>(null);
  const [askExact, setAskExact] = useState(false);
  const askDone = useRef<((ok: boolean) => void) | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [timerOpen, setTimerOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [leftChoices, setLeftChoices] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // When the newest messages were last on screen: anything from them after that is "unseen".
  const [bottomAt, setBottomAt] = useState(Date.now);
  const wasAtBottom = useRef(true);
  // Only messages newer than opening the chat rise into place (not the ones already there).
  const [openedAt] = useState(Date.now);
  const now = useNow(15_000);
  const listRef = useRef<FlatList<Item>>(null);
  const focused = useRef(true);
  const selecting = picked.size > 0;

  // The keyboard pushes the messages and the typing bar up as it slides in.
  // While it moves they're only shifted (cheap, nothing is measured again); the
  // space under them changes once, when it has stopped. Changing that space
  // every frame made the whole chat lay itself out again 60 times a second,
  // which is what made the keyboard feel slow on some phones.
  const keyboard = useAnimatedKeyboard();
  const rest = useSharedValue(0);
  useAnimatedReaction(
    () => (keyboard.state.value === KeyboardState.OPEN || keyboard.state.value === KeyboardState.CLOSED ? keyboard.height.value : -1),
    (h) => {
      if (h >= 0) rest.value = h;
    },
  );
  const lift = useAnimatedStyle(() => {
    const now = Math.max(keyboard.height.value, insets.bottom);
    const settledAt = Math.max(rest.value, insets.bottom);
    return { paddingBottom: settledAt, transform: [{ translateY: settledAt - now }] };
  });

  // The chat slides in first; the work that changes other screens (marking it
  // read, which redraws the chat list underneath) waits until it has, so the
  // slide stays smooth. Half a second at most, in case the "done" never comes.
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  // Timed from the tap on the chat list (Settings › Help › Speed check): drawn, then slid in.
  useEffect(() => {
    requestAnimationFrame(() => lapTimer('chat', 'chatDrawn'));
  }, []);
  useEffect(() => {
    if (settled) stopTimer('chat', 'chatIn');
  }, [settled]);
  useEffect(() => {
    const done = () => setSettled(true);
    const off = navigation.addListener('transitionEnd' as never, done);
    const wait = setTimeout(done, 500);
    return () => {
      off();
      clearTimeout(wait);
    };
  }, [navigation]);

  // Reading the chat: blue ticks for them, and no more unread here. Only while PakChat is
  // on screen: a chat left open in the background hasn't been read.
  const [onScreen, setOnScreen] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setOnScreen(s === 'active'));
    return () => sub.remove();
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // This chat's alert goes, and new messages here don't alert while you're looking.
      core.viewing = id;
      if (settled) {
        if (AppState.currentState === 'active') {
          void dismissChatAlert(id);
          void calls.seenMissed(id);
        }
        core.setPrefs(id, { markedUnread: false });
        // Coming back to the chat (from its info, say): anything that came meanwhile is read now.
        if (AppState.currentState === 'active') void core.client.markRead(id).catch(() => {});
      }
      return () => {
        focused.current = false;
        if (core.viewing === id) core.viewing = null;
      };
    }, [id, settled]),
  );
  useEffect(() => {
    if (settled && onScreen && focused.current && chat && chat.unread > 0) void core.client.markRead(id).catch(() => {});
  }, [chat, id, list, onScreen, settled]);
  // Back in PakChat with this chat open: its alert has been seen.
  useEffect(() => {
    if (settled && onScreen && focused.current) void dismissChatAlert(id);
  }, [id, onScreen, settled]);

  // Back first cancels picking, replying or editing.
  useEffect(() => {
    if (!selecting && !replyTo && !editing && !searching) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearching(false);
      setSearchText('');
      setPicked(new Map());
      setReplyTo(null);
      setEditing(null);
      return true;
    });
    return () => sub.remove();
  }, [selecting, replyTo, editing, searching]);

  // A disappearing message goes when its time is up, even if nothing else changes on screen.
  useEffect(() => {
    if (list) core.forgetExpired(list);
  }, [list, now]);

  const byKey = useMemo(() => new Map((list ?? []).map((m) => [keyOf(m), m])), [list]);

  // "3 unread messages": how many were unread when the chat opened (before it's marked read),
  // shown above the first of them, like WhatsApp. It goes once I send something.
  const [unreadOpen, setUnreadOpen] = useState<number | null>(() => chat?.unread ?? null);
  if (unreadOpen === null && chat) setUnreadOpen(chat.unread);
  const unreadMark = unreadAt(list, unreadOpen, openedAt);
  const unreadKey = unreadMark?.key;
  const unreadN = unreadMark?.n ?? 0;

  // Newest first (the list is upside down, so the newest sits at the bottom), with day labels between days.
  // Photos and videos sent together: one album each (albums.ts), shown where its newest is.
  const albums = useMemo(() => albumsIn(list ?? []), [list]);
  const items = useMemo<Item[]>(() => {
    const ms = list ?? [];
    const out: Item[] = [];
    const firstOf = (i: number) => {
      const m = ms[i];
      const prev = ms[i - 1];
      return !prev || prev.author !== m.author || prev.kind === 'system' || !sameDay(prev.sentAt, m.sentAt) || m.sentAt - prev.sentAt > 5 * 60_000;
    };
    if (typing.length) out.push({ key: 'typing', kind: 'typing' });
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      const prev = ms[i - 1];
      const album = albums.get(keyOf(m));
      if (album) {
        // The album goes in once, at its newest; its oldest decides the name and corner.
        if (album.at(-1) === m) out.push({ key: keyOf(m), kind: 'msg', m, first: firstOf(i - album.length + 1), album });
      } else out.push({ key: keyOf(m), kind: 'msg', m, first: firstOf(i) });
      if (unreadKey === keyOf(m)) out.push({ key: 'unread', kind: 'unread', text: unreadN === 1 ? t.oneUnread : fill(t.nUnread, { n: unreadN }) });
      if (!prev || !sameDay(prev.sentAt, m.sentAt)) out.push({ key: `day-${m.sentAt}`, kind: 'day', text: dayLabel(m.sentAt, t) });
    }
    return out;
  }, [list, albums, typing.length, t, unreadKey, unreadN]);

  const unseen = atBottom ? 0 : (list ?? []).filter((m) => m.kind !== 'system' && m.author !== core.myId && m.sentAt > bottomAt).length;

  // The day of the messages at the top, floating there while you scroll (WhatsApp's date pill).
  const [pill] = useState(makePill);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const top = viewableItems.reduce<ListViewToken | null>((a, v) => (v.index != null && (!a || (a.index ?? 0) < v.index) ? v : a), null)?.item as Item | undefined;
    if (top?.kind === 'msg') pill.setText(dayLabel(top.m.sentAt, tRef.current));
    else if (top?.kind === 'day') pill.setText(top.text);
    const bottom = viewableItems.some((v) => v.index === 0 || v.index === 1);
    // Only when it changes (scrolled away from the newest, or back), so scrolling
    // doesn't redraw the whole chat over and over.
    if (bottom === wasAtBottom.current) return;
    wasAtBottom.current = bottom;
    // Leaving the newest: what arrives from now on is "unseen".
    if (!bottom) setBottomAt(Date.now());
    setAtBottom(bottom);
  }, [pill]);

  // Going to a message: older pages load until it's there, then it scrolls into view and flashes.
  // Coming back with a new one (Show in chat, from the viewer) goes there too.
  const [jumping, setJumping] = useState<string | null>(jump ?? null);
  const [lastJump, setLastJump] = useState(jump);
  if (jump !== lastJump) {
    setLastJump(jump);
    if (jump) setJumping(jump);
  }
  // Reply (from the viewer): the message, once it's loaded, is what the next message answers.
  const [replyWanted, setReplyWanted] = useState(replyParam);
  const [lastReply, setLastReply] = useState(replyParam);
  if (replyParam !== lastReply) {
    setLastReply(replyParam);
    setReplyWanted(replyParam);
  }
  if (replyWanted && byKey.has(replyWanted)) {
    setReplyWanted(undefined);
    setEditing(null);
    setReplyTo(byKey.get(replyWanted)!);
  }
  const [flash, setFlash] = useState<string | null>(null);
  const jumpTo = useCallback((m: Pick<Message, 'author' | 'id'>) => setJumping(keyOf(m)), []);
  useEffect(() => {
    if (!jumping || !list) return;
    const index = items.findIndex((it) => it.key === jumping || (it.kind === 'msg' && !!it.album?.some((x) => keyOf(x) === jumping)));
    if (index < 0 && hasMore) {
      more();
      return;
    }
    const go = setTimeout(() => {
      setJumping(null);
      if (index < 0) return;
      setFlash(jumping);
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    }, 0);
    return () => clearTimeout(go);
  }, [jumping, items, list, hasMore, more]);
  useEffect(() => {
    if (!flash) return;
    const off = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(off);
  }, [flash]);

  // Opening with unread messages further up than the screen shows: start at the "unread" strip.
  const startedAtUnread = useRef(false);
  useEffect(() => {
    if (startedAtUnread.current || !unreadKey || jump) return;
    startedAtUnread.current = true;
    const index = items.findIndex((it) => it.kind === 'unread');
    if (index > 8) setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.9, animated: false }), 60);
  }, [unreadKey, items, jump]);

  // ---- Searching this chat (⋮ › Search): the box in the bar, with up and down through what's found ----
  const [hits, setHits] = useState<{ author: string; id: string }[]>([]);
  const [hit, setHit] = useState(0);
  useEffect(() => {
    if (!searching) return;
    const q = searchText.trim();
    let alive = true;
    const wait = setTimeout(() => {
      if (!q) {
        if (alive) setHits([]);
        return;
      }
      void core.storage
        .search(q, 500)
        .then((found) => {
          if (!alive) return;
          const here = found.filter((f) => f.chatId === id);
          setHits(here);
          setHit(0);
          if (here.length) setJumping(keyOf(here[0]));
        })
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      clearTimeout(wait);
    };
  }, [searching, searchText, id]);
  const stepHit = (by: number) => {
    // Up is older (further into the list), down is newer.
    const next = hit + by;
    if (next < 0 || next >= hits.length) return;
    tick();
    setHit(next);
    setJumping(keyOf(hits[next]));
  };
  const stopSearch = () => {
    setSearching(false);
    setSearchText('');
    setHits([]);
  };

  // The "+" on the reactions bar: any emoji.
  const [reactingTo, setReactingTo] = useState<Message | null>(null);

  // ---- Picking messages ----

  // An album is picked (or let go) as a whole, like WhatsApp.
  const toggle = useCallback(
    (m: Message) => {
      tick();
      const all = albums.get(keyOf(m)) ?? [m];
      setPicked((old) => {
        const next = new Map(old);
        const on = all.every((x) => next.has(keyOf(x)));
        for (const x of all) {
          if (on) next.delete(keyOf(x));
          else next.set(keyOf(x), x);
        }
        return next;
      });
    },
    [albums],
  );

  // A tap picks while picking. Otherwise a tap on a sticker shows it big, with Save, like WhatsApp.
  const [stickerShown, setStickerShown] = useState<Message | null>(null);
  const onPress = useCallback(
    (m: Message) => {
      if (picked.size) toggle(m);
      else if (!m.deleted && m.file?.kind === 'sticker' && haveFile(m)) setStickerShown(m);
    },
    [picked.size, toggle],
  );
  const onLongPress = useCallback(
    (m: Message) => {
      if (m.kind === 'system') return;
      thud();
      toggle(m);
    },
    [toggle],
  );

  const pickedList = [...picked.values()];
  const one = pickedList.length === 1 ? pickedList[0] : null;
  const amAdmin = !!chat && chat.kind === 'group' && roleOf(chat, core.myId) === 'admin';
  const canEdit = !!one && one.author === core.myId && one.kind === 'text' && !one.deleted && now - one.sentAt < EDIT_MINUTES * 60_000;
  const canUnsend = pickedList.length > 0 && pickedList.every((m) => !m.deleted && m.seq !== null && (amAdmin || (m.author === core.myId && now - m.sentAt < UNSEND_HOURS * 3_600_000)));
  const allStarred = pickedList.length > 0 && pickedList.every((m) => core.isStarred(m));
  // One sticker picked (and on this phone): "Save sticker" sits at the top right.
  const pickedSticker = one && !one.deleted && one.file?.kind === 'sticker' && haveFile(one) ? one.file.local! : null;
  const stickerSaved = useStickerSaved(pickedSticker ?? stickerShown?.file?.local);
  const done = () => {
    setPicked(new Map());
    setPickMenu(false);
  };

  const ref = (m: Message): Ref => ({ author: m.author, id: m.id });

  async function act(work: () => Promise<unknown>) {
    try {
      await work();
    } catch {
      toast(t.couldNot);
    }
  }

  /** Takes the reply (if any) for what's about to be sent, and scrolls down to it. */
  function replyFor() {
    const reply = replyTo;
    setReplyTo(null);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    return reply ? ref(reply) : undefined;
  }

  /** The private reply's quote goes with the next message only. */
  function quoteFor() {
    const q = quote;
    setQuote(null);
    return q ?? undefined;
  }

  /** "Reply privately" to someone's group message: our own chat, with it quoted. */
  function replyPrivately(m: Message) {
    done();
    const q: ChatQuote = { chat: id, author: m.author, id: m.id, kind: quoteKind(m) };
    if (m.text) q.text = m.text.slice(0, 700);
    if (m.file?.thumb && !m.file.once) q.thumb = m.file.thumb;
    void act(async () => {
      const c = await core.client.openDirect(m.author, defaultTimer());
      router.push({ pathname: '/chat/[id]', params: { id: c.id, quote: JSON.stringify(q) } });
    });
  }

  function send(text: string, mentions: string[], link?: LinkPreview) {
    if (editing) {
      const m = editing;
      setEditing(null);
      void act(() => core.client.edit(id, m.id, text, mentions.length ? mentions : undefined));
      return;
    }
    const reply = replyFor();
    const q = quoteFor();
    void act(() => core.client.sendText(id, text, { replyTo: reply, mentions, link, quote: q }));
  }

  /** Hold "send", Schedule message: asks when, then it waits on this phone (scheduled.ts). */
  function askSchedule(text: string, mentions: string[], link?: LinkPreview) {
    return new Promise<boolean>((done) => {
      askDone.current = done;
      setAsking({ text, mentions, link });
    });
  }

  function scheduleAt(at: number) {
    const a = asking;
    const done = askDone.current;
    askDone.current = null;
    setAsking(null);
    if (!a) return;
    const reply = replyTo;
    setReplyTo(null);
    void plan(id, at, a.text, { mentions: a.mentions, link: a.link, replyTo: reply ? ref(reply) : undefined })
      .then(() => {
        done?.(true);
        toast(fill(t.scheduledFor, { when: whenLabel(at, t) }));
        // Android 12+: without "Alarms & reminders" it may go a few minutes late while PakChat is closed.
        if (!askedExact && !exactAlarms()) {
          askedExact = true;
          setAskExact(true);
        }
      })
      .catch(() => {
        done?.(false);
        toast(t.couldNot);
      });
  }

  /** A voice note from the mic (it answers whatever you were replying to). */
  function sendVoiceNote(v: Recorded) {
    const reply = replyFor();
    void act(() => sendVoice(id, v, reply));
  }

  /** A round video, from holding the 📷. */
  function sendRound(v: RoundVideo) {
    const reply = replyFor();
    toast(t.videoGettingReady);
    void act(() => sendPicked(id, { uri: v.uri, mime: 'video/mp4', kind: 'video', duration: v.duration, round: true }, undefined, { replyTo: reply }));
  }

  function sendPlace(place: Place) {
    setLocationOpen(false);
    const reply = replyFor();
    void act(() => core.client.sendLocation(id, place, { replyTo: reply }));
  }

  function shareLive(ms: number) {
    setLocationOpen(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    void startLive(id, ms, { title: t.liveSharingTitle, text: fill(t.liveSharingText, { name: core.chatTitle(chat!) }), stop: t.stopWord })
      .then((ok) => !ok && toast(t.locationNeeded))
      .catch(() => toast(t.couldNot));
  }

  function sendCards(cards: SharedContact[]) {
    setContactOpen(false);
    const reply = replyFor();
    void act(() => core.client.sendContacts(id, cards, { replyTo: reply }));
  }

  /** A GIF or sticker from the smiley panel (it answers whatever you were replying to too). */
  function sendExtra(work: (reply?: Ref) => Promise<unknown>) {
    const reply = replyTo;
    setReplyTo(null);
    void act(() => work(reply ? ref(reply) : undefined));
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  /** Opens a picker; what's picked (and not too big) comes back. */
  async function choose(from: () => Promise<(Picked | null)[]>) {
    try {
      const picked = (await from()).filter((p): p is Picked => !!p);
      if (!picked.length) return [];
      const limit = await loadLimits();
      // A video over the limit can still go once it's made smaller (HD off); with HD on, sending says it's too big.
      const ok = picked.filter((p) => !p.size || p.size <= limit || (p.kind === 'video' && !p.gif));
      if (ok.length < picked.length) toast(fill(t.fileTooBig, { mb: Math.floor(limit / 1024 / 1024) }));
      return ok;
    } catch {
      toast(t.couldNot);
      return [];
    }
  }

  /** Opens a picker, then the editor with what was picked. */
  async function pick(from: () => Promise<(Picked | null)[]>) {
    const ok = await choose(from);
    if (ok.length) setOutgoing(ok);
  }

  function attachPicked(k: AttachKind) {
    setAttach(false);
    // The menu closes first, then the next thing opens.
    const next = (fn: () => void) => setTimeout(fn, 160);
    if (k === 'gallery') void pick(fromGallery);
    else if (k === 'camera') next(() => setCameraOpen(true));
    else if (k === 'document') void pick(async () => [await fromFiles()]);
    else if (k === 'audio') void pick(async () => [await fromAudio()]);
    else if (k === 'location') next(() => setLocationOpen(true));
    else if (k === 'contact') next(() => setContactOpen(true));
    else if (k === 'event') {
      setPollKey((n) => n + 1);
      next(() => setEventOpen(true));
    } else {
      setPollKey((n) => n + 1);
      next(() => setPollOpen(true));
    }
  }

  /** Send in the editor: each with its own caption, as on WhatsApp. */
  function sendOutgoing(list: Ready[]) {
    setOutgoing(null);
    const reply = replyFor();
    const q = quoteFor();
    // Making a video smaller takes a few seconds (longer for a long one).
    if (list.some((p) => p.kind === 'video' && !p.gif && !p.hd)) toast(t.videoGettingReady);
    void act(async () => {
      for (const [i, p] of list.entries()) {
        try {
          const { caption, ...picked } = p;
          await sendPicked(id, picked, caption, { replyTo: i === 0 ? reply : undefined, quote: i === 0 ? q : undefined });
        } catch (err) {
          if (err instanceof TooBig) toast(fill(t.fileTooBig, { mb: Math.floor(Number(err.message) / 1024 / 1024) }));
          else throw err;
        }
      }
    });
  }

  const react = useCallback(
    (m: Message, emoji: string) => {
      const mine = m.reactions?.[core.myId];
      tick();
      void core.client.react(id, ref(m), mine === emoji ? null : emoji).catch(() => {});
      setPicked(new Map());
    },
    [id],
  );

  const vote = useCallback(
    (m: Message, option: number) => {
      if (!m.poll) return;
      tick();
      const mine = m.votes?.[core.myId] ?? [];
      const next = mine.includes(option) ? mine.filter((o) => o !== option) : m.poll.multi ? [...mine, option] : [option];
      void core.client.vote(id, ref(m), next).catch(() => {});
    },
    [id],
  );

  const retry = useCallback(
    (m: Message) => {
      void (async () => {
        await core.deleteForMe([m], true);
        if (m.kind === 'file' && m.file?.local) {
          const { local, id: _id, key: _key, digest: _digest, ...meta } = m.file;
          await core.client.sendFile(id, { ...meta, local }, { caption: m.text, replyTo: m.replyTo, mentions: m.mentions });
        } else if (m.text) await core.client.sendText(id, m.text, { replyTo: m.replyTo, mentions: m.mentions });
      })().catch(() => {});
    },
    [id],
  );

  const reply = useCallback((m: Message) => {
    setEditing(null);
    setReplyTo(m);
  }, []);

  // The message box only redraws when its own things change (typing "typing…" or a
  // tick turning blue leaves it alone), so it gets the same functions every time.
  const composerCancel = useStable(() => (setReplyTo(null), setEditing(null), setQuote(null)));
  // Sending is timed from the tap to the new bubble showing (Settings › Help › Speed check).
  const sendFrom = useRef<string | null>(null);
  const composerSend = useStable((text: string, mentions: string[], link?: LinkPreview) => {
    if (!editing) {
      startTimer('send');
      sendFrom.current = list?.length ? keyOf(list[list.length - 1]) : null;
    }
    send(text, mentions, link);
  });
  useEffect(() => {
    const newest = list?.at(-1);
    if (!newest || !timing('send') || newest.author !== core.myId || keyOf(newest) === sendFrom.current) return;
    requestAnimationFrame(() => stopTimer('send', 'send'));
  }, [list]);
  const composerSchedule = useStable(askSchedule);
  const composerAttach = useStable(() => setAttach(true));
  const composerCamera = useStable(() => setCameraOpen(true));
  const composerRound = useStable(sendRound);
  const composerVoice = useStable(sendVoiceNote);
  const composerGif = useStable((g: Gif) => sendExtra((r) => sendGif(id, g, r)));
  const composerSticker = useStable((from: string | number) => sendExtra((r) => sendSticker(id, from, r)));

  // ---- The header ----

  const title = chat ? core.chatTitle(chat) : '';
  const group = chat?.kind === 'group';
  const subtitle = typing.length
    ? group
      ? fill(t.nameTyping, { name: core.name(typing[0]) || '…' })
      : t.typing
    : group
      ? (chat?.members ?? [])
          .map((mb) => (mb.userId === core.myId ? t.youWord : core.name(mb.userId)))
          .filter(Boolean)
          .join(', ')
      : chat && core.isSelfChat(chat)
        ? t.messageYourself
        : lastSeen(presence, t) || t.tapForInfo;

  const pinned = useMemo(() => [...(list ?? [])].reverse().find((m) => m.pinnedUntil && m.pinnedUntil > now && !m.deleted), [list, now]);
  const mayWrite = chat && !chat.left && !(group && chat.onlyAdminsSend && !amAdmin);
  // Calls: anyone still in the chat (not a group I left, and not myself).
  const mayCall = !!chat && !chat.left && chat.members.some((mb) => mb.userId !== core.myId);

  // Saving or un-saving a sticker from a message.
  const toggleSaved = (uri: string, saved: boolean) => {
    (saved ? unsaveSticker(uri).then(() => toast(t.stickerRemoved)) : saveSticker(uri).then(() => toast(t.stickerSaved))).catch(() => toast(t.couldNot));
  };
  // The picked bar gets one more button for a sticker, so they're a little smaller then.
  const bs = pickedSticker ? 38 : 42;
  const header = searching && !selecting ? (
    <Animated.View key="search" style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: BAR, paddingHorizontal: 4 }}>
      <IconButton icon="back" label={t.back} onPress={stopSearch} flip size={42} iconSize={23} testID="search-close" />
      <TextInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder={t.searchInChat}
        placeholderTextColor={theme.muted}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={() => stepHit(1)}
        style={{ flex: 1, color: theme.text, fontSize: 16, paddingHorizontal: 6 }}
        testID="chat-search-field"
      />
      {!!searchText.trim() && (
        <Txt size={12.5} color={theme.muted} testID="chat-search-count">
          {hits.length ? fill(t.nOfM, { n: hit + 1, m: hits.length }) : t.noResults}
        </Txt>
      )}
      <IconButton icon="up" label={t.olderMatch} size={40} onPress={() => stepHit(1)} testID="search-up" />
      <IconButton icon="down" label={t.newerMatch} size={40} onPress={() => stepHit(-1)} testID="search-down" />
    </Animated.View>
  ) : selecting ? (
    <Animated.View key="pick" style={{ flexDirection: 'row', alignItems: 'center', height: BAR, paddingHorizontal: 4 }}>
        <IconButton icon="close" label={t.cancelSelection} onPress={done} size={bs} testID="cancel-pick" />
        <View style={{ flex: 1, paddingHorizontal: 4 }}>
          <Txt size={18} weight="700">
            {fill(t.selected, { n: picked.size })}
          </Txt>
        </View>
        {one && !one.deleted && mayWrite && <IconButton icon="reply" label={t.reply} flip size={bs} onPress={() => (reply(one), done())} testID="pick-reply" />}
        <IconButton
          icon={allStarred ? 'starFilled' : 'star'}
          label={allStarred ? t.unstar : t.star}
         
          size={bs}
          onPress={() => {
            core.setStarred(pickedList, !allStarred);
            toast(allStarred ? t.unstarred : t.starredNote);
            done();
          }}
          testID="pick-star"
        />
        <IconButton icon="trash" label={t.delete} size={bs} onPress={() => setDeleting(true)} testID="pick-delete" />
        <IconButton
          icon="forward"
          label={t.forward}
         
          size={bs}
          flip
          onPress={() => {
            const texts = pickedList.filter((m) => m.kind === 'text' && !m.deleted && m.text).map((m) => m.text!);
            // Files go on only once they're on this phone (downloaded).
            // View once can't be forwarded.
            const files = pickedList.filter((m) => m.kind === 'file' && !m.deleted && !m.file?.once && haveFile(m)).map((m) => [m.chatId, m.author, m.id]);
            done();
            if (texts.length || files.length) router.push({ pathname: '/forward', params: { texts: JSON.stringify(texts), files: JSON.stringify(files) } });
          }}
          testID="pick-forward"
        />
        {pickedSticker && (
          <IconButton
            icon={stickerSaved ? 'stickerSaved' : 'stickerAdd'}
            label={stickerSaved ? t.unsaveSticker : t.saveSticker}
           
            size={bs}
            onPress={() => {
              done();
              toggleSaved(pickedSticker, !!stickerSaved);
            }}
            testID="pick-save-sticker"
          />
        )}
        <IconButton icon="more" label={t.moreOptions} size={bs} onPress={() => setPickMenu(true)} testID="pick-more" />
    </Animated.View>
  ) : (
    <Animated.View key="title" style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: BAR, paddingHorizontal: 4 }}>
        <IconButton icon="back" label={t.back} onPress={() => router.back()} flip size={42} iconSize={23} testID="back" />
        <Pressy onPress={() => router.push({ pathname: '/info/[id]', params: { id } })} label={title} scale={0.98} style={{ flex: 1, alignSelf: 'stretch', justifyContent: 'center' }} testID="chat-header">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar id={id} name={title} size={38} online={!!presence?.online} group={group} />
            <View style={{ flex: 1 }}>
              <Txt size={16} weight="700" lines={1}>
                {title}
              </Txt>
              {!!subtitle && (
                <Animated.View key={subtitle}>
                  {/* "last seen today at 4:20 pm" slides along so the time shows, like WhatsApp. */}
                  <Marquee text={subtitle} size={12} weight="500" color={typing.length || presence?.online ? theme.acc : theme.muted} testID="chat-subtitle" />
                </Animated.View>
              )}
            </View>
          </View>
        </Pressy>
        {mayCall && (
          <>
            <IconButton icon="video" label={t.videoCall} size={42} iconSize={23} onPress={() => void startCall(id, true, t)} testID="video-call" />
            <IconButton icon="calls" label={t.voiceCall} size={42} iconSize={20} onPress={() => void startCall(id, false, t)} testID="voice-call" />
          </>
        )}
        <IconButton icon="more" label={t.moreOptions} size={42} onPress={() => setMenu(true)} testID="chat-menu" />
    </Animated.View>
  );

  const wallpaper = prefs.wallpaper ?? settings.wallpaper;
  const textSize = MESSAGE_TEXT[settings.fontSize ?? 'medium'];
  if (chat === null) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }}>
          <Txt size={16} color={theme.muted} align="center">
            {t.chatGone}
          </Txt>
          <Button title={t.back} look="soft" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom={false} style={{ paddingTop: 0 }} backdrop={<Backdrop wp={wallpaper} />}>
      {/* A flat bar across the top, under the phone's status bar too, like WhatsApp's. It stays
          put; what's under it rides up with the keyboard (and slides under it meanwhile). */}
      <View style={{ zIndex: 2, paddingTop: insets.top, backgroundColor: theme.dark ? '#17181C' : '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(11,27,54,0.08)' }}>{header}</View>
      <Animated.View style={[{ flex: 1 }, lift]}>

        {pinned && !selecting && (
          <View>
            <Pressy onPress={() => jumpTo(pinned)} label={t.pinnedMessage} scale={0.98}>
              <Glass style={{ marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="pin" size={16} color={theme.accInk} />
                <View style={{ flex: 1 }}>
                  <Txt size={12} weight="700" color={theme.accInk}>
                    {t.pinnedMessage}
                  </Txt>
                  <Txt size={13} lines={1} color={theme.muted}>
                    {pinned.kind === 'poll' ? pinned.poll?.question : pinned.text}
                  </Txt>
                </View>
              </Glass>
            </Pressy>
          </View>
        )}

        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            inverted
            data={items}
            keyExtractor={(it) => it.key}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
            onEndReached={more}
            onEndReachedThreshold={0.4}
            onViewableItemsChanged={onViewable}
            onScrollBeginDrag={pill.show}
            onScrollEndDrag={pill.hideSoon}
            onMomentumScrollEnd={pill.hideSoon}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            keyboardShouldPersistTaps="handled"
            // Draws only what fills the screen first, so the chat opens quickly; the rest follows.
            initialNumToRender={11}
            maxToRenderPerBatch={slowPhone ? 5 : 8}
            updateCellsBatchingPeriod={30}
            // Until the chat has slid in, nothing past the screen is drawn, so the slide
            // stays smooth; the messages further up follow straight after.
            windowSize={settled ? (slowPhone ? 7 : 9) : 1}
            onScrollToIndexFailed={(info) => setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 250)}
            ListFooterComponent={
              list && !hasMore ? (
                <View>
                  <View style={{ alignSelf: 'center', maxWidth: '88%', marginVertical: 12, padding: 12, borderRadius: 14, backgroundColor: theme.glass, flexDirection: 'row', gap: 8 }}>
                    <Icon name="lock" size={15} color={theme.accInk} />
                    <View style={{ flexShrink: 1 }}>
                      <Txt size={12.5} color={theme.sectionText}>
                        {t.lockedNote}
                      </Txt>
                    </View>
                  </View>
                  {stranger && <NotInContacts userId={other} onBlock={() => setBlocking(true)} />}
                </View>
              ) : undefined
            }
            ListHeaderComponent={
              list && list.length === 0 && mayWrite ? (
                <Animated.View style={{ alignSelf: 'center', marginVertical: 20 }}>
                  <Button title={t.sayHi} look="soft" onPress={() => send(t.salam, [])} testID="say-hi" />
                </Animated.View>
              ) : undefined
            }
            renderItem={({ item }) => {
              if (item.kind === 'day') return <DayLabel text={item.text} />;
              if (item.kind === 'unread') return <UnreadStrip text={item.text} />;
              if (item.kind === 'typing') return <TypingDots name={group ? core.name(typing[0]) : undefined} />;
              const m = item.m;
              const k = keyOf(m);
              const showBar = one !== null && keyOf(one) === k && !m.deleted;
              const bubble = (
                <Bubble
                    m={m}
                    group={!!group}
                    quoted={m.replyTo ? (byKey.get(keyOf(m.replyTo)) ?? null) : null}
                    first={item.first}
                    // The clock only matters to pinned messages; the rest needn't redraw as it ticks.
                    now={m.pinnedUntil ? now : 0}
                    starred={!!starred[`${m.chatId}/${m.author}/${m.id}`]}
                    selecting={selecting}
                    selected={item.album ? item.album.every((x) => picked.has(keyOf(x))) : picked.has(k)}
                    flash={flash === k || (!!flash && !!item.album?.some((x) => keyOf(x) === flash))}
                    album={item.album}
                    textSize={textSize}
                    onPress={onPress}
                    onLongPress={onLongPress}
                    onReply={reply}
                    onVote={vote}
                    onReaction={react}
                    onQuote={jumpTo}
                    onRetry={retry}
                    above={showBar ? <ReactionBar mine={m.author === core.myId} current={m.reactions?.[core.myId]} onPick={(e) => react(m, e)} onMore={() => setReactingTo(m)} /> : undefined}
                  />
              );
              // One sent or come in while the chat is open rises into place, like WhatsApp's (not the ones already there).
              return m.sentAt > openedAt ? <Animated.View entering={arrive}>{bubble}</Animated.View> : bubble;
            }}
          />

          <DatePill pill={pill} />

          {/* Back to the newest, when you've scrolled up. */}
          {!atBottom && (
            <Animated.View style={{ position: 'absolute', end: 16, bottom: 12 }}>
              <Pressy onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: false })} label={t.newest} scale={0.9} testID="to-bottom">
                <Glass strong style={{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="down" size={22} color={theme.accInk} />
                  {unseen > 0 && (
                    <View style={{ position: 'absolute', top: -6, end: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: theme.acc, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt size={11} weight="700" color="#FFFFFF" align="center">
                        {unseen}
                      </Txt>
                    </View>
                  )}
                </Glass>
              </Pressy>
            </Animated.View>
          )}
        </View>

        {chat &&
          (mayWrite ? (
            <>
              <ScheduledBar chatId={id} />
              <Composer
                key={editing ? `edit-${editing.id}` : chat.id}
                chat={chat}
                replyTo={replyTo}
                editing={editing}
                quote={quote}
                onCancel={composerCancel}
                onSend={composerSend}
                onSchedule={composerSchedule}
                onAttach={composerAttach}
                onCamera={composerCamera}
                onRound={composerRound}
                onVoice={composerVoice}
                onGif={composerGif}
                onSticker={composerSticker}
              />
            </>
          ) : (
            <Glass style={{ margin: 10, padding: 14, borderRadius: 18, gap: 10 }}>
              <Txt size={14} color={theme.muted} align="center">
                {chat.left ? t.notInGroup : t.onlyAdminsNote}
              </Txt>
              {/* Left: WhatsApp's "Delete group" right there (or clear it). */}
              {chat.left && <Button title={t.deleteGroup} icon="trash" look="soft" onPress={() => setLeftChoices(true)} testID="chat-delete-group" />}
            </Glass>
          ))}
      </Animated.View>

      <LinkSheetHost />
      <AddToListSheet visible={listOpen} chatIds={[id]} onClose={() => setListOpen(false)} />
      <EmojiPicker
        visible={!!reactingTo}
        onClose={() => setReactingTo(null)}
        onPick={(e) => {
          const m = reactingTo;
          setReactingTo(null);
          if (m) react(m, e);
        }}
      />

      <LeftGroupChoices chatId={id} name={chat ? core.chatTitle(chat) : ''} visible={leftChoices} onClose={() => setLeftChoices(false)} />

      {/* The ⋮ menu of the chat. */}
      <Popup visible={menu} onClose={() => setMenu(false)}>
        <MenuItem icon="info" label={group ? t.groupInfo : t.contactInfo} onPress={() => (setMenu(false), router.push({ pathname: '/info/[id]', params: { id } }))} />
        <MenuItem icon="search" label={t.search} onPress={() => (setMenu(false), setSearching(true))} testID="menu-search" />
        <MenuItem
          icon={prefs.muted ? 'bell' : 'muted'}
          label={prefs.muted ? t.unmute : t.mute}
          onPress={() => {
            setMenu(false);
            if (prefs.muted) core.unmute(id);
            else setMuting(true);
          }}
        />
        <MenuItem icon="timer" label={t.disappearing} onPress={() => (setMenu(false), setTimerOpen(true))} testID="menu-timer" />
        <MenuItem icon="text" label={t.addToList} onPress={() => (setMenu(false), setListOpen(true))} testID="menu-add-to-list" />
        <MenuItem icon="wallpaper" label={t.wallpaper} onPress={() => (setMenu(false), router.push({ pathname: '/wallpaper', params: { chat: id } }))} testID="menu-wallpaper" />
        {!chat?.onlyAdminsSend && <MenuItem icon="calendar" label={t.scheduleCall} onPress={() => (setMenu(false), setPlanOpen(true))} testID="menu-schedule-call" />}
        <MenuItem icon="export" label={t.exportChat} onPress={() => (setMenu(false), setExportOpen(true))} testID="menu-export" />
        {/* Not for a locked chat: the home screen would show its name and photo. */}
        {chat && !prefs.lock && (
          <MenuItem icon="plus" label={t.addShortcut} onPress={() => (setMenu(false), addShortcut(chat) || toast(t.shortcutNotHere))} testID="menu-shortcut" />
        )}
        {(group || (other && other !== core.myId)) && <MenuItem icon="warning" label={t.report} onPress={() => (setMenu(false), setReportOf(null))} testID="menu-report" />}
        <MenuItem icon="trash" label={t.clearChat} danger onPress={() => (setMenu(false), setClearing(true))} />
      </Popup>

      {/* The ⋮ menu while messages are picked. */}
      <Popup visible={pickMenu} onClose={() => setPickMenu(false)} top={70}>
        {one && one.author === core.myId && (
          <MenuItem
            icon="info"
            label={t.info}
            onPress={() => {
              done();
              router.push({ pathname: '/message-info', params: { chat: id, author: one.author, id: one.id } });
            }}
          />
        )}
        {pickedList.some((m) => m.text && !m.deleted) && (
          <MenuItem
            icon="copy"
            label={t.copy}
            onPress={() => {
              void Clipboard.setStringAsync(
                pickedList
                  .filter((m) => m.text && !m.deleted)
                  .map((m) => m.text)
                  .join('\n'),
              );
              toast(t.copied);
              done();
            }}
            testID="pick-copy"
          />
        )}
        {canEdit && <MenuItem icon="edit" label={t.edit} onPress={() => (setEditing(one), setReplyTo(null), done())} testID="pick-edit" />}
        {one && !one.deleted && mayWrite && (
          <MenuItem
            icon="pin"
            label={one.pinnedUntil && one.pinnedUntil > now ? t.unpin : t.pin}
            onPress={() => {
              const on = one.pinnedUntil && one.pinnedUntil > now;
              void act(() => core.client.pin(id, ref(one), on ? null : Date.now() + 7 * 86_400_000));
              done();
            }}
            testID="pick-pin"
          />
        )}
        {one && group && one.author !== core.myId && !one.deleted && one.kind !== 'system' && <MenuItem icon="reply" label={t.replyPrivately} onPress={() => replyPrivately(one)} testID="pick-reply-private" />}
        {one && one.author !== core.myId && !one.deleted && one.kind !== 'system' && <MenuItem icon="warning" label={t.report} onPress={() => (setReportOf(one), done())} testID="pick-report" />}
        <MenuItem icon="select" label={t.selectAll} onPress={() => (setPicked(new Map((list ?? []).filter((m) => m.kind !== 'system').map((m) => [keyOf(m), m]))), setPickMenu(false))} />
      </Popup>

      {/* A sticker shown big after a tap, with Save (or Remove from saved). */}
      <Sheet visible={!!stickerShown} onClose={() => setStickerShown(null)}>
        {stickerShown?.file?.local && (
          <View style={{ alignItems: 'center', gap: 14, paddingBottom: 6 }}>
            <Image source={{ uri: stickerShown.file.local }} style={{ width: 180, height: 180 }} contentFit="contain" />
            <Txt size={13} color={theme.muted} align="center">
              {t.stickerHint}
            </Txt>
            <Button
              title={stickerSaved ? t.unsaveSticker : t.saveSticker}
              icon={stickerSaved ? 'stickerSaved' : 'stickerAdd'}
              look={stickerSaved ? 'soft' : 'main'}
              onPress={() => {
                const uri = stickerShown.file!.local!;
                setStickerShown(null);
                toggleSaved(uri, !!stickerSaved);
              }}
              testID="sheet-save-sticker"
            />
          </View>
        )}
      </Sheet>

      {/* Deleting picked messages. */}
      <Dialog
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={picked.size === 1 ? t.deleteOneMessage : fill(t.deleteMessages, { n: picked.size })}
        buttons={[
          ...(canUnsend
            ? [
                {
                  label: t.deleteForEveryone,
                  danger: true,
                  testID: 'delete-everyone',
                  onPress: () => {
                    const all = pickedList;
                    setDeleting(false);
                    done();
                    void act(async () => {
                      for (const m of all) await core.client.deleteForEveryone(id, ref(m));
                    });
                  },
                },
              ]
            : []),
          {
            label: t.deleteForMe,
            danger: true,
            testID: 'delete-me',
            onPress: () => {
              const all = pickedList;
              setDeleting(false);
              done();
              void act(() => core.deleteForMe(all));
            },
          },
          { label: t.cancel, onPress: () => setDeleting(false) },
        ]}
      />

      <ExportSheet visible={exportOpen} chatId={id} onClose={() => setExportOpen(false)} />
      <ScheduleCallSheet visible={planOpen} chatId={id} onClose={() => setPlanOpen(false)} />
      <MuteSheet visible={muting} onClose={() => setMuting(false)} onPick={(ms) => core.mute(id, ms)} />
      <ReportSheet visible={reportOf !== undefined} chatId={id} group={!!group} userId={reportOf ? reportOf.author : group ? null : other} message={reportOf} onClose={() => setReportOf(undefined)} />

      <Dialog
        visible={blocking}
        onClose={() => setBlocking(false)}
        title={fill(t.blockName, { name: other ? core.plainName(other) : '' })}
        buttons={[
          {
            label: t.block,
            danger: true,
            testID: 'confirm-block',
            onPress: () => {
              setBlocking(false);
              if (other) void act(() => core.block(other, true)).then(() => toast(t.blocked));
            },
          },
          { label: t.cancel, onPress: () => setBlocking(false) },
        ]}
      />

      <Dialog
        visible={clearing}
        onClose={() => setClearing(false)}
        title={t.clearChat}
        text={t.clearChatNote}
        buttons={[
          {
            label: t.clearChat,
            danger: true,
            onPress: () => {
              setClearing(false);
              void act(() => core.clearChat(id));
            },
          },
          { label: t.cancel, onPress: () => setClearing(false) },
        ]}
      />

      <Dialog
        visible={askExact}
        onClose={() => setAskExact(false)}
        title={t.exactAlarmsTitle}
        text={t.exactAlarmsText}
        buttons={[
          {
            label: t.allowWord,
            onPress: () => {
              setAskExact(false);
              allowExactAlarms();
            },
            testID: 'allow-exact',
          },
          { label: t.notNow, onPress: () => setAskExact(false) },
        ]}
      />

      {/* 📎: things to send. */}
      <AttachMenu visible={attach} onClose={() => setAttach(false)} onPick={attachPicked} />

      <CameraSheet
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onTaken={(list) => {
          setCameraOpen(false);
          setOutgoing((old) => [...(old ?? []), ...list]);
        }}
        onGallery={() => {
          setCameraOpen(false);
          void pick(fromGallery);
        }}
        onRound={(v) => {
          setCameraOpen(false);
          sendRound(v);
        }}
      />

      {/* What you picked, in the editor, before it goes. */}
      {outgoing && <MediaComposer items={outgoing} to={title} onClose={() => setOutgoing(null)} onMore={() => choose(fromGallery)} onSend={sendOutgoing} />}

      <LocationSheet visible={locationOpen} onClose={() => setLocationOpen(false)} onSend={sendPlace} onLive={shareLive} />
      <ContactShare visible={contactOpen} onClose={() => setContactOpen(false)} onSend={sendCards} />

      <SchedulePicker
        visible={!!asking}
        title={t.scheduleMessage}
        button={t.scheduleWord}
        soonest={SOONEST_MS}
        onClose={() => {
          askDone.current?.(false);
          askDone.current = null;
          setAsking(null);
        }}
        onPick={scheduleAt}
      />

      <PollSheet
        key={pollKey}
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onSend={(q, options, multi) => {
          setPollOpen(false);
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
          void act(() => core.client.sendPoll(id, q, options, multi));
        }}
      />

      <EventSheet
        key={`event-${pollKey}`}
        visible={eventOpen}
        onClose={() => setEventOpen(false)}
        onSend={(e) => {
          setEventOpen(false);
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
          const { call, ...rest } = e;
          void act(() => core.client.sendPlan(id, { ...rest, general: true, video: call === 'video', ...(call ? { call: true as const } : {}) }));
        }}
      />

      {/* Disappearing messages. */}
      <Sheet visible={timerOpen} onClose={() => setTimerOpen(false)} title={t.disappearing}>
        <View style={{ paddingHorizontal: 16, paddingTop: 4, gap: 4 }}>
          <Txt size={14} color={theme.muted} style={{ marginHorizontal: 4, marginBottom: 6 }}>
            {t.disappearingNote}
          </Txt>
          {TIMERS.map((s) => {
            const on = (chat?.timer ?? 0) === s;
            return (
              <Pressy
                key={s}
                label={timerLabel(s, t)}
                testID={`timer-${s}`}
                scale={0.98}
                onPress={() => {
                  setTimerOpen(false);
                  if (!on) void act(() => core.client.setTimer(id, s));
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: on ? theme.accSoft : 'transparent' }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={15.5} weight={on ? '700' : '500'} color={on ? theme.accInk : theme.text}>
                      {timerLabel(s, t)}
                    </Txt>
                  </View>
                  {on && <Icon name="check" size={20} color={theme.accInk} stroke={2.4} />}
                </View>
              </Pressy>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}

/** "Not in your contacts": who they are on PakChat, and Add or Block. */
function NotInContacts({ userId, onBlock }: { userId: string; onBlock: () => void }) {
  const t = useT();
  const { theme } = useLook();
  const person = usePerson(userId);
  return (
    <Animated.View style={{ alignSelf: 'center', width: '88%', marginBottom: 12 }}>
      <Glass strong style={{ padding: 16, borderRadius: 22, alignItems: 'center', gap: 8 }} testID="not-in-contacts">
        <Avatar id={userId} name={person?.name ?? ''} size={56} />
        <Txt size={16} weight="700" align="center">
          {person?.name ? `~ ${person.name}` : '…'}
        </Txt>
        <Txt size={13} color={theme.muted} align="center">
          {t.notInContacts}
        </Txt>
        <Txt size={12.5} color={theme.muted} align="center">
          {t.notInContactsNote}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignSelf: 'stretch' }}>
          <Button title={t.block} look="danger" onPress={onBlock} style={{ flex: 1 }} testID="stranger-block" />
          <Button title={t.addContact} onPress={() => router.push({ pathname: '/contact', params: { id: userId } })} style={{ flex: 1 }} testID="stranger-add" />
        </View>
      </Glass>
    </Animated.View>
  );
}

/** The six quick reactions over a held message. They pop in one after another. */
function ReactionBar({ mine, current, onPick, onMore }: { mine: boolean; current?: string; onPick: (emoji: string) => void; onMore: () => void }) {
  const t = useT();
  const { theme } = useLook();
  return (
    <Animated.View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginBottom: 6, zIndex: 3 }}>
      <Glass strong style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 3, borderRadius: 26, boxShadow: `0 16px 34px -14px ${theme.shadow}` }}>
        {REACTIONS.map((e, i) => (
          <Animated.View key={e}>
            <Pressy onPress={() => onPick(e)} label={e} scale={0.8} testID={`react-${e}`}>
              <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: current === e ? theme.accSoft : 'transparent' }}>
                <Txt size={24} align="center">
                  {e}
                </Txt>
              </View>
            </Pressy>
          </Animated.View>
        ))}
        {/* Any other emoji (or the one I picked from there, shown here). */}
        <View>
          <Pressy onPress={current && !REACTIONS.includes(current) ? () => onPick(current) : onMore} label={t.moreReactions} scale={0.8} testID="react-more">
            <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: current && !REACTIONS.includes(current) ? theme.accSoft : theme.glass }}>
              {current && !REACTIONS.includes(current) ? (
                <Txt size={24} align="center">
                  {current}
                </Txt>
              ) : (
                <Icon name="plus" size={20} color={theme.muted} />
              )}
            </View>
          </Pressy>
        </View>
      </Glass>
    </Animated.View>
  );
}

/** Where "N unread messages" goes: above the Nth newest message from someone else, until I send one. */
function unreadAt(list: Message[] | null, unread: number | null, openedAt: number) {
  if (!unread || !list) return null;
  if (list.some((m) => m.author === core.myId && m.sentAt > openedAt)) return null;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m.kind === 'system' || m.author === core.myId) continue;
    n++;
    if (n === unread || i === 0) return { key: keyOf(m), n: unread };
  }
  return null;
}

/** "3 unread messages", across the chat above the first of them. */
function UnreadStrip({ text }: { text: string }) {
  const { theme } = useLook();
  return (
    <View style={{ marginVertical: 8, marginHorizontal: -14, paddingVertical: 6, backgroundColor: theme.glass, alignItems: 'center' }} testID="unread-strip">
      <Txt size={12.5} weight="700" color={theme.sectionText}>
        {text}
      </Txt>
    </View>
  );
}

type Pill = ReturnType<typeof makePill>;

/** The floating date's state, kept out of the chat screen so scrolling doesn't redraw the whole chat. */
function makePill() {
  let text = '';
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<() => void>();
  const tell = () => subs.forEach((f) => f());
  return {
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    get: () => (shown ? text : ''),
    setText(next: string) {
      if (next === text) return;
      text = next;
      if (shown) tell();
    },
    show() {
      clearTimeout(timer);
      if (shown) return;
      shown = true;
      tell();
    },
    hideSoon() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        shown = false;
        tell();
      }, 1400);
    },
  };
}

function DatePill({ pill }: { pill: Pill }) {
  const { theme } = useLook();
  const text = useSyncExternalStore(pill.subscribe, pill.get);
  if (!text) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 8, alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, backgroundColor: theme.dark ? '#22252C' : '#FFFFFF', boxShadow: `0 2px 8px -3px ${theme.shadow}` }}>
        <Txt size={12.5} weight="600" color={theme.sectionText}>
          {text}
        </Txt>
      </View>
    </Animated.View>
  );
}
