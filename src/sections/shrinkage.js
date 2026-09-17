import { state, subscribe, setState, teamLabel, is2d, skillScenario, skillLabel } from '../state.js'
import { renderWhenNear, trackSteps } from '../lib/scroll.js'
import { zip, armEstimates, truthValues } from '../lib/transforms.js'
import { playerRows } from '../charts/playerRows.js'
import { playerEllipses } from '../charts/playerEllipses.js'
import { hasPosteriorQuantiles } from '../charts/posteriorBoxes.js'
import { layerLegend } from '../lib/layers.js'
import { bandFilter, scenarioBands } from '../lib/bandFilter.js'

/**
 * Section 2 — the flagship. One chart, pinned, carrying a five-beat argument as
 * the prose scrolls past it.
 *
 * This is the only place the sticky-graphic pattern earns its complexity: the
 * same 40 rows mean something different at each step, and re-rendering the chart
 * per step is what makes the movement legible.
 */
/**
 * Step prose. `body` is the one-skill text. In two skills a step may supply
 * `body2d`, which REPLACES `body` (the 2D chart draws different marks, so the
 * sentences that name them have to change), or `append2d`, which is added after
 * `body` (the 1D sentence still holds and the 2D one extends it).
 */
const STEPS = [
  {
    lede: 'Trust each player, and only that player.',
    body: `No pooling estimates every player from their own serves alone. The
           player you watched five times gets an estimate built from five serves —
           and it is all over the place.`,
    body2d: `No pooling estimates every player from their own plays alone. The
           player you watched five times gets an estimate built from five plays —
           and it is all over the place.`
  },
  {
    lede: 'Or trust nobody in particular.',
    body: `Complete pooling goes the other way: one number for the whole team.
           Nobody is special, so nobody is wrong in an interesting way. The dashed
           line is where it puts everyone.`,
    body2d: `Complete pooling goes the other way: one point for the whole team.
           Nobody is special, so nobody is wrong in an interesting way. The diamond
           where the dashed lines cross is where it puts everyone.`
  },
  {
    lede: 'Partial pooling moves each player toward the estimated population mean.',
    body: `Now every player gets pulled from their own estimate toward the
           estimated population mean μ. The grey segment is that pull — the
           distance the model decided to move them.`,
    // In two skills the pull has a direction as well as a length.
    append2d: ` In two skills the pull is a vector — the grey arrow points toward
           the estimated population mean μ in the plane.`
  },
  {
    lede: 'And it moves the sparse ones furthest.',
    body: `This is the part that matters. The segments are long at the top, where
           players have five serves, and short at the bottom, where they have
           thirty. Nobody told the model to do that. The other bands are dimmed so
           the five-serve players stand out.`,
    body2d: `This is the part that matters. The lit points are the players watched
           five times; everyone else is dimmed. Their arrows are the longest —
           nobody told the model that.`
  },
  {
    lede: 'So was it right?',
    body: `Here is the truth we simulated from. Watch which estimate ends up
           closer — and notice it is not uniformly one model. The green dashed
           line is the true population mean μ, which complete pooling was aiming
           at.`,
    body2d: `Here is the truth we simulated from. Watch which estimate ends up
           closer — and notice it is not uniformly one model. The green dashed
           crosshair is the true population mean μ, which complete pooling was
           aiming at.`
  }
]

/** The prose for one step in the mounted dimension; see the note on STEPS. */
const stepBody = (s, twoD) => (twoD
  ? (s.body2d ?? s.body) + (s.append2d ?? '')
  : s.body)

/**
 * The caption names every mark the chart can draw: the segment, the selection
 * ring, the sort order, and -- only when the rail is showing posteriors -- what
 * a box or ring is. It is rebuilt on every render because the view can change
 * without a remount.
 */
function captionText (twoD, view) {
  const base = twoD
    ? 'One point per player, in both skills at once. ' +
      'The grey arrow is the pull: from what the player\'s own plays say to where the model put them. ' +
      'Click a player to follow them; the black ring marks your choice, and once truth is drawn a dotted line runs from their estimate to their ×. Their numbers appear below the chart. ' +
      'Turn on Player numbers in the legend to see which × belongs to which point: the same number sits beside both. ' +
      'The buttons above hide or show players by how many plays they have; the numbers below the chart always count everyone.'
    : 'One row per player, grouped by how many serves we watched. Rows are sorted by their no-pooling estimate. ' +
      'The grey segment is the pull: from what the player\'s own serves say to where the model put them. ' +
      'Click a player to follow them; the black ring marks your choice. Their numbers appear below the chart. ' +
      'The buttons above hide or show players by how many serves they have; the numbers below the chart always count everyone.'
  if (view !== 'posterior') return base
  return base + (twoD
    ? ' Each ring encloses 50% of that model\'s posterior; a tilted ring means the model is borrowing across skills.'
    : ' Box = the middle 50% of that model\'s posterior, whiskers = 90%.')
}

/**
 * Legend entries for the mounted dimension and the current view. The swatch
 * must match the mark: in 2D complete pooling is a diamond on a dashed
 * crosshair, not a rule; in the posterior view the two estimate layers become
 * boxes (1D) or filled rings (2D).
 */
