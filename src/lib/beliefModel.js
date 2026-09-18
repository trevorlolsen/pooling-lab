// The shared, cached model layer behind the belief sections.
//
// Three sections now ask the same questions of a scenario -- which player is the
// site following, what does the whole team's serve stream say, what does the
// hierarchical fit think the population is -- and the answers are expensive
// enough that each one recomputing them is not an option. They are also
// per-scenario facts, not per-section ones, so they belong here rather than in
// three closures.
//
// Deliberately free of state.js: the selected player arrives as an argument.
// That keeps this module testable and means a section can ask what the answer
// WOULD be without having rendered.

import {
  thetaGrid, summarize, updateSequence, rowsForPlayer, densityFor as gridDensityFor
} from './bayesGrid.js'

/** One grid for every belief section. Two densities built on different grids
 *  are not comparable, and frameBounds would mix the rulers without saying so. */
export const GRID = thetaGrid()

/** The posterior for `rows` under a N(mean, sd) prior, on GRID. */
export const densityFor = (observations, rows, mean = 0, sd = 2) =>
  gridDensityFor(GRID, observations, rows, mean, sd)

export { rowsForPlayer }

// Cheap per-scenario products, keyed on the scenario OBJECT. data.js caches by
// path and hands back the same object every time, so identity is stable and a
// WeakMap needs no key string and no eviction -- which the old
// `scenario_id ?? population__seed` string key did need, and got wrong whenever
// scenario_id was absent.
const cache = new WeakMap()
const memo = (sc, key, build) => {
  let entry = cache.get(sc)
  if (!entry) { entry = {}; cache.set(sc, entry) }
  if (!(key in entry)) entry[key] = build(sc)
  return entry[key]
}

/** Every row index in the scenario, in recorded order. */
export const allRows = (sc) =>
  memo(sc, 'allRows', (s) => [...Array(s.observations.y.length).keys()])

/** Every difficulty in the scenario, for the whole-team predictive rate. */
export const allDifficulties = (sc) =>
  memo(sc, 'allDifficulties', (s) => [...s.observations.difficulty])

/** Complete pooling: one belief over every serve on the team. Does not depend
 *  on any player, which is the whole point of drawing it beside one. */
export const completeDensity = (sc) =>
  memo(sc, 'completeDensity', (s) => densityFor(s.observations, allRows(s), 0, 2))

/** { mu, tau } from the hierarchical fit, or null for an arm that has none. */
export const populationOf = (sc) =>
  memo(sc, 'population', (s) => {
    const pop = s.arms?.none?.population
    return pop ? { mu: pop.mu.mean, tau: pop.tau.mean } : null
  })

/**
 * The walk-through player.
 *
 * It wants the fullest data -- thirty serves -- but "the last player with the
 * most serves" is not enough. A player whose first fifteen serves all go the
 * same way gives a belief that slides steadily one way and never gets pushed
 * back, which is the least interesting thing a belief panel can show: the whole
 * point is that each serve's likelihood leans a direction and the belief
 * answers. On one_population__20260914 that rule picked player 40, whose first
 * miss is serve 16.
 *
 * So: among the best-observed players, take the one who has been seen to both
 * make AND miss soonest -- the smallest serve count by which the evidence has
 * pointed both ways -- and break ties on the largest final |posterior mean|, so
 * the orange tick ends visibly off the grey one rather than on top of it.
 *
 * Measured at 31 ms, and two sections want it, so it is cached per scenario.
 */
export const walkThroughPlayer = (sc) => memo(sc, 'walkThrough', (s) => {
  const { child_id: ids, n_train: ns } = s.truth
  const maxN = Math.max(...ns)
  let best = null
  for (let i = 0; i < ids.length; i++) {
    if (ns[i] !== maxN) continue
    const r = rowsForPlayer(s.observations, ids[i])
    let makes = 0
    let misses = 0
    let mixed = Infinity
    for (let k = 0; k < r.length; k++) {
      if (s.observations.y[r[k]] === 1) makes++
      else misses++
      if (makes > 0 && misses > 0) { mixed = k + 1; break }
    }
    const final = summarize(densityFor(s.observations, r, 0, 2), GRID).mean
    const cand = { id: ids[i], mixed, size: Math.abs(final) }
    if (!best || cand.mixed < best.mixed ||
      (cand.mixed === best.mixed && cand.size > best.size)) best = cand
  }
  return best ? best.id : ids[ids.length - 1]
})

/**
 * Whichever player the site is following on this scenario.
 *
 * ONE rule, shared: the section that lets the reader pick and the section whose
 * prose names a player must agree, including when the reader jumped straight to
 * the second one and the first has never rendered. `selected` is passed in
 * rather than read from state, and a selection from another team is ignored.
 */
export function followedPlayer (sc, selected) {
  const ids = sc.truth.child_id
  if (selected != null && ids.includes(selected)) return selected
  return walkThroughPlayer(sc)
}

/**
 * The prior swap, scored on every player on the team.
 *
 * Eighty grid posteriors over 650 rows: far too much to redo whenever a slider
 * moves, and it depends on the scenario alone. Measured at 61 ms.
 */
