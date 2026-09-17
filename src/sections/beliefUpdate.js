import { state, subscribe, setState, teamLabel } from '../state.js'
import { renderWhenNear, trackSteps } from '../lib/scroll.js'
import { layerLegend } from '../lib/layers.js'
import {
  thetaGrid, logNormalPrior, accumulate, normalize, summarize,
  predictedRate, updateSequence, mulberry32, frameBounds, mleSequence
} from '../lib/bayesGrid.js'
import { beliefUpdate } from '../charts/beliefUpdate.js'
import { beliefTrace } from '../charts/beliefTrace.js'

/**
 * Section 3 — where the estimates actually come from.
 *
 * Sections 2 and 4 show the model pulling small samples toward the team. This
 * one opens the machine: one player's serves are revealed one at a time, the
 * posterior after each is the prior for the next, and at the end the curve sits
 * on the number the site has been quoting all along.
 *
 * Nothing here is fitted at runtime in the MCMC sense. The exact posterior for
 * this model is a grid product over theta, so lib/bayesGrid.js reproduces the
 * shipped Stan answer from the per-serve stream the scenario already carries.
 *
 * Rail controls: it follows population, seed (both arrive as a 'scenario'
 * change), Scale and the player selection. It deliberately ignores d* -- the
 * difficulty in this section is real per-serve data, not a reference value the
 * reader picks -- and it is one skill at a time, so it opts out under the
 * two-skill toggle rather than drawing a belief surface.
 */

// One grid for the whole module. thetaGrid is pure arithmetic over 1025 floats
// and every consumer treats it as read-only.
const GRID = thetaGrid()

const plogis = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const fmt = (x, d = 3) => `<strong class="figures">${x.toFixed(d)}</strong>`
const pct = (x) => `<strong class="figures">${(100 * x).toFixed(0)}%</strong>`

/** Row indices of one player's serves, in the order they were served. */
function rowsForPlayer (observations, id) {
  const rows = []
  const c = observations.child_id
  for (let i = 0; i < c.length; i++) if (c[i] === id) rows.push(i)
  return rows
}

/** The posterior density for `rows` under a N(mean, sd) prior. */
function densityFor (observations, rows, priorMean, priorSd) {
  return normalize(
    accumulate(logNormalPrior(GRID, priorMean, priorSd), GRID, observations, rows), GRID)
}

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

