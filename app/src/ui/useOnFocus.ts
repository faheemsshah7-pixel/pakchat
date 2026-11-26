// useOnFocus.ts: runs `effect` while this screen is the one in front, and its cleanup when another
// screen covers it or it closes, the same as expo-router's useFocusEffect.
//
// expo-router's own version keeps a state of its own that it sets just after the screen first
// draws, so the whole screen draws a second time for nothing. In a chat that second draw landed
// a fifth of a second after opening (the 38g recording, Nov), right while the chat was coming in.
// This one keeps nothing that can redraw the screen.
import { useNavigation } from 'expo-router';
import { useEffect } from 'react';

export function useOnFocus(effect: () => void | (() => void)) {
  const navigation = useNavigation();
  useEffect(() => {
    let cleanup: void | (() => void);
    let focused = false;
    const focus = () => {
      if (focused) return;
      focused = true;
      cleanup = effect();
    };
    const blur = () => {
      if (!focused) return;
      focused = false;
      cleanup?.();
      cleanup = undefined;
    };
    if (navigation.isFocused()) focus();
    const offFocus = navigation.addListener('focus', focus);
    const offBlur = navigation.addListener('blur', blur);
    return () => {
      offFocus();
      offBlur();
      blur();
    };
  }, [effect, navigation]);
}
