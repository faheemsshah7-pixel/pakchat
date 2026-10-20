// The phase 1 screen. Top: the automatic test. Bottom: three pretend phones
// you can send between yourself, switching one offline to watch it catch up.
//
// All three "phones" live in this one app, each with its own Signal keys, and
// talk through a pretend server (relay.ts). The encryption is real: Signal's
// own library, running on your phone.

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import PakchatSignal from '../../modules/pakchat-signal';
import { Phone } from './phone';
import { Relay } from './relay';
import { runScenario, type Step } from './scenario';

const NAMES = ['Ali', 'Sara', 'Bilal'];
const GROUP = '0e3b7c55-1f2a-4b6c-9d8e-7a6b5c4d3e2f';

export default function SpikeScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <TestCard />
      <Playground />
    </ScrollView>
  );
}

function TestCard() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [crash, setCrash] = useState('');

  async function run() {
    setRunning(true);
    setSteps([]);
    setCrash('');
    try {
      await runScenario(PakchatSignal, (s) => setSteps((list) => [...list, s]));
    } catch (err) {
      setCrash((err as Error).message);
    }
    setRunning(false);
  }

  const failed = steps.filter((s) => !s.ok).length;
  const finished = !running && steps.length > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Encryption test</Text>
      <Text style={styles.text}>
        Three phones (Ali, Sara and Bilal) chat 1-to-1 and in a group. Sara goes offline, then comes back and
        catches up. Everything is locked with Signal's own library.
      </Text>

      <Pressable style={[styles.button, running && styles.buttonOff]} onPress={run} disabled={running}>
        <Text style={styles.buttonText}>{running ? 'Running…' : steps.length ? 'Run it again' : 'Run the test'}</Text>
      </Pressable>

      {finished && (
        <Text style={[styles.banner, failed ? styles.bad : styles.good]}>
          {failed ? `${failed} of ${steps.length} steps failed` : `All ${steps.length} steps passed. Encryption works on this phone.`}
        </Text>
      )}
      {crash !== '' && <Text style={[styles.banner, styles.bad]}>The test stopped: {crash}</Text>}

      {steps.map((s) => (
        <View key={s.title} style={styles.step}>
          <Text style={[styles.mark, s.ok ? styles.goodText : styles.badText]}>{s.ok ? '✓' : '✗'}</Text>
          <View style={styles.flex}>
            <Text style={styles.stepTitle}>
              {s.title} <Text style={styles.small}>{s.ms} ms</Text>
            </Text>
            <Text style={styles.small}>{s.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Playground() {
  const relay = useRef(new Relay()).current;
  const [phones, setPhones] = useState<Phone[]>([]);
  const [, redraw] = useState(0);
  const [from, setFrom] = useState('Ali');
  const [to, setTo] = useState('Sara');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Make the three phones once, when the screen opens.
    (async () => {
      const list = NAMES.map((n) => new Phone(PakchatSignal, relay, n));
      for (const p of list) {
        p.onChange = () => redraw((x) => x + 1);
        await p.setup(20);
        p.connect();
      }
      setPhones(list);
    })().catch((err) => setError((err as Error).message));
  }, [relay]);

  function pickFrom(name: string) {
    setFrom(name);
    // You can't send to yourself, so switch to the group.
    if (name === to) setTo('Group');
  }

  async function send() {
    const sender = phones.find((p) => p.name === from);
    if (!sender || !text.trim()) return;
    setError('');
    try {
      if (to === 'Group') await sender.sendGroup(GROUP, NAMES, text.trim());
      else await sender.sendText(to, text.trim());
      setText('');
    } catch (err) {
      setError((err as Error).message);
    }
    redraw((x) => x + 1);
  }

  const last = relay.seen[relay.seen.length - 1];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Try it yourself</Text>
      <Text style={styles.text}>Switch a phone off, send it some messages, then switch it back on.</Text>

      {phones.length === 0 && <Text style={styles.small}>Making keys…</Text>}
      {phones.map((p) => (
        <View key={p.name} style={styles.phone}>
          <View style={styles.row}>
            <Text style={styles.stepTitle}>{p.name}'s phone</Text>
            <View style={styles.row}>
              <Text style={styles.small}>{p.online ? 'Online' : `Offline, ${relay.pendingFor(p.name, 1)} waiting`}</Text>
              <Switch value={p.online} onValueChange={(on) => (on ? p.connect() : p.disconnect())} />
            </View>
          </View>
          {p.inbox.slice(-3).map((m) => (
            <Text key={m.envelopeId} style={styles.small}>
              {m.groupId ? 'Group · ' : ''}
              {m.from}: {m.text}
            </Text>
          ))}
          {p.errors.slice(-1).map((e) => (
            <Text key={e} style={[styles.small, styles.badText]}>
              {e}
            </Text>
          ))}
        </View>
      ))}

      <Text style={styles.label}>From</Text>
      <Chips options={NAMES} value={from} onChange={pickFrom} />
      <Text style={styles.label}>To</Text>
      <Chips options={[...NAMES.filter((n) => n !== from), 'Group']} value={to} onChange={setTo} />
      <View style={styles.row}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Type a message" />
        <Pressable style={styles.button} onPress={send}>
          <Text style={styles.buttonText}>Send</Text>
        </Pressable>
      </View>
      {error !== '' && <Text style={[styles.small, styles.badText]}>{error}</Text>}

      {last && (
        <View style={styles.server}>
          <Text style={styles.label}>What the server saw last</Text>
          <Text style={styles.mono}>
            {last.from} → {last.to}, {last.kind}
            {'\n'}
            {last.sealed.body.slice(0, 64)}…
          </Text>
        </View>
      )}
    </View>
  );
}

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.chip, o === value && styles.chipOn]}>
          <Text style={[styles.chipText, o === value && styles.chipTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fa' },
  body: { padding: 16, gap: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: '#e6e9eb' },
  title: { fontSize: 20, fontWeight: '700', color: '#111b21' },
  text: { fontSize: 14, lineHeight: 20, color: '#667781' },
  small: { fontSize: 12, lineHeight: 17, color: '#667781' },
  label: { fontSize: 12, fontWeight: '600', color: '#667781', textTransform: 'uppercase' },
  button: { backgroundColor: '#128C7E', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 18, alignItems: 'center' },
  buttonOff: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  banner: { padding: 10, borderRadius: 8, fontWeight: '600', overflow: 'hidden' },
  good: { backgroundColor: '#d9fdd3', color: '#075E54' },
  bad: { backgroundColor: '#fde2e1', color: '#c0392b' },
  goodText: { color: '#128C7E' },
  badText: { color: '#c0392b' },
  step: { flexDirection: 'row', gap: 8 },
  mark: { fontSize: 16, fontWeight: '700', width: 18 },
  stepTitle: { fontSize: 14, fontWeight: '600', color: '#111b21' },
  flex: { flex: 1, gap: 2 },
  phone: { borderWidth: 1, borderColor: '#e6e9eb', borderRadius: 10, padding: 10, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d1d7db', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#128C7E', borderColor: '#128C7E' },
  chipText: { color: '#111b21' },
  chipTextOn: { color: '#fff' },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d7db', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  server: { backgroundColor: '#f0f2f5', borderRadius: 8, padding: 10, gap: 4 },
  mono: { fontFamily: 'monospace', fontSize: 11, color: '#3b4a54' },
});