export function beliefUpdateSection () {
  // Read once: main.js remounts every section when the dimension changes, so a
  // closure never has to cope with the payload shape moving under it.
  const twoD = state.dimension === '2d'

  const el = document.createElement('section')
  el.id = 'belief'

  if (twoD) {
    // The two-skill opt-out. A belief surface over two abilities is a different
    // figure with a different lesson, and the updating story reads as a curve
    // narrowing on a line. Same idiom as an ungenerated dataset elsewhere.
    el.innerHTML = `
      <div class="wrap">
        <header>
          <p class="eyebrow">3 — One serve at a time</p>
          <h2>Where the estimates actually come from</h2>
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
        <p class="eyebrow">3 — One serve at a time</p>
        <h2>Where the estimates actually come from</h2>
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
         is the belief one serve ago — the thing being multiplied. The three
         ticks on the axis are three answers to the same question: grey is what
         the prior alone said (0), orange is the model's estimate now, and
         purple is what this player's own data say on their own. Shuffling the
         order changes the path completely and leaves the destination exactly
         where it was.</p>
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

      <h3 class="subhead">Two extremes, and an empty cell</h3>
      <p>Nothing above was special to no pooling. It was one prior and one set of
         serves. Change either and you get a different model out of the same
         machine — the black curve on the chart above is complete pooling, and it
         is the identical arithmetic run over every serve in the scenario.</p>
      <table class="metric-table figures dgp-table">
        <thead>
          <tr><th></th><th>prior starts as</th><th>updated by</th></tr>
        </thead>
        <tbody data-role="frame-table"></tbody>
      </table>
      <p class="control-note" data-role="frame-note"></p>

      <h3 class="subhead">Change only the prior</h3>
      <p>The blue curve is the same player, the same serves, the same updating —
         started from what the rest of the team already taught us instead of from
         nothing. One knob. Watch what it does to a player you have barely seen,
         and to one you have watched thirty times.</p>
      <p class="takeaway" data-role="prior-takeaway"></p>
      <p class="takeaway" data-role="closing"></p>
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
  let scenarioKey = null
  let completeDensity = null
  let learnedDensity = null
  let bounds = null         // one fixed ruler for the guided panel
  let freeBounds = null     // ditto for free play, with the learned curve in it
  let defaultId = null      // cached: the rule costs 10 players' worth of passes
  let population = null     // { mu, tau } from the hierarchical fit
  let teamStats = null      // the prior swap scored across the whole team
  let partialRevealed = false  // the 2x2's third row, filled in on arrival

  const scenario = () => state.scenario
  const indexOfPlayer = (id) => scenario().truth.child_id.indexOf(id)

  /**
   * The walk-through player.
   *
   * It wants the fullest data -- thirty serves -- but "the last player with the
   * most serves" is not enough any more, because the panel now also draws the
   * MLE, and the MLE does not exist while every serve so far has gone the same
   * way. On one_population__20260914 the old rule picked player 40, whose first
   * miss is serve 16: the comparison would read "no estimate yet" for half the
   * walk-through. So: among the best-observed players, take the one whose MLE
   * starts existing earliest, and break ties on the largest final |MLE| so the
   * three ticks are visibly apart rather than stacked on 0.
   */
  function defaultPlayer () {
    const sc = scenario()
    const { child_id: ids, n_train: ns } = sc.truth
    const maxN = Math.max(...ns)
    let best = null
    for (let i = 0; i < ids.length; i++) {
      if (ns[i] !== maxN) continue
      const seq = mleSequence({
        grid: GRID, observations: sc.observations, rows: rowsForPlayer(sc.observations, ids[i])
      })
      const at = seq.findIndex((s) => s.mleDefined)
      const final = seq[seq.length - 1].mle
      const cand = {
        id: ids[i],
        first: at < 0 ? Infinity : at,
        size: final == null ? 0 : Math.abs(final)
      }
      if (!best || cand.first < best.first ||
        (cand.first === best.first && cand.size > best.size)) best = cand
    }
    return best ? best.id : ids[ids.length - 1]
  }

  /** Whichever player the rest of the site is following, if this team has them. */
  function wantedPlayer () {
    const ids = scenario().truth.child_id
    if (state.selectedPlayer != null && ids.includes(state.selectedPlayer)) {
      return state.selectedPlayer
    }
    if (defaultId == null) defaultId = defaultPlayer()
    return defaultId
  }

  /** Everything that depends on the scenario but not on the player. */
  function rebuildScenario () {
    const sc = scenario()
    const key = sc.scenario_id ?? `${state.population}__${state.seed}`
    if (scenarioKey === key && completeDensity) return
    scenarioKey = key
    defaultId = null
    const all = [...Array(sc.observations.y.length).keys()]
    completeDensity = densityFor(sc.observations, all, 0, 2)
    const pop = sc.arms?.none?.population
    population = pop ? { mu: pop.mu.mean, tau: pop.tau.mean } : null

    playerSelect.innerHTML = sc.truth.child_id.map((id, i) =>
      `<option value="${id}">Player ${id} — ${sc.truth.n_train[i]} serves</option>`).join('')

    teamStats = buildTeamStats(sc)
  }

  /**
   * The prior swap, run on every player on the team.
   *
   * None of this depends on which player is selected, and it is 80 grid
   * posteriors over 650 rows -- far too much to redo every time the step slider
   * moves. Cached per scenario.
   */
  function buildTeamStats (sc) {
    if (!population) return null
    const ids = sc.truth.child_id
    const ns = sc.truth.n_train
    const move = new Array(ids.length)
    let maeFlat = 0
    let maeLearned = 0
    let better = 0
    for (let i = 0; i < ids.length; i++) {
      const r = rowsForPlayer(sc.observations, ids[i])
      const a = summarize(densityFor(sc.observations, r, 0, 2), GRID).mean
      const b = summarize(densityFor(sc.observations, r, population.mu, population.tau), GRID).mean
      move[i] = Math.abs(b - a)
      const ea = Math.abs(a - sc.truth.theta_true[i])
      const eb = Math.abs(b - sc.truth.theta_true[i])
      maeFlat += ea
      maeLearned += eb
      if (eb < ea) better++
    }
    // The sparsest band against the best-observed one, averaged rather than
    // picked. Two individual players would make the ratio look much larger --
    // player 4 against player 31 on the default team is 43x -- but that number
    // is a coincidence of which two players you name. The band means are 3x-8x
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
    learnedDensity = population
      ? densityFor(sc.observations, rows, population.mu, population.tau)
      : null
    // One ruler per player, held fixed for every step. This is the figure: the
    // curve narrows against axes that do not move. Both panels get their own,
    // because only the free-play one draws the learned-prior curve.
    bounds = frameBounds(frames, GRID)
    freeBounds = frameBounds(frames, GRID, { extras: [learnedDensity] })
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
          honest about it. This is the state every five-serve player in section 2
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
      // Pinned: the panel, the 90px likelihood strip and the caption all have to
      // fit between the rail and the bottom of the window. Rebuilt on resize.
      height: typeof window === 'undefined'
        ? 320
        : Math.max(220, Math.min(340, window.innerHeight - 290))
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
        // Seven entries, so the labels stay short enough to sit on two rows.
        // What each curve MEANS is the figcaption's job -- a legend that
        // explains itself in full sentences crowds the panel it belongs to.
        // 'Point estimates' is one toggle over all three ticks: they answer the
        // same question three ways and are only readable against each other.
        { id: 'posterior', label: 'Belief now', marker: 'area', color: '#e69f00' },
        { id: 'prior', label: 'Belief one serve ago', marker: 'dashed', color: '#94a3b8' },
        { id: 'ghosts', label: 'Every belief so far', marker: 'line', color: '#e69f00' },
        { id: 'estimates', label: 'Point estimates', marker: 'rule', color: '#6a3d9a' },
        { id: 'complete', label: 'Complete pooling', marker: 'line', color: '#000000' },
        { id: 'learned', label: 'Prior learned from the team', marker: 'line', color: '#56b4e9' },
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
      bounds: freeBounds,
      extras: { complete: completeDensity, learned: learnedDensity },
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
      `${nObs} serves in this scenario, which is why it does not move when you change player. ` +
      `The blue curve is this player's own serves again, started from a prior learned from the team. ` +
      `The ticks on the axis are the prior's answer (grey, always 0), the model's (orange) and ` +
      `this player's own data on their own (purple, the maximum-likelihood estimate — absent, and ` +
      `drawn as an arrow off the edge, while every serve so far has gone the same way). ` +
      `Both axes are fixed for this player across every step. ` +
      `Change the player and watch which curves jump and which one does not. ` +
      scaleLine(frame.density)
  }

  /**
   * Three answers to one question, at the step the reader is standing on.
   *
   * The third one is the MLE: the theta that maximises this player's own
   * likelihood with no prior term. It is NOT logit(makes / n) -- the serves
   * have different difficulties, so the sample rate is an answer to a different
   * question and would put the tick in the wrong place.
   *
   * It is also allowed not to exist. Every serve going the same way leaves a
   * likelihood that only ever rises, so the maximum is off at infinity and
   * there is no frequentist estimate at all -- which happens in the first few
   * serves of nearly every player and never resolves for about one player in
   * twenty. That is the most interesting state this readout has, so it says so
   * in words rather than falling back to 0.
   */
  function renderEstimates (frame) {
    const box = el.querySelector('[data-role="estimates-takeaway"]')
    const line = controls.querySelector('[data-role="estimates-readout"]')
    const model = frame.summary.mean
    const allMakes = frame.n > 0 && frame.makes === frame.n
    const serves = (n) => `${n} ${n === 1 ? 'serve' : 'serves'}`

    line.innerHTML = `prior <span class="figures">0.000</span> · model ` +
      `<span class="figures">${model.toFixed(3)}</span> · own data ` +
      (frame.mleDefined
        ? `<span class="figures">${frame.mle.toFixed(3)}</span>`
        : '<span class="figures">none yet</span>')

    // The guarantee is about the MODE, and the site quotes means everywhere.
    // Measured across all 25 scenarios and 1,000 players (scripts/smoke.mjs):
    // the mode is never outside 0 and the MLE, the mean is inside for 90.1% of
    // the 946 players whose MLE exists at all, and the worst excursion is 0.06.
    // So the prose describes where the estimate lands and the aside owns the
    // exception rather than claiming an ordering that is not always true.
    const caveat = `<span class="aside">Strictly, it is the posterior
      <em>mode</em> that is pinned between the two — a log-concave prior times a
      log-concave likelihood cannot peak outside them. The number quoted here,
      and everywhere else on this site, is the posterior <em>mean</em>, and when
      the belief is skewed a mean can sit a hair outside the pair: about one
      player in ten across the shipped scenarios, and by under 0.07 on θ even at
      its worst.</span>`

    if (frame.n === 0) {
      box.innerHTML = `No serves yet. The prior alone puts this player at
        <strong class="figures">0.000</strong>, and their own data have not said
        anything at all — there is nothing yet for a data-only estimate to be
        computed from. Step forward and watch what the serves do to the other
        two.`
      return
    }

    if (!frame.mleDefined) {
      const same = allMakes ? 'a make' : 'a miss'
      const plural = allMakes ? 'makes' : 'misses'
      const dir = allMakes ? 'better' : 'worse'
      box.innerHTML = `After ${fmt(frame.n, 0)} ${frame.n === 1 ? 'serve' : 'serves'},
        every one of them ${same}, this player's own data have
        <strong>no estimate yet</strong>. The likelihood has no peak:
        ${plural} only ever get more likely the ${dir} you suppose the player
        to be, and nothing in the data says where to stop, so the maximum runs
        off the end of the axis — which is what the purple arrow at the edge of
        the panel means. The model has an estimate anyway, ${fmt(model)},
        because the prior supplies the information the data have not. That is
        the trade, in one picture: the frequentist estimate does not exist here
        and the Bayesian one is merely uncertain. ${caveat}`
      return
    }

    const between = (model > 0 && model < frame.mle) || (model < 0 && model > frame.mle)
    box.innerHTML = `After ${serves(frame.n)}: the prior alone said
      <strong class="figures">0.000</strong>, this player's own data alone say
      ${fmt(frame.mle)}, and the model says ${fmt(model)}. ${between
        ? '<strong>The model\'s estimate lands between the two.</strong>'
        : '<strong>The model\'s estimate sits a hair outside the pair here</strong> — ' +
          'which a posterior mean is allowed to do when the belief is skewed.'}
      It is not a compromise anyone chose: it is what multiplying a prior by a
      likelihood does. Keep stepping and it pulls away from 0 toward the
      data-only answer; how close it gets is exactly how far the serves
      outweigh the prior. ${caveat}`
  }

  /** The step-independent half: everything that only moves with the frames. */
  function renderFree () {
    renderFreeChart()
    traceBox.innerHTML = ''
    traceBox.appendChild(beliefTrace({ frames, width: traceBox.clientWidth || 760 }))
    renderRateTakeaway()
    renderTraceCaption()
    renderFrameTable()
    renderPriorTakeaway()
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

  // --- two extremes, and the prior swap ------------------------------------

  /**
   * Two extremes and an empty cell the reader fills in.
   *
   * The partial-pooling row stays blank until the prior-swap section below comes
   * into view, because that is where the answer is demonstrated rather than
   * asserted. In a harness with no IntersectionObserver renderWhenNear fires
   * immediately, so the row is simply filled from the start there.
   */
  function renderFrameTable () {
    const nObs = scenario().observations.y.length
    const body = el.querySelector('[data-role="frame-table"]')
    const learned = population
      ? `N(${population.mu.toFixed(2)}, ${population.tau.toFixed(2)}²) — learned from the team`
      : '—'
    body.innerHTML = `
      <tr><td><b>No pooling</b></td><td>N(0, 2) — ~flat on probability</td>
          <td>only player ${playerId}'s serves</td></tr>
      <tr><td><b>Complete pooling</b></td><td>N(0, 2) — one shared curve</td>
          <td>all ${nObs} serves, into one number</td></tr>
      <tr data-role="partial-row"><td><b>Partial pooling</b></td>
          <td data-role="partial-prior">${partialRevealed ? learned : '?'}</td>
          <td data-role="partial-data">${
            partialRevealed ? `only player ${playerId}'s serves` : '?'}</td></tr>`
    el.querySelector('[data-role="frame-note"]').textContent = partialRevealed
      ? 'One knob, and it is the left-hand column. The serves in the right-hand ' +
        'column never changed.'
      : 'Two extremes and an empty row. Only one of the two columns has to change ' +
        'to get partial pooling — work out which, then read on.'
  }

  function renderPriorTakeaway () {
    const box = el.querySelector('[data-role="prior-takeaway"]')
    if (!population || !learnedDensity || !teamStats) { box.innerHTML = ''; return }
    const sc = scenario()
    const k = indexOfPlayer(playerId)
    const flat = frames[frames.length - 1].summary
    const learned = summarize(learnedDensity, GRID)
    const moved = learned.mean - flat.mean
    const truth = sc.truth.theta_true[k]
    const fitted = sc.arms?.none?.players
    const fittedMean = fitted ? fitted.theta_mean[fitted.child_id.indexOf(playerId)] : null

    // Adaptive shrinkage from first principles: the same prior swap, averaged
    // over the sparsest band and over the best-observed one.
    const { lo, hi, n, maeFlat, maeLearned, better } = teamStats
    const ratio = hi.move > 1e-9 ? lo.move / hi.move : null
    const nSelf = frames.length - 1
    const teamWin = maeLearned < maeFlat

    const errFlat = Math.abs(flat.mean - truth)
    const errLearned = Math.abs(learned.mean - truth)

    box.innerHTML = `
      Player ${playerId}, ${fmt(nSelf, 0)} serves. From the flat prior
      their own data lands at ${fmt(flat.mean)} (sd ${flat.sd.toFixed(3)}). From the
      learned prior <span class="figures">N(${population.mu.toFixed(2)},
      ${population.tau.toFixed(2)}²)</span> — same serves, same arithmetic — it lands
      at ${fmt(learned.mean)} (sd ${learned.sd.toFixed(3)}). The prior moved them
      ${fmt(moved, 3)}${
        fittedMean != null
          ? `, and the site's own partial-pooling estimate for them is ${fmt(fittedMean)}`
          : ''}.
      <br><br>
      Run that same swap on everyone. The ${fmt(lo.count, 0)} players with
      ${fmt(lo.n, 0)} serves move ${fmt(lo.move)} on average; the
      ${fmt(hi.count, 0)} with ${fmt(hi.n, 0)} move ${fmt(hi.move)} —
      ${ratio ? `${fmt(ratio, 1)}× less` : 'barely at all'}.
      <strong>Nothing instructed it to.</strong> That is section 2's adaptive
      shrinkage, derived here from first principles: a wide belief is easy for a
      prior to move and a narrow one is not.
      <br><br>
      For this player the learned prior lands
      ${errLearned < errFlat ? 'closer to' : 'further from'} their true ability
      (${fmt(errLearned)} against ${fmt(errFlat)}).
      <span class="aside">One player proves nothing, so here is the whole team on
      ${teamLabel() || 'this team'}: mean absolute error against the truth is
      <b class="figures">${maeFlat.toFixed(3)}</b> from the flat prior and
      <b class="figures">${maeLearned.toFixed(3)}</b> from the learned one, and the
      learned prior helps <b class="figures">${better}</b> of ${n} players.
      ${teamWin
        ? 'It wins on average here.'
        : 'It loses on average here — shrinkage is a mechanism, not a guarantee.'}
      Change the population or the team in the bar above and watch that margin
      move; on some draws it is thin enough to call noise.</span>`

    el.querySelector('[data-role="closing"]').innerHTML = `
      Sections 2 and 4 showed the model pulling small samples toward the team.
      Nothing in this section instructed it to. <strong>The pull is what happens
      when the same updating process starts from what the population already
      taught us, instead of from nothing.</strong>`
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

    // The 2x2's third row fills in when the reader reaches the section that
    // demonstrates it, not before.
    const offReveal = renderWhenNear(el.querySelector('[data-role="prior-takeaway"]'), () => {
      partialRevealed = true
      if (ready && frames.length) renderFrameTable()
    }, { rootMargin: '0px' })

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
        scenarioKey = null
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
      offReveal()
      controls.removeEventListener('click', onControls)
      controls.removeEventListener('change', onChange)
      slider.removeEventListener('input', onSlide)
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }

  return { el, mount }
}
