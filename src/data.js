// Loading and caching. One scenario is in memory at a time; switching
// population or seed fetches a new file rather than recomputing anything.

// import.meta.env is injected by Vite and absent under plain node, where the
// headless checks import this module for its pure helpers.
const BASE = import.meta.env?.BASE_URL || './'
const scenarioCache = new Map()
let indexPromise = null

async function getJSON (path) {
  const res = await fetch(`${BASE}data/${path}`)
  if (!res.ok) throw new Error(`could not load ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export function loadIndex () {
  if (!indexPromise) indexPromise = getJSON('index.json')
  return indexPromise
}

/** Where a scenario lives: `scenarios/` for one skill, `scenarios-2d/` for two. */
export function scenarioPath (scenarioId, dimension = '1d') {
  return dimension === '2d' ? `scenarios-2d/${scenarioId}.json` : `scenarios/${scenarioId}.json`
}

export async function loadScenario (scenarioId, dimension = '1d') {
  const path = scenarioPath(scenarioId, dimension)
  if (scenarioCache.has(path)) return scenarioCache.get(path)
  const promise = getJSON(path)
  scenarioCache.set(path, promise)
  try {
    return await promise
  } catch (err) {
    // Do not cache a failure; a transient network error should be retryable.
    scenarioCache.delete(path)
    throw err
  }
}

const optional = new Map()
function loadOptional (file) {
  // Optional datasets, like the levels factorial: a 404 means the sweep has
  // not been generated, not that the site is broken.
  if (!optional.has(file)) optional.set(file, getJSON(file).catch(() => null))
  return optional.get(file)
}

export function loadConvergence (dimension = '1d') {
  return loadOptional(dimension === '2d' ? 'convergence-2d.json' : 'convergence.json')
}

export const loadTeamSweep = () => loadOptional('team-sweep.json')
export const loadTeamCoverage = () => loadOptional('team-coverage.json')

let levelsPromise = null
export function loadLevelsFactorial () {
  // Optional: the build skips it on a machine without the 2024 dataset, so a
  // 404 here means "that section is unavailable", not "the site is broken".
  if (!levelsPromise) levelsPromise = getJSON('levels-factorial.json').catch(() => null)
  return levelsPromise
}

export function scenarioId (population, seed, dimension = '1d') {
  return dimension === '2d' ? `${population}__${seed}__2d` : `${population}__${seed}`
}

/** The index entry for a population in the requested dimension. */
export function populationEntry (index, population, dimension = '1d') {
  const list = dimension === '2d' ? index.populations2d : index.populations
  return (list ?? []).find((p) => p.preset === population)
}

export const hasDimension2d = (index) =>
  Array.isArray(index?.populations2d) && index.populations2d.length > 0

/**
 * Every team for one population, in parallel.
 *
 * One team is one random draw, and a conclusion drawn from it is an anecdote.
 * Any chart that claims a pattern should be able to show all five at once --
 * roughly 1.2 MB, fetched only when such a chart first comes into view.
 */
export async function loadAllTeams (index, population, dimension = '1d') {
  const pop = populationEntry(index, population, dimension)
  if (!pop) return []
  return Promise.all(pop.scenario_ids.map((id) => loadScenario(id, dimension)))
}

/** Arm design tokens, keyed by arm id, from index.json. */
export function armTokens (index) {
  const byId = new Map()
  for (const a of index.arms) byId.set(a.id, a)
  return byId
}

/** The arms a given scenario actually has, in canonical draw order. */
export function orderedArms (index, scenario) {
  const tokens = armTokens(index)
  return Object.keys(scenario.arms)
    .map((id) => ({ id, token: tokens.get(id), arm: scenario.arms[id] }))
    .filter((a) => a.token)
    .sort((a, b) => a.token.order - b.token.order)
}
