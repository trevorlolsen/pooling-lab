import * as Plot from '@observablehq/plot'
import { plogis, zip } from '../lib/transforms.js'

/**
 * Per-player posteriors, drawn as box plots.
 *
 * A point estimate hides the mechanism. The reason a five-observation player
 * shrinks further than a thirty-observation one is that their posterior is
 * wider, and the only way to see that is to draw its spread.
 *
 * Boxes rather than violins: forty stacked densities read as overlapping smoke,
 * and the quantiles are what the reader can actually compare row to row. The
 * quartiles are shipped from R as exact sample quantiles rather than inverted
 * from a density grid on the client.
 *
 * `metaOf(childId)` must return `{ rank, facet }` or null. The facet value is
 * load-bearing: these marks carry their own data, so without it Plot draws every
 * player's box inside every facet rather than only in the one they belong to.
 */
/**
 * Whether an arm carries the quartiles a box plot needs.
 *
 * Exported so a section can SAY the posterior view is unavailable. Rendering
 * nothing leaves the toggle looking broken -- identical to the point view, with
 * no hint that the data is the problem.
 */
export function hasPosteriorQuantiles (arm) {
  const p = arm?.players
  return Boolean(p && Array.isArray(p.theta_q25) && p.theta_q25.length)
}

export function posteriorBoxes ({ arm, metaOf, scale, difficulty, halfHeight = 0.3 }) {
  if (!hasPosteriorQuantiles(arm)) return []
  const players = zip(arm.players)
  if (!players.length) return []

  // plogis is monotone, so a quantile on the theta scale maps straight to the
  // same quantile on the probability scale. No Jacobian, no resampling.
  const at = (theta) => (scale === 'theta' ? theta : plogis(theta - difficulty))

  const rows = []
  for (const p of players) {
    const meta = metaOf(p.child_id)
    if (!meta) continue
    rows.push({
      child_id: p.child_id,
      rank: meta.rank,
      facet: meta.facet,
      low: at(p.theta_low),
      q25: at(p.theta_q25),
      median: at(p.theta_median),
      q75: at(p.theta_q75),
      high: at(p.theta_high),
      halfHeight
    })
  }
  return rows
}

/** Marks for a set of box rows: whisker, box, median line. */
export function boxMarks (rows, { color, fillOpacity = 0.3, facetChannel = 'fy' } = {}) {
  if (!rows.length) return []
  const facet = (options) => (facetChannel ? { ...options, [facetChannel]: 'facet' } : options)

  return [
    // Whiskers span the 90% interval, matching every other interval in the story.
    Plot.link(rows, facet({
      x1: 'low', x2: 'high', y1: 'rank', y2: 'rank',
      stroke: color, strokeWidth: 1, strokeOpacity: 0.7
    })),
    Plot.rect(rows, facet({
      x1: 'q25', x2: 'q75',
      y1: (d) => d.rank - d.halfHeight,
      y2: (d) => d.rank + d.halfHeight,
      fill: color, fillOpacity, stroke: color, strokeWidth: 1,
      title: (d) => `Player ${d.child_id}\n` +
        `50% of the posterior: ${d.q25.toFixed(3)} to ${d.q75.toFixed(3)}\n` +
        `90%: ${d.low.toFixed(3)} to ${d.high.toFixed(3)}`
    })),
    Plot.link(rows, facet({
      x1: 'median', x2: 'median',
      y1: (d) => d.rank - d.halfHeight,
      y2: (d) => d.rank + d.halfHeight,
      stroke: color, strokeWidth: 2
    }))
  ]
}
