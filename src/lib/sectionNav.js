// The section nav: one entry per section, built from the sections themselves.
//
// This lives in lib/ rather than main.js so the interaction harness can import
// and exercise the real thing. main.js imports styles.css and calls boot() on
// load, neither of which survives being pulled into plain Node, and a copy of
// this logic in the test would drift from the copy on the page -- which is the
// exact failure the eyebrow-derivation below exists to prevent.

/**
 * Split a section's eyebrow ("3 — One serve at a time") into its number and its
 * title. Anything that does not carry an em dash falls back to a bare title, so
 * a section module is free to change its eyebrow without breaking the nav.
 */
export function splitEyebrow (text, fallback) {
  const raw = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return { number: '', title: fallback }
  const i = raw.indexOf('—')
  if (i < 0) return { number: '', title: raw }
  return { number: raw.slice(0, i).trim(), title: raw.slice(i + 1).trim() }
}

/**
 * Build the nav from the mounted sections. One entry each, in page order.
 *
 * The labels are read off each section's own `.eyebrow` rather than kept in a
 * second list: the sections are defined by the modules in sections/, their
 * numbering by lib/sectionOrder.js, and
 * a copy of their titles here would go stale the first time one of them is
 * renumbered or retitled.
 *
 * Sections that degrade to a `.note` -- the belief sections under the two-skill toggle,
 * section 6 with no covariate -- still get an entry. They are still on the
 * page, and a nav that silently drops two of eight entries is worse than one
 * that takes the reader somewhere thin.
 *
 * Returns the entry buttons in section order, for the caller to highlight.
 */
export function buildSectionNav (nav, sectionEls, onNavigate) {
  // Rebuild, never append: mountSections() runs again on every population and
  // dimension change, and appending would stack eight more entries each time.
  nav.innerHTML = ''
  const entries = sectionEls.map((section) => {
    const eyebrow = section.querySelector('.eyebrow')
    const { number, title } = splitEyebrow(eyebrow?.textContent, section.id)

    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.target = section.id
    // The full label survives in the tooltip; the visible title is what the
    // narrow breakpoint truncates.
    button.title = number ? `${number} — ${title}` : title

    if (number) {
      const num = document.createElement('span')
      num.className = 'rail-nav-num'
      num.textContent = number
      button.appendChild(num)
    }
    const label = document.createElement('span')
    label.className = 'rail-nav-title'
    label.textContent = title
    button.appendChild(label)

    button.addEventListener('click', () => {
      // Answer the click straight away rather than waiting for the observer to
      // catch up with the scroll.
      for (const other of entries) other.removeAttribute('aria-current')
      button.setAttribute('aria-current', 'true')
      onNavigate(section, button)
    })
    nav.appendChild(button)
    return button
  })
  return entries
}

/**
 * Keep the highlighted entry in view when the nav is scrolling sideways.
 *
 * Deliberately `scrollLeft` rather than `scrollIntoView`: the latter would
 * scroll the PAGE to bring the nav entry into view, which is the opposite of
 * what a scrollspy should do while the reader is scrolling.
 */
export function keepEntryVisible (nav, entry) {
  if (!entry || nav.scrollWidth <= nav.clientWidth) return
  const pad = 12
  const left = entry.offsetLeft - pad
  const right = entry.offsetLeft + entry.offsetWidth + pad
  if (left < nav.scrollLeft) nav.scrollLeft = left
  else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth
}
