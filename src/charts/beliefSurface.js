import * as Plot from '@observablehq/plot'

/**
 * The complete-pooling belief over two skills at once.
 *
 * WHY THIS IS AN OUTER PRODUCT, AND WHY THAT IS THE LESSON
 *
 * stan/complete_pooling_2d.stan is:
 *
 *   parameters { vector[2] theta_shared; }
 *   theta_shared ~ normal(theta_prior_mean, theta_prior_sd);
 *   y ~ bernoulli_logit(theta_shared[skill] - difficulty);
 *
 * The prior is iid across the two components and every observation touches
 * exactly one of them, so the posterior factorises exactly:
 *
 *   p(theta1, theta2 | y) = p(theta1 | serves) * p(theta2 | receptions)
 *
 * The joint is therefore the outer product of the two 1D grid posteriors the
 * rest of the site already computes, and its contours are EXACTLY axis-aligned.
 * Complete pooling has no covariance to estimate, so it cannot represent the
 * two skills being related no matter how much data it sees. Measured: the
 * shipped Stan fit reports a posterior correlation of 0.02 on the walk-through
 * scenario and at most 0.06 across all 25, which is Monte Carlo noise around
 * zero -- against a true within-group rho of 0.5 and a marginal 0.85 that the
 * hierarchical model does estimate. The roundness is the point.
 *
 * Contours are highest-density regions of the gridded belief, matching
 * playerEllipses and populationContours. HDRs of a grid rather than of a fitted
 * normal: the factors are skewed at small n and an ellipse would quietly
 * symmetrise them.
 *
 * Always on the theta scale. A density does not survive being bent through
 * plogis without its Jacobian, and warping each axis separately would draw a
 * shape that means nothing (CLAUDE.md says this about the 2D charts generally).
 */

/** Linear interpolation of a grid density onto `n` points spanning [lo, hi]. */
function resample (density, grid, lo, hi, n) {
  const { from, dTheta } = grid
  const out = new Float64Array(n)
  const step = (hi - lo) / (n - 1)
  for (let i = 0; i < n; i++) {
    const t = lo + i * step
    const u = (t - from) / dTheta
    const j = Math.floor(u)
    if (j < 0 || j >= density.length - 1) { out[i] = 0; continue }
    const f = u - j
    out[i] = density[j] * (1 - f) + density[j + 1] * f
  }
  return out
}

/**
 * Density thresholds enclosing the given probability masses.
 *
 * Sort the cells by height, walk down accumulating mass, and record the height
 * at which each target is reached. That is what "the smallest region holding
 * 50% of the belief" means, and unlike a normal-theory ellipse it stays honest
 * when a factor is skewed.
 */
function hdrThresholds (z, cellArea, ps) {
  // Float64Array.sort is numeric and ascending; reverse for tallest-first.
  const sorted = Float64Array.from(z).sort().reverse()
  let total = 0
  for (let i = 0; i < sorted.length; i++) total += sorted[i]
  total *= cellArea
  const out = []
  let acc = 0
  let k = 0
  for (const p of [...ps].sort((a, b) => a - b)) {
    const target = p * total
    while (k < sorted.length && acc < target) { acc += sorted[k] * cellArea; k++ }
    out.push(sorted[Math.min(sorted.length - 1, Math.max(0, k - 1))])
  }
  return out // one threshold per p, descending in height as p grows
}

const COLOR = {
  belief: '#e69f00',
  ghost: '#e69f00',
  truth: '#009e73',
  axis: '#94a3b8'
}

