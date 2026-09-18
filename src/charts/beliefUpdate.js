import * as Plot from '@observablehq/plot'
import { thetaGrid, frameBounds } from '../lib/bayesGrid.js'

// The palette, matched to styles.css. These are hardcoded rather than read
// from CSS custom properties because this module is imported by the headless
// check scripts, where there is no stylesheet.
const COLOR = {
  posterior: '#e69f00', // --no-pool
  prior: '#94a3b8',
  truth: '#009e73', // --truth
  complete: '#000000', // --complete
  learned: '#56b4e9', // --partial
  priorTick: '#64748b' // the prior mean, a shade darker than the prior curve
}

const MARGIN_LEFT = 64
const MARGIN_RIGHT = 20

/** Sample a grid density down to ~`target` points inside [lo, hi].
 *
 *  The computation grid is 1025 points and the ghost trail can hold thirty
 *  curves; drawing every point of every one is a megabyte of path data for a
 *  shape that is smooth at a fiftieth of the resolution. */
function curvePoints (density, grid, lo, hi, target = 240) {
  const { theta, n } = grid
  let i0 = 0
  let i1 = n - 1
  while (i0 < n - 1 && theta[i0 + 1] < lo) i0++
  while (i1 > 0 && theta[i1 - 1] > hi) i1--
  const stride = Math.max(1, Math.floor((i1 - i0) / target))
  const pts = []
  for (let i = i0; i <= i1; i += stride) pts.push({ x: theta[i], y: density[i] })
  if (pts.length === 0 || pts[pts.length - 1].x !== theta[i1]) {
    pts.push({ x: theta[i1], y: density[i1] })
  }
  return pts
}

/**
 * Which of the frames before `at` to draw as ghosts, at most `max` of them.
 *
 * Log-spaced rather than evenly spaced: the belief moves furthest over the first
 * handful of serves and barely at all over the last hundred, so even spacing
 * spends most of its budget redrawing curves that lie on top of each other.
 *
 * Returns every step when the budget is not binding, so the default of Infinity
 * reproduces the old behaviour exactly -- including the array's order, which
 * Plot turns into <path> order.
 */
function ghostSteps (at, max) {
  if (!(max < at)) return Array.from({ length: at }, (_, k) => k)
  const keep = new Set([0, at - 1])
  for (let j = 0; j < max; j++) {
    keep.add(Math.round(Math.expm1((j / (max - 1)) * Math.log1p(at - 1))))
  }
  return [...keep].filter((k) => k >= 0 && k < at).sort((a, b) => a - b)
}

const peakOf = (pts) => pts.reduce((m, p) => (p.y > m ? p.y : m), 0)

/**
 * One step of Bayesian updating: the belief so far, and the serve that is
 * about to change it.
 *
 * Returns a <div> holding exactly two <svg>s -- the belief panel first, the
 * likelihood strip second. They are two separate Plot.plot() calls on purpose.
 * A likelihood is not a density: it has no normalisation, and its y axis means
 * something else entirely. Plot facets share scales (CLAUDE.md), so faceting
 * these two would either flatten the posterior or blow up the likelihood.
 *
 * Both panels are given the same x domain and the same left margin, because
 * the whole reading of the figure is vertical: this likelihood, applied to
 * that prior, gives this posterior.
 *
 * `bounds` comes from frameBounds() over the WHOLE sequence and is the same at
 * every step. That is the whole figure: the axes are a fixed ruler, so a wide
 * low prior visibly becomes a narrow tall spike. Rescaling per step -- which
 * this chart used to do -- cancels the one thing the section teaches, because
 * the ruler shrinks with the curve. If bounds is omitted it is computed from
 * `frames` here, which is still fixed across steps; callers pass it in so the
 * `learned` extra can be counted in the height.
 */
