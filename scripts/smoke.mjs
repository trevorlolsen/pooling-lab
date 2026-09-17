// Data-contract smoke test: exercise the client's transforms against the real
// published JSON, without a browser.
//
// This is the seam most likely to break -- the R build and the JS client agree
// on a shape by convention, and nothing else checks that they still do.
//
//   node scripts/smoke.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import {
  zip, interpolateGrid, armEstimates, borrowingTargets
} from '../src/lib/transforms.js'
import {
  thetaGrid, logNormalPrior, accumulate, normalize, summarize, predictedRate, updateSequence,
  mulberry32, frameBounds, mleSequence
} from '../src/lib/bayesGrid.js'

const D = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const read = (p) => JSON.parse(readFileSync(join(D, p), 'utf8'))

const index = read('index.json')
const sc = read('scenarios/distinct__20260914.json')
const grid = index.difficulty_grid

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL:', msg); fails++ } }

console.log('index: %d populations, %d arms, %d grid points, theta domain [%s]',
  index.populations.length, index.arms.length, grid.length, index.domains.theta.join(', '))

// --- columnar -> rows ---------------------------------------------------
const truth = zip(sc.truth)
ok(truth.length === 40, `truth should have 40 rows, got ${truth.length}`)
ok(truth[0].child_id === 1, 'first child_id should be 1')
ok(typeof truth[0].theta_true === 'number', 'theta_true should be numeric')
ok(zip(null).length === 0, 'zip(null) should be empty, not throw')

// --- grid interpolation -------------------------------------------------
const zeroIdx = grid.indexOf(0)
ok(zeroIdx >= 0, 'grid must contain an exact 0')
for (const j of [0, 17, 39]) {
  const exact = sc.arms.none.p_grid[j][zeroIdx]
  const interp = interpolateGrid(sc.arms.none.p_grid[j], grid, 0)
  ok(Math.abs(exact - interp) < 1e-12, `interpolation at d*=0 must hit the grid point (player ${j})`)
}
for (const j of [0, 20]) {
  const a = interpolateGrid(sc.arms.none.p_grid[j], grid, -0.73)
  const b = interpolateGrid(sc.arms.none.p_grid[j], grid, 0)
  const c = interpolateGrid(sc.arms.none.p_grid[j], grid, 0.77)
  ok(a > b && b > c, `return probability must fall as the serve gets harder (player ${j})`)
  ok(a <= 1 && c >= 0, 'probabilities stay in range')
}
// clamping past the ends
ok(interpolateGrid(sc.arms.none.p_grid[0], grid, -99) === sc.arms.none.p_grid[0][0],
  'below the grid clamps to the first point')
ok(interpolateGrid(sc.arms.none.p_grid[0], grid, 99) === sc.arms.none.p_grid[0][grid.length - 1],
  'above the grid clamps to the last point')

// --- estimates on both scales -------------------------------------------
for (const scale of ['probability', 'theta']) {
  const est = armEstimates(sc.arms.none, { scale, difficulty: 0, difficultyGrid: grid })
  ok(est.length === 40, `${scale}: 40 estimates`)
  ok(est.every((e) => e.low <= e.estimate + 1e-9 && e.estimate <= e.high + 1e-9),
    `${scale}: every estimate sits inside its own interval`)
}

// --- the client must agree with the exported comparison frame -----------
// If these drift, two charts on one page show different numbers for one player.
const cmp = zip(sc.derived.comparison).filter((r) => r.result_id === 'none')
const est = armEstimates(sc.arms.none, { scale: 'probability', difficulty: 0, difficultyGrid: grid })
let worst = 0
for (const row of cmp) {
  const mine = est.find((e) => e.child_id === row.child_id).estimate
  worst = Math.max(worst, Math.abs(mine - row.estimate))
}
ok(worst < 1e-3, `client estimate must match the exported comparison (worst ${worst})`)
console.log('client vs exported comparison: worst difference %s', worst.toExponential(2))