export function beliefSurface ({
  marginals, grid, bounds, ghosts = [], levels = [0.5, 0.9],
  axis = null, labels = ['Skill 1', 'Skill 2'], truth = null,
  resolution = 121, ghostResolution = 57, width = 760, height = 420
}) {
  const [lo, hi] = bounds.x
  const [lo2, hi2] = bounds.y ?? bounds.x

  /**
   * The joint on a display grid, in the row-major form Plot.contour takes.
   *
   * Plot's grid form rather than a flat array of {x, y, value} objects: the
   * object form allocates one object per cell, which is 14641 of them per
   * redraw before any contouring starts, and this is rebuilt on every scroll
   * beat. Measured end to end, the grid form is roughly twice as fast.
   *
   * ORIENTATION. `values[j * n + i]` has i indexing x and j indexing y ASCENDING,
   * so the mark must be given `y1: lo2, y2: hi2` in that order. Passing them the
   * other way round renders the surface vertically mirrored, silently and
   * plausibly -- verified both ways, and render-test.mjs pins it with an
   * off-centre belief so it cannot come back.
   *
   * Ghosts get their own, coarser grid. A ghost is one outlined ring at 20%
   * opacity with no fill, so a quarter of the cells is indistinguishable, and
   * at full resolution an eight-ghost trail cost more than half a second.
   */
  function surface (d1, d2, n = resolution) {
    const a = resample(d1, grid, lo, hi, n)
    const b = resample(d2, grid, lo2, hi2, n)
    const values = new Float64Array(n * n)
    for (let j = 0; j < n; j++) {
      const bj = b[j]
      const row = j * n
      for (let i = 0; i < n; i++) values[row + i] = a[i] * bj
    }
    const cellArea = ((hi - lo) / (n - 1)) * ((hi2 - lo2) / (n - 1))
    return { values, cellArea, n }
  }

  /** The grid-form options every contour mark here shares. */
  const gridOpts = (n) => ({ width: n, height: n, x1: lo, y1: lo2, x2: hi, y2: hi2 })

  const marks = [Plot.frame({ stroke: '#e6e6e6' })]

  // --- ghosts: the shape of every belief already held ----------------------
  // Outline only, and only the 90% ring: filling them would stack opacity into
  // a solid block, and the trail is here to show the shape shrinking.
  for (const pair of ghosts) {
    const { values, cellArea, n } = surface(pair[0], pair[1], ghostResolution)
    const [t] = hdrThresholds(values, cellArea, [0.9])
    marks.push(Plot.contour(values, {
      ...gridOpts(n),
      thresholds: [t],
      stroke: COLOR.ghost, strokeOpacity: 0.20, strokeWidth: 1
    }))
  }

  // --- the belief now ------------------------------------------------------
  const { values, cellArea, n } = surface(marginals[0], marginals[1])
  const ts = hdrThresholds(values, cellArea, levels)
  // Widest level first so the tighter one stacks darker on top, matching
  // populationContours.
  for (let i = ts.length - 1; i >= 0; i--) {
    marks.push(Plot.contour(values, {
      ...gridOpts(n),
      thresholds: [ts[i]],
      stroke: COLOR.belief, strokeWidth: 1.5,
      fill: COLOR.belief, fillOpacity: 0.10 + 0.10 * i
    }))
  }

  // --- which axis the current play just constrained ------------------------
  // A play is a serve OR a reception, so its likelihood is a function of one
  // coordinate only. Drawing it as a rule on that axis is the honest picture:
  // this observation narrowed the belief in one direction and said nothing at
  // all about the other.
  if (axis === 1 || axis === 2) {
    const at = axis === 1 ? [lo2, hi2] : [lo, hi]
    marks.push(axis === 1
      ? Plot.ruleY([at[0] + 0.02 * (at[1] - at[0])], {
        stroke: COLOR.axis, strokeWidth: 6, strokeOpacity: 0.35
      })
      : Plot.ruleX([at[0] + 0.02 * (at[1] - at[0])], {
        stroke: COLOR.axis, strokeWidth: 6, strokeOpacity: 0.35
      }))
  }

  // --- the true population mean, which is what it is aiming at -------------
  if (truth) {
    marks.push(
      Plot.ruleX([truth.x], { stroke: COLOR.truth, strokeDasharray: '4 3', strokeWidth: 1 }),
      Plot.ruleY([truth.y], { stroke: COLOR.truth, strokeDasharray: '4 3', strokeWidth: 1 })
    )
  }

  const svg = Plot.plot({
    width,
    height,
    marginLeft: 56,
    marginBottom: 42,
    x: { domain: [lo, hi], label: `${labels[0]} ability θ₁ →`, grid: true },
    y: { domain: [lo2, hi2], label: `↑ ${labels[1]} ability θ₂`, grid: true },
    marks
  })
  // Read back by the checks: the fixed ruler is the claim, as in 1D.
  svg.__domain = [lo, hi]
  svg.__domainY = [lo2, hi2]
  return svg
}
