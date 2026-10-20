import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import { SERVER_URL, checkServer } from './src/server';

// The first screen of the PakChat app. For now it only proves two things:
// the app runs on the phone, and it can reach the Phoenix server.
// Phase 4 replaces this with the real chat list.
export default function App() {
  // 'checking' while we wait, then 'up' or 'down'.
  const [status, setStatus] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    // Ask the server once when the app opens.
    checkServer().then((ok) => setStatus(ok ? 'up' : 'down'));
  }, []);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerText}>PakChat</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>The app runs</Text>
        <Text style={styles.text}>
          This is the starter screen. Your chats will live on this phone, not on the
          server.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Server</Text>
          <Text style={[styles.badge, status === 'up' ? styles.up : status === 'down' ? styles.down : styles.wait]}>
            {status === 'checking' ? 'Checking…' : status === 'up' ? 'Connected' : 'Not reachable'}
          </Text>
          <Text style={styles.small}>{SERVER_URL}</Text>
        </View>

        <Text style={styles.small}>
          If it says not reachable, start the server with "mix phx.server" in the
          server folder.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fa' },
  header: { backgroundColor: '#075E54', paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20 },
  headerText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  body: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#111b21' },
  text: { fontSize: 15, lineHeight: 22, color: '#667781' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e6e9eb',
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#667781', textTransform: 'uppercase' },
  badge: { fontSize: 16, fontWeight: '600' },
  up: { color: '#128C7E' },
  down: { color: '#c0392b' },
  wait: { color: '#667781' },
  small: { fontSize: 13, color: '#8696a0', lineHeight: 19 },
});
