import * as Plot from '@observablehq/plot'
import { zip } from '../lib/transforms.js'

/**
 * One player, observed more and more.
 *
 * Every other chart in the story compares different players who happen to have
 * different amounts of data. That supports a claim about a population. This
 * supports the claim a reader actually wants: as THIS person accumulates data,
 * the model stops borrowing on their behalf.
 *
 * x is log-scaled because the steps are 1, 2, 5 ... 100 and the interesting
 * movement all happens in the first handful of serves.
 */
export function convergenceTracks ({
  payload, layers = {}, width = 760, height = 420
}) {
  const on = (id) => layers[id] !== false
  const rows = []
  for (const f of payload.focal) {
    const steps = zip(f.steps)
    const label = `Player ${f.focal_id}`
    for (const s of steps) {
      rows.push({ ...s, focal: label, theta_true: f.theta_true })
    }
  }
  if (!rows.length) return Plot.plot({ width, height: 60, marks: [] })

  const facets = [...new Set(rows.map((r) => r.focal))]
  const truthRows = payload.focal.map((f) => ({
    focal: `Player ${f.focal_id}`, theta_true: f.theta_true
  }))

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  if (on('target')) {
    marks.push(
      Plot.line(rows, {
        x: 'n_keep', y: 'target_mean', fy: 'focal',
        stroke: '#94a3b8', strokeWidth: 1.2, strokeDasharray: '3 3'
      })
    )
  }

  if (on('interval')) {
    marks.push(
      Plot.areaY(rows, {
        x: 'n_keep', y1: 'no_pool_low', y2: 'no_pool_high', fy: 'focal',
        fill: '#e69f00', fillOpacity: 0.12, curve: 'monotone-x'
      }),
      Plot.areaY(rows, {
        x: 'n_keep', y1: 'partial_low', y2: 'partial_high', fy: 'focal',
        fill: '#56b4e9', fillOpacity: 0.16, curve: 'monotone-x'
      })
    )
  }

  if (on('no_pool')) {
    marks.push(
      Plot.line(rows, {
        x: 'n_keep', y: 'no_pool_mean', fy: 'focal',
        stroke: '#e69f00', strokeWidth: 2, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: 'no_pool_mean', fy: 'focal',
        r: 3.5, fill: 'none', stroke: '#e69f00', strokeWidth: 1.5,
        title: (d) => `${d.focal}, ${d.n_keep} serves\nNo pooling: ${d.no_pool_mean.toFixed(3)}`
      })
    )
  }

  if (on('partial')) {
    marks.push(
      Plot.line(rows, {
        x: 'n_keep', y: 'partial_mean', fy: 'focal',
        stroke: '#56b4e9', strokeWidth: 2.5, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: 'partial_mean', fy: 'focal',
        r: 4, fill: '#56b4e9',
        title: (d) => `${d.focal}, ${d.n_keep} serves\n` +
          `Partial pooling: ${d.partial_mean.toFixed(3)}\n` +
          `pulled ${d.shrinkage > 0 ? 'up' : 'down'} by ${Math.abs(d.shrinkage).toFixed(3)}`
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.ruleY(truthRows, {
        y: 'theta_true', fy: 'focal',
        stroke: '#009e73', strokeWidth: 1.6
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 10,
    marginBottom: 44,
    x: {
      type: 'log',
      label: 'Serves we have watched this player →',
      domain: [0.9, 110],
      ticks: payload.steps,
      tickFormat: (d) => d,
      grid: true
    },
    y: { label: 'Latent ability θ', grid: true, nice: true },
    fy: { domain: facets, label: null, axis: 'left' },
    facet: { data: rows, y: 'focal' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}

/**
 * The same sweep reduced to one number: how far the model moved this player
 * away from their own data. It should decay toward zero.
 */
export function convergenceShrinkage ({ payload, width = 760, height = 260 }) {
  const rows = []
  for (const f of payload.focal) {
    for (const s of zip(f.steps)) {
      rows.push({
        focal: `Player ${f.focal_id}`,
        n_keep: s.n_keep,
        pull: Math.abs(s.shrinkage)
      })
    }
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 12,
    marginBottom: 44,
    x: {
      type: 'log',
      label: 'Serves we have watched this player →',
      domain: [0.9, 110],
      ticks: payload.steps,
      tickFormat: (d) => d,
      grid: true
    },
    y: { label: 'How far the model moved them (θ)', zero: true, grid: true, nice: true },
    color: { legend: false },
    style: { fontSize: '12px', background: 'transparent' },
    marks: [
      Plot.frame({ stroke: '#e6e6e6' }),
      Plot.ruleY([0], { stroke: '#cbd5e1' }),
      Plot.line(rows, {
        x: 'n_keep', y: 'pull', z: 'focal',
        stroke: '#56b4e9', strokeWidth: 2, strokeOpacity: 0.75, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: 'pull', z: 'focal',
        r: 3.5, fill: '#56b4e9',
        title: (d) => `${d.focal}, ${d.n_keep} serves\nmoved ${d.pull.toFixed(3)}`
      }),
      Plot.text(rows.filter((d) => d.n_keep === Math.max(...rows.map((r) => r.n_keep))), {
        x: 'n_keep', y: 'pull', text: 'focal',
        textAnchor: 'start', dx: 8, fontSize: 10, fill: '#6b7280'
      })
    ]
  })
}
