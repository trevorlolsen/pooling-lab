import { state, subscribe, setState, teamLabel, is2d, skillScenario, skillLabel } from '../state.js'
import { renderWhenNear, trackSteps } from '../lib/scroll.js'
import { zip, armEstimates, truthValues } from '../lib/transforms.js'
import { playerRows } from '../charts/playerRows.js'
import { playerEllipses } from '../charts/playerEllipses.js'
import { hasPosteriorQuantiles } from '../charts/posteriorBoxes.js'
import { layerLegend } from '../lib/layers.js'

/**
 * Section 3 — the flagship. One chart, pinned, carrying a five-beat argument as
 * the prose scrolls past it.
 *
 * This is the only place the sticky-graphic pattern earns its complexity: the
 * same 40 rows mean something different at each step, and re-rendering the chart
 * per step is what makes the movement legible.
 */
const STEPS = [
  {
    lede: 'Trust each player, and only that player.',
    body: `No pooling estimates every player from their own serves alone. The
           player you watched five times gets an estimate built from five serves —
           and it is all over the place.`
  },
  {
    lede: 'Or trust nobody in particular.',
    body: `Complete pooling goes the other way: one number for the whole team.
           Nobody is special, so nobody is wrong in an interesting way. The dashed
           line is where it puts everyone.`
  },
  {
    lede: 'Partial pooling moves each player toward the team.',
    body: `Now every player gets pulled from their own estimate toward what the
           team suggests. The grey segment is that pull — the distance the model
           decided to move them.`,
    // In two skills the pull has a direction as well as a length.
    body2d: ` In two skills the pull is a vector — it points toward the team
           average in the plane.`
  },
  {
    lede: 'And it moves the sparse ones furthest.',
    body: `This is the part that matters. The segments are long at the top, where
           players have five observations, and short at the bottom, where they
           have thirty. Nobody told the model to do that.`
  },
  {
    lede: 'So was it right?',
    body: `Here is the truth we simulated from. Watch which estimate ends up
           closer — and notice it is not uniformly one model.`
  }
]

const CAPTION_1D = 'One row per player, grouped by how many serves we watched. Click any player for their numbers.'
const CAPTION_2D = 'One point per player; the segment is the pull toward the team, in both skills at once. Click any player for their numbers.'

