// transcribe.ts: voice message transcripts. Your words, written out while you record a voice note,
// so the people you send it to can read it when they can't listen (Settings > Chats).
//
// It uses the browser's own speech recognition (the "Web Speech API"). Chrome, Edge and Safari
// have it; Firefox doesn't. Some browsers send your voice to their maker's servers (like Google's)
// to work out the words. That's why it's off until you switch it on.
// It only hears you while you record. It can't listen to a voice note someone sent you.

export type Language = 'en' | 'ur'
const CODES: Record<Language, string> = { en: 'en-US', ur: 'ur-PK' }

// The parts of the browser's speech recognition we use. (TypeScript doesn't know about it yet.)
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionClass = new () => Recognition

function recognitionClass() {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

// Can this browser write out speech at all?
export const canTranscribe = () => !!recognitionClass()

export const MAX_TRANSCRIPT = 4000 // letters (the same limit is in firestore.rules)

// Start listening. stop() gives back the words heard so far ('' if none, or if it didn't work).
// It never stops the voice note itself from recording: if speech recognition fails, you just get no words.
export function startTranscript(language: Language) {
  const Recognition = recognitionClass()
  const heard: string[] = []
  let listening = true
  let failed = false
  let recognition: Recognition | null = null
  let ended: (() => void) | null = null

  function listen() {
    if (!Recognition) return
    const r = new Recognition()
    r.lang = CODES[language]
    r.continuous = true // keep listening through pauses
    r.interimResults = false // only the final words, not guesses while you speak
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard.push(e.results[i][0].transcript.trim())
      }
    }
    // "no-speech" (a long pause) is fine. Anything else (no permission, no internet,
    // a language it doesn't know) means it won't work this time, so we stop trying.
    r.onerror = (e) => {
      console.warn('Transcript:', e.error)
      if (e.error !== 'no-speech' && e.error !== 'aborted') failed = true
    }
    // Browsers stop listening by themselves after a while (or a long pause). Start again while you're still recording.
    r.onend = () => {
      if (listening && !failed) listen()
      else ended?.()
    }
    try {
      r.start()
      recognition = r
    } catch (err) {
      console.warn('Transcript:', err)
      recognition = null
    }
  }
  listen()

  return {
    // Stop and wait (a moment at most) for the last words to arrive.
    stop() {
      listening = false
      return new Promise<string>((resolve) => {
        const done = () => resolve(heard.filter(Boolean).join(' ').slice(0, MAX_TRANSCRIPT))
        if (!recognition) return done()
        ended = done
        setTimeout(done, 2000) // (some browsers never say they've ended)
        recognition.stop()
      })
    },
    cancel() {
      listening = false
      recognition?.abort()
    },
  }
}
