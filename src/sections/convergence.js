import { state } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { layerLegend } from '../lib/layers.js'
import { zip } from '../lib/transforms.js'
import { ellipseArea } from '../lib/ellipse.js'
import { loadConvergence } from '../data.js'
import { convergenceTracks, convergenceShrinkage } from '../charts/convergence.js'
import { convergenceTracks2d, convergenceArea2d } from '../charts/convergence2d.js'

/**
 * The same player, observed more.
 *
 * Section 2 shows that players WITH more data shrink less. That is a claim about
 * a population, and a reader can reasonably answer "those are different people,
 * maybe the well-observed ones are just more average". This section closes that
 * gap: one player's true ability is fixed, the rest of the team is held fixed,
 * and only the number of their own serves changes.
 *
 * Independent of the population switcher -- it is its own experiment on its own
 * team, so it does not react to the rail. The one rail control it does follow
 * is the dimension, and that remounts the section rather than re-rendering it,
 * so the payload held here is always the one for the current dimension.
 */
export function convergence () {
  const el = document.createElement('section')
  el.id = 'convergence'
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">3 — The same player, watched longer</p>
        <h2>Watch one player earn the model's trust</h2>
        <p>Everything so far compared <em>different</em> players who happened to
           have different amounts of data — which leaves the obvious objection
           that they are simply different people. So here one player's true
           ability is held fixed, the rest of the team is held fixed, and the
           only thing that changes is how many of their own serves the model has
           seen.</p>
      </header>
      <figure class="chart-panel">
        <div data-role="legend"></div>
        <div data-role="chart"><div class="loading">Loading the sweep…</div></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>

      <h3 class="subhead">The borrowing fades away</h3>
      <p>The same sweep reduced to one number: the distance between what the
         player's own serves say and where the model actually put them.</p>
      <figure class="chart-panel">
        <div data-role="pull"></div>
        <figcaption data-role="pull-caption">Each line is one player. Lower means the model is leaning on the team less.</figcaption>
      </figure>
      <p class="takeaway" data-role="pull-takeaway"></p>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  const pullBox = el.querySelector('[data-role="pull"]')
  // Reset on mount: data.js caches per dimension, and the section is remounted
  // when the dimension changes, so a fresh closure never holds a stale payload.
  let payload = null
  let payloadDimension = null
  let legend = null

  const is2dPayload = () => payload?.dimensions === 2

  function renderCharts () {
    if (!legend) {
      legend = layerLegend(is2dPayload()
        ? [
            { id: 'no_pool', label: 'What their own serves say', marker: 'open', color: '#e69f00' },
            { id: 'partial', label: 'Where the model put them', marker: 'dot', color: '#56b4e9' },
            { id: 'target', label: 'The team average', marker: 'dashed', color: '#94a3b8' },
            { id: 'truth', label: 'Their true ability', marker: 'times', color: '#009e73' }
          ]
        : [
            { id: 'no_pool', label: 'What their own serves say', marker: 'open', color: '#e69f00' },
            { id: 'partial', label: 'Where the model put them', marker: 'dot', color: '#56b4e9' },
            { id: 'interval', label: '90% intervals', marker: 'area', color: '#56b4e9' },
            { id: 'target', label: 'The team average', marker: 'dashed', color: '#94a3b8' },
            { id: 'truth', label: 'Their true ability', marker: 'line', color: '#009e73' }
          ], () => renderCharts())
      el.querySelector('[data-role="legend"]').appendChild(legend.el)
    }

    chart.innerHTML = ''
    pullBox.innerHTML = ''
    if (is2dPayload()) {
      chart.appendChild(convergenceTracks2d({
        payload,
        layers: legend.get(),
        width: chart.clientWidth || 760,
        height: Math.max(420, 150 * payload.focal.length)
      }))
      pullBox.appendChild(convergenceArea2d({
        payload,
        width: pullBox.clientWidth || 760
      }))
      return
    }

    chart.appendChild(convergenceTracks({
      payload,
      layers: legend.get(),
      width: chart.clientWidth || 760,
      height: Math.max(360, 150 * payload.focal.length)
    }))

    pullBox.appendChild(convergenceShrinkage({
      payload,
      width: pullBox.clientWidth || 760
    }))
  }

  function renderProse () {
    const first = payload.steps[0]
    const last = payload.steps[payload.steps.length - 1]
    const seriesOf = (f) => zip(f.steps)

    // Lead with whoever the model overruled hardest on their first serve. The
    // obvious selector -- distance from the population mean -- turns out to be
    // the wrong one: all three focal players sit within half an SD of it, and
    // what actually drives the pull is how far their own noisy estimate
    // wandered, not where they truly are.
    const ranked = [...payload.focal].sort((a, b) => {
      const pa = seriesOf(a).find((s) => s.n_keep === first)?.shrinkage ?? 0
      const pb = seriesOf(b).find((s) => s.n_keep === first)?.shrinkage ?? 0
      return Math.abs(pb) - Math.abs(pa)
    })
    const lead = ranked[0]
    const steps = seriesOf(lead)
    const start = steps.find((s) => s.n_keep === first)
    const end = steps.find((s) => s.n_keep === last)
    if (!start || !end) return

    el.querySelector('[data-role="caption"]').textContent =
      `${payload.focal.length} players, each swept from ${first} to ${last} serves ` +
      `while the other ${payload.n_players - payload.focal.length} players keep all of theirs. ` +
      `The datasets are nested, so every step adds serves to the same player.`

    el.querySelector('[data-role="takeaway"]').innerHTML = `
      On one serve, player <strong class="figures">${lead.focal_id}</strong>'s own data
      put them at <strong class="figures">${start.no_pool_mean.toFixed(2)}</strong> —
      with an uncertainty of <strong class="figures">${start.no_pool_sd.toFixed(2)}</strong>,
      which is to say it knew nothing. The model overruled it almost entirely,
      moving the estimate <strong class="figures">${Math.abs(start.shrinkage).toFixed(2)}</strong>
      toward the team. By <strong class="figures">${last}</strong> serves that same
      player's own data is ${(start.no_pool_sd / end.no_pool_sd).toFixed(1)}× sharper
      and the model moves them just
      <strong class="figures">${Math.abs(end.shrinkage).toFixed(2)}</strong>.
      <strong>Same person, same true ability. Only the evidence changed.</strong>`

    // Own-data uncertainty, unlike the pull, really is monotone -- it is the
    // mechanism rather than a noisy consequence of it.
    const narrowing = payload.focal.map((f) => {
      const s = seriesOf(f)
      const a = s.find((r) => r.n_keep === first)
      const b = s.find((r) => r.n_keep === last)
      return a && b ? a.no_pool_sd / b.no_pool_sd : 1
    })
    const pulls = payload.focal.map((f) => {
      const s = seriesOf(f)
      const a = s.find((r) => r.n_keep === first)
      const b = s.find((r) => r.n_keep === last)
      return a && b ? Math.abs(a.shrinkage) / Math.max(Math.abs(b.shrinkage), 1e-6) : 1
    })
    const minNarrow = Math.min(...narrowing)
    const minPull = Math.min(...pulls)

    el.querySelector('[data-role="pull-takeaway"]').innerHTML = `
      Across all ${payload.focal.length} players the pull collapses by at least
      <strong class="figures">${minPull.toFixed(0)}×</strong> between
      ${first} and ${last} serves, while their own-data uncertainty narrows by at
      least <strong class="figures">${minNarrow.toFixed(1)}×</strong>.
      <strong>Nothing told the model to ease off</strong> — a wide posterior gets
      overruled, a narrow one does not, and watching someone longer is what
      narrows it.
      <span class="aside">The path between is deliberately not smoothed. The pull
      depends on where a player's own noisy estimate happens to land at each step,
      so it wanders on the way down rather than falling cleanly — the trend is
      real, any single step is not.</span>`
  }

  /**
   * Two skills. Each focal player carries a 1D step series per skill plus the
   * joint posterior covariance, so the story is told twice over -- once per
   * skill -- and then once more as an area: how much of the plane the player's
   * own-data posterior still covers.
   */
  function renderProse2d () {
    const first = payload.steps[0]
    const last = payload.steps[payload.steps.length - 1]
    const labels = payload.skill_labels ?? ['Skill 1', 'Skill 2']
    const skillSteps = (f, k) => zip(f.skills[k].steps)
    const at = (rows, n) => rows.find((s) => s.n_keep === n)
    const areaAt = (f, n) => {
      const j = at(zip(f.joint), n)
      return j ? ellipseArea({ var1: j.no_pool_var1, var2: j.no_pool_var2, cov12: j.no_pool_cov12 }, 0.5) : null
    }

    // Lead with the player the model overruled hardest in skill 1 on their
    // first serve, for the reason given in renderProse.
    const ranked = [...payload.focal].sort((a, b) => {
      const pa = at(skillSteps(a, 0), first)?.shrinkage ?? 0
      const pb = at(skillSteps(b, 0), first)?.shrinkage ?? 0
      return Math.abs(pb) - Math.abs(pa)
    })
    const lead = ranked[0]
    const s1 = { start: at(skillSteps(lead, 0), first), end: at(skillSteps(lead, 0), last) }
    const s2 = { start: at(skillSteps(lead, 1), first), end: at(skillSteps(lead, 1), last) }
    if (!s1.start || !s1.end || !s2.start || !s2.end) return
    const leadArea = { start: areaAt(lead, first), end: areaAt(lead, last) }

    el.querySelector('[data-role="caption"]').textContent =
      `${payload.focal.length} players, each swept from ${first} to ${last} plays in both skills ` +
      `while the other ${payload.n_players - payload.focal.length} players keep all of theirs. ` +
      `The datasets are nested, so every step adds plays to the same player.`

    el.querySelector('[data-role="takeaway"]').innerHTML = `
      On one play, player <strong class="figures">${lead.focal_id}</strong>'s own data
      put their ${labels[0]} at <strong class="figures">${s1.start.no_pool_mean.toFixed(2)}</strong>
      and their ${labels[1]} at <strong class="figures">${s2.start.no_pool_mean.toFixed(2)}</strong>,
      with uncertainties of <strong class="figures">${s1.start.no_pool_sd.toFixed(2)}</strong> and
      <strong class="figures">${s2.start.no_pool_sd.toFixed(2)}</strong> —
      which is to say it knew nothing. The model overruled it almost entirely, moving the
      estimate <strong class="figures">${Math.abs(s1.start.shrinkage).toFixed(2)}</strong> in
      ${labels[0]} and <strong class="figures">${Math.abs(s2.start.shrinkage).toFixed(2)}</strong>
      in ${labels[1]} toward the team. By <strong class="figures">${last}</strong> plays the
      model moves them just <strong class="figures">${Math.abs(s1.end.shrinkage).toFixed(2)}</strong>
      and <strong class="figures">${Math.abs(s2.end.shrinkage).toFixed(2)}</strong>${
        leadArea.start && leadArea.end
          ? `, and the 50% region of their own-data posterior has shrunk from
             <strong class="figures">${leadArea.start.toFixed(2)}</strong> to
             <strong class="figures">${leadArea.end.toFixed(3)}</strong> square units of the plane —
             <strong class="figures">${(leadArea.start / leadArea.end).toFixed(0)}×</strong> smaller`
          : ''}.
      <strong>Same person, same true abilities. Only the evidence changed.</strong>`

    el.querySelector('[data-role="pull-caption"]').textContent =
      'Each line is one player: how much of the plane their own-data posterior still covers. ' +
      'Lower means their own plays pin them down more tightly.'

    // The pull per skill, and the area, both from first to last step.
    const collapse = (k) => Math.min(...payload.focal.map((f) => {
      const a = at(skillSteps(f, k), first)
      const b = at(skillSteps(f, k), last)
      return a && b ? Math.abs(a.shrinkage) / Math.max(Math.abs(b.shrinkage), 1e-6) : 1
    }))
    const areaCollapse = Math.min(...payload.focal.map((f) => {
      const a = areaAt(f, first)
      const b = areaAt(f, last)
      return a && b ? a / b : 1
    }))

    el.querySelector('[data-role="pull-takeaway"]').innerHTML = `
      Across all ${payload.focal.length} players the pull collapses by at least
      <strong class="figures">${collapse(0).toFixed(0)}×</strong> in ${labels[0]} and
      <strong class="figures">${collapse(1).toFixed(0)}×</strong> in ${labels[1]} between
      ${first} and ${last} plays, while the 50% region of their own-data posterior
      shrinks to at least <strong class="figures">1/${areaCollapse.toFixed(0)}</strong>
      of its starting area.
      <strong>Nothing told the model to ease off</strong> — a wide posterior gets
      overruled, a narrow one does not, and watching someone longer is what
      narrows it.
      <span class="aside">The path between is deliberately not smoothed. The pull
      depends on where a player's own noisy estimate happens to land at each step,
      so it wanders on the way down rather than falling cleanly — the trend is
      real, any single step is not.</span>`
  }

  async function render () {
    const dimension = state.dimension
    if (payload && payloadDimension === dimension) { renderCharts(); return }
    payload = await loadConvergence(dimension)
    payloadDimension = dimension
    if (!payload) {
      chart.innerHTML = '<div class="note">This sweep has not been generated yet. ' +
        'Run <code>Rscript scripts/build_site_data.R</code>.</div>'
      return
    }
    renderCharts()
    if (is2dPayload()) renderProse2d()
    else renderProse()
  }

  function mount () {
    renderWhenNear(el, render)
    return () => {}
  }

  return { el, mount }
}