export const teamStats = (sc) => memo(sc, 'teamStats', (s) => {
  const population = populationOf(s)
  if (!population) return null
  const ids = s.truth.child_id
  const ns = s.truth.n_train
  const move = new Array(ids.length)
  let maeFlat = 0
  let maeLearned = 0
  let better = 0
  for (let i = 0; i < ids.length; i++) {
    const r = rowsForPlayer(s.observations, ids[i])
    const a = summarize(densityFor(s.observations, r, 0, 2), GRID).mean
    const b = summarize(densityFor(s.observations, r, population.mu, population.tau), GRID).mean
    move[i] = Math.abs(b - a)
    const ea = Math.abs(a - s.truth.theta_true[i])
    const eb = Math.abs(b - s.truth.theta_true[i])
    maeFlat += ea
    maeLearned += eb
    if (eb < ea) better++
  }
  // The sparsest band against the best-observed one, averaged rather than
  // picked. Two individual players would make the ratio look much larger --
  // player 4 against player 31 on the default team is 43x -- but that number is
  // a coincidence of which two players you name. The band means are 3x-8x
  // across all 25 shipped scenarios, and that is the claim that survives the
  // reader changing team.
  const minN = Math.min(...ns)
  const maxN = Math.max(...ns)
  const bandMean = (target) => {
    let sum = 0
    let count = 0
    for (let i = 0; i < ns.length; i++) if (ns[i] === target) { sum += move[i]; count++ }
    return { n: target, count, move: count ? sum / count : 0 }
  }
  return {
    n: ids.length,
    maeFlat: maeFlat / ids.length,
    maeLearned: maeLearned / ids.length,
    better,
    lo: bandMean(minN),
    hi: bandMean(maxN)
  }
})

/**
 * Complete pooling absorbed one serve at a time: 651 frames over the whole team.
 *
 * NOT in the WeakMap. At 651 frames x 1025 doubles this is 5.3 MB, and data.js's
 * scenario cache never evicts -- a WeakMap would hold one of these per scenario
 * for as long as the reader keeps touring the rail, so twenty-five of them. One
 * slot, replaced on every scenario change, is the right trade: the section is
 * lazy, nobody compares two scenarios side by side, and a rebuild is ~160 ms.
 *
 * keepLike is off because the section shows a handful of fixed beats rather than
 * a slider over every serve; it rebuilds the few strips it draws on demand.
 */
let bigCache = null
export function completeFrames (sc) {
  if (bigCache?.scenario === sc) return bigCache.frames
  bigCache = {
    scenario: sc,
    frames: updateSequence({
      grid: GRID,
      prior: { mean: 0, sd: 2 },
      observations: sc.observations,
      rows: allRows(sc),
      keepLike: false
    })
  }
  return bigCache.frames
}

/**
 * The same thing over two skills: one sequence per skill, plus the rule for
 * reading a joint belief out of them at any point in an interleaved run.
 *
 * The joint is the OUTER PRODUCT of the two, exactly -- see the header of
 * charts/beliefSurface.js. complete_pooling_2d.stan gives the shared ability an
 * iid prior and every observation touches one component, so the two skills
 * never meet and there is nothing to compute jointly.
 *
 * Plays are interleaved serve, reception, serve, reception. The payload keeps
 * the two streams separately and their row order is a Stan data-layout artifact
 * rather than a running order (CLAUDE.md: skill-1 block then skill-2 block), so
 * alternating is the honest reading of "one play at a time" and the caption
 * says that is what it is.
 */
let bigCache2d = null
export function completeFrames2d (sc) {
  if (bigCache2d?.scenario === sc) return bigCache2d.value
  const perSkill = [0, 1].map((k) => {
    const s = sc.skills[k]
    return updateSequence({
      grid: GRID,
      prior: { mean: 0, sd: 2 },
      observations: s.observations,
      rows: [...Array(s.observations.y.length).keys()],
      keepLike: false
    })
  })
  const total = perSkill[0].length - 1 + perSkill[1].length - 1
  bigCache2d = { scenario: sc, value: { perSkill, total } }
  return bigCache2d.value
}

/**
 * How many of each skill's plays have been absorbed after `t` interleaved ones,
 * and which skill the t-th play belonged to.
 *
 * Alternating from skill 1, clamped per stream so an uneven pair still finishes
 * both: once one stream runs out the other keeps going alone.
 */
export function interleavedAt (perSkill, t) {
  const n1 = perSkill[0].length - 1
  const n2 = perSkill[1].length - 1
  let a1 = Math.min(n1, Math.ceil(t / 2))
  let a2 = Math.min(n2, Math.floor(t / 2))
  // Whatever the clamps took off one stream is spent on the other.
  const spent = a1 + a2
  if (spent < t) {
    const extra = t - spent
    if (a1 < n1) a1 = Math.min(n1, a1 + extra)
    else a2 = Math.min(n2, a2 + extra)
  }
  const skill = a1 + a2 === 0 ? null : (t % 2 === 1 && a1 > 0 ? 1 : 2)
  return { a1, a2, skill }
}
