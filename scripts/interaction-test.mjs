// Interaction check: mount the real sections in jsdom, change state, and assert
// the DOM actually moved.
//
// The render test proves a chart can be built. This proves the wiring that
// rebuilds it when the reader changes something -- which is a different failure
// mode and the one that bites silently.
//
//   node scripts/interaction-test.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true
})
for (const k of ['Node', 'NodeList', 'HTMLElement', 'SVGElement', 'Element']) {
  globalThis[k] = dom.window[k]
}
globalThis.getComputedStyle = dom.window.getComputedStyle

const D = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const read = (p) => JSON.parse(readFileSync(join(D, p), 'utf8'))

// Serve the published JSON off disk so sections that fetch (the evidence
// section loads all five teams) run for real rather than being skipped.
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\.?\/?data\//, '')
  try {
    const body = readFileSync(join(D, rel), 'utf8')
    return { ok: true, status: 200, json: async () => JSON.parse(body) }
  } catch {
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => null }
  }
}

const { state, setState } = await import('../src/state.js')
const { armTokens } = await import('../src/data.js')
const { theTeam } = await import('../src/sections/team.js')
const { adaptiveShrinkage } = await import('../src/sections/shrinkage.js')
const { completePooling } = await import('../src/sections/completePooling.js')
const { noPooling } = await import('../src/sections/noPooling.js')
const { evidence } = await import('../src/sections/evidence.js')
const { correctCovariateSplit, wrongCovariateSplit } =
  await import('../src/sections/covariateSplit.js')
const { convergence } = await import('../src/sections/convergence.js')
const { teamSweep } = await import('../src/sections/teamSweep.js')
const { SECTION_ORDER, numberOf } = await import('../src/lib/sectionOrder.js')

// ONE list, checked against sectionOrder.js -- which is the list main.js builds
// the page from. This file used to carry three separate hardcoded orders that
// could drift from each other and from main.js with nothing noticing.
const SECTIONS = [
  ['team', theTeam],
  ['complete-pooling', completePooling],
  ['no-pooling', noPooling],
  ['shrinkage', adaptiveShrinkage],
  ['covariate-correct', correctCovariateSplit],
  ['covariate-wrong', wrongCovariateSplit],
  ['evidence', evidence],
  ['convergence', convergence],
  ['team-sweep', teamSweep]
]

const index = read('index.json')

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL:', msg); fails++ } }

// Sections render asynchronously, so a throw inside one surfaces as an
// unhandled rejection and would otherwise vanish.
process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION:', err?.stack || err)
  process.exit(1)
})

const app = document.getElementById('app')
state.index = index
state.tokens = armTokens(index)
state.population = 'distinct'
state.seed = 20260914
state.scenario = read('scenarios/distinct__20260914.json')
state.scale = 'probability'
state.difficulty = 0

// Mount exactly the way main.js does.
// The non-fetching subset, in running order: the 1D checks below do not need
// convergence or the team sweep, and both of those fetch on mount.
const mounted = []
for (const [id, section] of SECTIONS) {
  if (id === 'convergence' || id === 'team-sweep') continue
  const { el, mount } = section()
  app.appendChild(el)
  mounted.push(mount() ?? (() => {}))
}
// Sections that fetch (evidence loads all five teams) need a tick to settle
// before anything about their DOM can be asserted.
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))
await settle(400)

// Target the chart container, not just any svg. The legend now renders a small
// svg swatch per entry, so a bare querySelector('svg') returns a 16px icon that
// never changes -- every "must redraw" assertion would compare it against
// itself and pass or fail for the wrong reason.
const chartSvg = (id) => document.getElementById(id)?.querySelector('[data-role="chart"] svg')
const snap = (id) => chartSvg(id)?.outerHTML ?? ''

/**
 * What the reader actually sees, with the Detail toggle off.
 *
 * The measured-number prose lives in `<span class="detail">` runs that are
 * always in the DOM and hidden by CSS (`:root:not([data-detail='on'])`). jsdom
 * applies no stylesheet, so `.textContent` returns the numbers whether or not
 * they are on screen -- which means a caption could go visually blank and every
 * textContent assertion here would still pass. This strips the detail runs the
 * way the stylesheet does, so "the caption says X" means the reader can read X.
 *
 * Assertions about the plain description go through this. Assertions about the
 * figures themselves go through detailText() below.
 */
const visible = (el) => {
  if (!el) return ''
  const clone = el.cloneNode(true)
  for (const d of clone.querySelectorAll('.detail')) d.remove()
  return clone.textContent.replace(/\s+/g, ' ').trim()
}
/** Only the prose behind the Detail toggle. */
const detailText = (el) => {
  if (!el) return ''
  return [...(el.querySelectorAll('.detail') ?? [])]
    .map((d) => d.textContent).join(' ').replace(/\s+/g, ' ').trim()
}
const roleEl = (id, role) => document.getElementById(id)?.querySelector(`[data-role="${role}"]`)

// The dynamic takeaway is checked as the READER sees it. Reading .textContent
// here would let a rewrite move every varying figure behind the toggle and
// leave a static sentence on screen, and this assertion would still pass while
// the page had quietly stopped responding to the team switcher.
const takeaway = (id) => visible(roleEl(id, 'takeaway'))

const before = { team: snap('team'), shrink: snap('shrinkage'), text: takeaway('shrinkage') }
ok(before.team.length > 0, 'team section should render an svg on mount')
ok(before.shrink.length > 0, 'shrinkage section should render an svg on mount')

// --- scale toggle -------------------------------------------------------
setState({ scale: 'theta' }, 'scale')
const afterScale = snap('shrinkage')
ok(afterScale !== before.shrink, 'changing scale must redraw the shrinkage chart')
ok(/ability/i.test(afterScale), 'theta scale should label the axis as ability')
setState({ scale: 'probability' }, 'scale')
ok(snap('shrinkage') === before.shrink, 'switching back should restore the original chart')

// --- reference difficulty ----------------------------------------------
setState({ difficulty: 1.0 }, 'difficulty')
ok(snap('shrinkage') !== before.shrink, 'changing d* must redraw the shrinkage chart')
setState({ difficulty: 0 }, 'difficulty')