// --- borrowing targets --------------------------------------------------
const bNone = borrowingTargets(sc.arms.none, { scale: 'theta', difficulty: 0 })
const bCorrect = borrowingTargets(sc.arms.correct, { scale: 'theta', difficulty: 0 })
const distinctTargets = (b) => new Set(b.map((t) => t.target.toFixed(6))).size
ok(distinctTargets(bNone) === 1, 'partial pooling shrinks everyone toward one target')
ok(distinctTargets(bCorrect) === 2, 'the correct covariate splits that into one target per group')
console.log('borrowing targets: none=%d distinct, correct=%d distinct',
  distinctTargets(bNone), distinctTargets(bCorrect))

// --- bayesian updating grid reproduces the shipped posteriors ------------
//
// The section-3 walk-through does not read a precomputed frame: it recomputes
// the posterior in the browser, one serve at a time, from `observations`. That
// is only honest if the arithmetic lands on the same answer Stan did, so this
// checks it against EVERY scenario -- 25 payloads, 40 players each.
//
// On the per-player bounds: they look loose because a handful of n=5 players
// are near-separated (0 or 5 makes), and their posteriors are strongly skewed
// with a long tail. There the 4,000-draw MCMC summary is the noisier of the
// two, not the grid -- widening the grid to [-20, 20] moves the grid's answer
// by 0.002 while the gap to Stan stays at 0.088. So the per-player bound
// tolerates those outliers and the MEDIAN bound below is what actually pins
// the arithmetic: a wrong likelihood, prior or serve order shifts every
// player at once, which a median of 1,000 comparisons catches immediately.
{
  const g = thetaGrid()
  const rowsByChild = (o) => {
    const m = new Map()
    for (let i = 0; i < o.child_id.length; i++) {
      if (!m.has(o.child_id[i])) m.set(o.child_id[i], [])
      m.get(o.child_id[i]).push(i)
    }
    return m
  }

  let dm = 0; let ds = 0; let dq = 0; let dc = 0; let de = 0
  const meanDevs = []
  let scenarios = 0

  for (const p of index.populations) {
    for (const id of p.scenario_ids) {
      const s = read(`scenarios/${id}.json`)
      const o = s.observations
      const rowsFor = rowsByChild(o)
      const post = (rows, mean, sd) =>
        summarize(normalize(accumulate(logNormalPrior(g, mean, sd), g, o, rows), g), g)
      scenarios++

      // No pooling: prior N(0,2), this player's serves only.
      const np = s.arms.no_pool.players
      for (let k = 0; k < np.child_id.length; k++) {
        const t = post(rowsFor.get(np.child_id[k]), 0, 2)
        const dev = Math.abs(t.mean - np.theta_mean[k])
        meanDevs.push(dev)
        dm = Math.max(dm, dev)
        ds = Math.max(ds, Math.abs(t.sd - np.theta_sd[k]))
        dq = Math.max(dq, Math.abs(t.low - np.theta_low[k]), Math.abs(t.high - np.theta_high[k]))
      }

      // Complete pooling: prior N(0,2), every row in the scenario. Well
      // conditioned by construction -- 650 serves -- so it stays tight.
      const all = [...Array(o.y.length).keys()]
      dc = Math.max(dc, Math.abs(post(all, 0, 2).mean - s.arms.complete.players.theta_mean[0]))

      // Empirical Bayes: prior N(mu-hat, tau-hat), this player's serves only.
      // This is the approximation section 3 shows for partial pooling, so how
      // close it lands to the real hierarchical fit is a teaching claim.
      const { mu, tau } = s.arms.none.population
      const nn = s.arms.none.players
      for (let k = 0; k < nn.child_id.length; k++) {
        de = Math.max(de, Math.abs(post(rowsFor.get(nn.child_id[k]), mu.mean, tau.mean).mean - nn.theta_mean[k]))
      }
    }
  }

  meanDevs.sort((a, b) => a - b)
  const median = meanDevs[Math.floor(meanDevs.length / 2)]

  ok(median < 0.015, `grid no-pooling means match Stan typically (median ${median.toFixed(4)})`)
  ok(dm < 0.08, `grid no-pooling means match Stan everywhere (worst ${dm.toFixed(4)})`)
  ok(ds < 0.12, `grid no-pooling sds match Stan (worst ${ds.toFixed(4)})`)
  ok(dq < 0.30, `grid no-pooling quantiles match Stan (worst ${dq.toFixed(4)})`)
  ok(dc < 0.01, `grid complete-pooling mean matches Stan (worst ${dc.toFixed(4)})`)
  ok(de < 0.05, `empirical-Bayes prior approximates the hierarchical fit (worst ${de.toFixed(4)})`)

  console.log('bayes grid: %d scenarios, %d players — no-pool Δmean median %s / worst %s, complete %s, EB %s',
    scenarios, meanDevs.length, median.toFixed(4), dm.toFixed(4), dc.toFixed(4), de.toFixed(4))
}

