import { state, subscribe, setState } from '../state.js'
import { renderWhenNear, trackSteps } from '../lib/scroll.js'
import { layerLegend } from '../lib/layers.js'
import {
  logNormalPrior, accumulate, normalize, summarize,
  predictedRate, updateSequence, mulberry32, frameBounds
} from '../lib/bayesGrid.js'
import {
  GRID, rowsForPlayer, completeDensity as beliefCompleteDensity, followedPlayer
} from '../lib/beliefModel.js'
import { stickyChartHeight } from '../lib/stickyFit.js'
import { numberOf, refTo } from '../lib/sectionOrder.js'
import { beliefUpdate } from '../charts/beliefUpdate.js'
import { beliefTrace } from '../charts/beliefTrace.js'

/**
 * No pooling: one player, their own serves, and nothing else.
 *
 * The section opens the machine. A single player's serves are revealed one at a
 * time, the posterior after each is the prior for the next, and at the end the
 * curve sits on the number the site has been quoting for that player all along.
 * Complete pooling ran the identical arithmetic over the whole team one section
 * earlier; the only thing that differs here is which serves go in.
 *
 * That is the setup for adaptive shrinkage. Two extremes have now been built out
 * of one machine, and the section after this one changes the remaining knob --
 * the prior -- rather than introducing a new mechanism.
 *
 * Nothing here is fitted at runtime in the MCMC sense. The exact posterior for
 * this model is a grid product over theta, so lib/bayesGrid.js reproduces the
 * shipped Stan answer from the per-serve stream the scenario already carries.
 *
 * This is also where the reader picks a player: selection flows FORWARD from
 * here to the sections that name one, via beliefModel.followedPlayer. Nothing
 * is written to state until the reader actually chooses, so a selection ring
 * never appears on somebody nobody asked for.
 *
 * Rail controls: it follows population, seed (both arrive as a 'scenario'
 * change), Scale and the player selection. It deliberately ignores d* -- the
 * difficulty in this section is real per-serve data, not a reference value the
 * reader picks -- and it is one skill at a time, so it opts out under the
 * two-skill toggle rather than drawing a belief surface.
 */

const plogis = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const fmt = (x, d = 3) => `<strong class="figures">${x.toFixed(d)}</strong>`
const pct = (x) => `<strong class="figures">${(100 * x).toFixed(0)}%</strong>`

/**
 * A controlled what-if: the same belief, one more serve, at a chosen difficulty.
 *
 * Rebuilt from the flat prior rather than from a stored density because
 * accumulate works in log space and the frames only keep the normalised curve.
 * The synthetic serve is passed as a one-row observations object -- accumulate
 * only ever reads `.difficulty` and `.y`.
 */
function oneMoreServe (observations, baseRows, difficulty, y) {
  const logPost = accumulate(logNormalPrior(GRID, 0, 2), GRID, observations, baseRows)
  accumulate(logPost, GRID, { difficulty: [difficulty], y: [y] }, [0])
  return summarize(normalize(logPost, GRID), GRID)
}

/** The six guided beats. `target` is a serve count, clamped to what exists. */
const STEP_TARGETS = [0, 1, 2, 5, 15, 30]

