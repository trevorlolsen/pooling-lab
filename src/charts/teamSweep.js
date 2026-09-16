import * as Plot from '@observablehq/plot'
import { zip, plogis } from '../lib/transforms.js'

/**
 * The team you have versus the population it came from.
 *
 * Eight players are observed 5, 10 ... 1000 times each and the partial-pooling
 * model is refitted at every step. Three posteriors are tracked: the team's own
 * sample average (mean of the eight θ_i), the population mean μ, and the
 * predictive for a player nobody has seen. Four charts make one argument:
 *
 *   sweepWidths     the three interval widths against n
 *   sweepRidges     the three posteriors themselves, one row per step
 *   orderedTeams    the same sweep on 100 replicate teams, bar per team
 *   coverageCurves  how often each interval contains μ, against n
 *
 * Colours are fixed here rather than read from the arm tokens: none of these
 * three quantities is an "arm" in the index. Okabe–Ito throughout.
 */

const COLOR = {
  team: '#e69f00',
  mu: '#56b4e9',
  new: '#009e73',
  miss: '#d55e00',
  naive: '#6b7280',
  truth: '#111111',
  soft: '#94a3b8'
}

const LABEL = {
  team: "The team's sample average",
  mu: 'Population mean μ',
  new: 'An unseen player'
}

const SERIES = ['team', 'mu', 'new']

// The x axis is the same on all four charts: n per player, log-scaled, with
// the sweep's own steps as ticks.
const xSteps = (steps, label = 'Serves per player →') => ({
  type: 'log',
  label,
  domain: [steps[0] * 0.8, steps[steps.length - 1] * 1.25],
  ticks: steps,
  tickFormat: (d) => d,
  grid: true
})

const xLabelFor = (scale) => scale === 'theta'
  ? 'Latent ability θ'
  : 'Return probability at serve difficulty d* = 0.00'

/**
 * 90% interval width against n, for the sample average, μ and a new player.
 *
 * On the θ scale a dashed reference marks the floor μ's width plateaus toward:
 * with eight players the posterior for μ cannot get narrower than about
 * τ/√8 no matter how long each of them is watched, so the floor is drawn as
 * the width of a 90% normal interval with that standard error.
 *
 * When the coverage payload is given, the mean widths across the 100 replicate
 * teams are drawn as fainter dotted lines: the walk-through team is one draw
 * and these show it is a typical one. The coverage summary carries θ-scale
 * widths only, so the replicate lines appear on that scale alone.
 */