// --- updating is order-invariant, and predicts the rate it should --------
{
  const g = thetaGrid()
  const o = sc.observations
  const rowsFor = new Map()
  for (let i = 0; i < o.child_id.length; i++) {
    if (!rowsFor.has(o.child_id[i])) rowsFor.set(o.child_id[i], [])
    rowsFor.get(o.child_id[i]).push(i)
  }
  const post = (rows, mean, sd) =>
    summarize(normalize(accumulate(logNormalPrior(g, mean, sd), g, o, rows), g), g)

  // Order invariance: the same serves in any order give the same posterior.
  // The section offers a "shuffle" control on exactly this claim.
  const rows = rowsFor.get(sc.arms.no_pool.players.child_id[30])
  const rnd = mulberry32(7)
  const shuffled = [...rows]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const a = post(rows, 0, 2); const b = post(shuffled, 0, 2)
  ok(Math.abs(a.mean - b.mean) < 1e-9 && Math.abs(a.sd - b.sd) < 1e-9,
    'updating is order-invariant')

  // The predictive rate, not plogis(mean theta), is what the sample mean converges to.
  const frames = updateSequence({ grid: g, prior: { mean: 0, sd: 2 }, observations: o, rows })
  const last = frames[frames.length - 1]
  ok(Math.abs(last.predictedRate - last.sampleRate) < 0.02,
    `predictive rate tracks the sample rate at n=${last.n}`)
  ok(frames.length === rows.length + 1, 'updateSequence emits a prior-only frame at n=0')
  ok(frames[0].n === 0 && frames[0].like === null, 'frame 0 is the prior, with no likelihood')

  console.log('bayes grid: order-invariant; predictive rate %s vs sample rate %s at n=%d',
    last.predictedRate.toFixed(3), last.sampleRate.toFixed(3), last.n)

  // --- one fixed ruler for the whole sequence ----------------------------
  // The chart used to recompute both axes per step, which cancelled the only
  // thing the section teaches: with the ruler shrinking alongside the curve,
  // every posterior looked the same width. frameBounds is that ruler, and it
  // has to be wide enough and tall enough for every frame at once.
  const fb = frameBounds(frames, g)
  ok(fb.x[0] >= g.from && fb.x[1] <= g.to, 'frameBounds must stay inside the computation grid')
  for (const f of frames) {
    const { mean: m, sd } = f.summary
    ok(fb.x[0] <= m - 2 * sd && fb.x[1] >= m + 2 * sd,
      `frameBounds must hold n=${f.n} out to two sd (${(m - 2 * sd).toFixed(2)}, ${(m + 2 * sd).toFixed(2)})`)
    ok(fb.yTop >= Math.max(...f.density), `frameBounds must clear the n=${f.n} peak`)
  }
  // The n=0 prior is the widest frame there is, so it sets the domain outright.
  const prior0 = frames[0].summary
  ok(Math.abs(fb.x[0] - (prior0.mean - 3.2 * prior0.sd)) < 1e-9,
    'the prior should set the left edge -- it is the width the posterior narrows away from')
  // An extra density counts toward the height but not the width.
  const tall = frames[frames.length - 1].density.map((v) => v * 3)
  ok(frameBounds(frames, g, { extras: [tall] }).yTop > fb.yTop,
    'an extra density must be able to raise the y ceiling')

  // --- the MLE exists exactly when the outcomes are not all the same -----
  const seq = mleSequence({ grid: g, observations: o, rows })
  ok(seq.length === frames.length, 'mleSequence must give one entry per frame, plus n=0')
  let makes = 0
  for (let k = 0; k < seq.length; k++) {
    if (k > 0 && o.y[rows[k - 1]] === 1) makes++
    const separated = k === 0 || makes === k || makes === 0
    ok(seq[k].mleDefined === !separated,
      `n=${k}: the MLE exists iff the outcomes so far differ (${makes} makes of ${k})`)
    ok(seq[k].mleDefined || seq[k].mle === null, `n=${k}: an undefined MLE must be null, never 0`)
    if (!seq[k].mleDefined && k > 0) {
      ok(seq[k].mleEdge === (makes === k ? 'high' : 'low'),
        `n=${k}: a monotone likelihood must say which way it ran off`)
    }
    ok(frames[k].mle === seq[k].mle && frames[k].mleDefined === seq[k].mleDefined,
      `n=${k}: updateSequence and mleSequence must agree about the MLE`)
  }
  ok(seq[0].mleEdge === null, 'with no serves the likelihood is flat, so there is no edge either')
}