export function noPooling () {
  // Read once: main.js remounts every section when the dimension changes, so a
  // closure never has to cope with the payload shape moving under it.
  const twoD = state.dimension === '2d'

  const el = document.createElement('section')
  el.id = 'no-pooling'
  // Shared with completePooling: both carry a control bar and a wide legend,
  // and styles.css scopes those rules to this class rather than to one id.
  el.className = 'belief-section'

  if (twoD) {
    // The two-skill opt-out. A belief surface over two abilities is a different
    // figure with a different lesson, and the updating story reads as a curve
    // narrowing on a line. Same idiom as an ungenerated dataset elsewhere.
    el.innerHTML = `
      <div class="wrap">
        <header>
          <p class="eyebrow">${numberOf('no-pooling')} — No pooling</p>
          <h2>Every player, on their own serves alone</h2>
        </header>
        <div class="note">This walk-through follows one skill at a time. It
          reveals a single player's plays one by one and watches a curve over
          <em>one</em> ability narrow — in two skills that curve becomes a
          surface, which tells a different story and is not drawn here. Switch
          the bar above back to one skill to step through it.</div>
      </div>`
    return { el, mount: () => () => {} }
  }

  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('no-pooling')} — No pooling</p>
        <h2>Every player, on their own serves alone</h2>
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

      <h3 class="subhead">Take the controls</h3>
      <p>Pick any player and walk their serves yourself. The orange curve is the
         belief after the serves absorbed so far; the grey dashed curve behind it
         is the belief one serve ago — the thing being multiplied. The strip
         underneath is the likelihood of the serve you just absorbed, which is
         what it was multiplied by. The two ticks on the axis are where we
         started and where we stand: grey is what the prior alone said (0),
         orange is the model's estimate now. Shuffling the order changes the
         path completely and leaves the destination exactly where it was.</p>
      <div class="controls" data-role="controls">
        <label>Player <select data-act="player" aria-label="Player"></select></label>
        <span class="seg">
          <button type="button" data-act="prev" title="Take back a serve">◀</button>
          <button type="button" data-act="next" title="Absorb the next serve">▶</button>
        </span>
        <input type="range" data-act="step" min="0" max="0" value="0" step="1"
               aria-label="Serves absorbed">
        <span class="control-note figures" data-role="step-readout"></span>
        <button type="button" data-act="shuffle">Shuffle the order</button>
        <button type="button" data-act="reset">Reset</button>
        <span class="control-note" data-role="shuffle-note"></span>
        <span class="control-note" data-role="estimates-readout"></span>
      </div>
      <figure class="chart-panel">
        <div data-role="legend"></div>
        <div data-role="free-chart"></div>
        <figcaption data-role="free-caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="estimates-takeaway"></p>
      <figure class="chart-panel">
        <div data-role="trace"></div>
        <figcaption data-role="trace-caption">The running success rate against what the model predicts for the serves actually faced.</figcaption>
      </figure>
      <p class="takeaway" data-role="rate-takeaway"></p>

    </div>`

  const chartBox = el.querySelector('[data-role="chart"]')
  const freeBox = el.querySelector('[data-role="free-chart"]')
  const traceBox = el.querySelector('[data-role="trace"]')
  const controls = el.querySelector('[data-role="controls"]')
  const playerSelect = controls.querySelector('select[data-act="player"]')
  const slider = controls.querySelector('input[data-act="step"]')
  const stepEls = [...el.querySelectorAll('.step')]

  let ready = false
  let legend = null
  let guidedStep = 0
  let freeStep = 0
  let playerId = null
  let rows = []
  let frames = []
  let shuffles = 0          // 0 = true serve order; each click reseeds
  let completeDensity = null
  let bounds = null         // one fixed ruler for the guided panel

  const scenario = () => state.scenario
  const indexOfPlayer = (id) => scenario().truth.child_id.indexOf(id)

  /** Whichever player the site is following. The rule lives in beliefModel so
   *  that every section naming a player names the same one. */
  const wantedPlayer = () => followedPlayer(scenario(), state.selectedPlayer)

  /** Everything that depends on the scenario but not on the player. The heavy
   *  parts are memoised per scenario in beliefModel; this just reads them and
   *  refills the player picker. */
  function rebuildScenario () {
    const sc = scenario()
    completeDensity = beliefCompleteDensity(sc)

    playerSelect.innerHTML = sc.truth.child_id.map((id, i) =>
      `<option value="${id}">Player ${id} — ${sc.truth.n_train[i]} serves</option>`).join('')
  }

  /** Everything that depends on the player or on the serve order. */
  function rebuildPlayer (id) {
    const sc = scenario()
    playerId = id
    rows = rowsForPlayer(sc.observations, id)
    if (shuffles > 0) {
      const rnd = mulberry32(1000 + shuffles * 97 + id)
      rows = [...rows]
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]]
      }
    }
    frames = updateSequence({
      grid: GRID, prior: { mean: 0, sd: 2 }, observations: sc.observations, rows
    })
    // One ruler per player, held fixed for every step. This is the figure: the
    // curve narrows against axes that do not move. Both panels share it now
    // that the learned-prior curve has gone: it was the only mark that could
    // raise the ceiling for one panel and not the other.
    bounds = frameBounds(frames, GRID)
    freeStep = Math.min(freeStep, frames.length - 1)
    playerSelect.value = String(id)
    slider.max = String(frames.length - 1)
    slider.value = String(freeStep)
  }

  // --- the guided walk-through ---------------------------------------------

  const stepIndex = (k) => Math.min(STEP_TARGETS[k], frames.length - 1)

  /** The serve count a beat actually lands on, so the prose can say it. */
  function stepProse (k) {
    const at = stepIndex(k)
    const f = frames[at]
    const last = frames[frames.length - 1]
    const serves = (n) => `${n} ${n === 1 ? 'serve' : 'serves'}`

    if (k === 0) {
      const s = f.summary
      const ds = rows.map((r) => scenario().observations.difficulty[r])
      const dbar = mean(ds)
      return {
        lede: 'Before this player serves, we have to believe something.',
        body: `The prior is <span class="figures">N(0, 2)</span> on ability — a bell
          on θ, and close to knowing nothing about a success rate. Its 90% range,
          ${f.summary.low.toFixed(2)} to ${f.summary.high.toFixed(2)} on θ, comes
          out as a chance of
          ${(100 * plogis(s.low - dbar)).toFixed(0)}% to
          ${(100 * plogis(s.high - dbar)).toFixed(0)}% of making a serve at this
          player's average difficulty (d = ${dbar.toFixed(2)}). That is nearly the
          whole range there is. "Knowing nothing" is not one curve — flip the
          <b>Scale</b> control in the bar above and the caption says the same
          belief in success-rate terms.`
      }
    }
    if (k === 1) {
      return {
        lede: `The first serve: ${f.y === 1 ? 'made' : 'missed'} at d = ${f.difficulty.toFixed(2)}.`,
        body: `The strip under the chart is that serve's likelihood, and it has no
          peak — it rises from 0 toward 1 and stays there. One observation did not
          tell us where this player is. It told us which way to lean. The belief
          moved from 0.00 to ${f.summary.mean.toFixed(2)} and is still
          ${f.summary.sd.toFixed(2)} wide.`
      }
    }
    if (k === 2) {
      const prev = frames[at - 1]
      return {
        lede: 'The posterior became the prior.',
        body: `The curve we finished with is the curve we are about to multiply.
          The grey dashed line is where we stood after ${serves(prev.n)}; the
          orange fill is where ${serves(f.n)} leaves us. Nothing is recomputed
          from scratch at any point — each step only ever multiplies the previous
          belief by one more likelihood.`
      }
    }
    if (k === 3) {
      return {
        lede: `${serves(f.n)[0].toUpperCase()}${serves(f.n).slice(1)}.`,
        body: `Still wide — ${f.summary.sd.toFixed(2)} on θ, a 90% range of
          ${f.summary.low.toFixed(2)} to ${f.summary.high.toFixed(2)} — and still
          honest about it. This is the state every five-serve player in ${refTo('shrinkage')}
          is left in, and a belief this wide is one the team can overrule cheaply.`
      }
    }
    if (k === 4) {
      const ds = rows.slice(0, at).map((r) => scenario().observations.difficulty[r])
      if (!ds.length) return { lede: 'Difficulty carries weight.', body: '' }
      const hard = Math.max(...ds)
      const easy = Math.min(...ds)
      const base = rows.slice(0, at)
      const now = f.summary.mean
      const hardMove = Math.abs(oneMoreServe(scenario().observations, base, hard, 1).mean - now)
      const easyMove = Math.abs(oneMoreServe(scenario().observations, base, easy, 1).mean - now)
      const held = hardMove > easyMove
      return {
        lede: 'Difficulty carries weight.',
        body: `From exactly this belief, after ${serves(f.n)}, one more serve
          <em>made</em> at d = ${hard.toFixed(2)} — the hardest this player has
          faced — would move the estimate ${hardMove.toFixed(3)}. The same make at
          d = ${easy.toFixed(2)} would move it ${easyMove.toFixed(3)}.
          ${held
            ? 'Bayesian updating weighs evidence by how hard it was to produce, and nothing in the model was told to.'
            : 'On this player the ordering comes out the other way round — the belief has already drifted far enough that the easier serve is the more surprising one. The weighting is real; which serve is surprising depends on where you already stand.'}`
      }
    }
    const k5 = indexOfPlayer(playerId)
    const fitted = scenario().arms?.no_pool?.players
    const fittedMean = fitted ? fitted.theta_mean[fitted.child_id.indexOf(playerId)] : null
    return {
      lede: `${serves(last.n)[0].toUpperCase()}${serves(last.n).slice(1)}, and we are done.`,
      body: `The belief has landed at ${last.summary.mean.toFixed(3)} with a width
        of ${last.summary.sd.toFixed(3)}${
          fittedMean != null
            ? ` — and the no-pooling estimate this site has been showing you for player ${playerId} all along is ${fittedMean.toFixed(3)}, a gap of ${Math.abs(last.summary.mean - fittedMean).toFixed(3)}`
            : ''}. Their true ability, which the model never saw, is
        ${scenario().truth.theta_true[k5].toFixed(3)}. You just watched the site's
        own number being built, one serve at a time. ${
          fittedMean != null
            ? 'The gap is sampling noise in the 4,000-draw summary the site ships, not a disagreement about the arithmetic — this grid is the exact posterior.'
            : ''}`
    }
  }

  function renderGuided () {
    for (const [i, s] of stepEls.entries()) {
      const { lede, body } = stepProse(i)
      s.querySelector('.step-lede').innerHTML = lede
      s.querySelector('[data-role="step-body"]').innerHTML = body
    }

    const at = stepIndex(guidedStep)
    const k = indexOfPlayer(playerId)
    chartBox.innerHTML = ''
    chartBox.appendChild(beliefUpdate({
      frames,
      step: at,
      truth: scenario().truth.theta_true[k],
      bounds,
      width: chartBox.clientWidth || 760,
      // Pinned: the panel, the 90px likelihood strip and the caption all have
      // to fit between the rail and the bottom of the window. Measured rather
      // than a constant -- see lib/stickyFit.js -- and rebuilt on resize. The
      // strip is inside [data-role="chart"], so it is part of what is being
      // sized here, not part of the chrome measured around it.
      height: stickyChartHeight(chartBox, { min: 220, max: 340, fallback: 320, reserve: 90 })
    }))
    el.querySelector('[data-role="caption"]').innerHTML =
      `Player ${playerId}, ${at} of ${frames.length - 1} serves absorbed. ` +
      'Orange is the belief now, grey dashed is the belief one serve ago, and the faint orange ' +
      'threads behind them are every belief this player has already been given. ' +
      'The strip below is the current serve\'s likelihood, scaled to a maximum of 1 — its height ' +
      'means nothing, only its shape does. ' +
      'Both axes are fixed for this player across every step, so the narrowing you see is real ' +
      'and not the ruler shrinking with the curve. ' +
      scaleLine(frames[at].density)

    el.querySelector('[data-role="lede"]').innerHTML =
      `Every estimate on this page came out of the same three-line loop: start from a prior, ` +
      `multiply by what you just saw, and call the answer your new prior. Here it is run in the ` +
      `open on one player's ${frames.length - 1} serves.`
  }

  /**
   * The Scale control, honestly.
   *
   * The belief panel is a density over θ and stays that way — nothing in
   * charts/beliefUpdate.js warps the axis, and warping a density through plogis
   * without the Jacobian would draw a shape that means nothing. What the
   * probability scale gets instead is an exact translation of the same belief:
   * the posterior predictive rate over the serves this player actually faces
   * (that is E_d[plogis(θ − d)], not plogis(E[θ])), and the θ interval mapped
   * through plogis at their average difficulty, which is exact because plogis is
   * monotone.
   */
  function scaleLine (density) {
    if (state.scale !== 'probability') return 'Shown on the ability scale θ.'
    const ds = rows.map((r) => scenario().observations.difficulty[r])
    if (!ds.length) return 'Shown on the ability scale θ.'
    const dbar = mean(ds)
    const rate = predictedRate(density, GRID, ds)
    const s = summarize(density, GRID)
    return `On the probability scale: against the serves this player actually faces, ` +
      `this belief puts their success rate at ${(100 * rate).toFixed(0)}%, and a 90% range of ` +
      `${(100 * plogis(s.low - dbar)).toFixed(0)}% to ${(100 * plogis(s.high - dbar)).toFixed(0)}% ` +
      `for a serve of their average difficulty (d = ${dbar.toFixed(2)}). ` +
      `The panel itself stays on θ — a density does not survive being bent through plogis.`
  }

  function renderTakeaway () {
    const last = frames[frames.length - 1]
    const first = frames[Math.min(1, frames.length - 1)]
    el.querySelector('[data-role="takeaway"]').innerHTML = `
      After one serve this player's belief was ${fmt(first.summary.sd)} wide. After
      ${fmt(last.n, 0)} it is ${fmt(last.summary.sd)} —
      ${fmt(first.summary.sd / Math.max(last.summary.sd, 1e-9), 1)}× narrower.
      <strong>No step in that loop is different from any other.</strong> The same
      multiplication ran ${fmt(last.n, 0)} times, and the width it ends on is the
      only thing that decides how hard the team can overrule this player later.
      <span class="aside">Every number in this section is computed in the browser
      from the serves in the scenario file, on a 1025-point grid over
      θ ∈ [−8, 8]. It is the exact posterior for this model, not a re-fit — which
      is why it lands on the fitted estimate rather than near it.</span>`
  }

  // --- free play ------------------------------------------------------------

  /**
   * Everything the step slider moves, and nothing else.
   *
   * Split out from renderFree so that scrubbing does not rebuild the rate trace
   * (which does not depend on the step at all) or re-derive the prior-swap
   * paragraph on every tick. Rebuilding the trace under a dragging thumb also
   * made the page flicker below the fold.
   */
  function renderFreeChart () {
    if (!legend) {
      legend = layerLegend([
        // Six entries, so the labels stay short enough to sit on two rows.
        // What each curve MEANS is the figcaption's job -- a legend that
        // explains itself in full sentences crowds the panel it belongs to.
        // One toggle over both ticks: prior mean and posterior mean are only
        // readable against each other, so they hide and show together.
        { id: 'posterior', label: 'Belief now', marker: 'area', color: '#e69f00' },
        { id: 'prior', label: 'Belief one serve ago', marker: 'dashed', color: '#94a3b8' },
        { id: 'ghosts', label: 'Every belief so far', marker: 'line', color: '#e69f00' },
        { id: 'estimates', label: 'Prior and current mean', marker: 'rule', color: '#64748b' },
        { id: 'complete', label: 'Complete pooling', marker: 'line', color: '#000000' },
        { id: 'truth', label: 'True ability', marker: 'rule', color: '#009e73' }
      ], () => renderFreeChart())
      el.querySelector('[data-role="legend"]').appendChild(legend.el)
    }

    const k = indexOfPlayer(playerId)
    const frame = frames[freeStep]
    freeBox.innerHTML = ''
    freeBox.appendChild(beliefUpdate({
      frames,
      step: freeStep,
      layers: legend.get(),
      truth: scenario().truth.theta_true[k],
      bounds,
      // Both companions at the SAME number of serves the reader is on. Complete
      // pooling is the exception and is deliberately full-data: it is one
      // belief over everyone's serves, the same at every step and for every
      // player, which is the whole point of showing it.
      extras: { complete: completeDensity },
      width: freeBox.clientWidth || 760,
      height: 320
    }))

    renderEstimates(frame)

    slider.max = String(frames.length - 1)
    slider.value = String(freeStep)
    controls.querySelector('[data-role="step-readout"]').textContent =
      `${freeStep} / ${frames.length - 1} serves`
    controls.querySelector('[data-role="shuffle-note"]').textContent = shuffles > 0
      ? 'Serves reordered. The path is different; the final curve is not.'
      : 'True serve order.'

    const nObs = scenario().observations.y.length
    el.querySelector('[data-role="free-caption"]').innerHTML =
      `Player ${playerId}, ${freeStep} of ${frames.length - 1} serves absorbed. ` +
      `The black curve is <b>complete pooling</b> — the identical updating run over all ` +
      `${nObs} serves in this scenario, which is ${refTo('complete-pooling')}, and is why it ` +
      `does not move when you change player. ` +
      `The two ticks on the axis are the prior's answer (grey, always 0) and the model's now ` +
      `(orange); the strip below is the likelihood of the serve just absorbed, scaled to a maximum ` +
      `of 1, and it is the shape the belief was multiplied by to get here. ` +
      `Both axes are fixed for this player across every step. ` +
      `Change the player and watch which curves jump and which one does not. ` +
      scaleLine(frame.density)
  }

  /**
   * Where the belief started and where it stands, at the step the reader is on.
   *
   * Two numbers, not three: the prior's answer (0, by construction) and the
   * posterior mean now. The evidence that moved one to the other is not
   * summarised into a third number at all -- it is drawn in full, as the
   * likelihood strip under the panel. That strip is the honest object here: one
   * serve's likelihood often has no peak to quote, and the shape says why.
   */
  function renderEstimates (frame) {
    const box = el.querySelector('[data-role="estimates-takeaway"]')
    const line = controls.querySelector('[data-role="estimates-readout"]')
    const model = frame.summary.mean
    const serves = (n) => `${n} ${n === 1 ? 'serve' : 'serves'}`

    line.innerHTML = `prior <span class="figures">0.000</span> · model ` +
      `<span class="figures">${model.toFixed(3)}</span>`

    if (frame.n === 0) {
      box.innerHTML = `No serves yet. The prior alone puts this player at
        <strong class="figures">0.000</strong>, and the strip under the panel is
        empty — there is nothing yet to multiply by. Step forward and watch one
        serve's likelihood arrive, then the next, and the orange tick pull away
        from the grey one.`
      return
    }

    const made = frame.y === 1
    box.innerHTML = `After ${serves(frame.n)}: the prior alone said
      <strong class="figures">0.000</strong> and the model says ${fmt(model)}.
      The gap between the two ticks is the whole of what ${serves(frame.n)}
      bought. <strong>Nothing chose that number.</strong> It is what multiplying
      a prior by a likelihood does — and the likelihood in question is drawn in
      full in the strip below, the serve you just absorbed
      (${made ? 'made' : 'missed'} at d = ${frame.difficulty.toFixed(2)}).
      Read it as a lean rather than an estimate: it rises the ${made ? 'higher' : 'lower'}
      you suppose this player to be and has no peak of its own to quote. Keep
      stepping and the belief pulls further from 0; how far it gets is exactly
      how far the serves outweigh the prior.`
  }

  /** The step-independent half: everything that only moves with the frames. */
  function renderFree () {
    renderFreeChart()
    traceBox.innerHTML = ''
    traceBox.appendChild(beliefTrace({ frames, width: traceBox.clientWidth || 760 }))
    renderRateTakeaway()
    renderTraceCaption()
  }

  /**
   * The destination, and only the destination.
   *
   * Everything quoted here comes from the final frame, so it is invariant to the
   * serve order — which is the claim the Shuffle button makes and the claim
   * interaction-test.mjs pins. The order-dependent half of the lesson (the
   * sample rate flailing at 0% for the first few serves) lives in the trace
   * caption, where it is allowed to move.
   */
  function renderRateTakeaway () {
    const last = frames[frames.length - 1]
    const ds = rows.map((r) => scenario().observations.difficulty[r])
    const dbar = mean(ds)
    const naive = plogis(last.summary.mean)
    el.querySelector('[data-role="rate-takeaway"]').innerHTML = `
      Player ${playerId} made ${fmt(last.makes, 0)} of ${fmt(last.n, 0)} — a success
      rate of ${pct(last.sampleRate)}. The belief we just built predicts
      ${pct(last.predictedRate)} for the serves they actually faced, which is the
      number that running rate is converging to.
      <strong>It is not plogis of the posterior mean.</strong> That would be
      ${pct(naive)}, from an ability of ${fmt(last.summary.mean)} — a different
      question, because it asks about a serve of difficulty 0 and this player
      faced an average difficulty of ${fmt(dbar, 2)}.
      <span class="aside">Shuffle the order and every number in this paragraph
      stays put. Multiplication commutes, so the serves can arrive in any order
      and leave the same belief behind — only the route changes.</span>`
  }

  function renderTraceCaption () {
    const at = (n) => frames[Math.max(1, Math.min(n, frames.length - 1))]
    const last = frames[frames.length - 1]
    if (last.sampleRate == null) return
    const early = at(3)
    el.querySelector('[data-role="trace-caption"]').innerHTML =
      `The running success rate against what the model predicts for the serves actually faced. ` +
      `After ${early.n} serves this player's running rate reads ${(100 * early.sampleRate).toFixed(0)}% ` +
      `and the model still predicts ${(100 * early.predictedRate).toFixed(0)}% — it refuses to ` +
      `conclude that much from ${early.n} serves. By ${last.n} the two are ` +
      `${(100 * last.sampleRate).toFixed(0)}% and ${(100 * last.predictedRate).toFixed(0)}%. ` +
      `This panel is the one thing on the page the Shuffle button really does change.`
  }

  // --- wiring ---------------------------------------------------------------

  function render () {
    if (!scenario()?.observations) return
    rebuildScenario()
    const want = wantedPlayer()
    if (want !== playerId || !frames.length) rebuildPlayer(want)
    renderGuided()
    renderTakeaway()
    renderFree()
  }

  function setFreeStep (n) {
    const next = Math.max(0, Math.min(n, frames.length - 1))
    if (next === freeStep) return
    freeStep = next
    renderFreeChart()
  }

  function mount () {
    renderWhenNear(el, () => { ready = true; render() })

    // jsdom has no IntersectionObserver, so trackSteps falls back to fire(0)
    // (lib/scroll.js:42) and interaction-test.mjs only ever sees this scrolly at
    // step 0. Step coverage for the belief panel comes from render-test.mjs,
    // which calls the chart module directly across steps. Do not stub
    // IntersectionObserver to "fix" that -- three existing sections rely on the
    // current fallback behaviour.
    const offSteps = trackSteps(stepEls, (i) => {
      guidedStep = i
      for (const [j, s] of stepEls.entries()) s.dataset.active = String(j === i)
      if (ready) renderGuided()
    })

    // No 'difficulty': the difficulty in this section is the real d attached to
    // each serve, not the rail's reference value d*.
    const offState = subscribe((reason) => {
      if (!ready) return
      if (reason === 'scenario') {
        // A new team invalidates the player, the frames and the pooled curves.
        // The pooled curves themselves are memoised per scenario in
        // beliefModel, so this only drops what this closure holds.
        completeDensity = null
        frames = []
        shuffles = 0
        freeStep = 0
        render()
      } else if (reason === 'select') {
        if (wantedPlayer() !== playerId) render()
      } else if (reason === 'scale') {
        renderGuided()
        renderFree()
      }
    })

    const onControls = (event) => {
      const button = event.target.closest('button[data-act]')
      if (!button || !frames.length) return
      const act = button.dataset.act
      if (act === 'next') setFreeStep(freeStep + 1)
      else if (act === 'prev') setFreeStep(freeStep - 1)
      else if (act === 'shuffle') {
        shuffles++
        rebuildPlayer(playerId)
        renderFree()
      } else if (act === 'reset') {
        shuffles = 0
        freeStep = 0
        rebuildPlayer(playerId)
        renderFree()
      }
    }
    controls.addEventListener('click', onControls)

    const onChange = (event) => {
      if (!frames.length) return
      if (event.target === playerSelect) {
        const id = Number(playerSelect.value)
        shuffles = 0
        freeStep = 0
        rebuildPlayer(id)
        renderGuided()
        renderTakeaway()
        renderFree()
        // Let the rest of the page follow the reader's choice. The 'select'
        // handler above sees playerId is already current and does nothing.
        setState({ selectedPlayer: id }, 'select')
      }
    }
    controls.addEventListener('change', onChange)

    const onSlide = (event) => {
      if (event.target === slider) setFreeStep(Number(slider.value))
    }
    slider.addEventListener('input', onSlide)

    let resizeTimer = null
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => { if (ready) render() }, 150)
    }
    window.addEventListener('resize', onResize)

    return () => {
      offSteps()
      offState()
      controls.removeEventListener('click', onControls)
      controls.removeEventListener('change', onChange)
      slider.removeEventListener('input', onSlide)
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }

  return { el, mount }
}
