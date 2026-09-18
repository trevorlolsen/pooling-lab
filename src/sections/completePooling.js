import { state, subscribe, skillLabel } from '../state.js'
import { renderWhenNear, trackSteps } from '../lib/scroll.js'
import { summarize, predictedRate, likelihoodCurve, frameBounds } from '../lib/bayesGrid.js'
import {
  GRID, completeFrames, completeFrames2d, interleavedAt, allDifficulties
} from '../lib/beliefModel.js'
import { stickyChartHeight } from '../lib/stickyFit.js'
import { numberOf, refTo } from '../lib/sectionOrder.js'
import { beliefUpdate } from '../charts/beliefUpdate.js'
import { beliefWidth } from '../charts/beliefWidth.js'
import { beliefSurface } from '../charts/beliefSurface.js'

/**
 * Complete pooling: one belief, built out of everybody's serves.
 *
 * The first of the two sections that open the machine. Every serve in the
 * scenario is absorbed one at a time into a single shared ability, so the
 * reader watches a posterior being built before any model is named -- and the
 * model that comes out at the end happens to be complete pooling.
 *
 * The section after this runs the identical arithmetic over one player's serves
 * instead of everyone's. Between them they build the two extremes out of one
 * machine, which is what lets adaptive shrinkage arrive as a change of prior
 * rather than as a new mechanism.
 *
 * ~650 serves, so two things differ from the one-player section:
 *
 *  - No free play. A slider over 650 frames is not a thing anyone drives, and
 *    the frames are built without their likelihood curves to save 5.3 MB
 *    (beliefModel.completeFrames); the handful of strips this section draws are
 *    rebuilt on demand below.
 *  - The ghost trail is thinned. One path per absorbed serve is 661 paths and
 *    4 MB of SVG at the last beat, rebuilt on every scroll step.
 *
 * The fixed ruler is kept, and it costs something: the prior frame draws at
 * about 4% of the panel height against 20% in the one-player section, because
 * the final curve is five times taller. That is not a bug to tune away -- area
 * is conserved, so a low wide mound becoming a tall narrow spike IS the lesson.
 * The caption still says so, but behind the rail's Detail toggle: the visible
 * caption names the marks and stops, because this page is narrated over.
 *
 * TWO SKILLS. Unlike the one-player section, this one does NOT opt out under the
 * two-skill toggle -- see twoSkillSection below. Complete pooling's joint belief
 * factorises exactly, so it can be drawn as a real contour surface and it says
 * something the one-skill view cannot: the contours are axis-aligned however
 * much data arrives, because the model has no covariance to estimate. The 2D
 * rendering is a stronger section than the 1D one, not a degraded one.
 */

/**
 * The six guided beats, in serves absorbed.
 *
 * Three of these are measured coincidences rather than round numbers, and the
 * prose leans on them:
 *   5    the shared belief is already as sharp as a five-serve player ever gets
 *        on their own serves (band mean sd 1.038 against 0.98 here)
 *   30   as sharp as the BEST-observed individual ever gets (band mean 0.420
 *        against 0.402 here) -- with 620 serves still to come
 *   650  five times narrower than any individual, and only 2.3x better than
 *        n=130 for five times the data
 */
const STEP_TARGETS = [0, 1, 5, 30, 130, Infinity]

/**
 * The two-skill rendering: the same walk-through, drawn as a surface.
 *
 * This is not a reduced version of the one-skill section. The joint belief
 * factorises exactly under complete pooling (see charts/beliefSurface.js), so
 * the contours come out axis-aligned however much data arrives — which is a
 * claim the one-skill view cannot make at all, and the setup for the two later
 * sections where the hierarchical model does estimate a correlation.
 *
 * Plays alternate serve, reception, so each one narrows the belief along one
 * axis and says nothing about the other.
 */
const STEP_TARGETS_2D = [0, 1, 2, 10, 60, 300, Infinity]