export function sweepWidths ({
  sweep, coverage = null, scale = 'theta', width = 760, height = 320, layers = {}
}) {
  const on = (id) => layers[id] !== false
  const rows = zip(sweep.steps_detail)
  if (!rows.length) return Plot.plot({ width, height: 60, marks: [] })
  const key = (id) => (scale === 'theta' ? `${id}_width` : `${id}_p_width`)
  const steps = sweep.steps ?? rows.map((r) => r.n_keep)

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  const floor = scale === 'theta' && sweep.truth?.standard_error != null
    ? 2 * 1.645 * sweep.truth.standard_error
    : null
  if (floor != null && on('floor')) {
    marks.push(
      Plot.ruleY([floor], { stroke: COLOR.soft, strokeWidth: 1.2, strokeDasharray: '4 3' }),
      // Below the rule: μ's own width sits just above it at large n.
      Plot.text([{ x: steps[steps.length - 1], y: floor }], {
        x: 'x', y: 'y', text: () => '≈ τ/√8 floor',
        textAnchor: 'end', dy: 11, fill: '#6b7280', fontSize: 11
      })
    )
  }

  // Replicates first so the walk-through team's own lines sit on top.
  const summary = coverage?.summary ? zip(coverage.summary) : []
  if (scale === 'theta' && summary.length && on('replicates')) {
    for (const id of SERIES) {
      if (!on(id)) continue
      const k = `${id}_width_mean`
      if (summary[0][k] == null) continue
      marks.push(
        Plot.line(summary, {
          x: 'n_keep', y: k,
          stroke: COLOR[id], strokeWidth: 1.4, strokeOpacity: 0.55,
          strokeDasharray: '1.5 3', curve: 'monotone-x'
        })
      )
    }
  }

  for (const id of SERIES) {
    if (!on(id)) continue
    const k = key(id)
    marks.push(
      Plot.line(rows, {
        x: 'n_keep', y: k, stroke: COLOR[id], strokeWidth: 2.5, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: k, r: 4, fill: COLOR[id],
        title: (d) => `${LABEL[id]}, ${d.n_keep} serves per player\n` +
          `90% interval width: ${d[k].toFixed(3)}`
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 64,
    marginRight: 18,
    // Room for the axis title above the top tick, which sits on the frame.
    marginTop: 28,
    marginBottom: 44,
    x: xSteps(steps),
    y: {
      label: scale === 'theta' ? 'Width of the 90% interval (θ)' : 'Width of the 90% interval (probability)',
      zero: true,
      grid: true,
      nice: true
    },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}

/**
 * The three posteriors at every step, one facet row per n.
 *
 * Each curve is scaled to its own peak: the point of the figure is WHERE each
 * posterior sits and how wide it is, and a shared density axis would let the
 * n = 1000 sample average -- a spike -- flatten every other curve to the floor.
 *
 * On the probability scale x maps through plogis and the curves keep their
 * θ-scale heights. No Jacobian is applied on purpose: these are shapes marking
 * a position and a width, not densities to integrate, and the transform is
 * monotone so the interval a curve covers is the same either way.
 */
export function sweepRidges ({
  sweep, scale = 'theta', width = 760, height = 620, layers = {}
}) {
  const on = (id) => layers[id] !== false
  const grid = sweep.density_grid ?? []
  const steps = sweep.steps ?? sweep.densities.map((d) => d.n_keep)
  if (!grid.length || !sweep.densities?.length) return Plot.plot({ width, height: 60, marks: [] })
  const toX = (t) => (scale === 'theta' ? t : plogis(t))

  const curves = { team: [], mu: [], new: [], naive: [] }
  for (const d of sweep.densities) {
    for (const id of Object.keys(curves)) {
      const y = d[id]
      if (!Array.isArray(y) || y.length !== grid.length) continue
      const peak = Math.max(...y) || 1
      for (let k = 0; k < grid.length; k++) {
        curves[id].push({ n_keep: d.n_keep, x: toX(grid[k]), y: y[k] / peak, zero: 0 })
      }
    }
  }

  const truthRows = steps.map((n) => ({
    n_keep: n,
    mu: toX(sweep.truth.mu),
    team_mean: toX(sweep.truth.team_mean)
  }))

  // The shipped grid is padded to the extreme predictive draws, which puts
  // the n = 1000 sample average -- a spike a tenth of a unit wide -- on an
  // axis twelve units long. Trim to where the three curves actually have
  // mass, keeping both truth rules in view.
  let lo = Infinity; let hi = -Infinity
  for (const id of SERIES) {
    for (const r of curves[id]) {
      if (r.y >= 0.01) { lo = Math.min(lo, r.x); hi = Math.max(hi, r.x) }
    }
  }
  for (const r of truthRows) { lo = Math.min(lo, r.mu, r.team_mean); hi = Math.max(hi, r.mu, r.team_mean) }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = toX(grid[0]); hi = toX(grid[grid.length - 1]) }
  const pad = (hi - lo) * 0.04
  const xDomain = scale === 'theta'
    ? [lo - pad, hi + pad]
    : [Math.max(0, lo - pad), Math.min(1, hi + pad)]

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  // Naive (no-pooling average of the eight) is off by default: it lands on top
  // of the partial-pooling sample average once n is large, and the story is
  // about the population level, not the estimator.
  if (layers.naive === true && curves.naive.length) {
    marks.push(
      Plot.line(curves.naive, {
        x: 'x', y: 'y', fy: 'n_keep',
        stroke: COLOR.naive, strokeWidth: 1.2, strokeDasharray: '3 3', clip: true
      })
    )
  }

  for (const id of SERIES) {
    if (!on(id) || !curves[id].length) continue
    marks.push(
      Plot.areaY(curves[id], {
        x: 'x', y1: 'zero', y2: 'y', fy: 'n_keep',
        fill: COLOR[id], fillOpacity: 0.25, clip: true
      }),
      Plot.line(curves[id], {
        x: 'x', y: 'y', fy: 'n_keep',
        stroke: COLOR[id], strokeWidth: 1.6, clip: true
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.ruleX(truthRows, {
        x: 'mu', fy: 'n_keep', stroke: COLOR.truth, strokeWidth: 1.4, strokeDasharray: '4 3',
        title: (d) => `True population mean μ = ${sweep.truth.mu.toFixed(2)}`
      })
    )
  }
  if (on('team_truth')) {
    marks.push(
      Plot.ruleX(truthRows, {
        x: 'team_mean', fy: 'n_keep', stroke: COLOR.team, strokeWidth: 1.6,
        title: (d) => `This team's true average = ${sweep.truth.team_mean.toFixed(3)}`
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 8,
    marginBottom: 44,
    x: {
      label: xLabelFor(scale),
      domain: xDomain,
      grid: true
    },
    y: { domain: [0, 1.04], axis: null, label: null },
    fy: { domain: steps, label: 'n serves per player', axis: 'left' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}

/**
 * The coverage argument, drawn: 100 replicate teams, one facet per step, each
 * team a thin bar from the low to the high end of its sample-average interval,
 * ranked by its posterior mean within the facet.
 *
 * Orange bars contain μ; red ones miss it. As n grows the bars shrink onto
 * each team's own true average and the reds take over -- a precisely known
 * team average is allowed to miss μ. The blue bars are the same teams'
 * intervals for μ itself, which stay wide enough to keep covering it.
 *
 * Rank is within the facet, not global: Plot shares the y scale across facets,
 * so a domain of 800 rows would leave each facet using an eighth of its height.
 */
export function orderedTeams ({
  coverage, walkThroughSeed = null, scale = 'theta', width = 760, height = 860, layers = {}
}) {
  const on = (id) => layers[id] !== false
  const rows = zip(coverage.teams)
  if (!rows.length) return Plot.plot({ width, height: 60, marks: [] })
  const p = scale === 'theta' ? '' : 'p_'
  const K = {
    mean: `team_${p}mean`, lo: `team_${p}low`, hi: `team_${p}high`,
    muMean: `mu_${p}mean`, muLo: `mu_${p}low`, muHi: `mu_${p}high`
  }
  const steps = coverage.steps ?? [...new Set(rows.map((r) => r.n_keep))].sort((a, b) => a - b)
  const mu = scale === 'theta' ? coverage.truth.mu : plogis(coverage.truth.mu)

  // Rank within each step by the team's posterior mean.
  const byStep = new Map()
  for (const r of rows) {
    if (!byStep.has(r.n_keep)) byStep.set(r.n_keep, [])
    byStep.get(r.n_keep).push(r)
  }
  let nTeams = 0
  for (const members of byStep.values()) {
    members.sort((a, b) => a[K.mean] - b[K.mean])
    members.forEach((r, i) => { r.rank = i + 1 })
    nTeams = Math.max(nTeams, members.length)
  }

  const colour = (d) => (d.team_covers_mu ? COLOR.team : COLOR.miss)
  const alpha = (d) => (d.team_covers_mu ? 0.55 : 0.9)
  const title = (d) => `Team ${d.seed} — ${d.n_keep} serves per player\n` +
    `sample average ${d[K.mean].toFixed(3)} [${d[K.lo].toFixed(3)}, ${d[K.hi].toFixed(3)}]\n` +
    `${d.team_covers_mu ? 'contains' : 'misses'} μ`

  const teamRows = on('miss') ? rows : rows.filter((d) => d.team_covers_mu)
  const walk = walkThroughSeed == null ? [] : rows.filter((d) => d.seed === walkThroughSeed)
  const muRows = steps.map((n) => ({ n_keep: n, mu }))

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  if (on('mu')) {
    marks.push(
      Plot.link(rows, {
        x1: K.muLo, x2: K.muHi,
        y1: (d) => d.rank + 0.35, y2: (d) => d.rank + 0.35,
        fy: 'n_keep',
        stroke: COLOR.mu, strokeWidth: 1, strokeOpacity: 0.6,
        title: (d) => `Team ${d.seed} — ${d.n_keep} serves per player\n` +
          `μ interval [${d[K.muLo].toFixed(3)}, ${d[K.muHi].toFixed(3)}]\n` +
          `${d.mu_covers_mu ? 'contains' : 'misses'} μ`
      })
    )
  }

  if (on('team')) {
    marks.push(
      Plot.link(teamRows, {
        x1: K.lo, x2: K.hi, y1: 'rank', y2: 'rank', fy: 'n_keep',
        stroke: colour, strokeOpacity: alpha, strokeWidth: 1.2, title
      }),
      Plot.dot(teamRows, {
        x: K.mean, y: 'rank', fy: 'n_keep', r: 1.4, fill: colour, fillOpacity: alpha, title
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.ruleX(muRows, { x: 'mu', fy: 'n_keep', stroke: COLOR.truth, strokeWidth: 1.4 })
    )
  }

  // The walk-through team, on top: its bar again, heavier, and a ring.
  if (on('team') && walk.length) {
    marks.push(
      Plot.link(walk, {
        x1: K.lo, x2: K.hi, y1: 'rank', y2: 'rank', fy: 'n_keep',
        stroke: colour, strokeWidth: 2.5, title
      }),
      Plot.dot(walk, {
        x: K.mean, y: 'rank', fy: 'n_keep', r: 4.5,
        stroke: COLOR.truth, strokeWidth: 1.5, fill: 'none',
        title: (d) => `Team ${d.seed} (the walk-through team)\n` +
          `sample average ${d[K.mean].toFixed(3)} at ${d.n_keep} serves per player`
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 92,
    marginRight: 18,
    marginTop: 8,
    marginBottom: 44,
    x: {
      label: xLabelFor(scale),
      domain: scale === 'theta' ? undefined : [0, 1],
      grid: true,
      nice: true
    },
    // Linear so the μ bars can sit a fraction of a row below their team.
    // Reversed so rank 1 (the lowest average) is at the top.
    y: { type: 'linear', domain: [nTeams + 1, 0], axis: null, label: null },
    // Opacity channels are scaled by default; pin the domain so the values
    // above are used as written.
    opacity: { domain: [0, 1], range: [0, 1] },
    fy: { domain: steps, label: 'n serves per player', axis: 'left' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}

/**
 * How often each 90% interval contains μ, across the 100 teams, against n.
 * Wilson 95% bounds as faint bands; the nominal 90% as a dashed rule.
 */
export function coverageCurves ({ coverage, width = 760, height = 320, layers = {} }) {
  const on = (id) => layers[id] !== false
  const rows = zip(coverage.summary)
  if (!rows.length) return Plot.plot({ width, height: 60, marks: [] })
  const steps = coverage.steps ?? rows.map((r) => r.n_keep)

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  if (on('nominal')) {
    marks.push(
      Plot.ruleY([0.9], { stroke: COLOR.soft, strokeWidth: 1.2, strokeDasharray: '4 3' }),
      Plot.text([{ x: steps[0], y: 0.9 }], {
        x: 'x', y: 'y', text: () => 'nominal 90%',
        textAnchor: 'start', dy: -7, fill: '#6b7280', fontSize: 11
      })
    )
  }

  for (const id of SERIES) {
    if (!on(id)) continue
    const k = `${id}_covers_mu`
    if (rows[0][k] == null) continue
    marks.push(
      Plot.areaY(rows, {
        x: 'n_keep', y1: `${k}_low`, y2: `${k}_high`,
        fill: COLOR[id], fillOpacity: 0.12, curve: 'monotone-x'
      }),
      Plot.line(rows, {
        x: 'n_keep', y: k, stroke: COLOR[id], strokeWidth: 2.5, curve: 'monotone-x'
      }),
      Plot.dot(rows, {
        x: 'n_keep', y: k, r: 4, fill: COLOR[id],
        title: (d) => `${LABEL[id]}, ${d.n_keep} serves per player\n` +
          `covers μ in ${(100 * d[k]).toFixed(0)}% of ${d.n_teams} teams\n` +
          `95% Wilson: ${(100 * d[`${k}_low`]).toFixed(0)}% to ${(100 * d[`${k}_high`]).toFixed(0)}%`
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 64,
    marginRight: 18,
    marginTop: 28,
    marginBottom: 44,
    x: xSteps(steps),
    y: {
      label: 'Share of teams whose 90% interval contains μ',
      domain: [0, 1],
      tickFormat: (d) => `${Math.round(d * 100)}%`,
      grid: true
    },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}
