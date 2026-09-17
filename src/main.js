import './styles.css'
import { loadIndex, loadScenario, scenarioId, armTokens, hasDimension2d } from './data.js'
import { state, setState } from './state.js'
import { theTeam } from './sections/team.js'
import { adaptiveShrinkage } from './sections/shrinkage.js'
import { beliefUpdateSection } from './sections/beliefUpdate.js'
import { convergence } from './sections/convergence.js'
import { teamSweep } from './sections/teamSweep.js'
import { correctCovariateSplit, wrongCovariateSplit } from './sections/covariateSplit.js'
import { evidence } from './sections/evidence.js'

const app = document.getElementById('app')
const railPopulation = document.getElementById('population')
const railSeed = document.getElementById('seed')
const railDimension = document.getElementById('dimension')
const dimensionControl = document.getElementById('dimension-control')
const railScale = document.getElementById('scale')
const railView = document.getElementById('view')
const railDifficulty = document.getElementById('difficulty')
const difficultyValue = document.getElementById('difficulty-value')
const difficultyControl = document.getElementById('difficulty-control')
const progress = document.getElementById('progress')

const SECTIONS = [theTeam, adaptiveShrinkage, beliefUpdateSection, convergence, teamSweep,
  correctCovariateSplit, wrongCovariateSplit, evidence]
let mounted = []

function fail (message) {
  app.innerHTML = ''
  const box = document.createElement('div')
  box.className = 'wrap'
  box.innerHTML = `<div class="error"><strong>Could not load the story.</strong><br>${message}</div>`
  app.appendChild(box)
}

/**
 * Surface runtime errors on the page.
 *
 * A chart that throws mid-render leaves the previous SVG sitting there, so the
 * page looks fine and the control appears to do nothing. That is a miserable
 * thing to debug from a description, and this turns it into a visible banner.
 */
function showRuntimeError (label, err) {
  let bar = document.getElementById('runtime-error')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'runtime-error'
    bar.className = 'error'
    bar.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:60;margin:0;max-width:none;' +
      'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:40vh;overflow:auto'
    document.body.appendChild(bar)
  }
  const line = document.createElement('div')
  line.textContent = `${label}: ${err?.stack || err?.message || err}`
  bar.appendChild(line)
}

