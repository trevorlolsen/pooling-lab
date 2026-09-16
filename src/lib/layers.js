/**
 * The legend, doubling as the layer controls.
 *
 * Every entry carries the colour AND the mark shape it stands for -- a filled
 * dot for a filled dot, an open ring for an open ring, a dashed rule for a
 * dashed rule -- so it works as a legend first and a control second. Clicking
 * one hides that layer.
 *
 * Turning things off is how you read a crowded chart: hide truth to judge the
 * estimates on their own, hide no-pooling to see where partial pooling landed.
 *
 * State lives in the closure rather than in global app state -- these are a
 * property of one figure, not of the reader's journey through the story.
 */

const SWATCH = {
  dot: (c) => `<circle cx="8" cy="8" r="4.5" fill="${c}"/>`,
  open: (c) => `<circle cx="8" cy="8" r="4.5" fill="none" stroke="${c}" stroke-width="1.8"/>`,
  diamond: (c) => `<path d="M8 3 L13 8 L8 13 L3 8 Z" fill="${c}"/>`,
  'diamond-open': (c) => `<path d="M8 3 L13 8 L8 13 L3 8 Z" fill="none" stroke="${c}" stroke-width="1.8"/>`,
  times: (c) => `<path d="M4 4 L12 12 M12 4 L4 12" stroke="${c}" stroke-width="2" fill="none"/>`,
  line: (c) => `<path d="M1 8 H15" stroke="${c}" stroke-width="2.5" fill="none"/>`,
  dashed: (c) => `<path d="M1 8 H15" stroke="${c}" stroke-width="2" stroke-dasharray="3 2.5" fill="none"/>`,
  rule: (c) => `<path d="M8 1 V15" stroke="${c}" stroke-width="2.5" fill="none"/>`,
  'rule-dashed': (c) => `<path d="M8 1 V15" stroke="${c}" stroke-width="2" stroke-dasharray="3 2.5" fill="none"/>`,
  area: (c) => `<rect x="1.5" y="4" width="13" height="8" rx="1.5" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-opacity="0.6"/>`,
  box: (c) => `<rect x="3" y="4.5" width="10" height="7" rx="1" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="1.4"/><path d="M1 8 H3 M13 8 H15" stroke="${c}" stroke-width="1.4"/>`
}

function swatch (marker, color) {
  const draw = SWATCH[marker] ?? SWATCH.dot
  return `<svg class="swatch-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${draw(color)}</svg>`
}

export function layerLegend (items, onChange) {
  const enabled = new Map(items.map((i) => [i.id, i.on !== false]))
  const el = document.createElement('div')
  el.className = 'legend-toggle'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', 'Chart layers')

  function paint () {
    el.innerHTML = items.map((i) => {
      const isOn = enabled.get(i.id)
      // Grey the swatch when the layer is off, so the row still reads as a
      // legend rather than turning into a list of identical grey chips.
      const colour = isOn ? (i.color ?? '#64748b') : '#c3c9d0'
      return `<button type="button"
              data-layer="${i.id}"
              aria-pressed="${isOn}"
              title="${isOn ? 'Hide' : 'Show'} ${i.label}"
            >${swatch(i.marker ?? 'dot', colour)}<span>${i.label}</span></button>`
    }).join('')
  }
  paint()

  el.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-layer]')
    if (!button) return
    const id = button.dataset.layer
    enabled.set(id, !enabled.get(id))
    paint()
    onChange(Object.fromEntries(enabled))
  })

  return { el, get: () => Object.fromEntries(enabled) }
}
