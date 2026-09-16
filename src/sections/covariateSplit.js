import { state, subscribe, is2d, skillLabel } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { zip, borrowingTargets, plogis } from '../lib/transforms.js'
import { borrowingSplit } from '../charts/borrowingSplit.js'
import { borrowingSplit2d } from '../charts/borrowingSplit2d.js'
import { layerLegend } from '../lib/layers.js'

/**
 * What a covariate actually changes: not how hard the model pulls, but WHERE it
 * pulls to.
 *
 * Built twice -- once for the covariate that reflects a real division and once
 * for a scrambled one. Same players, same data, same model. Only the label
 * changes, and the contrast between the two sections is the argument.
 *
 * Deliberately not a scrollytelling section. There is one thing to see here and
 * pinning a chart to make the reader scroll past five paragraphs would get in
 * the way of it.
 */
export function covariateSplit ({ armId, number, eyebrow }) {
  const el = document.createElement('section')
  el.id = `covariate-${armId}`
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${number} — ${eyebrow}</p>
        <h2 data-role="headline"></h2>
        <p data-role="lede"></p>
      </header>
      <figure class="chart-panel">
        <div class="legend" data-role="legend"></div>
        <div data-role="chart"></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  let legend = null

  function unavailable (message) {
    el.querySelector('[data-role="headline"]').textContent = 'Not available for this population'
    el.querySelector('[data-role="lede"]').textContent = message
    el.querySelector('[data-role="legend"]').innerHTML = ''
    legend = null
    chart.innerHTML = ''
    el.querySelector('[data-role="caption"]').textContent = ''
    el.querySelector('[data-role="takeaway"]').innerHTML = ''
  }

  /**
   * The two targets in the plane, on the displayed scale. Targets ship on the
   * theta scale; on the probability scale each axis maps through plogis(θ − d*)
   * before the distance is taken, so the number matches what is drawn.
   */
  function targets2d (arm, { scale, difficulty }) {
    if (!arm?.borrowing_targets2d) return []
    const map = (t) => (scale === 'theta' ? t : plogis(t - difficulty))
    return zip(arm.borrowing_targets2d).map((t) => ({
      ...t, x: map(t.target1), y: map(t.target2)
    }))
  }

  function render () {
    const { scenario, index, tokens, scale, difficulty } = state
    if (!scenario) return

    const twoD = is2d()
    const arm = scenario.arms[armId]
    const cov = scenario.analysis_covariates?.[armId]
    if (!arm || !cov) {
      unavailable(armId === 'correct'
        ? 'This population has no real grouping to condition on, so there is no correct covariate to use. Try one of the two-group populations.'
        : 'No alternative grouping was fitted for this population.')
      return
    }

    const opts = { scale, difficulty, difficultyGrid: index.difficulty_grid }
    // 1D: the spread is a distance on the axis. 2D: the distance between the
    // distinct group targets in the plane, and the global target is a point.
    let spread = 0
    let globalTarget = null
    if (twoD) {
      const pts = targets2d(arm, opts)
      const distinct = [...new Map(pts.map((t) => [`${t.x.toFixed(4)},${t.y.toFixed(4)}`, t])).values()]
      for (let i = 0; i < distinct.length; i++) {
        for (let j = i + 1; j < distinct.length; j++) {
          spread = Math.max(spread, Math.hypot(distinct[i].x - distinct[j].x, distinct[i].y - distinct[j].y))
        }
      }
      globalTarget = targets2d(scenario.arms.none, opts)[0] ?? null
    } else {
      const targets = borrowingTargets(arm, opts)
      const distinctTargets = [...new Set(targets.map((t) => t.target.toFixed(4)))].map(Number)
      globalTarget = borrowingTargets(scenario.arms.none, opts)[0]?.target
      spread = distinctTargets.length > 1
        ? Math.max(...distinctTargets) - Math.min(...distinctTargets)
        : 0
    }
    const overlap = cov.overlap ?? {}
    const isCorrect = armId === 'correct'

    el.querySelector('[data-role="headline"]').textContent = isCorrect
      ? 'With a real grouping, the target splits in two'
      : 'With a meaningless grouping, the target does not split at all'

    el.querySelector('[data-role="lede"]').innerHTML = isCorrect
      ? `The model now knows which group each player belongs to, so it estimates a
         separate mean for each and pulls every player toward <em>theirs</em>
         instead of toward one number for everybody.`
      : `Same players, same serves, same model. The only thing changed is the
         label: these groups were assigned by shuffling the real ones, so they
         carry no information about ability.
         ${overlap.n_matching != null
           ? `<strong class="figures">${overlap.n_matching}</strong> of
              <strong class="figures">${overlap.n_total}</strong> players happen to
              keep their real group, which is about what chance would give.`
           : ''}`

    if (!legend) {
      legend = layerLegend([
        { id: 'no_pool', label: 'No pooling', marker: 'open', color: tokens.get('no_pool').color },
        { id: 'pooled', label: 'Pulled toward the group mean', marker: 'dot',
          color: tokens.get(armId).color },
        { id: 'targets', label: 'Estimated group mean', marker: 'rule',
          color: tokens.get(armId).color },
        { id: 'true_group_mean', label: 'True mean of this group', marker: 'rule-dashed',
          color: index.truth_color },
        { id: 'global_target', label: 'Where no covariate would pull', marker: 'rule-dashed',
          color: tokens.get('none').color },
        { id: 'truth', label: 'Truth', marker: 'times', color: index.truth_color }
      ], () => render())
      el.querySelector('[data-role="legend"]').innerHTML = ''
      el.querySelector('[data-role="legend"]').appendChild(legend.el)
    }

    chart.innerHTML = ''
    chart.appendChild(twoD
      ? borrowingSplit2d({
        scenario, index, tokens, armId, scale, difficulty, view: state.view,
        layers: legend.get(),
        width: chart.clientWidth || 760,
        // Panels sit side by side in the plane, so the height grows more gently
        // with the team than the row chart does.
        height: Math.max(420, 60 + 30 * cov.G + 12 * scenario.n_players)
      })
      : borrowingSplit({
        scenario, index, tokens, armId, scale, difficulty, view: state.view,
        layers: legend.get(),
        width: chart.clientWidth || 760,
        // Not pinned, so it can exceed the viewport -- but only a little. At 22px
        // per row this ran past 1000px and took a screen and a half to scan; 15px
        // is enough for a box plus separation and keeps the whole comparison in
        // roughly one screen. Every player appears once across the panels, so row
        // height scales with the team, not the group count.
        height: Math.max(400, 60 + 30 * cov.G + 15 * scenario.n_players)
      }))

    el.querySelector('[data-role="caption"]').innerHTML = twoD
      ? `One panel per assigned group. The cross in each panel is that group's
         estimated mean, with its 90% intervals in ${skillLabel(1)} and ${skillLabel(2)}
         — the place its players get pulled toward. The green dashed cross is what
         that group's abilities actually average, and the blue dashed cross is the
         single target a model without any covariate would have used.`
      : `One panel per assigned group. The solid line in each panel is that group's
         estimated mean — the place its players get pulled toward. The green dashed
         line is what that group's ability actually averages, and the blue dashed
         line is the single target a model without any covariate would have used.`

    const fmt = (x) => (scale === 'theta' ? x.toFixed(2) : x.toFixed(3))
    const globalText = twoD
      ? (globalTarget ? `(${fmt(globalTarget.x)}, ${fmt(globalTarget.y)})` : null)
      : (globalTarget != null ? fmt(globalTarget) : null)
    const where = twoD ? ' in the plane' : ''
    el.querySelector('[data-role="takeaway"]').innerHTML = isCorrect
      ? `The two targets sit <strong class="figures">${fmt(spread)}</strong> apart${where}
         ${globalText != null ? `— one either side of the
         <span class="figures">${globalText}</span> a covariate-free model
         would have used` : ''}. Players in different groups are now pulled in
         <strong>opposite directions</strong>, and no player is dragged toward a
         value nobody has.`
      : `The two targets sit only <strong class="figures">${fmt(spread)}</strong>
         apart${where}${globalText != null ? `, both effectively on top of the
         <span class="figures">${globalText}</span> a covariate-free model
         would have used` : ''}. The model looked for a difference between these
         groups, found none, and quietly went back to treating everyone the same.
         <strong>A useless covariate is not harmful — it is just wasted.</strong>`
  }

  function mount () {
    renderWhenNear(el, render)
    return subscribe((reason) => {
      if (['scenario', 'scale', 'difficulty', 'view'].includes(reason)) render()
    })
  }

  return { el, mount }
}

export const correctCovariateSplit = () =>
  covariateSplit({ armId: 'correct', number: '5', eyebrow: 'The right grouping' })

export const wrongCovariateSplit = () =>
  covariateSplit({ armId: 'wrong', number: '6', eyebrow: 'The wrong grouping' })