window.addEventListener('error', (e) => showRuntimeError('error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showRuntimeError('promise', e.reason))

function hero () {
  const el = document.createElement('div')
  el.className = 'wrap hero'
  el.innerHTML = `
    <h1>You watched one player serve five times. Another, thirty. How good is each one?</h1>
    <p>Forty players. Some you have barely seen. A model has to decide, for each
       one, how much to trust what it watched and how much to borrow from
       everyone else.</p>
    <p>That decision has a right answer, and it changes from player to player.
       Scroll to watch it happen — and use the controls above to change the
       population the players were drawn from.</p>`
  return el
}

function populateRail (index) {
  railPopulation.innerHTML = index.populations
    .map((p) => `<option value="${p.preset}">${p.label}</option>`).join('')
  railPopulation.value = state.population
  syncSeeds(index)
}

function syncSeeds (index) {
  const pop = index.populations.find((p) => p.preset === state.population)
  railSeed.innerHTML = pop.seeds
    .map((s, i) => `<option value="${s}">Team ${i + 1}</option>`).join('')
  if (!pop.seeds.includes(state.seed)) state.seed = pop.default_seed
  railSeed.value = state.seed
  return pop
}

async function swapScenario () {
  const id = scenarioId(state.population, state.seed, state.dimension)
  const panels = [...app.querySelectorAll('.chart-panel')]
  for (const n of panels) n.style.opacity = '0.4'
  try {
    const scenario = await loadScenario(id, state.dimension)
    setState({ scenario, selectedPlayer: null }, 'scenario')
  } catch (err) {
    fail(err.message)
  } finally {
    // Previously this dimmed the panels and never undid it, so every switch
    // after the first left the charts washed out.
    for (const n of panels) n.style.opacity = ''
  }
}

function mountSections () {
  for (const teardown of mounted) teardown()
  mounted = []
  app.innerHTML = ''
  app.appendChild(hero())
  for (const section of SECTIONS) {
    const { el, mount } = section()
    app.appendChild(el)
    mounted.push(mount() ?? (() => {}))
  }
}

function trackProgress () {
  const onScroll = () => {
    const max = document.body.scrollHeight - window.innerHeight
    progress.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : '0'
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

async function boot () {
  let index
  try {
    index = await loadIndex()
  } catch (err) {
    fail(`${err.message}. Run <code>Rscript scripts/build_site_data.R</code> first.`)
    return
  }

  // Default to the one-population case: no group label, nothing to condition
  // on, so the reader meets pooling on its own before the covariate argument
  // adds a second thing to think about. The rail steps up the ladder from here.
  const preferred = index.populations.find((p) => p.preset === 'one_population')
  state.population = preferred?.preset ?? index.populations[0].preset
  state.index = index
  state.tokens = armTokens(index)
  populateRail(index)

  await swapScenario()
  mountSections()
  trackProgress()

  railPopulation.addEventListener('change', async () => {
    state.population = railPopulation.value
    syncSeeds(index)
    await swapScenario()
    mountSections()
  })

  railSeed.addEventListener('change', async () => {
    state.seed = Number(railSeed.value)
    await swapScenario()
  })

  // The two-skill story only appears once the 2D scenarios have been built.
  // Switching dimension swaps the payload shape, so sections are remounted
  // rather than asked to re-render in place.
  //
  // Two skills are shown on the ability scale only. d* is a SERVE difficulty:
  // one difficulty cannot apply to a plane of two different kinds of play, and
  // warping each axis through plogis separately turns a posterior ellipse into
  // a shape that means nothing. The reader's 1D scale is remembered and
  // restored when they come back.
  let scale1d = state.scale
  function setScale (scale) {
    state.scale = scale
    for (const b of railScale.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.scale === scale))
    }
  }
  function syncScaleEnabled () {
    const locked = state.dimension === '2d'
    for (const b of railScale.querySelectorAll('button')) b.disabled = locked
    railScale.style.opacity = locked ? '0.4' : ''
    railScale.title = locked
      ? 'Two skills are compared on the ability scale only: a serve difficulty d* applies to one kind of play, not to a plane of two'
      : ''
    syncDifficultyEnabled()
  }
  dimensionControl.hidden = !hasDimension2d(index)
  railDimension.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-dimension]')
    if (!button || button.dataset.dimension === state.dimension) return
    for (const b of railDimension.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b === button))
    }
    state.dimension = button.dataset.dimension
    if (state.dimension === '2d') {
      scale1d = state.scale
      setScale('theta')
    } else {
      setScale(scale1d)
    }
    syncScaleEnabled()
    await swapScenario()
    mountSections()
  })

  railScale.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-scale]')
    if (!button || button.disabled) return
    for (const b of railScale.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b === button))
    }
    setState({ scale: button.dataset.scale }, 'scale')
    syncDifficultyEnabled()
  })

  // d* is a serve difficulty, so it only means anything on the probability
  // scale. Disabling it there is clearer than letting it sit live and inert.
  function syncDifficultyEnabled () {
    const applies = state.scale === 'probability' && state.dimension !== '2d'
    railDifficulty.disabled = !applies
    difficultyControl.style.opacity = applies ? '1' : '0.4'
    difficultyControl.title = applies
      ? 'Reference serve difficulty for the probability scale'
      : state.dimension === '2d'
        ? 'Two skills are compared on the ability scale only'
        : 'Only applies on the probability scale'
  }
  syncDifficultyEnabled()

  railView.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]')
    if (!button) return
    for (const b of railView.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b === button))
    }
    setState({ view: button.dataset.view }, 'view')
  })

  railDifficulty.addEventListener('input', () => {
    const value = Number(railDifficulty.value)
    difficultyValue.textContent = value.toFixed(2)
    setState({ difficulty: value }, 'difficulty')
  })
}

boot()