// --- where the Bayesian estimate lands, against the data-only one --------
// The section claims the model's estimate sits between the prior mean (0) and
// the estimate from this player's data alone. Log-concavity guarantees that for
// the posterior MODE. The site quotes MEANS everywhere, and a mean can fall
// just outside when the posterior is skewed -- so the prose says "lands
// between" and an aside owns the exception. These two rates are what that copy
// is allowed to claim, measured over every player in every shipped scenario.
//
// "Between" is tested inclusively for the mode, and that is not a fudge: on a
// 1025-point grid the cell is 0.0156 wide, and when the MLE is small (|MLE| <
// 0.15, 71 players here) the mode and the MLE land in the SAME cell. Every one
// of those is a tie at the endpoint -- zero players have a mode strictly
// outside the pair, which is the guarantee log-concavity actually makes.
{
  const g = thetaGrid()
  let defined = 0
  let undef = 0
  let modeOutside = 0
  let modeStrict = 0
  let modeExample = null
  let meanBetween = 0
  let worstOutside = 0
  for (const p of index.populations) {
    for (const id of p.scenario_ids) {
      const s = read(`scenarios/${id}.json`)
      const o = s.observations
      const rowsFor = new Map()
      for (let i = 0; i < o.child_id.length; i++) {
        if (!rowsFor.has(o.child_id[i])) rowsFor.set(o.child_id[i], [])
        rowsFor.get(o.child_id[i]).push(i)
      }
      for (const rows of rowsFor.values()) {
        const seq = mleSequence({ grid: g, observations: o, rows })
        const mle = seq[seq.length - 1].mle
        if (mle == null) { undef++; continue }
        defined++
        const density = normalize(accumulate(logNormalPrior(g, 0, 2), g, o, rows), g)
        let mode = 0
        let best = -Infinity
        for (let i = 0; i < g.n; i++) if (density[i] > best) { best = density[i]; mode = g.theta[i] }
        const mean = summarize(density, g).mean
        const lo = Math.min(0, mle)
        const hi = Math.max(0, mle)
        const strict = (v) => v > lo && v < hi
        if (!(mode >= lo && mode <= hi)) {
          modeOutside++
          if (!modeExample) modeExample = `MLE ${mle.toFixed(3)}, mode ${mode.toFixed(3)}`
        }
        if (strict(mode)) modeStrict++
        if (strict(mean)) meanBetween++
        else worstOutside = Math.max(worstOutside, Math.min(Math.abs(mean), Math.abs(mean - mle)))
      }
    }
  }
  const meanRate = meanBetween / defined
  ok(modeOutside === 0,
    `the posterior mode must NEVER sit outside 0 and the MLE ` +
    `(${modeOutside}/${defined} do, e.g. ${modeExample})`)
  ok(meanRate > 0.85,
    `the posterior mean sits between for a large majority (${(100 * meanRate).toFixed(1)}%)`)
  ok(worstOutside < 0.1,
    `when the mean falls outside it is by a hair (worst ${worstOutside.toFixed(3)})`)
  console.log('bayes grid: %d players with a defined MLE (%d separated, %s%%) — ' +
    'mode never outside [0, MLE] (%s%% strictly inside, the rest tied at a grid cell), ' +
    'mean strictly inside %s%% (worst miss %s)',
  defined, undef, (100 * undef / (defined + undef)).toFixed(1),
  (100 * modeStrict / defined).toFixed(1), (100 * meanRate).toFixed(1), worstOutside.toFixed(3))
}

