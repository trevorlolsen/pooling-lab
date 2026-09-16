import * as Plot from '@observablehq/plot'
import { armEstimates, truthValues, plogis } from '../lib/transforms.js'
import { posteriorBoxes, boxMarks } from './posteriorBoxes.js'
import { keepBands } from '../lib/bandFilter.js'

/**
 * The flagship: one row per player, banded by how many serves that player
 * has, showing where each model puts them. This chart is 1D-only, so the unit
 * is always "serves"; the 2D sibling (playerEllipses) says "plays".
 *
 * The segment from the no-pooling estimate to the partial-pooling estimate IS
 * the shrinkage. Players with less information have visibly longer segments --
 * that is the whole argument, drawn.
 *
 * `step` drives a progressive reveal so the chart can carry a multi-beat
 * argument while staying pinned:
 *   0  no pooling alone            -- "trust each player's own data"
 *   1  + complete pooling line     -- "or trust none of it"
 *   2  + partial pooling, segments -- "partial pooling moves each one"
 *   3  + band emphasis             -- "and it moves the sparse ones furthest"
 *   4  + truth                     -- "was it right?"
 *
 * `bands` is the reader's filter on observation count: an array of n_train
 * values to draw, or null for everyone. A hidden band loses its facet too.
 */
export function playerRows ({
  scenario, index, tokens, scale, difficulty, step = 4, view = 'point',
  layers = {}, bands = null, selectedPlayer, onSelect, width = 760, maxHeight = null
}) {
  // A layer is drawn when the reader has it enabled AND the scroll step has
  // reached it. The step controls the reveal; the toggle controls what is
  // available to reveal. Neither overrides the other.
  const on = (id, atStep = 0) => layers[id] !== false && step >= atStep
  const grid = index.difficulty_grid
  const opts = { scale, difficulty, difficultyGrid: grid }

  const noPool = new Map(armEstimates(scenario.arms.no_pool, opts).map((d) => [d.child_id, d]))
  const partial = new Map(armEstimates(scenario.arms.none, opts).map((d) => [d.child_id, d]))
  const complete = armEstimates(scenario.arms.complete, opts)
  const truth = truthValues(scenario.truth, opts)

  // Complete pooling gives every player the same value; one reference line.
  const completeValue = complete.length ? complete[0].estimate : null

  // The true population mean, which is what every estimate is trying to be
  // near on average. Without it the reader can see movement but not whether the
  // model is aiming at the right place.
  const trueMean = scale === 'theta'
    ? scenario.population.overall_mean
    : plogis(scenario.population.overall_mean - difficulty)

  const rows = keepBands(truth, bands).map((t) => {
    const np = noPool.get(t.child_id)
    const pp = partial.get(t.child_id)
    return {
      child_id: t.child_id,
      n_train: t.n_train,
      band: `${t.n_train} serves`,
      truth: t.truth_value,
      no_pool: np?.estimate,
      partial: pp?.estimate,
      shrinkage: Math.abs((pp?.estimate ?? 0) - (np?.estimate ?? 0)),
      selected: t.child_id === selectedPlayer
    }
  })

  // Position each player by their rank WITHIN their own band, not by a global
  // ordering.
  //
  // Plot shares scales across facets. A y domain of all 40 player ids means
  // every facet inherits all 40 slots, and because the ordering puts each band
  // together, a band's ten players land in one contiguous tenth of the axis with
  // the other thirty slots empty. Ranking within the band gives all four facets
  // the same short axis, so each one fills its height.
  const byBand = new Map()
  for (const row of rows) {
    if (!byBand.has(row.band)) byBand.set(row.band, [])
    byBand.get(row.band).push(row)
  }
  let widestBand = 0
  for (const members of byBand.values()) {
    // Within a band, order by the no-pooling estimate so movement is easy to
    // compare between neighbouring rows.
    members.sort((a, b) => a.no_pool - b.no_pool)
    members.forEach((row, i) => { row.rank = i + 1 })
    widestBand = Math.max(widestBand, members.length)
  }
  const order = Array.from({ length: widestBand }, (_, i) => i + 1)

  const xLabel = scale === 'theta'
    ? 'Latent ability θ'
    : `Return probability at serve difficulty d* = ${difficulty.toFixed(2)}`

  const bandLabels = [...new Set(rows.map((d) => d.band))]
    .sort((a, b) => parseInt(a) - parseInt(b))

  // Step 3 lights the sparsest band SHOWN and dims the rest. If the reader has
  // hidden the five-serve players, the next band up is the one that stands out.
  const emphasisBand = step === 3 ? bandLabels[0] : null
  const dim = (d) => (emphasisBand && d.band !== emphasisBand ? 0.18 : 1)

  const marks = [
    Plot.frame({ stroke: '#e6e6e6' })
  ]

  if (on('complete', 1) && completeValue != null) {
    marks.push(
      Plot.ruleX([completeValue], {
        stroke: tokens.get('complete').color,
        strokeWidth: 1.5,
        strokeDasharray: '4 3'
      })
    )
  }

  if (on('partial', 2)) {
    marks.push(
      Plot.link(rows, {
        x1: 'no_pool',
        x2: 'partial',
        y1: 'rank',
        y2: 'rank',
        stroke: '#9ca3af',
        strokeWidth: 1.5,
        opacity: dim
      })
    )
  }

  if (view === 'posterior') {
    // Carry the band through so each violin lands in its own facet. Without it
    // Plot draws all forty players inside every band.
    const byId = new Map(rows.map((r) => [r.child_id, r]))
    const metaOf = (childId) => {
      const row = byId.get(childId)
      return row ? { rank: row.rank, facet: row.band } : null
    }
    const bopts = { metaOf, scale, difficulty }
    if (on('no_pool')) {
      marks.push(...boxMarks(
        posteriorBoxes({ arm: scenario.arms.no_pool, ...bopts }),
        { color: tokens.get('no_pool').color, fillOpacity: 0.18 }
      ))
    }
    if (on('partial', 2)) {
      marks.push(...boxMarks(
        posteriorBoxes({ arm: scenario.arms.none, ...bopts }),
        { color: tokens.get('none').color, fillOpacity: 0.3 }
      ))
    }
  }

  if (on('no_pool')) marks.push(
    Plot.dot(rows, {
      x: 'no_pool',
      y: 'rank',
      r: 4,
      stroke: tokens.get('no_pool').color,
      strokeWidth: 1.6,
      fill: 'none',
      opacity: dim,
      title: (d) => `Player ${d.child_id} — ${d.n_train} serves\nNo pooling: ${d.no_pool?.toFixed(3)}`
    })
  )

  if (on('partial', 2)) {
    marks.push(
      Plot.dot(rows, {
        x: 'partial',
        y: 'rank',
        r: 4,
        fill: tokens.get('none').color,
        opacity: dim,
        title: (d) => `Player ${d.child_id} — ${d.n_train} serves\n` +
          `Partial pooling: ${d.partial?.toFixed(3)}\nMoved ${d.shrinkage.toFixed(3)}`
      })
    )
  }

  if (on('truth', 4)) {
    marks.push(
      Plot.dot(rows, {
        x: 'truth',
        y: 'rank',
        symbol: 'times',
        r: 4,
        stroke: index.truth_color,
        strokeWidth: 2,
        opacity: dim,
        title: (d) => `Player ${d.child_id}\nTruth: ${d.truth?.toFixed(3)}`
      })
    )
  }

  if (trueMean != null && on('true_mean', 4)) {
    marks.push(
      Plot.ruleX([trueMean], {
        stroke: index.truth_color,
        strokeWidth: 1.5,
        strokeDasharray: '2 3'
      })
    )
  }

  // Selection ring, drawn last so it sits on top. It follows the partial
  // estimate once that is drawn, and the no-pooling estimate before then --
  // otherwise at steps 0 and 1 the ring circles an empty spot on the axis.
  const selected = rows.filter((d) => d.selected)
  if (selected.length) {
    const showPartial = on('partial', 2)
    marks.push(
      Plot.dot(selected, {
        x: showPartial ? 'partial' : 'no_pool',
        y: 'rank', r: 8, stroke: '#111', strokeWidth: 1.5, fill: 'none'
      })
    )
  }

  // Vertical room is the binding constraint here: the chart is pinned, so it has
  // to fit the viewport, but 40 rows want space to breathe. Take everything the
  // viewport allows, then let Plot distribute it.
  //
  // `maxHeight` comes from the section, which knows what the rail, legend and
  // caption are costing. The fallback keeps jsdom deterministic.
  const ideal = 30 * bandLabels.length + 19 * rows.length
  const ceiling = maxHeight ?? 640
  const height = Math.max(460, Math.min(ideal, ceiling))

  const figure = Plot.plot({
    width,
    height,
    // Band labels live in the left margin, so it has to be wide enough for
    // "30 serves". The y axis is hidden, so this space is otherwise idle
    // -- and a label you read before the data beats one you read after it.
    marginLeft: 120,
    marginRight: 16,
    marginTop: 6,
    marginBottom: 34,
    x: {
      label: xLabel,
      domain: scale === 'theta' ? index.domains.theta : [0, 1],
      grid: true,
      nice: true
    },
    y: {
      // Linear, not ordinal: a violin has to straddle its row by a continuous
      // offset, which a point scale cannot express. Reversed so rank 1 is top.
      type: 'linear',
      domain: [widestBand + 0.6, 0.4],
      label: null,
      ticks: [],
      axis: null
    },
    fy: {
      domain: bandLabels,
      label: null,
      axis: 'left'
    },
    facet: { data: rows, y: 'band' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })

  // Click selects a player globally. Selection must work by tap, not hover.
  if (onSelect) {
    figure.addEventListener('click', (event) => {
      const target = event.target
      const title = target?.querySelector?.('title')?.textContent ??
        target?.parentNode?.querySelector?.('title')?.textContent
      const match = title?.match(/Player (\d+)/)
      if (match) onSelect(Number(match[1]))
    })
    figure.style.cursor = 'pointer'
  }

  return figure
}
