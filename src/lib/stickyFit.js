// How tall a chart pinned in a `.scrolly-graphic` column is allowed to be.
//
// A pinned graphic has to fit between the bottom of the sticky rail and the
// bottom of the window, and it is not just the chart in there: the legend, the
// band filter, the caption, the likelihood strip, the panel's padding and the
// column's own padding all take space above and below it.
//
// Both sticky sections used to subtract a hardcoded constant from
// window.innerHeight -- 190 in shrinkage, 290 in belief -- tuned by eye against
// whatever the rail happened to measure at the time. Adding the section nav
// made the rail a row taller and shrinkage's pinned column overflowed the
// window by exactly 182px at every viewport height, because the constant could
// not know the rail had changed.
//
// So: no constants. The rail publishes its live height as --rail-h (main.js),
// and the furniture is measured off the DOM rather than guessed.

/** The pinned column's chrome: everything in it that is not the chart. */
function chromeAround (graphic, chartEl) {
  const column = graphic.getBoundingClientRect().height
  const chart = chartEl.getBoundingClientRect().height
  // Before the first render the chart box is empty, so the column IS the
  // chrome; afterwards the difference is. Both give the same answer.
  return Math.max(0, column - chart)
}

/**
 * The height to hand a chart that lives in a pinned column.
 *
 * `min` keeps it legible on a short window even if that means the column
 * overflows a little -- a chart squeezed to 200px teaches nothing. `max` stops
 * a tall monitor from stretching a chart past the point where it reads well.
 * Returns `fallback` under jsdom, where there is no layout to measure.
 *
 * `reserve` is for a container that holds more than the one chart being sized:
 * section 3's chart box carries the belief panel AND a 90px likelihood strip,
 * and only the panel's height is being asked for. It comes off before `min`
 * and `max` apply, so those stay expressed in the units the caller cares
 * about -- the panel -- rather than in box-minus-strip.
 */
export function stickyChartHeight (
  chartEl, { min = 320, max = Infinity, fallback = 420, gap = 16, reserve = 0 } = {}
) {
  if (typeof window === 'undefined' || !chartEl?.closest) return fallback
  const graphic = chartEl.closest('.scrolly-graphic')
  if (!graphic) return fallback

  const railH = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--rail-h')) || 96
  const available =
    window.innerHeight - railH - gap - chromeAround(graphic, chartEl) - reserve
  if (!Number.isFinite(available)) return fallback
  return Math.round(Math.max(min, Math.min(max, available)))
}