// --- every scenario matches what index.json advertises -------------------
let n = 0
for (const p of index.populations) {
  for (const id of p.scenario_ids) {
    const s = read(`scenarios/${id}.json`)
    n++
    ok(JSON.stringify(Object.keys(s.arms).sort()) === JSON.stringify([...p.arms].sort()),
      `${id}: arms should match index.json (${Object.keys(s.arms)} vs ${p.arms})`)
    ok(s.arms.none.p_grid.length === s.n_players, `${id}: p_grid must have one row per player`)
    ok(s.arms.none.p_grid[0].length === grid.length, `${id}: p_grid must match the shared grid`)
    ok(typeof s.prose.tau_verdict === 'string', `${id}: missing tau_verdict`)
  }
}
console.log('all %d scenarios parse with matching arms and grid shape', n)

// --- the two-skill story ------------------------------------------------
// A 2D scenario carries two complete 1D payloads plus a joint block: per-player
// posterior covariances, a population correlation, planar borrowing targets.
// The joint block is the only new shape the R side ships, so it gets the
// scrutiny; the per-skill payloads are checked against the joint truth, since
// a skill payload that drifted from it would make two charts on one page
// disagree about the same player.
if (existsSync(join(D, 'scenarios-2d', 'distinct__20260914__2d.json'))) {
  ok(Array.isArray(index.dimensions) && index.dimensions.includes(2),
    'index.json should advertise dimension 2')
  ok(index.skill_labels?.length === 2, 'index.json should name exactly two skills')
  ok(index.domains.theta2d?.length === 2, 'index.json should carry a shared 2D theta domain')
  ok(Array.isArray(index.populations2d) && index.populations2d.length === index.populations.length,
    'populations2d should list every 1D population')
  for (const p of index.populations) {
    const q = (index.populations2d ?? []).find((x) => x.preset === p.preset)
    ok(q, `populations2d is missing ${p.preset}`)
    ok(q && JSON.stringify(q.seeds) === JSON.stringify(p.seeds),
      `${p.preset}: the 2D seeds should match the 1D seeds`)
  }

  // Only the hierarchical arms estimate a population, so only they carry a
  // correlation and a target to borrow toward.
  const HB = ['none', 'wrong', 'correct']
  let n2 = 0
  for (const p of index.populations2d ?? []) {
    for (const id of p.scenario_ids) {
      const s = read(`scenarios-2d/${id}.json`)
      n2++
      ok(s.dimensions === 2, `${id}: dimensions should be 2`)
      ok(s.skills?.length === 2, `${id}: should carry one 1D payload per skill`)
      for (const [k, skill] of (s.skills ?? []).entries()) {
        ok(skill.arms.none.p_grid.length === s.n_players &&
           skill.arms.none.p_grid[0].length === grid.length,
        `${id} skill ${k + 1}: p_grid must be n_players x grid`)
        const joint = s.truth[`theta${k + 1}_true`]
        ok(skill.truth.theta_true.length === joint.length &&
           skill.truth.theta_true.every((v, i) => v === joint[i]),
        `${id} skill ${k + 1}: the skill's truth must be the joint truth, element for element`)
      }
      ok(JSON.stringify(Object.keys(s.arms).sort()) === JSON.stringify([...p.arms].sort()),
        `${id}: arms should match index.json (${Object.keys(s.arms)} vs ${p.arms})`)
      for (const [armId, arm] of Object.entries(s.arms)) {
        const pl = arm.players2d
        ok(pl?.child_id?.length === s.n_players, `${id} ${armId}: one 2D posterior per player`)
        // A covariance with a negative determinant is not one; the ellipse code
        // clamps it silently, so this is the only place it would be caught.
        ok(pl && pl.var1.every((v, i) => v * pl.var2[i] - pl.cov12[i] ** 2 >= -1e-9),
          `${id} ${armId}: every player covariance must be positive semi-definite`)
        if (HB.includes(armId)) {
          ok(typeof arm.population2d?.rho?.mean === 'number',
            `${id} ${armId}: a hierarchical arm should estimate rho`)
          ok(arm.borrowing_targets2d?.child_id?.length === s.n_players,
            `${id} ${armId}: a hierarchical arm should carry a planar target per player`)
        }
      }
      ok(s.derived?.rho_comparison?.summary?.result_id?.includes('none'),
        `${id}: rho comparison should include the plain partial-pooling arm`)
    }
  }
  console.log('all %d 2D scenarios parse with per-skill payloads matching the joint truth', n2)

  // --- lib/ellipse.js -----------------------------------------------------
  // The contours are computed on the client from a mean and a covariance, so
  // the geometry is pinned here against numbers that can be worked by hand.
  const { ellipsePoints, ellipseArea, mixtureCovariance, pointsToScale } =
    await import('../src/lib/ellipse.js')
  const unit = { mean1: 0, mean2: 0, var1: 1, var2: 1, cov12: 0 }
  // The 50% region of a standard bivariate normal is a circle of radius
  // sqrt(-2 ln 0.5) = sqrt(chi-square_2 quantile) ~ 1.177.
  const r = Math.sqrt(-2 * Math.log(0.5))
  const circle = ellipsePoints(unit, 0.5)
  ok(circle.length > 8, 'an ellipse should be a polygon of many points')
  ok(circle.every((pt) => Math.abs(Math.hypot(pt.x, pt.y) - r) < 1e-9),
    `every vertex of the unit 50% region should sit at radius ${r.toFixed(3)}`)
  ok(Math.abs(ellipseArea(unit, 0.5) - Math.PI * (-2 * Math.log(0.5))) < 1e-9,
    'the unit 50% region should have area pi * 1.386')
  // A positive covariance tilts the major axis off both coordinate axes, so
  // the first vertex (which lies on the major axis) is off both of them.
  const tilted = ellipsePoints({ ...unit, cov12: 0.6 }, 0.5)[0]
  ok(Math.abs(tilted.x) > 1e-6 && Math.abs(tilted.y) > 1e-6,
    'a correlated posterior should draw as a tilted ellipse')
  // Two equal groups two units apart in x add a unit of between-group variance
  // to that axis only: 0.2 + 0.5 * 1 + 0.5 * 1 = 1.2, and 0.2 on the other.
  const mix = mixtureCovariance(
    [{ weight: 1, theta_mean_1: -1, theta_mean_2: 0 }, { weight: 1, theta_mean_1: 1, theta_mean_2: 0 }],
    { var1: 0.2, var2: 0.2, cov12: 0 })
  ok(Math.abs(mix.var1 - 1.2) < 1e-12 && Math.abs(mix.var2 - 0.2) < 1e-12,
    `mixture covariance should be (1.2, 0.2), got (${mix.var1}, ${mix.var2})`)
  ok(Math.abs(mix.cov12) < 1e-12 && Math.abs(mix.mean1) < 1e-12,
    'a symmetric mixture should have no covariance and a zero mean')
  const origin = pointsToScale([{ x: 0, y: 0 }], 'probability', 0)[0]
  ok(Math.abs(origin.x - 0.5) < 1e-12 && Math.abs(origin.y - 0.5) < 1e-12,
    'theta = 0 should map to a coin flip on the probability scale')
  console.log('ellipse geometry: unit radius %s, area %s, tilted first vertex (%s, %s)',
    r.toFixed(3), ellipseArea(unit, 0.5).toFixed(3), tilted.x.toFixed(3), tilted.y.toFixed(3))
} else {
  console.log('2D: skipped, scenarios-2d not generated')
}

