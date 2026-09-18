import './styles.css'
import { loadIndex, loadScenario, scenarioId, armTokens, hasDimension2d } from './data.js'
import { trackSections } from './lib/scroll.js'
import { buildSectionNav, keepEntryVisible } from './lib/sectionNav.js'
import { SECTION_ORDER, refTo } from './lib/sectionOrder.js'
import { state, setState } from './state.js'
import { theTeam } from './sections/team.js'
import { adaptiveShrinkage } from './sections/shrinkage.js'
import { completePooling } from './sections/completePooling.js'
import { noPooling } from './sections/noPooling.js'
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
const railDetail = document.getElementById('detail')
const progress = document.getElementById('progress')
const rail = document.getElementById('rail')
const sectionNav = document.getElementById('section-nav')

// Paired with their ids so the running order can be checked against
// SECTION_ORDER rather than trusted. Order here IS page order IS nav order.
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
let mounted = []

/** Which sections follow the Scale control, named by number rather than by hand. */
const SCALE_SCOPE =
  `${refTo(['complete-pooling', 'no-pooling', 'shrinkage', 'covariate-correct',
    'covariate-wrong', 'evidence'],
    { cap: true })} follow this; ` +
  `${refTo('convergence')} is always on the ability scale and ` +
  `${refTo('team-sweep')} is fixed at d* = 0`

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

// Read aloud at the start of the session, so it is written the way it is said:
// first person, four numbered points, before any of the statistics.
function openingPoints () {
  return `
    <p class="eyebrow">Four things I want to say at the beginning</p>
    <ol class="intro-points">
      <li>
        <p class="point-lede">I “vibe coded” this site with various LLMs.</p>
        <p>So, appropriately, treat anything you read on the site with a healthy
           degree of skepticism.</p>
      </li>
      <li>
        <p class="point-lede">This is meant to be interactive.</p>
        <p>There is so much we could discuss, so please jump in with questions or
           comments. Take something like synthetic data — there’s a whole
           conversation just around how to generate it, when it’s appropriate,
           and how to justify it.</p>
      </li>
      <li>
        <p class="point-lede">I’m going to lean heavily on the geometric view.</p>
        <p>I think of it a little like linear algebra: there’s an algebraic view
           and a geometric view. Both describe the same thing, but a lot of the
           intuition comes from being able to see the geometry.</p>
      </li>
      <li>
        <p class="point-lede">The goal for the conversation is to see how covariates work.</p>
        <p>To get the geometric intuition on what covariates do, we are going to
           spend a lot of time on how information is pooled in this context. I
           also hope it becomes clear that Bayesian statistics is useful for
           small samples.</p>
      </li>
    </ol>`
}

function hero () {
  const el = document.createElement('div')
  el.className = 'wrap hero'
  el.innerHTML = `
    <h1>The geometric view on covariates</h1>
    ${openingPoints()}
    <div class="hero-setup">
      <p>So, the setting: you watched one player serve five times. Another,
         thirty. How good is each one?</p>
      <p>Forty players. Some you have barely seen. A model has to decide, for
         each one, how much to trust what it watched and how much to borrow from
         everyone else.</p>
      <p>That decision has a right answer, and it changes from player to player.
         Scroll to watch it happen — and use the controls above to change the
         population the players were drawn from.</p>
    </div>`
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
  for (const [, section] of SECTIONS) {
    const { el, mount } = section()
    app.appendChild(el)
    mounted.push(mount() ?? (() => {}))
  }

  // Two ways the running order can drift, both silent without this. The static
  // check catches the factory list disagreeing with sectionOrder.js; the
  // mounted check catches a section whose own el.id is not what the list says
  // it is -- the real failure mode for covariateSplit, whose id is a template.
  //
  // showRuntimeError rather than throw: mountSections runs inside boot()'s
  // async chain and from two rail handlers, and throwing here would leave a
  // half-mounted page with no nav and no explanation.
  const declared = SECTIONS.map(([id]) => id).join()
  const ids = [...app.querySelectorAll(':scope > section')].map((s) => s.id).join()
  if (declared !== SECTION_ORDER.join()) {
    showRuntimeError('section order',
      new Error(`main.js lists [${declared}] but SECTION_ORDER is [${SECTION_ORDER}]`))
  } else if (ids !== declared) {
    showRuntimeError('section ids',
      new Error(`mounted [${ids}] but the section list declares [${declared}]`))
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
    // Restored, not cleared. This used to set '' in the unlocked branch, which
    // meant the first touch of the dimension toggle destroyed the scope note
    // for the rest of the session -- it was written in index.html and nothing
    // ever put it back.
    railScale.title = locked
      ? 'Two skills are compared on the ability scale only: a serve difficulty d* applies to one kind of play, not to a plane of two'
      : SCALE_SCOPE
    syncDifficultyEnabled()
  }
  railScale.title = SCALE_SCOPE
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

  // Detail is a CSS disclosure, not a re-render: every `.detail` run is already
  // in the DOM and the root attribute decides whether it shows. Sections are
  // deliberately NOT asked to rebuild -- the prose they last wrote is the prose
  // that reveals, so the two cannot disagree.
  //
  // The resize dispatch is the one thing that does have to happen. Revealing
  // the numbers makes every caption taller, and lib/stickyFit.js sizes a pinned
  // chart by measuring the panel's own furniture (legend, band filter, caption)
  // off the DOM. Without this the four sticky sections keep the height they fitted
  // against the short caption and their charts overhang the window by the
  // difference. Every section already debounces resize into a re-render, so
  // this reuses that path rather than adding a second one.
  railDetail.addEventListener('click', () => {
    const on = railDetail.getAttribute('aria-pressed') !== 'true'
    railDetail.setAttribute('aria-pressed', String(on))
    document.documentElement.dataset.detail = on ? 'on' : 'off'
    setState({ detail: on }, 'detail')
    window.dispatchEvent(new Event('resize'))
  })

  railDifficulty.addEventListener('input', () => {
    const value = Number(railDifficulty.value)
    difficultyValue.textContent = value.toFixed(2)
    setState({ difficulty: value }, 'difficulty')
  })
}

boot()
