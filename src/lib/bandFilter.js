/**
 * A filter on how much data a player has: the 5 / 10 / 20 / 30 ladder.
 *
 * Sits beside the layer legend and works the same way -- one button per band,
 * pressed while its players are drawn, click to hide them. The last band left
 * on cannot be turned off, so a reader can never empty the chart by accident;
 * a "Show all" button appears whenever anything is hidden.
 *
 * It filters CHARTS only. Takeaways and tables stay complete, per the
 * conventions in CLAUDE.md, so a hidden band never changes a quoted number.
 *
 * State lives in the closure, like the legend: it is a property of one figure,
 * not of the reader's journey through the story.
 */
export function bandFilter ({ bands, unit = 'serves', onChange }) {
  const shown = new Set(bands)
  const el = document.createElement('div')
  el.className = 'band-filter'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', `Show players by number of ${unit}`)

  function paint () {
    const all = shown.size === bands.length
    el.innerHTML = `
      <span class="band-filter-label">Show players with</span>
      <span class="seg">${bands.map((b) => {
        const isOn = shown.has(b)
        const last = isOn && shown.size === 1
        return `<button type="button" data-band="${b}" aria-pressed="${isOn}"
                  title="${last ? 'At least one band stays on' : `${isOn ? 'Hide' : 'Show'} players with ${b} ${unit}`}"
                >${b}</button>`
      }).join('')}</span>
      <span class="band-filter-unit">${unit}</span>
      <button type="button" class="band-filter-all" data-band="all" ${all ? 'hidden' : ''}>Show all</button>`
  }
  paint()

  el.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-band]')
    if (!button) return
    const band = button.dataset.band
    if (band === 'all') {
      for (const b of bands) shown.add(b)
    } else {
      const b = Number(band)
      if (shown.has(b)) {
        // Never let the last band go: an empty chart reads as a bug.
        if (shown.size === 1) return
        shown.delete(b)
      } else {
        shown.add(b)
      }
    }
    paint()
    onChange(get())
  })

  /** The bands currently drawn, in ladder order. */
  const get = () => bands.filter((b) => shown.has(b))

  return { el, get, isAll: () => shown.size === bands.length }
}

/** The observation ladder a scenario was built on, ascending. */
export function scenarioBands (scenario) {
  return [...new Set(scenario?.truth?.n_train ?? [])].sort((a, b) => a - b)
}

/** Keep only the rows whose `n_train` is in `bands`; null or undefined keeps all. */
export function keepBands (rows, bands) {
  if (!bands) return rows
  const keep = new Set(bands)
  return rows.filter((r) => keep.has(r.n_train))
}
