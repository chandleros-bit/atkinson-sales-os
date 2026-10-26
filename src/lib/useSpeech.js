// Dictation through the browser's own speech recognition (Chrome, Edge, iPhone
// and Mac Safari). No service of ours, no cost. One utterance per start():
// interim words show as you speak; the final text goes to onFinal.
import { useCallback, useEffect, useRef, useState } from 'react'

const Recognition = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null)

export const speechSupported = () => !!Recognition()

const ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it for this site in the browser settings.',
  'service-not-allowed': 'Microphone access is blocked. Allow it for this site in the browser settings.',
  'no-speech': "Didn't hear anything. Tap the mic and try again.",
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection.',
}

export function useSpeech({ onFinal }) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const rec = useRef(null)
  const finalCb = useRef(onFinal)
  finalCb.current = onFinal

  const stop = useCallback(() => rec.current?.stop(), [])

  const start = useCallback(() => {
    const R = Recognition()
    if (!R) {
      setError("This browser can't take dictation. Use your keyboard's mic in + Work item.")
      return
    }
    rec.current?.abort()
    const r = new R()
    r.lang = 'en-US'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    let heard = ''
    r.onresult = (e) => {
      let text = ''
      let done = false
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
        if (e.results[i].isFinal) done = true
      }
      heard = text.trim()
      setInterim(heard)
      if (done) r.stop()
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] || `Dictation stopped (${e.error}).`)
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
      if (heard) finalCb.current?.(heard)
    }
    rec.current = r
    setError(null)
    setInterim('')
    setListening(true)
    r.start()
  }, [])

  useEffect(() => () => rec.current?.abort(), [])

  return { listening, interim, error, start, stop }
}
