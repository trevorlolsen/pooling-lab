import './styles.css'
import { loadIndex, loadScenario, scenarioId, armTokens, hasDimension2d } from './data.js'
import { trackSections } from './lib/scroll.js'
import { buildSectionNav, keepEntryVisible } from './lib/sectionNav.js'
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
const rail = document.getElementById('rail')
const sectionNav = document.getElementById('section-nav')

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

/**
 * The rail is sticky at the top, so a section scrolled to its own top lands
 * underneath it. Publishing the rail's measured height as --rail-h lets the
 * stylesheet reserve exactly that much scroll-margin, whatever the rail
 * happens to wrap to at this width.
 */
function syncRailHeight () {
  if (!rail) return
  const h = rail.offsetHeight
  if (h > 0) document.documentElement.style.setProperty('--rail-h', `${h + 12}px`)
}

/** Where a section's top should come to rest: just under the sticky rail. */
function landingOffset () {
  return (rail?.offsetHeight ?? 0) + 12
}

function scrollToSection (section) {
  if (!section.scrollIntoView) return
  // No `behavior` here on purpose: `html { scroll-behavior: smooth }` already
  // covers this, and the prefers-reduced-motion block already turns it off.
  // Passing behavior: 'smooth' would override the reader's setting.
  section.scrollIntoView({ block: 'start' })
  settleAt(section)
}

// Only ever one settler running: clicking a second entry while the first jump
// is still settling must hand the page over, not have two of these pulling it
// in different directions.
let cancelSettle = () => {}

/**
 * Keep nudging the section back into place while the page finishes growing.
 *
 * Charts render lazily as they come near the viewport (renderWhenNear), so a
 * jump from section 1 to section 6 renders four sections' worth of charts on
 * the way down and the content ABOVE the target gets taller while the smooth
 * scroll is still running. Measured in Chromium, that left the target about
 * 550px below where it was asked to be -- far enough that the reader lands in
 * the previous section and the nav honestly highlights the previous section.
 *
 * So: wait for the scroll to stop, and if the target is not where it should
 * be, close the gap without re-animating (a second smooth scroll on top of the
 * first reads as the page fighting itself). Any scroll of the reader's own
 * cancels the whole thing immediately.
 */
function settleAt (section, timeout = 1500) {
  cancelSettle()
  let cancelled = false
  const cancel = () => { cancelled = true; release() }
  const release = () => {
    for (const type of ['wheel', 'touchstart', 'keydown']) {
      window.removeEventListener(type, cancel)
    }
  }
  for (const type of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(type, cancel, { passive: true })
  }
  cancelSettle = cancel

  const deadline = Date.now() + timeout
  let previousY = null
  const tick = () => {
    if (cancelled) return
    const y = window.scrollY
    const stopped = previousY !== null && Math.abs(y - previousY) < 1
    previousY = y
    if (stopped) {
      const off = section.getBoundingClientRect().top - landingOffset()
      if (Math.abs(off) > 2) {
        window.scrollBy({ top: off, behavior: 'auto' })
        previousY = null
      }
    }
    if (Date.now() < deadline) setTimeout(tick, 100)
    else release()
  }
  setTimeout(tick, 100)
}

function mountSectionNav () {
  if (!sectionNav) return
  const sectionEls = [...app.querySelectorAll(':scope > section')]
  const entries = buildSectionNav(sectionNav, sectionEls, scrollToSection)

  // trackSections returns a teardown, and it goes on the same `mounted` array
  // the section mounts use. Without that, every population or dimension switch
  // would leave its IntersectionObserver connected to detached sections.
  mounted.push(trackSections(sectionEls, (i) => {
    entries.forEach((entry, j) => {
      if (j === i) entry.setAttribute('aria-current', 'true')
      else entry.removeAttribute('aria-current')
    })
    keepEntryVisible(sectionNav, entries[i])
  }))

  // The nav is part of the rail, so adding it changed the rail's height.
  syncRailHeight()
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
  mountSectionNav()
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

  // The rail wraps differently at every width and whenever a control appears
  // (the dimension toggle unhides below), so re-measure rather than assume.
  syncRailHeight()
  window.addEventListener('resize', syncRailHeight, { passive: true })
  if (rail && 'ResizeObserver' in window) new window.ResizeObserver(syncRailHeight).observe(rail)

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
  syncRailHeight()
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
