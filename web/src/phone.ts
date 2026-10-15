// phone.ts: turns what people type into one standard format.
//   "0300 1234567", "300 1234567" or "+92 300 1234567" -> "+923001234567"
export function toInternational(input: string) {
  const digits = input.replace(/\D/g, '').replace(/^92/, '').replace(/^0/, '')
  return '+92' + digits
}

// People log in with a phone number OR a Google (Gmail) account.
// So a friend is found by either one: "0300 1234567" or "ali@gmail.com".
export function contactKey(input: string) {
  const text = input.trim()
  return text.includes('@')
    ? ({ field: 'email', value: text.toLowerCase() } as const)
    : ({ field: 'phone', value: toInternational(text) } as const)
}
