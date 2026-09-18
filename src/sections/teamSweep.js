import { renderWhenNear } from '../lib/scroll.js'
import { numberOf } from '../lib/sectionOrder.js'
import { layerLegend } from '../lib/layers.js'
import { zip } from '../lib/transforms.js'
import { state, subscribe } from '../state.js'
import { loadTeamSweep, loadTeamCoverage } from '../data.js'
import { sweepWidths, sweepRidges, orderedTeams, coverageCurves } from '../charts/teamSweep.js'

/**
 * The team you have, and the population you don't.
 *
 * Section 4 showed one player earning the model's trust. This section asks
 * what watching the whole team longer buys: eight players observed 5 ... 1000
 * times each, refitted at every step. The team's own average becomes known
 * almost exactly. The population mean μ does not -- its interval plateaus at
 * about τ/√8 -- and the prediction for a player nobody has seen never narrows
 * past τ. A team of eight is eight draws from a population, and no amount of
 * data on those eight makes them the population.
 *
 * Its own experiment on its own team, so it ignores the population switcher;
 * it follows the display scale so the axes agree with the rest of the page.
 * Everything here is read from a precomputed frame at d* = 0.
 */
export function teamSweep () {
  const el = document.createElement('section')
  el.id = 'team-sweep'
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('team-sweep')} — The team you have, and the population you don't</p>
        <h2>Watch the whole team longer, and see what stops improving</h2>
        <p>One player, watched longer, converges on their own true ability. Now
           watch all eight, from a handful of serves each to a thousand, and
           track three things the model believes: the average of <em>these</em>
           eight players, the mean of the population they were drawn from, and
           where the next player it has never seen would land. Only the first
           of these keeps sharpening.</p>
      </header>

      <figure class="chart-panel">
        <div data-role="legend-widths"></div>
        <div data-role="chart"><div class="loading">Loading the sweep…</div></div>
        <figcaption data-role="caption-widths"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway-widths"></p>

      <h3 class="subhead">Where each belief actually sits</h3>
      <p>The same three posteriors drawn in full, one row per step. Each curve
         is scaled to its own peak, so read the position and the width, not the
         height.</p>
      <figure class="chart-panel">
        <div data-role="legend-ridges"></div>
        <div data-role="ridges"><div class="loading">Loading the sweep…</div></div>
        <figcaption data-role="caption-ridges"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway-ridges"></p>

      <h3 class="subhead">A hundred teams, not one</h3>
      <p>One team is one draw. The same sweep on a hundred teams of eight, every
         team a thin bar spanning its 90% interval for its own average, ranked
         within each step.</p>
      <figure class="chart-panel">
        <div data-role="legend-teams"></div>
        <div data-role="teams"><div class="loading">Loading the replicates…</div></div>
        <figcaption data-role="caption-teams"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway-teams"></p>

      <h3 class="subhead">Coverage, counted</h3>
      <p>The share of those hundred teams whose interval contains the true
         population mean, for each of the three beliefs, as the data grow.</p>
      <figure class="chart-panel">
        <div data-role="legend-coverage"></div>
        <div data-role="coverage"><div class="loading">Loading the replicates…</div></div>
        <figcaption data-role="caption-coverage"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway-coverage"></p>
    </div>`

  const box = {
    widths: el.querySelector('[data-role="chart"]'),
    ridges: el.querySelector('[data-role="ridges"]'),
    teams: el.querySelector('[data-role="teams"]'),
    coverage: el.querySelector('[data-role="coverage"]')
  }
  let sweep = null
  let coverage = null
  let ready = false
  const legends = {}

  function legend (id, items) {
    if (!legends[id]) {
      legends[id] = layerLegend(items, () => renderCharts())
      el.querySelector(`[data-role="legend-${id}"]`).appendChild(legends[id].el)
    }
    return legends[id].get()
  }

  function renderCharts () {
    const scale = state.scale
    const widthOf = (node) => node.clientWidth || 760

    // The unseen player is pink, not the site's truth green: it is a
    // prediction. The replicate means are dotted in each series' own colour,
    // so their swatch is a neutral grey and the label says so.
    const widthsLayers = legend('widths', [
      { id: 'team', label: "This team's sample average", marker: 'line', color: '#e69f00' },
      { id: 'mu', label: 'Estimated population mean μ', marker: 'line', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'line', color: '#cc79a7' },
      { id: 'floor', label: 'τ/√8 floor (ability scale only)', marker: 'dashed', color: '#94a3b8' },
      { id: 'replicates', label: 'Mean across 100 teams (dotted, in each colour; ability scale only)', marker: 'dashed', color: '#94a3b8' }
    ])
    box.widths.innerHTML = ''
    box.widths.appendChild(sweepWidths({
      sweep, coverage, scale, layers: widthsLayers, width: widthOf(box.widths)
    }))

    const ridgeLayers = legend('ridges', [
      { id: 'team', label: "This team's sample average", marker: 'area', color: '#e69f00' },
      { id: 'mu', label: 'Estimated population mean μ', marker: 'area', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'area', color: '#cc79a7' },
      { id: 'naive', label: 'No-pooling average of the eight (the plain sample mean, no model)', marker: 'dashed', color: '#6b7280', on: false },
      { id: 'truth', label: 'True population mean μ', marker: 'rule-dashed', color: '#111' },
      { id: 'team_truth', label: "This team's true average", marker: 'rule', color: '#e69f00' }
    ])
    box.ridges.innerHTML = ''
    box.ridges.appendChild(sweepRidges({
      sweep, scale, layers: ridgeLayers, width: widthOf(box.ridges)
    }))

    const teamLayers = legend('teams', [
      { id: 'team', label: 'Sample-average interval, contains μ', marker: 'line', color: '#e69f00' },
      { id: 'miss', label: 'Sample-average interval, misses μ', marker: 'line', color: '#d55e00' },
      { id: 'mu', label: 'The same team’s interval for μ', marker: 'line', color: '#56b4e9' },
      { id: 'truth', label: 'True population mean μ', marker: 'rule-dashed', color: '#111' },
      { id: 'walk', label: 'The team from the charts above', marker: 'open', color: '#111' }
    ])
    box.teams.innerHTML = ''
    box.teams.appendChild(orderedTeams({
      coverage, walkThroughSeed: coverage.walk_through_seed ?? sweep.seed, scale,
      layers: teamLayers, width: widthOf(box.teams)
    }))

    const coverageLayers = legend('coverage', [
      { id: 'team', label: "The team's sample average", marker: 'line', color: '#e69f00' },
      { id: 'mu', label: 'Estimated population mean μ', marker: 'line', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'line', color: '#cc79a7' },
      { id: 'band', label: '95% uncertainty band (Wilson, in each colour)', marker: 'area', color: '#94a3b8' },
      { id: 'nominal', label: 'Nominal 90%', marker: 'dashed', color: '#94a3b8' }
    ])
    box.coverage.innerHTML = ''
    box.coverage.appendChild(coverageCurves({
      coverage, layers: coverageLayers, width: widthOf(box.coverage)
    }))
  }

  const fig = (x, digits = 2) => `<strong class="figures">${Number(x).toFixed(digits)}</strong>`
  const pct = (x) => `<strong class="figures">${Math.round(100 * x)}%</strong>`

  function renderProse () {
    const detail = zip(sweep.steps_detail)
    const summary = zip(coverage.summary)
    const first = sweep.steps[0]
    const last = sweep.steps[sweep.steps.length - 1]
    const d0 = detail.find((r) => r.n_keep === first)
    const dN = detail.find((r) => r.n_keep === last)
    const s0 = summary.find((r) => r.n_keep === first)
    const sN = summary.find((r) => r.n_keep === last)
    if (!d0 || !dN || !s0 || !sN) return

    const J = sweep.n_players
    const tau = sweep.truth.tau
    const floor = 2 * 1.645 * sweep.truth.standard_error
    const teamTruth = dN.team_true_mean ?? sweep.truth.team_mean
    const seedNote = sweep.seed_selection?.rule ? ` ${sweep.seed_selection.rule}` : ''
    // The true μ as the text quotes it -- read from the payload, not typed in.
    const muTruth = Number(sweep.truth.mu).toFixed(2)

    // (a) widths. Visible: what the lines are, and which way is better. The
    // method note, the dotted replicate means, the ability-scale caveat and the
    // fixed-d* caveat all sit behind the Detail toggle.
    el.querySelector('[data-role="caption-widths"]').innerHTML =
      `Each line is how wide one belief stays — the width of its 90% interval — as every player ` +
      `on the team is watched longer, from a handful of serves each to a thousand. Lower is sharper.` +
      `<span class="detail"> A different team of ${J} from the 40-player roster the rest of the ` +
      `story uses, observed ${first} to ${last} times each, nested, refitted at every step. ` +
      `The dotted lines behind them are the same widths averaged over the replicate teams, in ` +
      `each colour: this team is one draw, and they show it is an ordinary one. Those and the ` +
      `τ/√${J} floor are drawn on the ability scale only, and the figures quoted below are on ` +
      `that scale too. This section is its own experiment, fixed at d* = 0; the slider does not ` +
      `apply here.</span>`
    el.querySelector('[data-role="takeaway-widths"]').innerHTML = `
      The team's own average keeps tightening.<span class="detail"> Its interval
      is ${fig(d0.team_width)} wide at ${first} serves per player and
      ${fig(dN.team_width)} at ${last}.</span> The population mean does not — its
      interval flattens against a floor that eight players can never get
      under<span class="detail"> — still ${fig(dN.mu_width)} wide at ${last}
      serves, against ${fig(floor)} = 2 × 1.645 × τ/√${J}, with
      τ = ${fig(tau, 1)}</span>.<span class="detail"> A player nobody has seen
      stays about as spread out as the population itself: that band is
      ${fig(2 * 1.645 * tau)} wide and the prediction holds at
      ${fig(dN.new_width)}.</span>
      <strong>More data on the same people sharpens the people, not the
      population.</strong>`

    // (b) ridges. The seed rule is a justification of the team choice, so it
    // goes behind the toggle -- which means this caption is innerHTML now, not
    // textContent, or the span would print as literal characters.
    el.querySelector('[data-role="caption-ridges"]').innerHTML =
      `Posterior densities at each step, each scaled to its own peak. ` +
      `The dashed rule is the true population mean; the orange rule is this team's true average.` +
      (seedNote ? `<span class="detail">${seedNote}</span>` : '')
    const inside = dN.team_covers_mu
    const muInside = dN.mu_covers_mu
    el.querySelector('[data-role="takeaway-ridges"]').innerHTML = `
      Row by row the orange curve narrows onto this team's own true average, not
      μ.<span class="detail"> That average is ${fig(teamTruth, 3)}; by ${last}
      serves the sample average is ${fig(dN.team_mean, 3)}, with a 90% interval
      from ${fig(dN.team_low, 3)} to ${fig(dN.team_high, 3)}. The true μ is
      ${muTruth}.</span>
      ${inside
        ? `At the last step it still contains μ — one draw of eight can land either way.`
        : `At the last step it no longer contains μ, and it is right not to.`}
      <span class="detail">The blue curve for μ itself ${muInside ? 'still covers μ' : 'has slipped off μ too'},
      because it is wider on purpose: it carries the uncertainty of having drawn
      only eight people.</span> <strong>The team's average is not the
      population's.</strong>`

    // (c) ordered teams. The caption names the bars and nothing else; the
    // ranking rule, the seed and how to read the facets sit behind the toggle.
    // The takeaway carries a coverage verdict, so it keeps its figures.
    el.querySelector('[data-role="caption-teams"]').innerHTML =
      `${coverage.n_teams} teams<span class="detail"> of ${coverage.n_players}</span>, one facet per step, ` +
      `each a thin bar spanning its 90% interval. Orange contains μ, red misses it, blue is that ` +
      `team's interval for μ; the dashed rule is μ, the ringed bar the team above` +
      `<span class="detail"> (seed ${coverage.walk_through_seed ?? sweep.seed})</span>.` +
      `<span class="detail"> Bars are stacked in order of where each team's average sits. Read ` +
      `down a facet for the spread of teams, and across facets for what more data does to that ` +
      `spread.</span>`
    el.querySelector('[data-role="takeaway-teams"]').innerHTML = `
      A precisely known team average is allowed to miss μ. The sample-average
      interval contains μ for ${pct(s0.team_covers_mu)} of the
      ${coverage.n_teams} teams at ${first} serves each, but only
      ${pct(sN.team_covers_mu)} at ${last} — the bars have shrunk onto each
      team's own true average, which is almost never μ. The interval for μ
      itself holds: ${pct(s0.mu_covers_mu)} and ${pct(sN.mu_covers_mu)}.
      <strong>One falls toward zero, the other holds near its nominal
      90%</strong> — the first is answering a different question.`

    // (d) coverage curves. The caption names the three marks; what the dashed
    // line means to read and what the bands are go behind the toggle. The
    // takeaway is the verdict of the whole section, so it keeps its figures.
    el.querySelector('[data-role="caption-coverage"]').innerHTML =
      `One curve per belief: the share of the ${coverage.n_teams} teams whose 90% interval ` +
      `contains the true μ, as the data grow. The dashed line is the 90% they promise; ` +
      `the shading is how uncertain each share is.` +
      `<span class="detail"> Counted over only that many teams; the bands are 95% Wilson, in each ` +
      `curve's colour. A curve sitting on the dashed line is keeping the promise, and a curve ` +
      `falling away from it is not.</span>`
    el.querySelector('[data-role="takeaway-coverage"]').innerHTML = `
      The sample-average interval starts near the 90% it promises and then
      slides away, from ${pct(s0.team_covers_mu)} of teams at ${first} serves to
      ${pct(sN.team_covers_mu)} at ${last}. μ's own interval holds near nominal
      the whole way<span class="detail"> — ${pct(s0.mu_covers_mu)} at
      ${first} serves and ${pct(sN.mu_covers_mu)} at ${last}</span>. And the
      unseen-player interval never drops below ${pct(s0.new_covers_mu)}: it is
      so wide that it can hardly fail to contain μ.
      <strong>Knowing your eight players perfectly does not tell you the next
      eight.</strong><span class="detail"> The population level is what carries
      over, and its uncertainty is set by how many people you have seen, not by
      how long you watched them.</span>`
  }

  async function render () {
    if (ready) { renderCharts(); return }
    ;[sweep, coverage] = await Promise.all([loadTeamSweep(), loadTeamCoverage()])
    if (!sweep || !coverage) {
      box.widths.innerHTML = '<div class="note">This sweep has not been generated yet. ' +
        'Run <code>Rscript scripts/build_site_data.R</code>.</div>'
      for (const id of ['ridges', 'teams', 'coverage']) {
        box[id].closest('figure').hidden = true
      }
      return
    }
    ready = true
    renderCharts()
    renderProse()
  }

  function mount () {
    renderWhenNear(el, render)
    return subscribe((reason) => {
      if (ready && ['scale', 'difficulty'].includes(reason)) renderCharts()
    })
  }

  return { el, mount }
}
