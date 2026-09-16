// Pure data shaping. Everything the reader can change -- reference difficulty,
// display scale, selected player -- is a transform of already-shipped numbers,
// never a refit.

/**
 * Columnar JSON -> array of row objects.
 * The payload ships `{child_id: [...], theta_true: [...]}` because that is ~60%
 * smaller than an array of objects; Observable Plot wants rows.
 */
export function zip (columns) {
  if (!columns) return []
  const keys = Object.keys(columns)
  if (keys.length === 0) return []
  const n = columns[keys[0]].length
  const rows = new Array(n)
  for (let i = 0; i < n; i++) {
    const row = {}
    for (const k of keys) row[k] = columns[k][i]
    rows[i] = row
  }
  return rows
}

/** Inverse logit, matching R's plogis. */
export const plogis = (x) => 1 / (1 + Math.exp(-x))

/**
 * Linear interpolation into a player's precomputed probability curve.
 *
 * The payload ships p_j(d) on a 61-point grid rather than posterior draws. That
 * is exact to ~2e-5 under interpolation, where 200 thinned draws would carry a
 * Monte Carlo SD of 0.014 -- about half the size of the shrinkage effect the
 * story is about.
 */
export function interpolateGrid (grid, gridX, x) {
  const n = gridX.length
  if (x <= gridX[0]) return grid[0]
  if (x >= gridX[n - 1]) return grid[n - 1]
  // The grid is uniform, so find the cell directly instead of scanning.
  const step = (gridX[n - 1] - gridX[0]) / (n - 1)
  let i = Math.floor((x - gridX[0]) / step)
  if (i < 0) i = 0
  if (i > n - 2) i = n - 2
  const t = (x - gridX[i]) / (gridX[i + 1] - gridX[i])
  return grid[i] * (1 - t) + grid[i + 1] * t
}

/**
 * One arm's estimate for every player, on the requested scale.
 *
 * scale 'probability' reads the grid at d*; scale 'theta' reads the stored
 * posterior means. Both are lookups -- changing either never triggers a refit.
 */
export function armEstimates (arm, { scale, difficulty, difficultyGrid }) {
  const players = zip(arm.players)
  return players.map((p, j) => {
    if (scale === 'theta') {
      return {
        child_id: p.child_id,
        estimate: p.theta_mean,
        low: p.theta_low,
        high: p.theta_high
      }
    }
    return {
      child_id: p.child_id,
      estimate: interpolateGrid(arm.p_grid[j], difficultyGrid, difficulty),
      // plogis is monotone, so a theta interval maps straight to a probability
      // interval. No second grid needed.
      low: plogis(p.theta_low - difficulty),
      high: plogis(p.theta_high - difficulty)
    }
  })
}

/** Truth on the displayed scale. */
export function truthValues (truth, { scale, difficulty }) {
  const rows = zip(truth)
  return rows.map((r) => ({
    ...r,
    truth_value: scale === 'theta' ? r.theta_true : plogis(r.theta_true - difficulty)
  }))
}

/** The shared pooling target an arm shrinks toward, per player. */
export function borrowingTargets (arm, { scale, difficulty }) {
  if (!arm.borrowing_targets) return []
  return zip(arm.borrowing_targets).map((t) => ({
    ...t,
    target: scale === 'theta' ? t.target_mean : plogis(t.target_mean - difficulty)
  }))
}

/**
 * Accuracy of one arm against the simulated truth, on the displayed scale.
 *
 * Computed live rather than read from the exported error grid, which is fixed
 * at d* = 0 -- otherwise moving the difficulty slider would change the charts
 * and leave the scoreboard behind.
 *
 * Both MAE and RMSE are returned: RMSE punishes the occasional badly-wrong
 * player, which is exactly where no pooling suffers, so reporting only the mean
 * absolute error would understate the difference between the models.
 */
export function armAccuracy (arm, truth, { scale, difficulty, difficultyGrid }) {
  const est = armEstimates(arm, { scale, difficulty, difficultyGrid })
  const tru = truthValues(truth, { scale, difficulty })
  const byId = new Map(tru.map((t) => [t.child_id, t]))

  const rows = est.map((e) => {
    const t = byId.get(e.child_id)
    const err = e.estimate - t.truth_value
    return { child_id: e.child_id, n_train: t.n_train, error: err, abs: Math.abs(err) }
  })

  const summarize = (subset) => ({
    n: subset.length,
    mae: subset.reduce((s, r) => s + r.abs, 0) / subset.length,
    rmse: Math.sqrt(subset.reduce((s, r) => s + r.error * r.error, 0) / subset.length)
  })

  const bands = [...new Set(rows.map((r) => r.n_train))].sort((a, b) => a - b)
  return {
    overall: summarize(rows),
    byBand: bands.map((n) => ({ n_train: n, ...summarize(rows.filter((r) => r.n_train === n)) })),
    rows
  }
}

/** Accuracy for every arm of a scenario, keyed by arm id. */
export function scenarioAccuracy (scenario, opts) {
  const out = {}
  for (const [id, arm] of Object.entries(scenario.arms)) {
    out[id] = armAccuracy(arm, scenario.truth, opts)
  }
  return out
}

export const fmt = {
  p: (x) => (x == null || Number.isNaN(x) ? '--' : x.toFixed(3)),
  pct: (x) => (x == null || Number.isNaN(x) ? '--' : `${(100 * x).toFixed(1)}%`),
  theta: (x) => (x == null || Number.isNaN(x) ? '--' : x.toFixed(2))
}
