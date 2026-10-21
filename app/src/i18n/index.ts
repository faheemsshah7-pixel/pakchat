// useT() gives any screen the words in the chosen language, plus fill() for the gaps.
import { useLook } from '../theme/ThemeProvider';
import { en, fill, ur, type Strings } from './strings';

export { fill };
export type { Strings };

export function useT(): Strings {
  return useLook().lang === 'ur' ? ur : en;
}