// --- team (seed) switch -------------------------------------------------
state.seed = 20260917
setState({ scenario: read('scenarios/distinct__20260917.json'), selectedPlayer: null }, 'scenario')
const afterSeed = { team: snap('team'), shrink: snap('shrinkage'), text: takeaway('shrinkage') }
ok(afterSeed.shrink !== before.shrink, 'switching team must redraw the shrinkage chart')
ok(afterSeed.team !== before.team, 'switching team must redraw the population chart')
ok(afterSeed.text !== before.text, 'switching team must update the dynamic takeaway')

// --- population switch --------------------------------------------------
state.population = 'one_population'
state.seed = 20260914
setState({ scenario: read('scenarios/one_population__20260914.json'), selectedPlayer: null }, 'scenario')
ok(snap('team') !== afterSeed.team, 'switching population must redraw the population chart')
ok(/one population|sample from/i.test(document.getElementById('team').textContent),
  'a one-group population should get its own headline')

// --- evidence: all five teams, both metrics -----------------------------
{
  // The population switch above made the evidence section re-fetch all five
  // teams. Let that settle before asserting, or we measure the loading state.
  await settle()
  const ev = document.getElementById('evidence')
  ok(chartSvg('evidence'), 'evidence section should render its chart')
  const text = ev.textContent
  ok(/RLH/i.test(text), 'evidence should report root likelihood')
  ok(/In-sample/i.test(text) && /Out-of-sample/i.test(text),
    'evidence should report both in-sample and out-of-sample RLH')

  // Every arm the scenario has should appear in the RLH table.
  const armLabels = Object.keys(state.scenario.arms)
    .map((id) => index.arms.find((a) => a.id === id)?.label)
    .filter(Boolean)
  for (const label of armLabels) {
    ok(text.includes(label), `evidence should score the "${label}" arm`)
  }

  // Each arm gets a mean line plus a band spanning all teams, so the reader can
  // see how much a single draw is worth without twenty-five overlapping paths.
  const armCount = Object.keys(state.scenario.arms).length
  const lines = chartSvg('evidence').querySelectorAll('path[stroke]:not([stroke="none"])').length
  const bands = chartSvg('evidence').querySelectorAll('path[fill]:not([fill="none"])').length
  ok(lines >= armCount, `expected a mean line per arm (${armCount}), found ${lines}`)
  ok(bands >= armCount, `expected a team-range band per arm (${armCount}), found ${bands}`)

  // Hiding a model must drop it from the chart and rescale the axis, while
  // leaving the RLH scoreboard complete.
  const evLegend = [...ev.querySelectorAll('.legend-toggle button')]
  ok(evLegend.length >= 4, `evidence legend should offer toggles, found ${evLegend.length}`)
  const completeToggle = evLegend.find((b) => b.dataset.layer === 'complete')
  ok(completeToggle, 'evidence legend should offer a complete-pooling toggle')

  const beforeHide = snap('evidence')
  const rlhBefore = ev.querySelector('.metric-table').textContent
  completeToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle()
  ok(snap('evidence') !== beforeHide, 'hiding a model should redraw the evidence chart')
  ok(ev.querySelector('.metric-table').textContent === rlhBefore,
    'the RLH table should stay complete when a model is hidden from the chart')
  ev.querySelector('[data-layer="complete"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle()

  const beforeMetric = snap('evidence')
  ev.querySelector('[data-metric="rmse"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true }))
  await settle()
  ok(snap('evidence') !== beforeMetric, 'switching to RMSE should redraw the evidence chart')
  ok(/RMSE/.test(chartSvg('evidence').textContent), 'RMSE should be labelled on the axis')
}

// --- covariate split sections -------------------------------------------
{
  // Back to a two-group population so both split sections have something to show.
  state.population = 'distinct'
  state.seed = 20260914
  setState({ scenario: read('scenarios/distinct__20260914.json'), selectedPlayer: null }, 'scenario')
  await settle()

  for (const [armId, expectSplit] of [['correct', true], ['wrong', false]]) {
    const sec = document.getElementById(`covariate-${armId}`)
    ok(sec, `covariate-${armId} section should exist`)
    const svg = chartSvg(`covariate-${armId}`)
    ok(svg, `covariate-${armId} should render a chart`)

    // One facet per assigned group, each with its own target line.
    const cov = state.scenario.analysis_covariates[armId]
    const fyDomain = cov.levels
    for (const level of fyDomain) {
      ok(svg.textContent.includes(level),
        `covariate-${armId} should label the "${level}" panel`)
    }
  }

  // The decisive contrast: the correct covariate's two targets are far apart,
  // the scrambled one's are effectively the same number.
  const { borrowingTargets } = await import('../src/lib/transforms.js')
  const opts = { scale: 'theta', difficulty: 0 }
  const spread = (armId) => {
    const t = borrowingTargets(state.scenario.arms[armId], opts).map((d) => d.target)
    return Math.max(...t) - Math.min(...t)
  }
  const correctSpread = spread('correct')
  const wrongSpread = spread('wrong')
  ok(correctSpread > 1, `correct covariate targets should be far apart, got ${correctSpread.toFixed(3)}`)
  ok(wrongSpread < 0.3, `scrambled covariate targets should nearly coincide, got ${wrongSpread.toFixed(3)}`)
  ok(correctSpread > wrongSpread * 4,
    'the correct covariate should split the target far more than a scrambled one')
  console.log(`  target spread: correct ${correctSpread.toFixed(3)}, scrambled ${wrongSpread.toFixed(3)}`)
}

// --- clickable legend toggles layers ------------------------------------
{
  const sec = document.getElementById('shrinkage')
  const buttons = [...sec.querySelectorAll('.legend-toggle button')]
  ok(buttons.length >= 4, `expected layer toggles in the legend, found ${buttons.length}`)
  ok(buttons.every((b) => b.getAttribute('aria-pressed') === 'true'),
    'every layer should start enabled')

  // Toggle no_pool, not truth: jsdom has no IntersectionObserver, so trackSteps
  // falls back to step 0, where truth is not drawn yet and hiding it correctly
  // changes nothing. no_pool is visible from the first step.
  const before = snap('shrinkage')
  const button = buttons.find((b) => b.dataset.layer === 'no_pool')
  ok(button, 'the legend should expose a no-pooling layer')
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(80)

  ok(snap('shrinkage') !== before, 'toggling a layer should redraw the chart')
  ok(sec.querySelector('[data-layer="no_pool"]').getAttribute('aria-pressed') === 'false',
    'the toggled entry should read as off')

  // And back on again, restoring the original chart exactly.
  sec.querySelector('[data-layer="no_pool"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(80)
  ok(sec.querySelector('[data-layer="no_pool"]').getAttribute('aria-pressed') === 'true',
    'toggling twice should restore the layer')
  ok(snap('shrinkage') === before, 'toggling twice should restore the chart exactly')
}

// --- band filter hides players by observation count ---------------------
// Sections 2, 6 and 7 each carry a filter on the 5/10/20/30 ladder. Hiding a
// band must remove those players (and, in section 2, their facet) from the
// chart, must leave the takeaway alone, and must be fully reversible.
{
  // The control repaints its buttons on every click, so always look them up
  // fresh rather than holding a reference across a click.
  const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  const bandButtons = (id) => [...document.getElementById(id)
    .querySelectorAll('.band-filter button[data-band]')].filter((b) => b.dataset.band !== 'all')
  const pressed = (id, band) => document.getElementById(id)
    .querySelector(`.band-filter button[data-band="${band}"]`)?.getAttribute('aria-pressed')
  const clickBand = async (id, band) => {
    click(document.getElementById(id).querySelector(`.band-filter button[data-band="${band}"]`))
    await settle(60)
  }
  const playerTitles = (id) => [...chartSvg(id).querySelectorAll('title')]
    .filter((t) => /^Player \d+ — \d+ serves/.test(t.textContent)).length

  for (const id of ['shrinkage', 'covariate-correct', 'covariate-wrong']) {
    const bands = bandButtons(id).map((b) => Number(b.dataset.band))
    ok(bands.length === 4, `${id}: expected four band buttons, found ${bands.length}`)
    ok(bands.every((b) => pressed(id, b) === 'true'), `${id}: every band should start shown`)
    ok(document.getElementById(id).querySelector('.band-filter-all')?.hidden,
      `${id}: "Show all" should be hidden while every band is shown`)

    const before = snap(id)
    const beforeText = takeaway(id)
    const beforeTitles = playerTitles(id)
    ok(beforeTitles === 40, `${id}: should tooltip all 40 players before filtering, got ${beforeTitles}`)

    await clickBand(id, bands[0]) // hide the five-serve players
    ok(snap(id) !== before, `${id}: hiding a band should redraw the chart`)
    ok(pressed(id, bands[0]) === 'false', `${id}: the hidden band should read as off`)
    ok(!/\b5 serves/.test(snap(id)), `${id}: no five-serve player should remain on the chart`)
    ok(playerTitles(id) === 30, `${id}: 30 players should remain, got ${playerTitles(id)}`)
    ok(takeaway(id) === beforeText, `${id}: the takeaway must not change with the filter`)
    ok(!document.getElementById(id).querySelector('.band-filter-all').hidden,
      `${id}: "Show all" should appear once a band is hidden`)

    // The last band on cannot be turned off.
    await clickBand(id, bands[1])
    await clickBand(id, bands[2])
    ok(pressed(id, bands[3]) === 'true', `${id}: one band should be left on`)
    await clickBand(id, bands[3])
    ok(pressed(id, bands[3]) === 'true', `${id}: the last band on must refuse to turn off`)
    ok(playerTitles(id) === 10, `${id}: a single band should leave 10 players, got ${playerTitles(id)}`)

    await clickBand(id, 'all')
    ok(snap(id) === before, `${id}: "Show all" should restore the chart exactly`)
    ok(bands.every((b) => pressed(id, b) === 'true'), `${id}: "Show all" should press every band`)
  }

  // Section 2 loses the facet as well as the rows.
  {
    await clickBand('shrinkage', 30)
    ok(!/30 serves/.test(snap('shrinkage')), 'shrinkage: a hidden band should lose its facet label')
    ok(/20 serves/.test(snap('shrinkage')), 'shrinkage: the other facets should keep their labels')
    await clickBand('shrinkage', 'all')
  }
  console.log('  band filter: 5/10/20/30 buttons on sections 2, 6 and 7; hide, floor at one band, show all')
}

// --- player selection ---------------------------------------------------
const beforeSelect = snap('shrinkage')
setState({ selectedPlayer: 12 }, 'select')
ok(snap('shrinkage') !== beforeSelect, 'selecting a player must redraw the shrinkage chart')

// --- complete pooling: one belief over every serve on the team -----------
{
  const sec = document.getElementById('complete-pooling')
  ok(sec, 'the complete-pooling section should mount')
  ok(snap('complete-pooling').length > 0, 'the shared belief panel should render on mount')

  const nObs = state.scenario.observations.y.length
  const capEl = sec.querySelector('[data-role="caption"]')

  // The visible caption DESCRIBES the panel; the serve count it used to open
  // with is a readout of something already on the chart, so it now sits behind
  // the Detail toggle. Both halves are asserted: the description has to say
  // whose serves these are (the claim that distinguishes this section from the
  // one-player one next door), and the count has to still exist to be revealed.
  // Whose serves these are is the claim that distinguishes this section from
  // the one-player one next door, so it stays visible -- but the wording is the
  // section's to choose, so this asserts the claim rather than a sentence.
  ok(/team|every player/i.test(visible(capEl)),
    'the visible caption should say whose serves these are')
  ok(/belief/i.test(visible(capEl)),
    'the visible caption should describe what the marks are')
  ok(!new RegExp(`of ${nObs} serves`).test(visible(capEl)),
    'the visible caption should not read the serve count back off the chart')
  ok(new RegExp(`of ${nObs} serves`).test(detailText(capEl)),
    `the Detail run should still account for all ${nObs} serves, not one player's`)

  // The width trace is the section's second panel and carries the "diminishing
  // returns" argument that the fixed-ruler panel cannot show.
  ok(sec.querySelector('[data-role="width"] svg'), 'the width trace should render')
  ok(/√n|sqrt/i.test(sec.querySelector('[data-role="width-caption"]').textContent),
    'the width caption should name the 1/sqrt(n) reference')

  // It follows Scale but deliberately NOT d*: the difficulties here are real
  // per-serve data, not the rail's reference value. The ambient scale here is
  // probability, so flip away and back rather than setting it to what it is.
  const captionOf = () => sec.querySelector('[data-role="caption"]').textContent
  // The scale note is a CAVEAT, not a mark, so it now sits behind the Detail
  // toggle: the rail's Scale control and the chart's own axis label already say
  // which scale the reader is on, and the caption was the third place saying it.
  // What still has to hold is that the caption restates the belief when the
  // scale changes -- asserted below -- and that the rate survives to be revealed.
  ok(/success rate/i.test(sec.querySelector('[data-role="caption"]').textContent),
    'the probability scale should still restate the belief as a success rate')
  const onProbability = captionOf()
  setState({ scale: 'theta' }, 'scale')
  ok(captionOf() !== onProbability, 'the scale toggle should restate the shared belief')
  ok(/ability scale/i.test(captionOf()), 'the theta scale should say so')
  setState({ scale: 'probability' }, 'scale')
  ok(captionOf() === onProbability, 'switching back should restore the caption')

  const beforeD = captionOf()
  setState({ difficulty: 1.0 }, 'difficulty')
  ok(captionOf() === beforeD,
    'd* must not move this section: its difficulties are real per-serve data')
  setState({ difficulty: 0 }, 'difficulty')
}

// --- bayesian updating: stepping, shuffling, and the prior swap ----------
// Known harness limitation: jsdom has no IntersectionObserver, so trackSteps
// falls back to fire(0) (lib/scroll.js:42) and this harness only ever exercises
// the belief scrolly at step 0. Step coverage for the belief panel comes from
// render-test.mjs, which calls the chart module directly across steps. Do NOT
// add an IntersectionObserver stub to widen this: four existing sections
// depend on the current fallback and would change behaviour under one.
{
  const sec = document.getElementById('no-pooling')
  ok(sec, 'the no-pooling section should mount')
  ok(snap('no-pooling').length > 0, 'the guided belief panel should render on mount')

  // The control bar drives the free-play figure, not the pinned scrolly one, so
  // these snapshot [data-role="free-chart"] rather than going through snap(),
  // which is fixed to [data-role="chart"].
  const freeSnap = () => sec.querySelector('[data-role="free-chart"] svg')?.outerHTML ?? ''
  const traceSnap = () => sec.querySelector('[data-role="trace"] svg')?.outerHTML ?? ''
  const takeawayOf = (el, role) => el.querySelector(`[data-role="${role}"]`)?.textContent ?? ''
  const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

  const before = freeSnap()
  ok(before.length > 0, 'the free-play belief panel should render on mount')
  ok(traceSnap().length > 0, 'the rate trace should render on mount')

  const next = sec.querySelector('[data-role="controls"] button[data-act="next"]')
  ok(next, 'the control bar should offer a next-serve button')
  click(next)
  await settle(80)
  ok(freeSnap() !== before, 'advancing a serve should redraw the belief panel')
  click(sec.querySelector('[data-role="controls"] button[data-act="prev"]'))
  await settle(80)
  ok(freeSnap() === before, 'stepping back should restore the previous drawing exactly')

  // --- the two point estimates -------------------------------------------
  // The prior's answer and the posterior mean now, and nothing else: the
  // evidence between them is not summarised into a number at all, it is the
  // likelihood strip under the panel, which the copy has to send the reader to.
  const readout = () => sec.querySelector('[data-role="estimates-readout"]')?.textContent ?? ''
  ok(/prior/.test(readout()) && /model/.test(readout()),
    'the live readout should carry both estimates')
  ok(!/own data/.test(readout()),
    'the data-only estimate is gone and must not come back in the readout')
  ok(/strip under the panel is\s+empty/.test(takeawayOf(sec, 'estimates-takeaway')),
    'the n=0 copy should say there is nothing to multiply by yet')

  const readBefore = readout()
  click(next)
  await settle(80)
  ok(readout() !== readBefore, 'absorbing a serve should move the live readout')
  const oneServe = takeawayOf(sec, 'estimates-takeaway')
  ok(/the model says/.test(oneServe),
    'after one serve the copy should quote where the model now stands')
  ok(/strip below/.test(oneServe) && /(made|missed) at d =/.test(oneServe),
    'the copy should send the reader to the likelihood strip for the serve just absorbed')

  // The estimate ticks are their own layer. layerLegend repaints its own
  // innerHTML on every toggle, so the button has to be looked up again each
  // time -- the old node is detached and a click on it goes nowhere.
  const estToggle = () => sec.querySelector('[data-role="legend"] button[data-layer="estimates"]')
  ok(estToggle(), 'the legend should offer the estimate ticks as a layer')
  const withTicks = freeSnap()
  click(estToggle())
  await settle(60)
  ok(freeSnap() !== withTicks, 'hiding the estimate ticks should redraw the panel')
  click(estToggle())
  await settle(60)
  ok(freeSnap() === withTicks, 'showing them again should restore the drawing exactly')
  click(sec.querySelector('[data-role="controls"] button[data-act="prev"]'))
  await settle(80)

  // Shuffle changes the path but not the destination.
  const select = sec.querySelector('[data-role="controls"] select')
  ok(select, 'the control bar should offer a player selector')
  select.value = String(31)
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await settle(80)
  ok(state.selectedPlayer === 31, 'choosing a player should publish the selection')
  ok(/Player 31\b/.test(takeawayOf(sec, 'rate-takeaway')),
    'the rate readout should name the selected player')

  // The prior swap lives in the shrinkage section now, so this is a
  // CROSS-SECTION claim: shuffling here must not move the numbers there. It
  // holds because the swap is computed from the destination posterior, which
  // multiplication makes order-free -- keep the assertion, it is the one that
  // would catch someone recomputing the swap from a step-indexed frame.
  const shrink = () => document.getElementById('shrinkage')
  const endText = takeawayOf(sec, 'rate-takeaway')
  const priorText = takeawayOf(shrink(), 'prior-takeaway')
  const beforeTrace = traceSnap()
  click(sec.querySelector('[data-act="shuffle"]'))
  await settle(80)
  ok(takeawayOf(sec, 'rate-takeaway') === endText,
    'shuffling the order must not change the final readout')
  ok(takeawayOf(shrink(), 'prior-takeaway') === priorText,
    'shuffling the order must not change where the prior swap lands')
  ok(traceSnap() !== beforeTrace, 'shuffling should change the path the running rate takes')
  click(sec.querySelector('[data-act="reset"]'))
  await settle(80)
  ok(traceSnap() === beforeTrace, 'reset should restore the true serve order')

  // Changing player must move the no-pooling curve and leave complete pooling put.
  ok(/\bcomplete pooling\b/i.test(sec.querySelector('[data-role="free-caption"]').textContent),
    'the caption should name the complete-pooling layer')
  const beforePlayer = freeSnap()
  select.value = String(4)
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await settle(80)
  ok(freeSnap() !== beforePlayer, 'changing player should redraw the belief panel')
  // Selection flows FORWARD: the reader picks here, and the derivation in the
  // next section names whoever they picked.
  ok(/Player 4\b/.test(takeawayOf(shrink(), 'prior-takeaway')),
    'the prior-swap takeaway should follow the player selected upstream')

  // The 2x2's partial-pooling row is blank until the prior swap is reached;
  // with no IntersectionObserver here, renderWhenNear fires at once.
  ok(/N\(.*\).*learned from the team/.test(
    shrink().querySelector('[data-role="partial-row"]')?.textContent ?? ''),
  'the 2x2 should fill in the partial-pooling prior')

  // The Scale control reaches this section: it restates the same belief as a
  // success rate rather than bending the density through plogis.
  const beforeScale = sec.querySelector('[data-role="free-caption"]').textContent
  setState({ scale: 'theta' }, 'scale')
  await settle(40)
  ok(sec.querySelector('[data-role="free-caption"]').textContent !== beforeScale,
    'changing scale should restate the belief in the caption')
  setState({ scale: 'probability' }, 'scale')
  await settle(40)
  ok(sec.querySelector('[data-role="free-caption"]').textContent === beforeScale,
    'switching the scale back should restore the caption')

  console.log('  belief: stepping redraws, shuffle preserves the destination, the two point ' +
    'estimates track the step, the prior swap and the rate ' +
    'readout follow the selected player')
}

// --- the two-skill story ------------------------------------------------
// The dimension toggle swaps the payload shape, so main.js remounts every
// section rather than asking them to re-render in place. This does the same:
// tear down, swap the payload, mount the full list main.js mounts -- the two
// sections the 1D checks above skip (convergence, the team sweep) included,
// since both fetch on mount and both have a 2D branch.
if (existsSync(join(D, 'scenarios-2d', 'distinct__20260914__2d.json'))) {
  const remount = () => {
    for (const teardown of mounted) teardown()
    mounted.length = 0
    app.innerHTML = ''
    for (const [, section] of SECTIONS) {
      const { el, mount } = section()
      app.appendChild(el)
      mounted.push(mount() ?? (() => {}))
    }
  }
  const [skill1, skill2] = index.skill_labels ?? []
  ok(skill1 && skill2, 'index.json should name both skills')

  state.dimension = '2d'
  state.population = 'distinct'
  state.seed = 20260914
  state.scenario = read('scenarios-2d/distinct__20260914__2d.json')
  state.selectedPlayer = null
  state.scale = 'probability'
  state.difficulty = 0
  remount()
  // Three sections fetch on mount (five 2D teams, the 2D sweep, the team
  // sweep and its replicates); give them longer than the 1D mount got.
  await settle(700)

  for (const id of ['team', 'shrinkage', 'covariate-correct', 'covariate-wrong',
    'evidence', 'convergence', 'team-sweep']) {
    ok(chartSvg(id), `2D: ${id} should render a chart on mount`)
  }

  // Complete pooling DOES render in two skills: the joint factorises exactly,
  // so the belief is the outer product of the two per-skill posteriors and the
  // contours come out axis-aligned by construction. That is a claim the
  // one-skill view cannot make, so the section is fuller here, not thinner.
  {
    const cp = document.getElementById('complete-pooling')
    ok(cp, '2D: the complete-pooling section should mount')
    ok(!cp.querySelector('.note'), '2D: complete pooling should draw, not opt out')
    ok(chartSvg('complete-pooling'), '2D: complete pooling should render a belief surface')
    const text = cp.textContent
    const capEl = cp.querySelector('[data-role="caption"]')
    // The play count moved behind the Detail toggle; it must still be there,
    // and it must still say plays rather than serves.
    ok(/plays absorbed/.test(detailText(capEl)),
      '2D: the Detail run should count plays, not serves')
    ok(/filled regions|50%|90%/i.test(visible(capEl)),
      '2D: the visible caption should describe what the filled regions are')
    for (const label of state.scenario.skill_labels) {
      ok(text.includes(label), `2D: the surface should name the "${label}" skill`)
    }
    // This one is checked on VISIBLE text: "it cannot tilt" is the section's
    // whole argument, so it must survive with the numbers put away.
    ok(/square|axis-aligned|tilt|lean/i.test(visible(cp)),
      '2D: the visible prose should say the belief cannot tilt')
  }

  // The one-player walk-through IS one skill at a time -- a belief over two
  // abilities from ONE player's plays is a different figure with a different
  // lesson -- so it still degrades to a note.
  {
    const belief = document.getElementById('no-pooling')
    ok(belief, '2D: the no-pooling section should still mount')
    ok(belief.querySelector('.note'), '2D: the no-pooling section should explain why it is absent')
    ok(!chartSvg('no-pooling'), '2D: the no-pooling section should draw no chart')
    // The derivation grafted onto shrinkage is 1D-only for a different reason --
    // it reads sc.observations, which under two skills lives inside skills[].
    ok(document.getElementById('shrinkage').querySelector('[data-role="opening"]')
      ?.classList.contains('note'),
    '2D: the shrinkage derivation should degrade to a note, not read skill 1 silently')
  }

  // The band filter follows the dimension: plays, not serves, and it still
  // removes players from the ellipse chart.
  {
    const sec = document.getElementById('shrinkage')
    const buttons = [...sec.querySelectorAll('.band-filter button[data-band]')].filter((b) => b.dataset.band !== 'all')
    ok(buttons.length === 4, `2D: expected four band buttons on the shrinkage section, found ${buttons.length}`)
    ok(/plays/.test(sec.querySelector('.band-filter')?.textContent ?? ''), '2D: the band filter should count plays')
    const before = snap('shrinkage')
    sec.querySelector('.band-filter button[data-band="5"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(80)
    ok(snap('shrinkage') !== before, '2D: hiding a band should redraw the ellipse chart')
    ok(!/\b5 plays/.test(snap('shrinkage')), '2D: no five-play player should remain on the chart')
    sec.querySelector('.band-filter-all').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(80)
    ok(snap('shrinkage') === before, '2D: "Show all" should restore the ellipse chart exactly')
  }

  // Player numbers: a 2D-only legend entry, off by default, that prints each
  // player's id beside their marks so a × can be matched to its point.
  for (const id of ['shrinkage', 'covariate-correct']) {
    const sec = document.getElementById(id)
    const entry = sec.querySelector('.legend-toggle button[data-layer="labels"]')
    ok(entry, `2D: ${id} should offer a Player numbers layer`)
    ok(entry?.getAttribute('aria-pressed') === 'false', `2D: ${id} player numbers should start off`)
    const labelsOf = () => [...chartSvg(id).querySelectorAll('text')]
      .filter((t) => /^\d+$/.test(t.textContent.trim())).length
    const before = { svg: snap(id), labels: labelsOf() }
    entry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(80)
    ok(snap(id) !== before.svg, `2D: ${id} turning on player numbers should redraw the chart`)
    // Axis ticks are numbers too, so compare against the count before: at
    // least one label per shown player must have been added.
    ok(labelsOf() >= before.labels + 40, `2D: ${id} should print a number beside every player, added ${labelsOf() - before.labels}`)
    sec.querySelector('.legend-toggle button[data-layer="labels"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await settle(80)
    ok(snap(id) === before.svg, `2D: ${id} turning player numbers off should restore the chart exactly`)
  }
  ok(!document.getElementById('shrinkage').querySelector('.band-filter button[data-band="all"]:not([hidden])'),
    '2D: the band filter should still be at show-all after the label checks')

  // Clicking a player in 2D should quote their numbers in BOTH skills.
  setState({ selectedPlayer: 12 }, 'select')
  const detail = document.getElementById('shrinkage')
    .querySelector('[data-role="detail"]')?.textContent ?? ''
  ok(/Player 12/.test(detail), '2D: the detail should name the selected player')
  ok(detail.includes(skill1) && detail.includes(skill2),
    `2D: the detail should quote both ${skill1} and ${skill2}`)

  // The scale toggle reaches the pinned chart and the team sweep alike.
  const before2d = { shrink: snap('shrinkage'), widths: snap('team-sweep') }
  ok(before2d.widths.length > 0, '2D: the team sweep should render its widths chart')
  setState({ scale: 'theta' }, 'scale')
  ok(snap('shrinkage') !== before2d.shrink, '2D: changing scale must redraw the ellipse chart')
  ok(/ability/i.test(snap('shrinkage')), '2D: theta scale should label the axes as ability')
  ok(snap('team-sweep') !== before2d.widths, '2D: changing scale must redraw the sweep widths')
  setState({ scale: 'probability' }, 'scale')
  ok(snap('shrinkage') === before2d.shrink, '2D: switching back should restore the ellipse chart')

  // Evidence scores each arm per skill, so the table names both.
  const rlh = document.getElementById('evidence').querySelector('.metric-table')?.textContent ?? ''
  ok(/RLH/i.test(rlh), '2D: evidence should report root likelihood')
  ok(rlh.includes(skill1) && rlh.includes(skill2),
    `2D: the RLH table should score both ${skill1} and ${skill2}`)

  // The team section's 2D takeaway is about the correlation between skills.
  ok(/ρ|correlat/.test(document.getElementById('team').textContent),
    '2D: the team section should talk about the correlation between skills')

  // The team sweep draws its replicates and quotes their coverage.
  const sweepEl = document.getElementById('team-sweep')
  ok(sweepEl.querySelector('[data-role="teams"] svg'), '2D: the sweep should draw the replicate teams')
  ok(/\d+%/.test(sweepEl.querySelector('[data-role="takeaway-teams"]')?.textContent ?? ''),
    '2D: the replicate takeaway should quote a coverage percentage')

  // A one-group population has no correct covariate in 2D either.
  state.population = 'one_population'
  setState({ scenario: read('scenarios-2d/one_population__20260914__2d.json'), selectedPlayer: null }, 'scenario')
  await settle()
  ok(/Not available/.test(document.getElementById('covariate-correct').textContent),
    '2D: a one-group population should mark the correct covariate as unavailable')
  ok(!chartSvg('covariate-correct'), '2D: the unavailable section should draw no chart')
  if (state.scenario.arms.wrong && state.scenario.analysis_covariates?.wrong) {
    ok(chartSvg('covariate-wrong'), '2D: the scrambled covariate should still render')
  }
  ok(chartSvg('team') && /one population|sample from/i.test(document.getElementById('team').textContent),
    '2D: a one-group population should get its own headline')

  // And back: the toggle is reversible, and the 1D sections come up clean.
  state.dimension = '1d'
  state.population = 'distinct'
  state.seed = 20260914
  state.scenario = read('scenarios/distinct__20260914.json')
  state.selectedPlayer = null
  remount()
  await settle(400)
  ok(snap('shrinkage').length > 0, 'back to 1D: the shrinkage chart should render again')
  ok(!document.getElementById('shrinkage').querySelector('.legend-toggle button[data-layer="labels"]'),
    'back to 1D: the Player numbers entry is 2D-only and should be gone')
  ok(/One row per player/.test(
    document.getElementById('shrinkage').querySelector('[data-role="caption"]')?.textContent ?? ''),
  'back to 1D: the shrinkage caption should be the 1D one')
  ok(chartSvg('team'), 'back to 1D: the team section should render its density')
  console.log(`  2D: ${SECTIONS.length} sections mounted; detail quotes ${skill1} and ${skill2}; ` +
    'scale, selection and population switches all redraw; toggle reverses cleanly')
} else {
  console.log('  2D: skipped, scenarios-2d not generated')
}

// --- the rail's section nav ---------------------------------------------
// Known harness limitation: jsdom has no IntersectionObserver, so
// trackSections() takes its early return and hands back an empty teardown
// (lib/scroll.js:66) without ever firing. The aria-current highlighting that
// follows the reader down the page therefore cannot be exercised headlessly --
// that needs a real viewport and a real scroll. Do NOT stub an
// IntersectionObserver to widen this: four sections already depend on the
// current fallbacks (see the note on the belief block above) and would change
// behaviour under one.
//
// What is checked here is everything that is not the highlight: one entry per
// mounted section, every data-target naming a real section, the labels tracking
// the sections' own eyebrows, the click wiring, and -- the bug this nav is most
// likely to grow -- a remount rebuilding the entries rather than stacking a
// second set of eight on top of the first.
{
  const { buildSectionNav, splitEyebrow } = await import('../src/lib/sectionNav.js')
  const NAV_SECTIONS = SECTIONS.map(([, factory]) => factory)

  const nav = document.createElement('nav')
  nav.id = 'section-nav'
  nav.className = 'rail-nav'
  document.body.appendChild(nav)

  // Remount exactly the way the dimension block above does, which is the way
  // main.js's mountSections() does.
  const remountAll = () => {
    for (const teardown of mounted) teardown()
    mounted.length = 0
    app.innerHTML = ''
    for (const section of NAV_SECTIONS) {
      const { el, mount } = section()
      app.appendChild(el)
      mounted.push(mount() ?? (() => {}))
    }
    return [...app.querySelectorAll(':scope > section')]
  }
  const entriesIn = () => [...nav.querySelectorAll('button')]
  const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  // The real splitter, not a second copy of it. lib/sectionNav.js exports it
  // precisely so this harness can check the shipped rule rather than a
  // paraphrase that can drift from it.
  const eyebrowOf = (section) => {
    const raw = (section.querySelector('.eyebrow')?.textContent ?? '')
      .replace(/\s+/g, ' ').trim()
    return { ...splitEyebrow(raw, section.id), raw }
  }

  state.dimension = '1d'
  state.population = 'distinct'
  state.seed = 20260914
  state.scenario = read('scenarios/distinct__20260914.json')
  state.selectedPlayer = null
  state.scale = 'probability'
  let sections = remountAll()
  await settle(400)
  // The id sequence, not just the count: a reorder that keeps the same number
  // of sections is exactly the change a count cannot see, and it is the change
  // this file exists to catch.
  ok(sections.map((s) => s.id).join() === SECTION_ORDER.join(),
    `mounted sections should match SECTION_ORDER\n    got      [${sections.map((s) => s.id)}]\n    expected [${SECTION_ORDER}]`)

  const navigated = []
  buildSectionNav(nav, sections, (section) => navigated.push(section.id))

  // One entry per section, in section order, each pointing at a real section.
  ok(entriesIn().length === sections.length,
    `expected one nav entry per section (${sections.length}), found ${entriesIn().length}`)
  ok(entriesIn().map((b) => b.dataset.target).join() === sections.map((s) => s.id).join(),
    'nav entries should be in section order')
  for (const button of entriesIn()) {
    ok(button.type === 'button', `entry "${button.dataset.target}" should be type=button`)
    ok(document.getElementById(button.dataset.target),
      `data-target "${button.dataset.target}" should name a section that is on the page`)
  }

  // The labels are derived from the sections, not from a second list in
  // main.js: if a section module renumbers or retitles itself, the nav follows.
  const labels = []
  sections.forEach((section, i) => {
    const { number, title, raw } = eyebrowOf(section)
    const button = entriesIn()[i]
    ok(button.querySelector('.rail-nav-num')?.textContent === number,
      `${section.id}: the entry should carry the eyebrow's number "${number}"`)
    ok(button.querySelector('.rail-nav-title')?.textContent === title,
      `${section.id}: the entry title should be the eyebrow's title "${title}"`)
    ok(button.title === raw, `${section.id}: the full eyebrow should survive in the tooltip`)
    // And the number the section wears must be the one sectionOrder.js assigns:
    // this is what stops an eyebrow being renumbered by hand and drifting.
    ok(Number(number) === numberOf(section.id),
      `${section.id}: eyebrow says "${number}" but SECTION_ORDER says ${numberOf(section.id)}`)
    labels.push(raw)
  })

  // Click wiring: the entry hands its section back to the caller to scroll to.
  // (jsdom has no scrollIntoView either, which is why the navigate callback is
  // a parameter rather than baked into the button.)
  click(entriesIn()[3])
  ok(navigated.length === 1 && navigated[0] === sections[3].id,
    `clicking entry 4 should navigate to "${sections[3].id}", got ${navigated.join() || 'nothing'}`)
  ok(entriesIn()[3].getAttribute('aria-current') === 'true',
    'a clicked entry should read as current immediately')
  click(entriesIn()[6])
  ok(navigated[1] === sections[6].id, 'clicking another entry should navigate there too')
  ok(entriesIn().filter((b) => b.getAttribute('aria-current') === 'true').length === 1,
    'only one entry at a time should be marked current')

  // The rebuild. main.js calls mountSections() again on every population and
  // dimension change; the nav has to be replaced, not appended to.
  const before = entriesIn().length
  sections = remountAll()
  await settle(400)
  buildSectionNav(nav, sections, (section) => navigated.push(section.id))
  ok(entriesIn().length === before,
    `a remount must rebuild the nav, not duplicate it: ${entriesIn().length} entries, expected ${before}`)
  ok(entriesIn().every((b, i) => document.getElementById(b.dataset.target) === sections[i]),
    'the rebuilt entries should target the freshly mounted sections, not the detached ones')

  // Sections that degrade still get an entry -- a nav that quietly drops two of
  // eight is worse than one that takes the reader somewhere thin.
  state.population = 'one_population'
  setState({ scenario: read('scenarios/one_population__20260914.json'), selectedPlayer: null }, 'scenario')
  sections = remountAll()
  await settle(400)
  buildSectionNav(nav, sections, () => {})
  ok(entriesIn().length === SECTION_ORDER.length,
    `a one-group population should still get ${SECTION_ORDER.length} entries, found ${entriesIn().length}`)
  ok(/Not available/.test(document.getElementById('covariate-correct').textContent),
    'section 6 should be the unavailable one for a one-group population')
  ok(entriesIn().some((b) => b.dataset.target === 'covariate-correct'),
    'the unavailable section 6 must keep its nav entry')

  if (existsSync(join(D, 'scenarios-2d', 'distinct__20260914__2d.json'))) {
    state.dimension = '2d'
    state.population = 'distinct'
    state.scenario = read('scenarios-2d/distinct__20260914__2d.json')
    state.scale = 'theta'
    sections = remountAll()
    await settle(700)
    buildSectionNav(nav, sections, () => {})
    ok(document.getElementById('no-pooling').querySelector('.note'),
      '2D: the no-pooling section should be a note under the two-skill toggle')
    ok(entriesIn().length === SECTION_ORDER.length &&
      entriesIn().some((b) => b.dataset.target === 'no-pooling'),
    '2D: the note-only no-pooling section must keep its nav entry')
    state.dimension = '1d'
    state.scale = 'probability'
  }

  console.log(`  section nav: ${labels.join(' · ')}`)
}

// --- the Detail disclosure, swept across every section --------------------
// The per-section assertions above check particular sentences. This checks the
// three ways the mechanism can fail silently EVERYWHERE at once.
{
  state.dimension = '1d'
  state.population = 'distinct'
  state.seed = 20260914
  state.scenario = read('scenarios/distinct__20260914.json')
  state.selectedPlayer = null
  state.scale = 'probability'
  for (const teardown of mounted) teardown()
  mounted.length = 0
  app.innerHTML = ''
  for (const [, section] of SECTIONS) {
    const { el, mount } = section()
    app.appendChild(el)
    mounted.push(mount() ?? (() => {}))
  }
  await settle(600)

  let runs = 0
  let withDetail = 0
  for (const section of [...app.querySelectorAll(':scope > section')]) {
    const id = section.id

    // 1. The textContent trap. A `.detail` span assigned through
    //    `el.textContent = ...` instead of `.innerHTML` does not become an
    //    element -- it becomes the literal characters `<span class="detail">`
    //    sitting in the reader's caption. Nothing else in this file would
    //    notice, because the markup IS the text.
    ok(!/<span|<\/span>|class="detail"/.test(section.textContent),
      `${id}: literal markup leaked into the text -- a .detail span was assigned ` +
      'through .textContent instead of .innerHTML')

    // 2. Nothing went blank. Moving a whole caption behind the toggle would
    //    leave the reader looking at an unlabelled chart.
    for (const el of section.querySelectorAll('figcaption, .takeaway')) {
      const full = el.textContent.replace(/\s+/g, ' ').trim()
      if (!full) continue
      const seen = visible(el)
      ok(seen.length > 0,
        `${id}: a ${el.tagName.toLowerCase()} is entirely behind the Detail toggle and reads blank with it off`)
      // A description, not a stub left behind after the numbers were cut.
      ok(seen.length >= 40 || seen === full,
        `${id}: visible prose is down to ${seen.length} chars ("${seen}") -- too thin to describe the chart`)

      // And the other direction. The site is narrated live, so a caption names
      // the marks and stops; the numbers, the methodology, the control caveats
      // and the provenance asides all sit behind the Detail toggle. Without a
      // ceiling this silently creeps back: it was 15,238 visible chars across
      // these blocks before the cut and 6,579 after, and nothing but this
      // assertion would notice it climbing again.
      //
      // The exemptions are arguments a reader cannot get from the picture, and
      // they are listed one by one rather than raising the limit for everyone:
      //   pull-takeaway    -- CLAUDE.md's noise convention. "the trend is real,
      //                       any single step is not" stays on screen.
      //   takeaway-teams   -- the coverage collapse, 80% -> 11% against 85% ->
      //   takeaway-coverage   89%. The chart draws the curves; only the prose
      //                       says which of them is answering the question.
      const EXEMPT = new Set(['pull-takeaway', 'takeaway-teams', 'takeaway-coverage'])
      const ceiling = EXEMPT.has(el.dataset.role || '') ? 560 : 240
      ok(seen.length <= ceiling,
        `${id}: ${el.dataset.role || el.tagName.toLowerCase()} shows ${seen.length} visible chars ` +
        `(limit ${ceiling}) -- move the numbers, methodology or caveats behind the Detail toggle\n    "${seen}"`)
      const n = el.querySelectorAll('.detail').length
      runs += n
      if (n) withDetail++
    }

    // 3. Every `.detail` run actually holds something.
    for (const d of section.querySelectorAll('.detail')) {
      ok(d.textContent.trim().length > 0, `${id}: an empty .detail run`)
    }
  }

  // The pass happened at all. If a future edit reverted the prose wholesale
  // this would drop to zero and nothing else here would care.
  ok(runs >= 20, `expected the measured numbers to be behind the toggle, found only ${runs} detail runs`)
  console.log(`  detail disclosure: ${runs} runs across ${withDetail} captions/takeaways, ` +
    'no literal markup, nothing blank with Detail off')
}

console.log(fails === 0 ? '\nOK - interactions rewire correctly' : `\n${fails} FAILURE(S)`)
process.exit(fails ? 1 : 0)
