// countries.ts: the countries in "Log in with phone number", Pakistan first,
// then the ones most Pakistanis abroad live in, then the rest A to Z.

export type Country = { name: string; code: string; dial: string };

export const COUNTRIES: Country[] = [
  { name: 'Pakistan', code: 'PK', dial: '92' },
  { name: 'Saudi Arabia', code: 'SA', dial: '966' },
  { name: 'United Arab Emirates', code: 'AE', dial: '971' },
  { name: 'United Kingdom', code: 'GB', dial: '44' },
  { name: 'United States', code: 'US', dial: '1' },
  { name: 'Canada', code: 'CA', dial: '1' },
  { name: 'Qatar', code: 'QA', dial: '974' },
  { name: 'Oman', code: 'OM', dial: '968' },
  { name: 'Kuwait', code: 'KW', dial: '965' },
  { name: 'Bahrain', code: 'BH', dial: '973' },
  ...[
    { name: 'Afghanistan', code: 'AF', dial: '93' },
    { name: 'Australia', code: 'AU', dial: '61' },
    { name: 'Austria', code: 'AT', dial: '43' },
    { name: 'Bangladesh', code: 'BD', dial: '880' },
    { name: 'Belgium', code: 'BE', dial: '32' },
    { name: 'China', code: 'CN', dial: '86' },
    { name: 'Denmark', code: 'DK', dial: '45' },
    { name: 'Egypt', code: 'EG', dial: '20' },
    { name: 'France', code: 'FR', dial: '33' },
    { name: 'Germany', code: 'DE', dial: '49' },
    { name: 'Greece', code: 'GR', dial: '30' },
    { name: 'Hong Kong', code: 'HK', dial: '852' },
    { name: 'India', code: 'IN', dial: '91' },
    { name: 'Indonesia', code: 'ID', dial: '62' },
    { name: 'Iran', code: 'IR', dial: '98' },
    { name: 'Iraq', code: 'IQ', dial: '964' },
    { name: 'Ireland', code: 'IE', dial: '353' },
    { name: 'Italy', code: 'IT', dial: '39' },
    { name: 'Japan', code: 'JP', dial: '81' },
    { name: 'Jordan', code: 'JO', dial: '962' },
    { name: 'Kazakhstan', code: 'KZ', dial: '7' },
    { name: 'Kenya', code: 'KE', dial: '254' },
    { name: 'Malaysia', code: 'MY', dial: '60' },
    { name: 'Maldives', code: 'MV', dial: '960' },
    { name: 'Netherlands', code: 'NL', dial: '31' },
    { name: 'New Zealand', code: 'NZ', dial: '64' },
    { name: 'Nigeria', code: 'NG', dial: '234' },
    { name: 'Norway', code: 'NO', dial: '47' },
    { name: 'Poland', code: 'PL', dial: '48' },
    { name: 'Portugal', code: 'PT', dial: '351' },
    { name: 'Russia', code: 'RU', dial: '7' },
    { name: 'Singapore', code: 'SG', dial: '65' },
    { name: 'South Africa', code: 'ZA', dial: '27' },
    { name: 'South Korea', code: 'KR', dial: '82' },
    { name: 'Spain', code: 'ES', dial: '34' },
    { name: 'Sri Lanka', code: 'LK', dial: '94' },
    { name: 'Sweden', code: 'SE', dial: '46' },
    { name: 'Switzerland', code: 'CH', dial: '41' },
    { name: 'Thailand', code: 'TH', dial: '66' },
    { name: 'Turkey', code: 'TR', dial: '90' },
    { name: 'Uzbekistan', code: 'UZ', dial: '998' },
  ],
];

/** The flag, made of the two regional letters (a picture on most computers). */
export const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));

/** The whole number to send: "+", the country's code, then the number without its leading 0. */
export function fullNumber(c: Country, typed: string) {
  const digits = typed.replace(/\D/g, '');
  if (typed.trim().startsWith('+')) return `+${digits}`;
  return `+${c.dial}${digits.replace(/^0+/, '')}`;
}
