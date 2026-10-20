import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

import SpikeScreen from './src/spike/SpikeScreen';

// Phase 1: the app only shows the encryption test.
// Phase 4 replaces this with the real chat list.
export default function App() {
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.headerText}>PakChat</Text>
      </View>
      <SpikeScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fa' },
  header: { backgroundColor: '#075E54', paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20 },
  headerText: { color: '#fff', fontSize: 20, fontWeight: '600' },
});