function legendItems ({ twoD, view, tokens, index }) {
  const posterior = view === 'posterior'
  const unit = twoD ? 'plays' : 'serves'
  return [
    twoD
      ? { id: 'complete', label: 'Complete pooling (one point for everyone)', marker: 'diamond', color: tokens.get('complete').color }
      : { id: 'complete', label: 'Complete pooling (one number for everyone)', marker: 'rule-dashed', color: tokens.get('complete').color },
    {
      id: 'no_pool',
      label: `No pooling — their own ${unit} alone`,
      marker: posterior ? (twoD ? 'area' : 'box') : 'open',
      color: tokens.get('no_pool').color
    },
    {
      id: 'partial',
      label: 'Partial pooling — where the model put them',
      marker: posterior ? (twoD ? 'area' : 'box') : 'dot',
      color: tokens.get('none').color
    },
    { id: 'truth', label: 'Truth', marker: 'times', color: index.truth_color },
    {
      id: 'true_mean',
      label: twoD ? 'True population mean μ (dashed crosshair)' : 'True population mean μ',
      marker: 'rule-dashed',
      color: index.truth_color
    },
    // 2D only, and off by default: in the plane nothing else says which × is
    // whose. In 1D the row does, so the entry would be noise there.
    ...(twoD
      ? [{ id: 'labels', label: 'Player numbers', marker: 'text', color: '#55606c', on: false }]
      : [])
  ]
}

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
              <p>${stepBody(s, twoD)}</p>
            </div>`).join('')}
        </div>
        <div class="scrolly-graphic">
          <figure class="chart-panel">
            <div data-role="legend"></div>
            <div data-role="filter"></div>
            <div data-role="chart"></div>
            <figcaption data-role="caption">${captionText(twoD, state.view)}</figcaption>
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
  // The view the legend's swatches were drawn for. The legend is built once and
  // keeps its toggle state in a closure, but its swatches must follow the rail's
  // Estimates/Posteriors switch -- so it is rebuilt when the view changes, with
  // the reader's toggles carried across.
  let legendView = null
  // The band filter: which observation counts are drawn. Built once per
  // ladder and carried across renders; every scenario uses the same ladder,
  // but if one ever did not, the control is rebuilt with the reader's choices
  // kept where they still apply.
  let filter = null
  let filterKey = null
  let step = STEPS.length - 1
  let ready = false

  function render () {
    const { scenario, index, tokens, scale, difficulty } = state
    if (!scenario) return
    const bands = scenarioBands(scenario)
    const key = bands.join(',')
    if (!filter || filterKey !== key) {
      const wasShown = filter ? new Set(filter.get()) : null
      filter = bandFilter({ bands, unit: twoD ? 'plays' : 'serves', onChange: () => render() })
      // Carry the reader's choice across a rebuild where it still applies.
      if (wasShown) {
        for (const b of bands) {
          if (!wasShown.has(b) && filter.get().length > 1) {
            filter.el.querySelector(`button[data-band="${b}"]`)?.click()
          }
        }
      }
      filterKey = key
      const host = el.querySelector('[data-role="filter"]')
      host.innerHTML = ''
      host.appendChild(filter.el)
    }
    if (!legend || legendView !== state.view) {
      const wasOn = legend ? legend.get() : {}
      // A rebuild keeps the reader's toggles; a fresh legend uses each entry's
      // own default (on, except where the entry says otherwise).
      const items = legendItems({ twoD, view: state.view, tokens, index })
        .map((i) => ({ ...i, on: i.id in wasOn ? wasOn[i.id] : i.on !== false }))
      legend = layerLegend(items, () => render())
      legendView = state.view
      const host = el.querySelector('[data-role="legend"]')
      host.innerHTML = ''
      host.appendChild(legend.el)
    }
    el.querySelector('[data-role="caption"]').textContent = captionText(twoD, state.view)

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
        bands: filter.get(),
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
        bands: filter.get(),
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

  // "Further" gets plain ink, not the no-pooling orange: on this page orange
  // means "No pooling", and a bad move by partial pooling is not that.
  const verdictOf = (better) => better
    ? `<strong style="color:var(--truth)">closer to the truth</strong>`
    : `<strong style="color:var(--ink)">further from the truth</strong>`

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
          <span>${pool.n_train} serves</span>
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
          <span>${a.n_train} plays in each skill</span>
          ${moved != null ? `<span>moved <b>${moved.toFixed(3)}</b> in the plane</span>` : ''}
        </div>
        ${line(skillLabel(1), a)}
        ${line(skillLabel(2), b)}`
  }

  // The unit of data in the mounted dimension: skill 2 is Reception, so in two
  // skills a data point is a "play", not a serve.
  const unit = twoD ? 'plays' : 'serves'

  /** "Players with 5 serves moved 0.061 on average. Players with 30 moved 0.019 — 3.1× less." */
  function shrinkageSentence (sc, prefix = '') {
    const shrink = zip(sc.derived.shrinkage_by_information)
    if (!shrink.length) return ''
    const low = shrink[0]
    const high = shrink[shrink.length - 1]
    const ratio = high.mean_shrinkage > 0
      ? (low.mean_shrinkage / high.mean_shrinkage)
      : null
    return `${prefix}Players with <strong class="figures">${low.n_train}</strong> ${unit} moved
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
      <strong>The model was never told how many ${unit} anyone had.</strong>
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