export function beliefUpdate ({
  frames, step = 0, layers = {}, bounds = null, extras = {}, truth = null,
  grid, width = 760, height = 300, stripHeight = 90, maxGhosts = Infinity
}) {
  const on = (id) => layers[id] !== false
  const g = grid ?? thetaGrid({ n: frames[0].density.length })
  const at = Math.max(0, Math.min(step, frames.length - 1))
  const frame = frames[at]
  const prev = frames[at - 1] ?? frames[0]

  const b = bounds ?? frameBounds(frames, g, {
    extras: extras.learned ? [extras.learned] : []
  })
  const [lo, hi] = b.x
  const top = b.yTop

  const marks = []

  // --- ghosts: every belief this player has already held -------------------
  // The sequence of shapes narrowing IS the lesson of the section.
  //
  // One <path> per ghost, rebuilt on every step. Over a 30-serve player that is
  // 30 paths and nobody notices; over all 650 serves in a scenario it measured
  // 661 paths and 4 MB of SVG, rebuilt on every scroll beat. maxGhosts thins
  // them log-spaced -- dense early where the shape is changing fast, sparse
  // later where consecutive curves sit on top of each other anyway -- and the
  // most recent ghost is always kept, since it is the one the eye tracks.
  // Default Infinity: a 30-serve panel renders byte-identically to before.
  if (on('ghosts') && at > 0) {
    const ghosts = []
    for (const k of ghostSteps(at, maxGhosts)) {
      const pts = curvePoints(frames[k].density, g, lo, hi, 160)
      for (const p of pts) ghosts.push({ ...p, k })
    }
    marks.push(Plot.lineY(ghosts, {
      x: 'x',
      y: 'y',
      z: 'k',
      stroke: COLOR.posterior,
      strokeOpacity: 0.18,
      strokeWidth: 1,
      curve: 'basis'
    }))
  }

  // --- prior: the curve we are about to multiply ---------------------------
  if (on('prior')) {
    const pts = curvePoints(prev.density, g, lo, hi)
    marks.push(Plot.lineY(pts, {
      x: 'x',
      y: 'y',
      stroke: COLOR.prior,
      strokeWidth: 1.6,
      strokeDasharray: at === 0 ? null : '4 3',
      curve: 'basis'
    }))
  }

  // --- posterior: the belief after n serves --------------------------------
  if (on('posterior')) {
    const pts = curvePoints(frame.density, g, lo, hi)
    marks.push(
      Plot.areaY(pts, {
        x: 'x',
        y: 'y',
        fill: COLOR.posterior,
        fillOpacity: 0.28,
        curve: 'basis'
      }),
      Plot.lineY(pts, {
        x: 'x',
        y: 'y',
        stroke: COLOR.posterior,
        strokeWidth: 2,
        curve: 'basis'
      })
    )
  }

  // --- optional companion beliefs -----------------------------------------
  // Complete pooling does not move when the player changes; the learned prior
  // is the same machine started somewhere else. Both are passed in as
  // densities over the same grid.
  // The learned-prior belief is this player's own serves again, so it is the
  // same order of magnitude as the posterior and belongs in the height: the
  // caller hands it to frameBounds as an `extras` density.
  if (on('learned') && extras.learned) {
    const pts = curvePoints(extras.learned, g, lo, hi)
    marks.push(Plot.lineY(pts, {
      x: 'x', y: 'y', stroke: COLOR.learned, strokeWidth: 1.6, curve: 'basis'
    }))
  }

  // Complete pooling is deliberately LEFT OUT of the height (frameBounds). It is one
  // belief built from all 650 serves, so it is several times taller than
  // anything built from one player's thirty -- and letting it set the scale
  // squashes the posterior, the prior and the whole ghost trail into a smear
  // along the axis, which is the only thing this section is actually about.
  // It is clipped instead, and running off the top is a fair reading of a
  // belief that certain.
  let completeClipped = false
  if (on('complete') && extras.complete) {
    const pts = curvePoints(extras.complete, g, lo, hi)
    completeClipped = peakOf(pts) > top
    // Cut the curve with nulls rather than Plot's `clip: true`. Plot mints a
    // globally incrementing <clipPath> id per render, so a clipped mark makes
    // the same drawing serialise differently every time -- and the interaction
    // test compares outerHTML to prove that stepping back restores the chart
    // exactly. Nulls give Plot a gap, which is the same picture and is stable.
    const capped = pts.map((p) => (p.y > top ? { x: p.x, y: null } : p))
    marks.push(Plot.lineY(capped, {
      x: 'x', y: 'y', stroke: COLOR.complete, strokeWidth: 1.6, curve: 'basis'
    }))
    // Sits at 0.78 of the panel, not the top: the truth rule carries its own
    // label up there, and on a narrow viewport the two curves can be close
    // enough in x that same-height labels overlap.
    if (completeClipped && width >= 420) {
      const mode = pts.reduce((a, b) => (b.y > a.y ? b : a), pts[0])
      marks.push(Plot.text([{ x: mode.x, y: top * 0.78, t: 'complete pooling ↑' }], {
        x: 'x', y: 'y', text: 't', fill: COLOR.complete,
        fontSize: 10, textAnchor: 'start', dx: 5
      }))
    }
  }

  // --- estimates: where we started and where we stand ----------------------
  // Two ticks on the theta axis, under the curve: where the prior alone said
  // this player was (0, grey) and where the model says they are now (the
  // posterior mean, orange). The distance between them is everything the
  // serves have bought so far.
  //
  // Heights differ so that a posterior mean still sitting on 0 is two visible
  // ticks rather than one.
  if (on('estimates')) {
    const tick = (x, h, color, stroke = 2) => [
      Plot.ruleX([{ x }], {
        x: 'x', y1: () => 0, y2: () => top * h, stroke: color, strokeWidth: stroke
      }),
      Plot.dot([{ x, y: top * h }], { x: 'x', y: 'y', fill: color, r: 2.6 })
    ]
    marks.push(...tick(0, 0.06, COLOR.priorTick, 1.6))
    marks.push(...tick(frame.summary.mean, 0.14, COLOR.posterior))
  }

  if (on('truth') && Number.isFinite(truth)) {
    marks.push(
      Plot.ruleX([truth], { stroke: COLOR.truth, strokeWidth: 1.6 }),
      Plot.text([truth], {
        x: (d) => d,
        y: () => top * 0.96,
        text: () => 'true ability',
        fill: COLOR.truth,
        fontSize: 10,
        fontWeight: 600,
        dx: 4,
        textAnchor: 'start'
      })
    )
  }

  marks.push(Plot.ruleY([0], { stroke: '#cbd5e1' }))

  const belief = Plot.plot({
    width,
    height,
    marginLeft: MARGIN_LEFT,
    marginRight: MARGIN_RIGHT,
    marginTop: 22,
    marginBottom: 36,
    x: { label: 'Latent ability θ', domain: [lo, hi], grid: true },
    y: { label: null, domain: [0, top], ticks: [], axis: null },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })

  // --- the likelihood strip ------------------------------------------------
  // Scaled to a maximum of 1 and deliberately unlabelled on y: the height means
  // nothing, only the shape does. Empty before the first serve.
  const stripMarks = []
  if (frame.like) {
    const pts = curvePoints(frame.like, g, lo, hi)
    stripMarks.push(
      Plot.lineY(pts, {
        x: 'x',
        y: 'y',
        stroke: frame.y === 1 ? COLOR.posterior : '#6b7280',
        strokeWidth: 2,
        curve: 'basis'
      }),
      Plot.ruleX([frame.difficulty], { stroke: '#cbd5e1', strokeDasharray: '3 3' }),
      Plot.text([frame.difficulty], {
        x: (d) => d,
        y: () => 0.92,
        text: () => `serve ${frame.n}: ${frame.y === 1 ? 'made' : 'missed'} at d = ${frame.difficulty.toFixed(2)}`,
        fill: '#374151',
        fontSize: 11,
        dx: 6,
        textAnchor: 'start'
      })
    )
  } else {
    stripMarks.push(Plot.text([0], {
      x: () => (lo + hi) / 2,
      y: () => 0.5,
      text: () => 'no serve yet — this is what we believed beforehand',
      fill: '#9ca3af',
      fontSize: 11
    }))
  }

  const strip = Plot.plot({
    width,
    height: stripHeight,
    marginLeft: MARGIN_LEFT,
    marginRight: MARGIN_RIGHT,
    marginTop: 8,
    marginBottom: 20,
    x: { domain: [lo, hi], axis: null, label: null },
    y: { domain: [0, 1.08], axis: null, label: null },
    style: { fontSize: '12px', background: 'transparent' },
    marks: stripMarks
  })

  const svgOf = (fig) => (fig.tagName === 'svg' ? fig : fig.querySelector('svg'))
  const beliefSvg = svgOf(belief)
  const stripSvg = svgOf(strip)

  // The resolved domain is asserted on directly: a headless check cannot see
  // that a curve ran off the edge, but it can read the number that decided it.
  beliefSvg.__domain = [lo, hi]
  beliefSvg.__yTop = top

  const wrap = document.createElement('div')
  wrap.className = 'belief-update'
  wrap.appendChild(beliefSvg)
  wrap.appendChild(stripSvg)
  return wrap
}
