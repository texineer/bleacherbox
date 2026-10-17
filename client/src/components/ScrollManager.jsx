import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Scroll position of each visited history entry, for this app session.
const positions = new Map()

// New pages open at the top; going back (or forward) returns to where you were
// scrolled. Pages load their data after mounting, so the restore retries until
// the page is tall enough (up to ~3 seconds).
export default function ScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const currentKey = useRef(location.key)

  useEffect(() => {
    const onScroll = () => positions.set(currentKey.current, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    currentKey.current = location.key
    const saved = positions.get(location.key)
    if (navigationType !== 'POP' || saved == null) {
      window.scrollTo(0, 0)
      return
    }
    let tries = 0
    let timer
    const restore = () => {
      window.scrollTo(0, saved)
      if (Math.abs(window.scrollY - saved) > 2 && tries++ < 30) timer = setTimeout(restore, 100)
    }
    restore()
    return () => clearTimeout(timer)
  }, [location.key, navigationType])

  return null
}
