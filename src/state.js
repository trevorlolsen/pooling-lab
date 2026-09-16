// Reader state, and a tiny subscribe/notify so sections re-render when it moves.
//
// Everything here is a display choice. None of it can trigger a refit, because
// there is nothing to fit at runtime.

const listeners = new Set()

export const state = {
  population: 'one_population',
  seed: null,           // filled from index.json's default for the population (Team 1)
  dimension: '1d',      // '1d' | '2d' -- one skill per player, or two
  scenario: null,       // the loaded payload; in 2D it carries `skills[0..1]`, each a 1D payload
  index: null,
  arm: 'correct',       // which covariate arm section 5+ displays
  scale: 'theta',       // 'probability' | 'theta' -- the parameter space first, d* is opt-in
  view: 'point',        // 'point' | 'posterior' -- point estimate or full density
  difficulty: 0,        // d*, continuous over the shipped grid
  selectedPlayer: null,
  step: {}              // section id -> current scroll step
}

export function subscribe (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notify (reason) {
  for (const fn of listeners) fn(reason)
}

export function setState (patch, reason = 'state') {
  Object.assign(state, patch)
  notify(reason)
}

/** The arm a section should show, falling back when a scenario lacks it. */
export function resolveArm (preferred) {
  const arms = state.scenario?.arms ?? {}
  if (preferred && arms[preferred]) return preferred
  if (arms[state.arm]) return state.arm
  return arms.none ? 'none' : Object.keys(arms)[0]
}

export const is2d = () => state.dimension === '2d'

/**
 * The 1D-shaped payload for one skill (1 or 2). In 2D the scenario carries two
 * complete 1D payloads, so every 1D reader can be pointed at a skill; in 1D
 * both skills are the scenario itself.
 */
export function skillScenario (k = 1) {
  const sc = state.scenario
  if (!sc) return null
  return sc.skills ? sc.skills[k - 1] : sc
}

export function skillLabel (k) {
  return state.scenario?.skill_labels?.[k - 1] ?? state.index?.skill_labels?.[k - 1] ?? `Skill ${k}`
}

/** "Team 3 of 5" — a readout that unmistakably moves when the seed changes. */
export function teamLabel () {
  const pop = state.index?.populations?.find((p) => p.preset === state.population)
  if (!pop) return ''
  const i = pop.seeds.indexOf(state.seed)
  return i < 0 ? '' : `Team ${i + 1} of ${pop.seeds.length}`
}

export function selectedOrFirst () {
  const ids = state.scenario?.truth?.child_id ?? []
  if (state.selectedPlayer != null && ids.includes(state.selectedPlayer)) {
    return state.selectedPlayer
  }
  return ids[0]
}