// --- the team sweep --------------------------------------------------------
// Eight players observed longer and longer, refitted at every step, and the
// same on a hundred replicate teams. The argument is that the team's own
// average sharpens while the population mean does not, so the shapes below
// are asserted along with the numbers the prose quotes.
if (existsSync(join(D, 'team-sweep.json')) && existsSync(join(D, 'team-coverage.json'))) {
  const sweep = read('team-sweep.json')
  const coverage = read('team-coverage.json')
  const steps = sweep.steps
  const d = sweep.steps_detail

  ok(steps.length === 8, `expected 8 sweep steps, got ${steps.length}`)
  ok(sweep.n_players === 8, `expected a team of 8, got ${sweep.n_players}`)
  for (const col of ['n_keep', 'team_width', 'mu_width', 'new_width', 'team_p_width', 'mu_p_width',
    'team_covers_mu', 'mu_covers_mu', 'new_covers_mu', 'team_mean', 'team_low', 'team_high']) {
    ok(Array.isArray(d[col]) && d[col].length === steps.length,
      `steps_detail.${col} should have one value per step`)
  }
  ok(JSON.stringify(d.n_keep) === JSON.stringify(steps), 'steps_detail should be ordered by the sweep steps')
  ok(d.team_width.every((v, i) => i === 0 || v < d.team_width[i - 1]),
    'the team average should sharpen at every step')
  // Eight people can never pin mu down below tau / sqrt(8): its width should
  // end up near the 90% normal width at that standard error.
  const floor = 2 * 1.645 * sweep.truth.standard_error
  const muLast = d.mu_width[steps.length - 1]
  ok(Math.abs(muLast - floor) < 0.2 * floor,
    `mu's width at n=${steps[steps.length - 1]} should sit near the floor (${muLast} vs ${floor.toFixed(3)})`)
  ok(d.team_covers_mu[steps.length - 1] === false,
    'by the last step the team average should have left mu behind')
  ok(d.mu_covers_mu[steps.length - 1] === true,
    'mu\'s own interval should still contain mu at the last step')
  ok(sweep.densities?.length === steps.length && sweep.players?.length === steps.length,
    'one density set and one player block per step')

  const s = coverage.summary
  ok(coverage.n_teams === 100, `expected 100 replicate teams, got ${coverage.n_teams}`)
  ok(coverage.teams?.seed?.length === 100 * steps.length,
    `expected ${100 * steps.length} team-step rows, got ${coverage.teams?.seed?.length}`)
  ok(JSON.stringify(coverage.steps) === JSON.stringify(steps), 'the replicates should use the walk-through steps')
  ok(s.team_covers_mu[0] >= 0.6 && s.team_covers_mu[steps.length - 1] <= 0.2,
    `team coverage of mu should fall from >= 0.6 to <= 0.2 (${s.team_covers_mu[0]} -> ${s.team_covers_mu[steps.length - 1]})`)
  ok(s.team_covers_mu.every((v, i) => i === 0 || v <= s.team_covers_mu[i - 1]),
    'team coverage of mu should never rise with more data')
  ok(s.mu_covers_mu.every((v) => v >= 0.8 && v <= 0.98),
    `mu's own coverage should hold near nominal at every step (${s.mu_covers_mu.join(', ')})`)
  for (const k of ['team_covers_mu', 'mu_covers_mu', 'new_covers_mu']) {
    ok(s[k].every((v, i) => s[`${k}_low`][i] <= v + 1e-9 && v <= s[`${k}_high`][i] + 1e-9),
      `${k}: the Wilson bounds should bracket the rate`)
  }

  const pct = (v) => `${Math.round(100 * v)}%`.padStart(4)
  console.log('team sweep: %d players x %d steps; floor 2*1.645*se = %s, mu width at n=%d is %s',
    sweep.n_players, steps.length, floor.toFixed(3), steps[steps.length - 1], muLast.toFixed(3))
  console.log('coverage of mu across %d teams (rate, Wilson 95%%):', coverage.n_teams)
  console.log('     n   team              mu                new')
  for (let i = 0; i < steps.length; i++) {
    const cell = (k) => `${pct(s[k][i])} [${pct(s[`${k}_low`][i])},${pct(s[`${k}_high`][i])}]`
    console.log(`  ${String(steps[i]).padStart(4)}   ${cell('team_covers_mu')}   ${cell('mu_covers_mu')}   ${cell('new_covers_mu')}`)
  }
} else {
  console.log('team sweep: skipped, team-sweep.json / team-coverage.json not generated')
}

console.log(fails === 0 ? '\nOK - data layer clean' : `\n${fails} FAILURE(S)`)
process.exit(fails ? 1 : 0)
