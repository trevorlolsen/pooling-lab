// Exact Bayesian updating for the site's 1D model, on a theta grid.
//
// Every 1D model in this repo is  y ~ bernoulli_logit(theta - difficulty)  with
// theta ~ normal(0, 2), and the per-serve stream is already shipped in
// scenario.observations. So the exact posterior after n serves is a grid
// product and needs no Stan fit:
//
//   log p(theta | y_1..y_n) = log N(theta; 0, 2)
//                             - sum_i log1pexp( y_i ? -(theta - d_i) : (theta - d_i) )
//
// Verified against the shipped Stan posteriors -- see scripts/smoke.mjs.
//
// This module is deliberately pure: no DOM, no CSS, no import.meta.env, no
// imports at all. Check scripts import it under plain Node.

/** log(1 + exp(x)), without overflowing. Past ~33 the 1 is below the ulp. */
function log1pexp (x) {
  return x > 33.3 ? x : Math.log1p(Math.exp(x))
}

/** Logistic CDF, computed on whichever side does not overflow. */
function plogis (z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

/** The computation grid. Wider than any display domain on purpose: the widest
 *  n=5 posterior carries 2.75% of its mass outside [-5, 5]. */
export function thetaGrid ({ from = -8, to = 8, n = 1025 } = {}) {
  const theta = new Float64Array(n)
  const dTheta = (to - from) / (n - 1)
  for (let i = 0; i < n; i++) theta[i] = from + i * dTheta
  return { theta, dTheta, n, from, to }
}

/** Unnormalised log N(theta; mean, sd) -- the -z^2/2 kernel, constants dropped
 *  because normalize() divides them out anyway. */
export function logNormalPrior (grid, mean, sd) {
  const { theta, n } = grid
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const z = (theta[i] - mean) / sd
    out[i] = -0.5 * z * z
  }
  return out
}

/** Add the log-likelihood of `rows` to `logPost`, IN PLACE, and return it.
 *  Mutating matters: updateSequence calls this once per serve over 1025 points,
 *  and every caller downstream slices before it stores anything. */
export function accumulate (logPost, grid, observations, rows) {
  const { theta, n } = grid
  const d = observations.difficulty
  const y = observations.y
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k]
    const dk = d[r]
    if (y[r] === 1) {
      for (let i = 0; i < n; i++) logPost[i] -= log1pexp(-(theta[i] - dk))
    } else {
      for (let i = 0; i < n; i++) logPost[i] -= log1pexp(theta[i] - dk)
    }
  }
  return logPost
}

/** Log space -> a density integrating to 1. The max is subtracted before exp:
 *  a naive product of likelihoods underflows to all-zeros by about n=15 and the
 *  chart then silently renders a flat line. */
export function normalize (logPost, grid) {
  const { dTheta, n } = grid
  let max = -Infinity
  for (let i = 0; i < n; i++) if (logPost[i] > max) max = logPost[i]
  const out = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = Math.exp(logPost[i] - max)
    out[i] = v
    sum += v
  }
  const z = sum * dTheta
  if (z > 0) for (let i = 0; i < n; i++) out[i] /= z
  return out
}

/** Mean, sd and a pair of quantiles by Riemann sum over dTheta. Quantiles come
 *  from the cumulative sum, interpolated linearly inside the containing cell. */
export function summarize (density, grid, probs = [0.05, 0.95]) {
  const { theta, dTheta, n } = grid
  let mean = 0
  for (let i = 0; i < n; i++) mean += theta[i] * density[i]
  mean *= dTheta
  let varSum = 0
  for (let i = 0; i < n; i++) {
    const c = theta[i] - mean
    varSum += c * c * density[i]
  }
  const sd = Math.sqrt(Math.max(0, varSum * dTheta))

  // Cumulative mass at each grid point.
  const cdf = new Float64Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += density[i] * dTheta
    cdf[i] = acc
  }
  const total = acc > 0 ? acc : 1
  const quantile = (p) => {
    const target = p * total
    if (target <= cdf[0]) return theta[0]
    for (let i = 1; i < n; i++) {
      if (cdf[i] >= target) {
        const span = cdf[i] - cdf[i - 1]
        const frac = span > 0 ? (target - cdf[i - 1]) / span : 0
        return theta[i - 1] + frac * dTheta
      }
    }
    return theta[n - 1]
  }
  return { mean, sd, low: quantile(probs[0]), high: quantile(probs[1]) }
}

/** Posterior predictive success rate averaged over the given difficulties:
 *  mean over d of E[plogis(theta - d)]. This -- not plogis(E[theta]) -- is what
 *  a running sample rate converges to when difficulties vary. */
export function predictedRate (density, grid, difficulties) {
  const { theta, dTheta, n } = grid
  if (!difficulties || difficulties.length === 0) return null
  let total = 0
  for (let k = 0; k < difficulties.length; k++) {
    const dk = difficulties[k]
    let e = 0
    for (let i = 0; i < n; i++) e += plogis(theta[i] - dk) * density[i]
    total += e * dTheta
  }
  return total / difficulties.length
}

/** One serve's likelihood over theta, scaled to a maximum of 1. Display only --
 *  a likelihood is not a density and has no normalisation. */
export function likelihoodCurve (grid, difficulty, y) {
  const { theta, n } = grid
  const out = new Float64Array(n)
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const z = theta[i] - difficulty
    const v = -log1pexp(y === 1 ? -z : z)
    out[i] = v
    if (v > max) max = v
  }
  for (let i = 0; i < n; i++) out[i] = Math.exp(out[i] - max)
  return out
}

/** Absorb `rows` one serve at a time. Returns one frame per serve, plus a
 *  prior-only frame at index 0. frames[k].density IS the prior for frames[k+1].
 *
 *  Each density is sliced before it is stored -- accumulate mutates, so without
 *  the copy every frame would alias the last one. */
export function updateSequence ({ grid, prior, observations, rows }) {
  const mean = prior?.mean ?? 0
  const sd = prior?.sd ?? 2
  const logPost = logNormalPrior(grid, mean, sd)
  const frames = []

  const density0 = normalize(logPost, grid).slice()
  frames.push({
    i: -1,
    n: 0,
    difficulty: null,
    y: null,
    density: density0,
    like: null,
    summary: summarize(density0, grid),
    makes: 0,
    sampleRate: null,
    predictedRate: null
  })

  const seen = []
  let makes = 0
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k]
    const d = observations.difficulty[r]
    const y = observations.y[r]
    accumulate(logPost, grid, observations, [r])
    const density = normalize(logPost, grid).slice()
    seen.push(d)
    if (y === 1) makes++
    const n = k + 1
    frames.push({
      i: k,
      n,
      difficulty: d,
      y,
      density,
      like: likelihoodCurve(grid, d, y),
      summary: summarize(density, grid),
      makes,
      sampleRate: makes / n,
      predictedRate: predictedRate(density, grid, seen)
    })
  }
  return frames
}

/** A tiny seeded PRNG, for shuffles that must be reproducible across reloads. */
export function mulberry32 (seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
