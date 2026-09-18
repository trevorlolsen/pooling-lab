import { state } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { numberOf } from '../lib/sectionOrder.js'
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
        <p class="eyebrow">${numberOf('convergence')} — The same player, watched longer</p>
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
        // Swatches match what is drawn: in 2D the no-pooling posterior is an
        // open ring, the partial-pooling one a filled ellipse, and the pooling
        // target a filled grey dot per cell. In 1D the target is a dashed line
        // and the interval layer draws BOTH models' 90% bands, each in its own
        // colour, so the label says so.
        ? [
            { id: 'no_pool', label: 'No pooling — their own plays alone', marker: 'open', color: '#e69f00' },
            { id: 'partial', label: 'Partial pooling — where the model put them', marker: 'area', color: '#56b4e9' },
            { id: 'target', label: 'Estimated population mean μ — what the model pulls toward', marker: 'dot', color: '#94a3b8' },
            { id: 'truth', label: 'Their true ability', marker: 'times', color: '#009e73' }
          ]
        : [
            { id: 'no_pool', label: 'No pooling — their own serves alone', marker: 'open', color: '#e69f00' },
            { id: 'partial', label: 'Partial pooling — where the model put them', marker: 'dot', color: '#56b4e9' },
            { id: 'interval', label: '90% intervals (both models, in their colours)', marker: 'area', color: '#56b4e9' },
            { id: 'target', label: 'Estimated population mean μ — what the model pulls toward', marker: 'dashed', color: '#94a3b8' },
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

    // Visible: one sentence naming the panels and the axes, one naming the grey
    // line. The log scaling, the nesting, the held-fixed team and the control
    // caveat are all method, not marks, so they sit behind the Detail toggle
    // with the measured numbers.
    el.querySelector('[data-role="caption"]').innerHTML =
      'One panel per player: across the bottom, how many of that player\'s own serves the model ' +
      'has seen; up the side, latent ability. The dashed grey line is the estimated population mean μ. ' +
      '<span class="detail">The bottom axis is log-scaled, because nearly all of the movement ' +
      'happens in the first handful of serves. </span>' +
      `<span class="detail">${payload.focal.length} players, each swept from ${first} to ${last} serves, ` +
      `while the other ${payload.n_players - payload.focal.length} keep all of theirs. </span>` +
      '<span class="detail">The rest of the team is held fixed the whole way across, and the ' +
      'datasets are nested, so every step adds serves to the same player. μ shifts a little as ' +
      'this player\'s data changes the team fit. Always on the ability scale; the Scale and Show ' +
      'controls do not apply here.</span>'

    el.querySelector('[data-role="takeaway"]').innerHTML = `
      Follow player <strong class="figures">${lead.focal_id}</strong>, the one the model
      overruled hardest: at the left edge it all but ignores their own data, and at the
      right it barely moves them.
      <span class="detail">At the far left a single serve buys an orange band wide enough to
      fill much of the panel, and the model sets them down beside the dashed team mean instead:
      their own serves put them at ${start.no_pool_mean.toFixed(2)},
      with an uncertainty of ${start.no_pool_sd.toFixed(2)}, and the model moved the
      estimate ${Math.abs(start.shrinkage).toFixed(2)} toward the team. </span>
      <span class="detail">Read rightward and the orange track tightens into a claim worth
      listening to while the blue one stops leaving it: by ${last} serves that same player's own data is
      ${(start.no_pool_sd / end.no_pool_sd).toFixed(1)}× sharper and the model moves
      them just ${Math.abs(end.shrinkage).toFixed(2)}. </span>
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

    // The aside stays on screen on purpose. The convention is that the prose
    // admits it when a pattern is noisy, and the monotone sentence above it is
    // the thing that admission contrasts against, so both survive the Detail
    // pass even though they cost this takeaway its character budget.
    el.querySelector('[data-role="pull-takeaway"]').innerHTML = `
      Every line starts high and ends on the floor: by the right-hand edge the model
      barely moves anyone off their own data. Their own-data uncertainty, unlike the
      pull, narrows monotonically.
      <span class="detail">Across all ${payload.focal.length} players the pull collapses
      by at least ${minPull.toFixed(0)}× between ${first} and ${last} serves, while their
      own-data uncertainty narrows by at least ${minNarrow.toFixed(1)}×. </span>
      <strong>Nothing told the model to ease off</strong> — a wide posterior gets
      overruled, a narrow one does not.<span class="detail"> Watching someone longer is
      what narrows it.</span>
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

    // Same rule as the 1D caption: the grid and the marks stay, the method —
    // what the axes are, why the cells are comparable, the nesting, the held
    // -fixed team, the control caveat — goes behind the Detail toggle.
    el.querySelector('[data-role="caption"]').innerHTML =
      'A row per player, a column per observation count. Each cell is the skill plane; ' +
      'each ring is the 50% region of a model\'s posterior, and the grey dot is the estimated ' +
      'population mean μ. ' +
      '<span class="detail">One skill on each axis, and reading left to right walks one player ' +
      'through being watched longer. The axes are the same in every cell, so a ring that looks ' +
      'smaller is smaller. </span>' +
      `<span class="detail">${payload.focal.length} players, each swept from ${first} to ${last} plays ` +
      `in both skills, while the other ${payload.n_players - payload.focal.length} keep all of theirs. </span>` +
      '<span class="detail">The rest of the team is held fixed the whole way across, and the ' +
      'datasets are nested, so every step adds plays to the same player. μ shifts a little as ' +
      'this player\'s data changes the team fit. Always on the ability scale; the Scale and Show ' +
      'controls do not apply here.</span>'

    const areaClause = leadArea.start && leadArea.end
      ? `, and the 50% region of their own-data posterior has shrunk from
         ${leadArea.start.toFixed(2)} to ${leadArea.end.toFixed(3)} square units of the
         plane, ${(leadArea.start / leadArea.end).toFixed(0)}× smaller`
      : ''

    el.querySelector('[data-role="takeaway"]').innerHTML = `
      Follow player <strong class="figures">${lead.focal_id}</strong>, the one the model
      overruled hardest: in the leftmost cell it all but ignores their own data; by the
      rightmost it barely moves them.
      <span class="detail">The ranking is by ${labels[0]} on their opening play. At the left
      their own-data ring fills very nearly the whole cell — one play says nothing about either
      skill — so the model parks them next to the grey
      population dot. Their own data put their ${labels[0]} at
      ${s1.start.no_pool_mean.toFixed(2)} and their ${labels[1]} at
      ${s2.start.no_pool_mean.toFixed(2)}, with uncertainties of
      ${s1.start.no_pool_sd.toFixed(2)} and ${s2.start.no_pool_sd.toFixed(2)}, and the model
      moved the estimate ${Math.abs(s1.start.shrinkage).toFixed(2)} in ${labels[0]} and
      ${Math.abs(s2.start.shrinkage).toFixed(2)} in ${labels[1]} toward the team. </span>
      <span class="detail">Walk the row rightward and that ring closes onto the truth while the
      blue ellipse stops leaning toward the dot — the borrowed information being handed back, a
      few plays at a time. By ${last} plays the model moves them just
      ${Math.abs(s1.end.shrinkage).toFixed(2)} and
      ${Math.abs(s2.end.shrinkage).toFixed(2)}${areaClause}. </span>
      <strong>Same person, same true abilities. Only the evidence changed.</strong>`

    // innerHTML, not textContent: this caption carries a `.detail` span, and a
    // textContent assignment would put the tag on screen as literal characters.
    el.querySelector('[data-role="pull-caption"]').innerHTML =
      'Two lines per player: orange dashed is how much of the plane their own-data posterior still covers, blue is partial pooling\'s. ' +
      '<span class="detail">The gap between them is the information the model borrowed, and it closes as the player is watched longer.</span>'

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

    // As in 1D, the aside is exempt from the Detail pass: the noise admission
    // stays on screen, and the clause about the own-data patch shrinking the
    // whole way is what it contrasts against.
    el.querySelector('[data-role="pull-takeaway"]').innerHTML = `
      The orange and blue lines start far apart and end on top of each other, in both
      ${labels[0]} and ${labels[1]}: the pull collapses.
      <span class="detail">The patch of the plane their own data still leaves open shrinks
      the whole way across. Across all ${payload.focal.length} players the pull collapses by
      at least ${collapse(0).toFixed(0)}× in ${labels[0]} and ${collapse(1).toFixed(0)}× in
      ${labels[1]} between ${first} and ${last} plays, while the 50% region of their
      own-data posterior shrinks to at least 1/${areaCollapse.toFixed(0)} of its starting
      area. </span>
      <strong>Nothing told the model to ease off</strong> — a wide posterior gets
      overruled, a narrow one does not.<span class="detail"> Watching someone longer is
      what narrows it.</span>
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
