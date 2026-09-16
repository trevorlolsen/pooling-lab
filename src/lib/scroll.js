// Scroll plumbing: lazy rendering, and step tracking for sticky-graphic
// sections.

/**
 * Render a section the first time it comes near the viewport, then stop
 * watching it.
 *
 * Without this every chart on the page renders on load. The page holds a dozen
 * of them, most of which the reader may never reach.
 */
export function renderWhenNear (el, render, { rootMargin = '200px 0px' } = {}) {
  if (!('IntersectionObserver' in window)) { render(); return () => {} }
  let done = false
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !done) {
        done = true
        io.disconnect()
        render()
      }
    }
  }, { rootMargin })
  io.observe(el)
  return () => io.disconnect()
}

/**
 * Track which step of a sticky-graphic section the reader is on.
 *
 * Steps are prose blocks that scroll past a pinned chart. The callback fires
 * with the index of the step currently crossing the middle of the viewport, and
 * only when that index changes -- so a chart updates once per step rather than
 * on every scroll event.
 */
export function trackSteps (stepEls, onStep) {
  if (!stepEls.length) return () => {}
  let current = -1
  const fire = (i) => {
    if (i !== current) { current = i; onStep(i) }
  }

  if (!('IntersectionObserver' in window)) { fire(0); return () => {} }

  const io = new IntersectionObserver((entries) => {
    // Pick the visible step nearest the middle of the viewport. Several can be
    // intersecting at once on a tall screen.
    const mid = window.innerHeight / 2
    let best = null
    let bestDist = Infinity
    for (const el of stepEls) {
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) continue
      const dist = Math.abs(r.top + r.height / 2 - mid)
      if (dist < bestDist) { bestDist = dist; best = el }
    }
    if (best) fire(stepEls.indexOf(best))
  }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-10% 0px -10% 0px' })

  for (const el of stepEls) io.observe(el)
  fire(0)
  return () => io.disconnect()
}

/** Progress rail: which section is currently in view. */
export function trackSections (sectionEls, onSection) {
  if (!('IntersectionObserver' in window)) return () => {}
  let current = -1
  const io = new IntersectionObserver((entries) => {
    let best = null
    let bestTop = Infinity
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const top = Math.abs(e.boundingClientRect.top)
      if (top < bestTop) { bestTop = top; best = e.target }
    }
    if (best) {
      const i = sectionEls.indexOf(best)
      if (i !== current) { current = i; onSection(i) }
    }
  }, { rootMargin: '-45% 0px -45% 0px' })
  for (const el of sectionEls) io.observe(el)
  return () => io.disconnect()
}
