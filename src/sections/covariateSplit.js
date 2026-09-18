import { state, subscribe, is2d, skillLabel } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { numberOf } from '../lib/sectionOrder.js'
import { zip, borrowingTargets, plogis } from '../lib/transforms.js'
import { borrowingSplit } from '../charts/borrowingSplit.js'
import { borrowingSplit2d } from '../charts/borrowingSplit2d.js'
import { layerLegend } from '../lib/layers.js'
import { bandFilter, scenarioBands, keepBands } from '../lib/bandFilter.js'

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
        <div data-role="filter"></div>
        <div data-role="chart"></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  let legend = null
  // What the current legend's swatches were drawn for. The legend keeps its
  // toggle state in a closure, but a box is not a dot and a ring is not a box:
  // the swatches must follow the rail's Estimates/Posteriors switch and the
  // One skill/Two skills toggle, so the legend is rebuilt when either changes,
  // with the reader's toggles carried across.
  let legendKey = null
  // The band filter: which observation counts are drawn. Keyed on the ladder
  // and the unit, since a dimension change turns serves into plays.
  let filter = null
  let filterKey = null

  function unavailable (message) {
    el.querySelector('[data-role="headline"]').textContent = 'Not available for this population'
    el.querySelector('[data-role="lede"]').textContent = message
    el.querySelector('[data-role="legend"]').innerHTML = ''
    el.querySelector('[data-role="filter"]').innerHTML = ''
    legend = null
    legendKey = null
    filter = null
    filterKey = null
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
           ? `<span class="detail"><strong class="figures">${overlap.n_matching}</strong> of
              <strong class="figures">${overlap.n_total}</strong> players happen to
              keep their real group, which is about what chance would give.</span>`
           : ''}`

    // Players whose assigned panel is not their true group. Read from the
    // payload's overlap block, not recounted here, so the caption quotes the
    // same number the lede does. Zero for the correct covariate by construction.
    const mismatched = overlap.n_matching != null ? overlap.n_total - overlap.n_matching : null
    const posterior = state.view === 'posterior'
    const unit = twoD ? 'plays' : 'serves'

    const bands = scenarioBands(scenario)
    const fkey = `${bands.join(',')}|${unit}`
    if (!filter || filterKey !== fkey) {
      const wasShown = filter ? new Set(filter.get()) : null
      filter = bandFilter({ bands, unit, onChange: () => render() })
      // Carry the reader's choice across a rebuild where it still applies.
      if (wasShown) {
        for (const b of bands) {
          if (!wasShown.has(b) && filter.get().length > 1) {
            filter.el.querySelector(`button[data-band="${b}"]`)?.click()
          }
        }
      }
      filterKey = fkey
      el.querySelector('[data-role="filter"]').innerHTML = ''
      el.querySelector('[data-role="filter"]').appendChild(filter.el)
    }
    // Rows the chart will draw, for sizing it. Panels come from the model, so
    // the group term stays; the per-player term follows the filter.
    const nShown = keepBands(zip(scenario.truth), filter.get()).length

    const key = `${state.view}|${twoD ? '2d' : '1d'}`
    if (!legend || legendKey !== key) {
      const wasOn = legend ? legend.get() : {}
      const armColor = tokens.get(armId).color
      // In the posterior view the player layers are boxes (1D) or rings (2D),
      // and the swatch has to say so.
      const playerMarker = (point) => (posterior ? (twoD ? 'area' : 'box') : point)
      const items = [
        { id: 'no_pool', label: `No pooling — their own ${unit} alone`,
          marker: playerMarker('open'), color: tokens.get('no_pool').color },
        { id: 'pooled', label: 'Partial pooling with this grouping',
          marker: playerMarker('dot'), color: armColor },
        // Only the scrambled covariate puts anyone in the wrong panel, so only
        // section 7 gets the entry. It toggles the open-dot distinction; the
        // players themselves stay on the pooled layer.
        ...(armId === 'wrong'
          ? [{ id: 'mismatch', label: 'Assigned to the wrong group', marker: 'open', color: armColor }]
          : []),
        twoD
          ? { id: 'targets', label: 'Estimated group mean, with 90% bars', marker: 'diamond', color: armColor }
          : { id: 'targets', label: 'Estimated group mean', marker: 'rule', color: armColor },
        { id: 'true_group_mean', label: 'True group mean', marker: 'rule-dashed',
          color: index.truth_color },
        { id: 'global_target', label: 'Estimated population mean μ — where no covariate would pull',
          marker: 'rule-dashed', color: tokens.get('none').color },
        { id: 'truth', label: 'Truth', marker: 'times', color: index.truth_color },
        // 2D only, off by default: the number beside a × and beside a point is
        // what ties them together in the plane. In 1D the row already does.
        ...(twoD
          ? [{ id: 'labels', label: 'Player numbers', marker: 'text', color: '#55606c', on: false }]
          : [])
      ].map((i) => ({ ...i, on: i.id in wasOn ? wasOn[i.id] : i.on !== false }))
      legend = layerLegend(items, () => render())
      legendKey = key
      el.querySelector('[data-role="legend"]').innerHTML = ''
      el.querySelector('[data-role="legend"]').appendChild(legend.el)
    }

    chart.innerHTML = ''
    chart.appendChild(twoD
      ? borrowingSplit2d({
        scenario, index, tokens, armId, scale, difficulty, view: state.view,
        layers: legend.get(),
        bands: filter.get(),
        width: chart.clientWidth || 760,
        // Panels sit side by side in the plane, so the height grows more gently
        // with the team than the row chart does.
        height: Math.max(420, 60 + 30 * cov.G + 12 * nShown)
      })
      : borrowingSplit({
        scenario, index, tokens, armId, scale, difficulty, view: state.view,
        layers: legend.get(),
        bands: filter.get(),
        width: chart.clientWidth || 760,
        // Not pinned, so it can exceed the viewport -- but only a little. At 22px
        // per row this ran past 1000px and took a screen and a half to scan; 15px
        // is enough for a box plus separation and keeps the whole comparison in
        // roughly one screen. Every player appears once across the panels, so row
        // height scales with the team, not the group count.
        height: Math.max(400, 60 + 30 * cov.G + 15 * nShown)
      }))

    // The caption is a legend in prose: the marks, named compactly and
    // together, and nothing else. Everything that explains rather than names --
    // which skill is on which axis, where each mark's value comes from, what a
    // shuffled label does to the green mark, why the rows are sorted as they
    // are, what the band buttons do, what the posterior view's box or ring
    // encloses, and how many players sit in the wrong panel -- is behind the
    // rail's Detail toggle. With Detail off this is one narrated sentence per
    // mark-list, which is what a live surface can carry.
    const marks = twoD
      ? `One panel per assigned group. Pink diamond: its estimated mean.
         Green crosshair: what its players average. Blue crosshair: the population
         mean. Grey: the pull.`
      : `One panel per assigned group. Solid line: the group's estimated mean.
         Green dashed: what its players average. Blue dashed: the population mean.
         Grey: the pull.`
    // Only the scrambled covariate puts anyone in the wrong panel, so only that
    // arm names the open dots. The count behind them stays behind the toggle:
    // the dots are already on the chart.
    const mismatchMark = !isCorrect && mismatched != null
      ? ` Open dots: players in the wrong panel.<span class="detail"> Their assigned
         panel is not their true group —
         <strong class="figures">${mismatched}</strong> of
         <strong class="figures">${overlap.n_total}</strong> players.</span>`
      : ''
    // Section 6's green mark needs its own line in the detail: there is no
    // "true mean of a shuffled label", only the average of whoever was given it.
    const shuffledNote = isCorrect
      ? ''
      : ` A shuffled label has no group of its own, so the green mark sits on
         what everybody averages.`
    const capDetail = twoD
      ? `<span class="detail"> ${skillLabel(1)} runs across and ${skillLabel(2)} up.
         The diamond carries 90% intervals in each skill and marks the place that
         group's players get pulled toward; the blue crosshair is the population
         mean μ a model with no covariate would have used, and the grey arrow runs
         from what a player's own plays say to where the model put them.${shuffledNote} Turn on Player numbers
         in the legend to see which × belongs to which point: the same number sits beside
         both. The buttons above hide or show players by how many plays they have; the
         panels and their diamonds stay put.${posterior ? " Each ring encloses 50% of that model's posterior." : ''}</span>`
      : `<span class="detail"> The solid line is the place that group's players get pulled
         toward; the blue dashed line is the population mean μ a model with no covariate
         would have used, and the grey segment runs from what a player's own serves say
         to where the model put them.${shuffledNote} Rows are sorted by their no-pooling
         estimate. The buttons above hide or show players by how many serves they have;
         the panels and their target lines stay put.${posterior ? " Box = the middle 50% of that model's posterior, whiskers = 90%." : ''}</span>`
    el.querySelector('[data-role="caption"]').innerHTML = `${marks}${mismatchMark}${capDetail}`

    const fmt = (x) => (scale === 'theta' ? x.toFixed(2) : x.toFixed(3))
    const globalText = twoD
      ? (globalTarget ? `(${fmt(globalTarget.x)}, ${fmt(globalTarget.y)})` : null)
      : (globalTarget != null ? fmt(globalTarget) : null)
    const where = twoD ? ' in the plane' : ''
    // Claim, then punchline. The spread between the two targets stays in the
    // open in both arms: it is the argument -- how far a grouping moved the
    // place a player gets pulled to -- the contrast between a real grouping and
    // a shuffled one, and the figure that changes when the reader picks another
    // population. Behind the Detail toggle go the coordinates of the
    // covariate-free mean (that point is already drawn, in blue dashes) and the
    // sentence that restates the claim rather than making it.
    el.querySelector('[data-role="takeaway"]').innerHTML = isCorrect
      ? `Each group now has a target of its own,
         <strong class="figures">${fmt(spread)}</strong> apart${where}${globalText != null
          ? ` — one either side of the mean a covariate-free model would use<span class="detail">
             (<span class="figures">${globalText}</span>)</span>`
          : ''}. Players in different groups are pulled in
         <strong>opposite directions</strong>.<span class="detail"> No player is dragged
         toward a value nobody has.</span>`
      : `The two targets barely come apart — only
         <strong class="figures">${fmt(spread)}</strong> between them${where}${globalText != null
          ? `, effectively on top of the mean a covariate-free model would use<span class="detail">
             (<span class="figures">${globalText}</span>)</span>`
          : ''}. <span class="detail">The model looked for a difference between these
         groups, found none, and quietly went back to treating everyone the same.
         </span><strong>A useless covariate is not harmful — it is just wasted.</strong>`
  }

  function mount () {
    renderWhenNear(el, render)
    return subscribe((reason) => {
      if (['scenario', 'scale', 'difficulty', 'view'].includes(reason)) render()
    })
  }

  return { el, mount }
}

// The number comes from SECTION_ORDER, keyed on the id the factory will build
// (`covariate-${armId}`), so these two renumber with everything else.
export const correctCovariateSplit = () =>
  covariateSplit({ armId: 'correct', number: numberOf('covariate-correct'), eyebrow: 'The right grouping' })

export const wrongCovariateSplit = () =>
  covariateSplit({ armId: 'wrong', number: numberOf('covariate-wrong'), eyebrow: 'The wrong grouping' })
