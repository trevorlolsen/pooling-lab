import * as Plot from '@observablehq/plot'
import { ellipseRows, ellipseArea } from '../lib/ellipse.js'

/**
 * One player, observed more and more, in the skill plane.
 *
 * Small multiples: a column per observation count, a row per focal player. In
 * each cell the no-pooling posterior and the partial-pooling posterior are
 * drawn as their 50% highest-density ellipses around the population target
 * and the truth. Reading left to right, the no-pooling ellipse collapses onto
 * the truth and the partial one stops leaning toward the target -- the same
 * story the 1D tracks tell, with the tilt of the ellipse adding what a single
 * skill cannot show: the model borrowing across skills.
 */
export function convergenceTracks2d ({ payload, layers = {}, width = 760, height = 420 }) {
  const on = (id) => layers[id] !== false
  const cells = cellsOf(payload)
  if (!cells.length) return Plot.plot({ width, height: 60, marks: [] })

  const focals = [...new Set(cells.map((c) => c.facet))]
  const steps = payload.steps ?? [...new Set(cells.map((c) => c.n_keep))]

  const noPoolRows = cells.flatMap((c) => ellipseRows(c.noPool, {
    id: `${c.facet}-${c.n_keep}-np`, facet: c.facet, n_keep: c.n_keep, p: 0.5
  }))
  const partialRows = cells.flatMap((c) => ellipseRows(c.partial, {
    id: `${c.facet}-${c.n_keep}-pp`, facet: c.facet, n_keep: c.n_keep, p: 0.5
  }))

  // Shared axes across every cell, padded around everything drawn, so the
  // ellipses visibly shrink from column to column instead of being rescaled.
  const xs = []; const ys = []
  for (const r of noPoolRows) { xs.push(r.x); ys.push(r.y) }
  for (const r of partialRows) { xs.push(r.x); ys.push(r.y) }
  for (const c of cells) { xs.push(c.target.x, c.truth.x); ys.push(c.target.y, c.truth.y) }
  const pad = (v) => {
    const lo = Math.min(...v); const hi = Math.max(...v)
    const m = Math.max(0.05 * (hi - lo), 0.05)
    return [lo - m, hi + m]
  }
  const xDomain = pad(xs)
  const yDomain = pad(ys)

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  if (on('no_pool')) {
    marks.push(
      Plot.line(noPoolRows, {
        x: 'x', y: 'y', z: 'id', fx: 'n_keep', fy: 'facet',
        stroke: '#e69f00', strokeWidth: 1.4, fill: 'none'
      })
    )
  }

  if (on('partial')) {
    marks.push(
      Plot.line(partialRows, {
        x: 'x', y: 'y', z: 'id', fx: 'n_keep', fy: 'facet',
        stroke: '#56b4e9', strokeWidth: 2.2, fill: '#56b4e9', fillOpacity: 0.12
      })
    )
  }

  if (on('target')) {
    marks.push(
      Plot.dot(cells, {
        x: (c) => c.target.x, y: (c) => c.target.y, fx: 'n_keep', fy: 'facet',
        r: 3, fill: '#94a3b8',
        title: (c) => `${c.facet}, ${c.n_keep} plays\nEstimated population mean μ (${c.target.x.toFixed(2)}, ${c.target.y.toFixed(2)})`
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.dot(cells, {
        x: (c) => c.truth.x, y: (c) => c.truth.y, fx: 'n_keep', fy: 'facet',
        symbol: 'times', r: 4.5, stroke: '#009e73', strokeWidth: 2,
        title: (c) => `${c.facet}\nTruth (${c.truth.x.toFixed(2)}, ${c.truth.y.toFixed(2)})`
      })
    )
  }

  const labels = payload.skill_labels ?? ['Skill 1', 'Skill 2']

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 30,
    marginBottom: 44,
    // The cells are too small for tick labels to mean anything; the axes are
    // reduced to one label per skill, and every cell shares the same domain.
    x: { domain: xDomain, ticks: [], label: `${labels[0]} ability θ₁ →`, labelAnchor: 'center' },
    y: { domain: yDomain, ticks: [], label: `${labels[1]} ability θ₂ →`, labelAnchor: 'center' },
    fx: { domain: steps, label: 'Plays we have watched this player →', tickFormat: (d) => `${d}`, axis: 'top' },
    fy: { domain: focals, label: null, axis: 'left' },
    facet: { data: cells, x: 'n_keep', y: 'facet' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}

/**
 * The same sweep reduced to one number per cell: the area of the 50% region.
 * It should fall with every step for both models, with the partial-pooling
 * region always the smaller -- that gap is the borrowed information.
 */
export function convergenceArea2d ({ payload, width = 760, height = 260 }) {
  const cells = cellsOf(payload)
  const rows = cells.map((c) => ({
    facet: c.facet,
    n_keep: c.n_keep,
    no_pool: ellipseArea(c.noPool, 0.5),
    partial: ellipseArea(c.partial, 0.5)
  }))
  if (!rows.length) return Plot.plot({ width, height: 60, marks: [] })

  const steps = payload.steps ?? [...new Set(rows.map((r) => r.n_keep))]
  const last = Math.max(...steps)

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 12,
    marginBottom: 44,
    x: {
      type: 'log',
      label: 'Plays we have watched this player →',
      domain: [Math.min(...steps) * 0.9, last * 1.1],
      ticks: steps,
      tickFormat: (d) => `${d}`,
      grid: true
    },
    y: { label: 'Area of the 50% posterior region', zero: true, grid: true, nice: true },
    style: { fontSize: '12px', background: 'transparent' },
    marks: [
      Plot.frame({ stroke: '#e6e6e6' }),
      Plot.ruleY([0], { stroke: '#cbd5e1' }),
      Plot.line(rows, {
        x: 'n_keep', y: 'no_pool', z: 'facet',
        stroke: '#e69f00', strokeWidth: 1.8, strokeDasharray: '4 3', strokeOpacity: 0.85, curve: 'monotone-x'
      }),
      Plot.line(rows, {
        x: 'n_keep', y: 'partial', z: 'facet',
        stroke: '#56b4e9', strokeWidth: 2.2, strokeOpacity: 0.85, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: 'no_pool', z: 'facet',
        r: 3, fill: 'none', stroke: '#e69f00', strokeWidth: 1.4,
        title: (d) => `${d.facet}, ${d.n_keep} plays\nNo pooling: area ${d.no_pool.toFixed(3)}`
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: 'partial', z: 'facet',
        r: 3.5, fill: '#56b4e9',
        title: (d) => `${d.facet}, ${d.n_keep} plays\nPartial pooling: area ${d.partial.toFixed(3)}`
      }),
      Plot.text(rows.filter((d) => d.n_keep === last), {
        x: 'n_keep', y: 'partial', text: 'facet',
        textAnchor: 'start', dx: 8, fontSize: 10, fill: '#6b7280'
      })
    ]
  })
}

/**
 * One record per (focal player, step): both posteriors as shapes, the target
 * and the truth as points. The joint block carries the covariances; the means
 * live in the per-skill blocks, matched by n_keep rather than by position so a
 * skill block ordered differently from the joint one still lines up.
 */
function cellsOf (payload) {
  const cells = []
  for (const f of payload.focal ?? []) {
    const joint = f.joint
    const s1 = f.skills?.[0]?.steps
    const s2 = f.skills?.[1]?.steps
    if (!joint || !s1 || !s2) continue
    const facet = `Player ${f.focal_id}`
    for (let i = 0; i < joint.n_keep.length; i++) {
      const n = joint.n_keep[i]
      const j1 = s1.n_keep.indexOf(n)
      const j2 = s2.n_keep.indexOf(n)
      if (j1 < 0 || j2 < 0) continue
      cells.push({
        facet,
        focal_id: f.focal_id,
        n_keep: n,
        noPool: {
          mean1: s1.no_pool_mean[j1], mean2: s2.no_pool_mean[j2],
          var1: joint.no_pool_var1[i], var2: joint.no_pool_var2[i], cov12: joint.no_pool_cov12[i]
        },
        partial: {
          mean1: s1.partial_mean[j1], mean2: s2.partial_mean[j2],
          var1: joint.partial_var1[i], var2: joint.partial_var2[i], cov12: joint.partial_cov12[i]
        },
        target: { x: s1.target_mean[j1], y: s2.target_mean[j2] },
        truth: { x: f.theta_true[0], y: f.theta_true[1] }
      })
    }
  }
  return cells
}