export function adaptiveShrinkage () {
  // Read once: a dimension change remounts the section, so the prose can be
  // fixed at build time rather than patched on every render.
  const twoD = is2d()
  const el = document.createElement('section')
  el.id = 'shrinkage'
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">2 — Adaptive shrinkage</p>
        <h2>Players with less information borrow more from the team</h2>
        <p>Three models, the same forty players, the same axis. The only thing
           that changes between them is what they assume about how players
           relate to each other.</p>
      </header>
      <div class="scrolly">
        <div class="scrolly-steps" data-role="steps">
          ${STEPS.map((s, i) => `
            <div class="step" data-step="${i}" data-active="false">
              <p class="step-lede">${s.lede}</p>
              <p>${s.body}${twoD && s.body2d ? s.body2d : ''}</p>
            </div>`).join('')}
        </div>
        <div class="scrolly-graphic">
          <figure class="chart-panel">
            <div data-role="legend"></div>
            <div data-role="chart"></div>
            <figcaption data-role="caption">${twoD ? CAPTION_2D : CAPTION_1D}</figcaption>
            <div data-role="posterior-notice"></div>
            <div data-role="detail"></div>
          </figure>
        </div>
      </div>
      <p class="takeaway" data-role="takeaway"></p>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  const stepEls = [...el.querySelectorAll('.step')]
  let legend = null
  let step = STEPS.length - 1
  let ready = false

  function render () {
    const { scenario, index, tokens, scale, difficulty } = state
    if (!scenario) return
    if (!legend) {
      const { tokens, index } = state
      legend = layerLegend([
        { id: 'complete', label: 'Complete pooling', marker: 'rule-dashed', color: tokens.get('complete').color },
        { id: 'no_pool', label: 'No pooling', marker: 'open', color: tokens.get('no_pool').color },
        { id: 'partial', label: 'Partial pooling', marker: 'dot', color: tokens.get('none').color },
        { id: 'truth', label: 'Truth', marker: 'times', color: index.truth_color },
        { id: 'true_mean', label: 'True population mean', marker: 'rule-dashed', color: index.truth_color }
      ], () => render())
      el.querySelector('[data-role="legend"]').appendChild(legend.el)
    }

    // The pinned figure has to fit between the rail and the bottom of the
    // window, less the legend and caption sitting around it.
    const fit = typeof window === 'undefined' ? null : Math.max(460, window.innerHeight - 190)

    chart.innerHTML = ''
    chart.appendChild(twoD
      ? playerEllipses({
        scenario,
        index,
        tokens,
        scale,
        difficulty,
        step,
        view: state.view,
        layers: legend.get(),
        selectedPlayer: state.selectedPlayer,
        onSelect: (id) => setState({ selectedPlayer: id }, 'select'),
        width: chart.clientWidth || 760,
        height: fit == null ? 560 : Math.min(560, fit)
      })
      : playerRows({
        scenario,
        index,
        tokens,
        scale,
        difficulty,
        step,
        view: state.view,
        layers: legend.get(),
        // Null until the reader actually clicks. A ring sitting on player 1
        // before anyone chose them is just noise.
        selectedPlayer: state.selectedPlayer,
        onSelect: (id) => setState({ selectedPlayer: id }, 'select'),
        width: chart.clientWidth || 760,
        maxHeight: fit
      }))
    renderPosteriorNotice()
    renderDetail()
    renderTakeaway()
  }

  /**
   * The posterior view needs quartiles the data may predate. Say so rather than
   * drawing nothing and leaving the toggle looking dead.
   */
  function renderPosteriorNotice () {
    const box = el.querySelector('[data-role="posterior-notice"]')
    const missing = state.view === 'posterior' &&
      !hasPosteriorQuantiles(skillScenario(1)?.arms?.no_pool)
    box.innerHTML = missing
      ? '<div class="note">This data was built before posterior quartiles were ' +
        'exported, so there is nothing to draw. Re-run ' +
        '<code>Rscript scripts/build_site_data.R --export-only</code>.</div>'
      : ''
  }

  /** One skill's numbers for one player, on the displayed scale, or null. */
  function skillDetail (k, id) {
    const { index, scale, difficulty } = state
    const sc = skillScenario(k)
    const opts = { scale, difficulty, difficultyGrid: index.difficulty_grid }
    const np = armEstimates(sc.arms.no_pool, opts).find((d) => d.child_id === id)
    const pp = armEstimates(sc.arms.none, opts).find((d) => d.child_id === id)
    const tr = truthValues(sc.truth, opts).find((d) => d.child_id === id)
    if (!np || !pp || !tr) return null
    const noPoolErr = Math.abs(np.estimate - tr.truth_value)
    const partialErr = Math.abs(pp.estimate - tr.truth_value)
    return {
      n_train: tr.n_train,
      no_pool_mean: np.estimate,
      partial_mean: pp.estimate,
      shrinkage: Math.abs(pp.estimate - np.estimate),
      better: partialErr < noPoolErr
    }
  }

  const verdictOf = (better) => better
    ? `<strong style="color:var(--truth)">closer to the truth</strong>`
    : `<strong style="color:var(--no-pool)">further from the truth</strong>`

  /**
   * What clicking a player actually buys: their own numbers, and whether the
   * move the model made was toward the truth or away from it.
   *
   * That last part matters. Shrinkage is a mechanism, not a guarantee -- for
   * any individual player it can move the estimate the wrong way, and saying so
   * is more honest than implying every move is an improvement.
   */
  function renderDetail () {
    const box = el.querySelector('[data-role="detail"]')
    const id = state.selectedPlayer
    if (id == null) {
      box.innerHTML = ''
      return
    }
    // Computed live rather than read from the precomputed frame, which is fixed
    // at d* = 0. Otherwise moving the difficulty slider would change the chart
    // and leave these numbers behind.
    if (!twoD) {
      const pool = skillDetail(1, id)
      if (!pool) { box.innerHTML = ''; return }
      box.innerHTML = `
        <div class="player-detail figures">
          <strong>Player ${id}</strong>
          <span>${pool.n_train} observations</span>
          <span>no pooling <b>${pool.no_pool_mean.toFixed(3)}</b></span>
          <span>partial pooling <b>${pool.partial_mean.toFixed(3)}</b></span>
          <span>moved <b>${pool.shrinkage.toFixed(3)}</b></span>
          <span>and landed ${verdictOf(pool.better)}</span>
        </div>`
      return
    }

    const a = skillDetail(1, id)
    const b = skillDetail(2, id)
    if (!a || !b) { box.innerHTML = ''; return }

    // The pull as a single length in the plane, from the SAME per-skill
    // estimates quoted below. On the probability scale those come from the
    // grid (the posterior mean of plogis), which is not plogis of the posterior
    // mean that players2d carries -- so deriving the planar distance from
    // players2d would put two different quantities in one box.
    const moved = Math.hypot(a.shrinkage, b.shrinkage)

    const line = (label, d) => `
        <div class="player-detail figures">
          <strong>${label}</strong>
          <span>no pooling <b>${d.no_pool_mean.toFixed(3)}</b></span>
          <span>partial pooling <b>${d.partial_mean.toFixed(3)}</b></span>
          <span>moved <b>${d.shrinkage.toFixed(3)}</b></span>
          <span>and landed ${verdictOf(d.better)}</span>
        </div>`
    box.innerHTML = `
        <div class="player-detail figures">
          <strong>Player ${id}</strong>
          <span>${a.n_train} observations in each skill</span>
          ${moved != null ? `<span>moved <b>${moved.toFixed(3)}</b> in the plane</span>` : ''}
        </div>
        ${line(skillLabel(1), a)}
        ${line(skillLabel(2), b)}`
  }

  /** "Players with 5 observations moved 0.061 on average. Players with 30 moved 0.019 — 3.1× less." */
  function shrinkageSentence (sc, prefix = '') {
    const shrink = zip(sc.derived.shrinkage_by_information)
    if (!shrink.length) return ''
    const low = shrink[0]
    const high = shrink[shrink.length - 1]
    const ratio = high.mean_shrinkage > 0
      ? (low.mean_shrinkage / high.mean_shrinkage)
      : null
    return `${prefix}Players with <strong class="figures">${low.n_train}</strong> observations moved
      <strong class="figures">${low.mean_shrinkage.toFixed(3)}</strong> on average.
      Players with <strong class="figures">${high.n_train}</strong> moved
      <strong class="figures">${high.mean_shrinkage.toFixed(3)}</strong>${
        ratio ? ` — <strong class="figures">${ratio.toFixed(1)}×</strong> less` : ''}.`
  }

  function renderTakeaway () {
    const opening = twoD
      ? [
          shrinkageSentence(skillScenario(1), `In ${skillLabel(1)}: `),
          shrinkageSentence(skillScenario(2), `In ${skillLabel(2)}: `)
        ].filter(Boolean).join(' ')
      : shrinkageSentence(skillScenario(1))
    if (!opening) return

    el.querySelector('[data-role="takeaway"]').innerHTML = `
      ${opening}
      <strong>The model was never told how many observations anyone had.</strong>
      It worked that out from how uncertain each player's own data left it.
      <span class="aside">This is one team — one random draw. Use
      <b>${teamLabel()}</b> in the bar above to draw another; the pattern holds in
      all five. That check matters more later, where some conclusions do not
      survive it.</span>`
  }

  function mount () {
    renderWhenNear(el, () => { ready = true; render() })

    const offSteps = trackSteps(stepEls, (i) => {
      step = i
      for (const [j, s] of stepEls.entries()) {
        s.dataset.active = String(j === i)
      }
      if (ready) render()
    })

    const offState = subscribe((reason) => {
      if (ready && ['scenario', 'scale', 'difficulty', 'select', 'view'].includes(reason)) render()
    })

    // The pinned figure is sized against the viewport, so it has to be rebuilt
    // when the viewport changes. Debounced: resize fires continuously on drag.
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
