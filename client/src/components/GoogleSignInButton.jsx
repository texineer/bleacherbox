import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { authConfig } from '../api'

const GSI_SRC = 'https://accounts.google.com/gsi/client'

// Load Google Identity Services once and resolve with window.google.
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${GSI_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = GSI_SRC
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', () => resolve(window.google))
    script.addEventListener('error', reject)
  })
}

// "Continue with Google" button plus an "or use email" divider. Renders nothing
// until the server reports a Google client ID and the Google script loads.
// Calls onStart before signing in, then onDone with the sign-in result
// ({ user, roles } or { pending, message }) or onError with the thrown error.
export default function GoogleSignInButton({ onStart, onDone, onError }) {
  const [ready, setReady] = useState(false)
  const buttonRef = useRef(null)
  const { loginWithGoogle } = useAuth()

  // Keep the latest callbacks without re-rendering the Google button.
  const handlers = useRef({ onStart, onDone, onError })
  useEffect(() => { handlers.current = { onStart, onDone, onError } })

  useEffect(() => {
    let cancelled = false
    authConfig()
      .then(({ googleClientId }) => {
        if (!googleClientId) return
        return loadGsi().then(google => {
          if (cancelled || !buttonRef.current) return
          google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async ({ credential }) => {
              handlers.current.onStart?.()
              try {
                handlers.current.onDone?.(await loginWithGoogle(credential))
              } catch (err) {
                handlers.current.onError?.(err)
              }
            },
          })
          google.accounts.id.renderButton(buttonRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: buttonRef.current.offsetWidth || 320,
          })
          setReady(true)
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [loginWithGoogle])

  return (
    <div style={{ display: ready ? 'block' : 'none' }}>
      <div ref={buttonRef} className="flex justify-center" />
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--navy-muted)' }}>
          or use email
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      </div>
    </div>
  )
}