function twoSkillSection (el) {
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('complete-pooling')} — Complete pooling</p>
        <h2>One pair of numbers for the whole team</h2>
        <p data-role="lede"></p>
      </header>

      <div class="scrolly">
        <div class="scrolly-steps" data-role="steps">
          ${STEP_TARGETS_2D.map((_, i) => `
            <div class="step" data-step="${i}" data-active="false">
              <p class="step-lede"></p>
              <p data-role="step-body"></p>
            </div>`).join('')}
        </div>
        <div class="scrolly-graphic">
          <figure class="chart-panel">
            <div data-role="chart"></div>
            <figcaption data-role="caption"></figcaption>
          </figure>
        </div>
      </div>
      <p class="takeaway" data-role="takeaway"></p>
    </div>`

  const chartBox = el.querySelector('[data-role="chart"]')
  const stepEls = [...el.querySelectorAll('.step')]

  let ready = false
  let guidedStep = 0
  let perSkill = null
  let total = 0
  let bounds = null

  const scenario = () => state.scenario
  const fmt = (x, d = 3) => `<strong class="figures">${x.toFixed(d)}</strong>`
  const stepIndex = (k) => Math.min(STEP_TARGETS_2D[k], total)

  function rebuild () {
    const sc = scenario()
    const built = completeFrames2d(sc)
    perSkill = built.perSkill
    total = built.total
    // ONE ruler for both axes and every step, for the same reason the 1D panel
    // has one: a surface redrawn against axes that shrink with it teaches
    // nothing. Each axis is unioned over its own sequence, then the pair is
    // squared up so the plane is not silently stretched -- a circular belief
    // has to look circular, or "no tilt" is unreadable.
    const b = perSkill.map((frames) => frameBounds(frames, GRID).x)
    const span = Math.max(b[0][1] - b[0][0], b[1][1] - b[1][0])
    const centred = b.map(([l, h]) => {
      const m = (l + h) / 2
      return [m - span / 2, m + span / 2]
    })
    bounds = { x: centred[0], y: centred[1] }
  }

  /** The joint's marginals after `t` interleaved plays. */
  const marginalsAt = (t) => {
    const { a1, a2 } = interleavedAt(perSkill, t)
    return [perSkill[0][a1].density, perSkill[1][a2].density]
  }

  /** A log-spaced sample of earlier beliefs, as the 1D panel's ghosts are. */
  function ghostsUpTo (t) {
    if (t < 1) return []
    const out = []
    const max = 8
    for (let j = 0; j < max; j++) {
      const k = Math.round(Math.expm1((j / (max - 1)) * Math.log1p(t - 1)))
      if (k >= 0 && k < t) out.push(marginalsAt(k))
    }
    return out
  }

  function sdAt (t) {
    const { a1, a2 } = interleavedAt(perSkill, t)
    return [perSkill[0][a1].summary.sd, perSkill[1][a2].summary.sd]
  }

  function stepProse (k) {
    const t = stepIndex(k)
    const { a1, a2, skill } = interleavedAt(perSkill, t)
    const [s1, s2] = sdAt(t)
    const names = [skillLabel(1), skillLabel(2)]
    const plays = (n) => `${n} ${n === 1 ? 'play' : 'plays'}`

    if (k === 0) {
      return {
        lede: 'Before anyone plays, we have to believe something about both skills.',
        body: `One shared pair of abilities for the whole team, and a prior of
          <span class="figures">N(0, 2)</span> on each — independently. The belief
          is a round blob because nothing yet connects
          ${names[0].toLowerCase()} to ${names[1].toLowerCase()}.`
      }
    }
    if (k === 1) {
      return {
        lede: `The first play is a ${names[0].toLowerCase()}.`,
        body: `It narrows the belief left to right and leaves it exactly as wide
          top to bottom. A play is one skill or the other, so its likelihood is a
          function of one coordinate and says <em>nothing</em> about the other.
          The grey bar marks the axis it spoke to.`
      }
    }
    if (k === 2) {
      return {
        lede: `The second is a ${names[1].toLowerCase()}.`,
        body: `Now the other axis moves. The blob is tightening in both
          directions, one play at a time, and it is staying square to the axes
          while it does — which is the thing to watch from here on.`
      }
    }
    if (k === 3 || k === 4) {
      return {
        lede: `${plays(t)[0].toUpperCase()}${plays(t).slice(1)}.`,
        body: `The region keeps closing in on both axes at once, and keeps its
          corners square to them.
          <span class="detail">${fmt(a1, 0)} ${names[0].toLowerCase()}s and
          ${fmt(a2, 0)} ${names[1].toLowerCase()}s, and it is down to
          ${fmt(s1, 2)} by ${fmt(s2, 2)} on the two abilities.</span>
          ${skill ? `This one was a ${names[skill - 1].toLowerCase()}.` : ''}`
      }
    }
    if (k === 5) {
      return {
        lede: 'Still square.',
        body: `Hundreds of plays in, and the contours have not tilted by a
          degree. That is not a coincidence and it is not going to change —
          the next beat says why.`
      }
    }
    return {
      lede: `All ${fmt(total, 0)} plays, and we are done.`,
      body: `A very small region, and <strong>a perfectly axis-aligned
        one</strong>. Complete pooling gives the team one shared ability per
        skill and no way to relate them: the prior treats the two independently
        and every play touches one of them, so the posterior is the product of
        two separate beliefs. It cannot tilt. Whatever these players have in
        common across the two skills, this model has no place to put it —
        and ${refTo('shrinkage')} onward is where that changes.`
    }
  }

  function renderGuided () {
    for (const [i, s] of stepEls.entries()) {
      const { lede, body } = stepProse(i)
      s.querySelector('.step-lede').innerHTML = lede
      s.querySelector('[data-role="step-body"]').innerHTML = body
    }

    const sc = scenario()
    const t = stepIndex(guidedStep)
    const { a1, a2, skill } = interleavedAt(perSkill, t)
    const mean = sc.population?.overall_mean

    chartBox.innerHTML = ''
    chartBox.appendChild(beliefSurface({
      marginals: marginalsAt(t),
      grid: GRID,
      bounds,
      ghosts: ghostsUpTo(t),
      axis: skill,
      labels: [skillLabel(1), skillLabel(2)],
      truth: Array.isArray(mean) ? { x: mean[0], y: mean[1] } : null,
      width: chartBox.clientWidth || 760,
      height: stickyChartHeight(chartBox, { min: 300, max: 460, fallback: 420 })
    }))

    const [s1, s2] = sdAt(t)
    el.querySelector('[data-role="caption"]').innerHTML =
      // Visible: one sentence naming the marks, nothing else. The counts, the
      // widths, why the axes are fixed and squared up, what a tilt would have
      // meant and which scale this is drawn on are all behind the rail's Detail
      // toggle -- this panel is narrated over, and none of that is a mark.
      'One shared pair of abilities for the whole team. ' +
      'The filled regions hold 50% and 90% of the belief' +
      // No ghosts on the opening beat, and promising rings that are not there
      // is exactly the sort of caption that teaches a reader to stop trusting
      // captions.
      (t > 0 ? ', faint rings earlier ones' : '') +
      (skill ? ', the grey bar the axis just played' : '') +
      ', and the green cross the true mean. ' +
      `<span class="detail">${t} of ${total} plays absorbed — ${a1} ` +
      `${skillLabel(1).toLowerCase()}s and ${a2} ${skillLabel(2).toLowerCase()}s, ` +
      `taken in turn. The region is ${s1.toFixed(2)} wide and ${s2.toFixed(2)} tall ` +
      'on the two ability scales. ' +
      'Both axes are fixed across every step and share one scale, so the shrinking is real ' +
      'and a round belief looks round. Watch whether it ever leans: a tilt would mean the ' +
      'model had found the two skills to be related. The cross marks the population mean ' +
      'complete pooling is aiming at. ' +
      'Shown on the ability scale θ: a density does not survive being bent through plogis, ' +
      'and warping each axis separately would draw a shape that means nothing.</span>'

    el.querySelector('[data-role="lede"]').innerHTML =
      `The same loop as ever — start from a prior, multiply by what you just saw, call the ` +
      `answer your new prior — run over all ${total} plays in this scenario, poured into a ` +
      `single shared pair of abilities.`
  }

  function renderTakeaway () {
    const [s1, s2] = sdAt(total)
    const [p1, p2] = sdAt(1)
    const cor = scenario().arms?.complete?.players2d?.cor?.[0]
    // The fitted correlation stays on screen with the toggle off. It is the one
    // figure here that moves when the reader switches team or population, so
    // putting it away would leave a takeaway that reads the same for every draw
    // -- and watching this number stay at zero across draws IS the claim.
    el.querySelector('[data-role="takeaway"]').innerHTML = `
      Every play tightened the region, and not one of them turned it.
      <span class="detail">After ${fmt(total, 0)} plays the shared belief is
      ${fmt(s1)} by ${fmt(s2)}, down from ${fmt(p1, 2)} by ${fmt(p2, 2)} after
      the first.</span>
      <strong>It is exactly as square as it started.</strong>
      ${cor != null
        ? `The fitted model agrees: it puts the correlation between the two
           shared abilities at ${fmt(cor, 3)}.<span class="detail"> That is zero
           to within the noise of a four-thousand-draw summary.</span>`
        : ''}
      <span class="aside detail">That is forced, not fitted.
      <code>complete_pooling_2d.stan</code> gives the shared pair an independent
      prior on each component, and every play touches exactly one of them — so
      the joint posterior is the product of two separate beliefs and its contours
      cannot tilt. This is computed in the browser as exactly that product, on a
      1025-point grid per skill, and it lands on the shipped Stan fit to within
      0.003. Hold on to the roundness: it is the thing the models in the later
      sections are able to give up.</span>`
  }

  function render () {
    if (!scenario()?.skills) return
    rebuild()
    renderGuided()
    renderTakeaway()
  }

  function mount () {
    renderWhenNear(el, () => { ready = true; render() })
    const offSteps = trackSteps(stepEls, (i) => {
      guidedStep = i
      for (const [j, s] of stepEls.entries()) s.dataset.active = String(j === i)
      if (ready) renderGuided()
    })
    // Scale is locked to theta in 2D by the rail, so only the scenario matters.
    const offState = subscribe((reason) => {
      if (ready && reason === 'scenario') render()
    })
    let resizeTimer = null
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { if (ready) render() }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      offSteps()
      offState()
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }

  return { el, mount }
}

export function completePooling () {
  const twoD = state.dimension === '2d'

  const el = document.createElement('section')
  el.id = 'complete-pooling'
  el.className = 'belief-section'

  if (twoD) return twoSkillSection(el)

  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('complete-pooling')} — Complete pooling</p>
        <h2>One number for the whole team</h2>
        <p data-role="lede"></p>
      </header>

      <div class="scrolly">
        <div class="scrolly-steps" data-role="steps">
          ${STEP_TARGETS.map((_, i) => `
            <div class="step" data-step="${i}" data-active="false">
              <p class="step-lede"></p>
              <p data-role="step-body"></p>
            </div>`).join('')}
        </div>
        <div class="scrolly-graphic">
          <figure class="chart-panel">
            <div data-role="chart"></div>
            <figcaption data-role="caption"></figcaption>
          </figure>
        </div>
      </div>
      <p class="takeaway" data-role="takeaway"></p>

      <h3 class="subhead">What the last five hundred serves bought</h3>
      <p>The same run, reduced to one number: how wide the shared belief is after
         each serve.</p>
      <figure class="chart-panel">
        <div data-role="width"></div>
        <figcaption data-role="width-caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="width-takeaway"></p>
    </div>`

  const chartBox = el.querySelector('[data-role="chart"]')
  const widthBox = el.querySelector('[data-role="width"]')
  const stepEls = [...el.querySelectorAll('.step')]

  let ready = false
  let guidedStep = 0
  let frames = []
  let bounds = null

  const scenario = () => state.scenario
  const stepIndex = (k) => Math.min(STEP_TARGETS[k], frames.length - 1)
  const fmt = (x, d = 3) => `<strong class="figures">${x.toFixed(d)}</strong>`

  function rebuild () {
    const sc = scenario()
    frames = completeFrames(sc)
    bounds = frameBounds(frames, GRID)
  }

  /**
   * The scale line, for the team rather than for one player.
   *
   * Same arithmetic as the one-player section's, over every difficulty in the
   * scenario instead of one player's. The panel itself stays on θ: a density
   * does not survive being bent through plogis without its Jacobian.
   *
   * The whole line sits behind the Detail toggle: which scale the reader is on
   * is a control caveat, already said by the rail's Scale button and by the
   * chart's own axis, and the caption was the third place saying it. It is
   * returned as one `.detail` span so the caption above can concatenate it
   * without knowing that.
   */
  function scaleLine (density) {
    if (state.scale !== 'probability') {
      return '<span class="detail">Shown on the ability scale θ.</span>'
    }
    const ds = allDifficulties(scenario())
    const rate = predictedRate(density, GRID, ds)
    const s = summarize(density, GRID)
    const dbar = ds.reduce((a, b) => a + b, 0) / ds.length
    return '<span class="detail">On the probability scale the same belief is restated as a ' +
      'success rate, against the serves this team actually faces rather than against an ' +
      `average one. It puts that rate at ${(100 * rate).toFixed(0)}%, with a 90% range ` +
      `of ${(100 * plogis(s.low - dbar)).toFixed(0)}% to ${(100 * plogis(s.high - dbar)).toFixed(0)}% ` +
      `for a serve of average difficulty (d = ${dbar.toFixed(2)}). ` +
      'The panel itself stays on θ — a density does not survive being bent through ' +
      'plogis.</span>'
  }

  const plogis = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

  /** Band means the prose quotes, computed from the scenario rather than pinned. */
  function bandSd (nTrain) {
    const sc = scenario()
    const arm = sc.arms?.no_pool?.players
    if (!arm) return null
    let sum = 0
    let count = 0
    for (let i = 0; i < sc.truth.child_id.length; i++) {
      if (sc.truth.n_train[i] !== nTrain) continue
      const k = arm.child_id.indexOf(sc.truth.child_id[i])
      if (k >= 0) { sum += arm.theta_sd[k]; count++ }
    }
    return count ? sum / count : null
  }

  function stepProse (k) {
    const at = stepIndex(k)
    const f = frames[at]
    const last = frames[frames.length - 1]
    const sd = (x) => fmt(x, 3)

    if (k === 0) {
      return {
        lede: 'Before anyone serves, we have to believe something.',
        body: `One ability, shared by the whole team, and a prior of
          <span class="figures">N(0, 2)</span> on it — the identical prior every
          player gets to themselves in ${refTo('no-pooling')}. Its 90% range is
          very nearly the whole range there is<span class="detail">, running
          ${fmt(f.summary.low, 2)} to ${fmt(f.summary.high, 2)}</span>.`
      }
    }
    if (k === 1) {
      return {
        lede: `The first serve: ${f.y === 1 ? 'made' : 'missed'} at d = ${f.difficulty.toFixed(2)}.`,
        body: `The strip under the chart is that serve's likelihood. It has no
          peak — it leans, and the belief answers. What is different here is
          whose serve it was: nobody's in particular. Under complete pooling
          every serve is evidence about <em>everyone</em>, so this one moved the
          estimate for all forty players at once.`
      }
    }
    if (k === 2) {
      const band = bandSd(Math.min(...scenario().truth.n_train))
      return {
        lede: 'Five serves in.',
        body: `${band != null
          ? `The shared belief is already about as sharp as a five-serve player's
             own belief ever gets<span class="detail"> — ${sd(f.summary.sd)} wide,
             against ${fmt(band, 2)} on average for those players</span>`
          : `The shared belief has already tightened a long way<span class="detail">,
             to ${sd(f.summary.sd)} wide</span>`}. Five serves is five serves. It
          does not yet matter that they came from different people.`
      }
    }
    if (k === 3) {
      const band = bandSd(Math.max(...scenario().truth.n_train))
      const left = frames.length - 1 - at
      return {
        lede: 'Thirty serves in, and this is where it gets interesting.',
        body: `${band != null
          ? `The team's shared belief is now as sharp as the <em>best</em>-observed
             player on the team ever gets about themselves<span class="detail"> —
             ${sd(f.summary.sd)} against ${fmt(band, 2)}</span>`
          : `The shared belief is sharper than any one player's<span class="detail">,
             at ${sd(f.summary.sd)} wide</span>`}. And there are still ${fmt(left, 0)} serves to come. This is the
          bargain complete pooling offers: certainty about the average, bought by
          refusing to believe anyone differs from it.`
      }
    }
    if (k === 4) {
      const prev = frames[stepIndex(3)]
      return {
        lede: 'A fifth of the way.',
        body: `<span class="detail">${sd(f.summary.sd)}, against
          ${sd(prev.summary.sd)} at ${fmt(prev.n, 0)}. </span>Four times the data
          for about half the width — which is the rate this is going to keep
          paying, and the next panel is where that becomes obvious.`
      }
    }
    const mid = frames[stepIndex(4)]
    return {
      lede: `All ${fmt(last.n, 0)} serves, and we are done.`,
      body: `Roughly five times sharper than any single player's belief about
        themselves<span class="detail">, at ${sd(last.summary.sd)} wide</span> —
        and yet only ${fmt(mid.summary.sd / last.summary.sd, 1)}× sharper than it
        was at ${fmt(mid.n, 0)} serves, for five times the data. <strong>One number,
        known very precisely.</strong> The question the rest of the site asks is
        whether it is the number you wanted.`
    }
  }

  function renderGuided () {
    for (const [i, s] of stepEls.entries()) {
      const { lede, body } = stepProse(i)
      s.querySelector('.step-lede').innerHTML = lede
      s.querySelector('[data-role="step-body"]').innerHTML = body
    }

    const at = stepIndex(guidedStep)
    const f = frames[at]
    // completeFrames drops likelihood curves to stay inside its memory budget;
    // this section draws at most six of them, so they are rebuilt here.
    const shown = f.like || f.difficulty == null
      ? f
      : { ...f, like: likelihoodCurve(GRID, f.difficulty, f.y) }

    chartBox.innerHTML = ''
    chartBox.appendChild(beliefUpdate({
      frames: frames.map((g, i) => (i === at ? shown : g)),
      step: at,
      bounds,
      grid: GRID,
      // 661 paths and 4 MB of SVG at the last beat without this.
      maxGhosts: 32,
      width: chartBox.clientWidth || 760,
      height: stickyChartHeight(chartBox, { min: 220, max: 340, fallback: 320, reserve: 90 })
    }))

    // Visible: one sentence naming the marks, because this panel is narrated
    // over. Everything that explains or justifies them -- what the strip is
    // scaled to, why the ruler is fixed, why the opening curve is a smear, and
    // which scale we are on -- sits behind the rail's Detail toggle.
    el.querySelector('[data-role="caption"]').innerHTML =
      'One shared belief, built from the whole team\'s serves. ' +
      'Orange is the belief now, grey dashed one serve ago, the faint threads earlier beliefs, ' +
      'and the strip below this serve\'s likelihood. ' +
      `<span class="detail">${at} of ${frames.length - 1} serves absorbed. ` +
      'The strip is scaled to a maximum of 1, and it is the shape the belief was multiplied by ' +
      'to get here. Both axes are fixed across every step, so the narrowing you see is real and ' +
      'not the ruler shrinking with the curve — which is also why the opening curve is such a ' +
      'low, wide smear. It holds the same amount of belief as the spike at the end; it is just ' +
      'spread over everything it could have been. </span>' +
      scaleLine(frames[at].density)

    el.querySelector('[data-role="lede"]').innerHTML =
      `Every estimate on this page comes out of the same three-line loop: start from a prior, ` +
      `multiply by what you just saw, call the answer your new prior. Here it is run in the open ` +
      `over all ${frames.length - 1} serves in this scenario, poured into a single shared ability.`
  }

  function renderWidth () {
    const last = frames[frames.length - 1]
    widthBox.innerHTML = ''
    const svg = beliefWidth({
      frames,
      mark: stepIndex(guidedStep),
      width: widthBox.clientWidth || 760
    })
    widthBox.appendChild(svg)

    const half = frames.find((f) => f.n > 0 && f.summary.sd <= frames[1].summary.sd / 2)
    const c = svg.__refConstant

    // The constant stays visible: it names the dashed mark, and it is the one
    // thing on this panel that moves when the reader switches team. Why it is
    // fitted where it is, and why the axis is linear, are arguments about the
    // chart rather than marks on it, so they go behind the Detail toggle.
    el.querySelector('[data-role="width-caption"]').innerHTML =
      `The width of the shared belief after each serve, with the serve you are standing on marked. ` +
      `The dashed line is <span class="figures">${fmt(c, 2)}/√n</span>.` +
      `<span class="detail"> It is fitted on the tail. The axis is linear on purpose: the shape ` +
      `— a cliff, then a floor — is the whole point, and a log axis would straighten it into a ` +
      `line and hide it.</span>`

    el.querySelector('[data-role="width-takeaway"]').innerHTML = `
      The first ${fmt(half ? half.n : 40, 0)} serves halve the width; the
      <em>next</em> halving takes four times as many again, and the one after
      that sixteen. <strong>Precision about an average is cheap, and it stays
      cheap forever.</strong>
      <span class="aside detail">It just stops being worth much.
      The dashed reference is the law behind that: width
      falls as one over the square root of the data, so to halve it you quadruple
      the serves. Measured across the populations in the bar above, the constant
      lands near 2.18 every time<span class="detail">, and the final width near
      ${fmt(last.summary.sd, 3)}</span> — by then it is set by how varied the serve
      difficulties are, not by anything about the players.</span>
      <!-- Hoisted OUT of the aside deliberately. The asides collapse under the
           Detail toggle, and a forward reference is how the reader gets to the
           next step of the argument -- losing every cross-reference with the
           numbers would leave the sections with no thread between them. Kept
           short for the same reason the rest of this was cut. -->
      <span class="aside">${refTo('team-sweep', { cap: true })} takes this to a
      thousand serves each.</span>`
  }

  function render () {
    if (!scenario()?.observations) return
    rebuild()
    renderGuided()
    renderWidth()
    renderTakeaway()
  }

  function renderTakeaway () {
    const first = frames[1]
    const last = frames[frames.length - 1]
    el.querySelector('[data-role="takeaway"]').innerHTML = `
      The belief began as wide as the prior and ended as a spike.
      <span class="detail">After one serve it was ${fmt(first.summary.sd)} wide;
      after ${fmt(last.n, 0)} it is ${fmt(last.summary.sd)},
      ${fmt(first.summary.sd / last.summary.sd, 1)}× narrower.</span>
      <strong>No step in that loop was different from any other.</strong> The same
      multiplication ran at every serve.
      <span class="aside detail">This is the exact posterior for complete pooling on a
      1025-point grid over θ ∈ [−8, 8], computed in the browser from the serves in
      the scenario file — not a re-fit, which is why it lands on the number the
      site ships rather than near it.</span>
      <!-- Hoisted out of the aside: see the note in renderWidth(). The thread to
           the next section survives the toggle; the provenance above does not. -->
      <span class="aside">${refTo('no-pooling', { cap: true })} runs the identical
      loop over one player's serves instead of all of them.</span>`
  }

  function mount () {
    renderWhenNear(el, () => { ready = true; render() })

    // jsdom has no IntersectionObserver, so trackSteps falls back to fire(0)
    // (lib/scroll.js) and the interaction harness only ever sees step 0. Step
    // coverage comes from render-test.mjs, which calls the chart directly. Do
    // not stub IntersectionObserver to widen that -- four sections rely on the
    // current fallback and would change behaviour under one.
    const offSteps = trackSteps(stepEls, (i) => {
      guidedStep = i
      for (const [j, s] of stepEls.entries()) s.dataset.active = String(j === i)
      if (ready) { renderGuided(); renderWidth() }
    })

    // No 'difficulty': the difficulties here are the real ones attached to each
    // serve, not the rail's reference value d*.
    const offState = subscribe((reason) => {
      if (ready && ['scenario', 'scale'].includes(reason)) render()
    })

    // The pinned figure is sized against the viewport, so it is rebuilt when the
    // viewport changes. Debounced: resize fires continuously on drag.
    let resizeTimer = null
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { if (ready) render() }, 150)
    }
    window.addEventListener('resize', onResize)

    return () => {
      offSteps()
      offState()
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }

  return { el, mount }
}
