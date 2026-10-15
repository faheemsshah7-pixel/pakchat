// phone.ts: turns what people type into one standard format.
//   "0300 1234567", "300 1234567" or "+92 300 1234567" -> "+923001234567"
export function toInternational(input: string) {
  const digits = input.replace(/\D/g, '').replace(/^92/, '').replace(/^0/, '')
  return '+92' + digits
}
