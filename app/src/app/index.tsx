// index.tsx: the app's front door. The layout decides which screens you may see
// (signed in or not); this just points at the chat list.
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(tabs)" />;
}
