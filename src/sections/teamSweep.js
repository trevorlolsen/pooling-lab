import { renderWhenNear } from '../lib/scroll.js'
import { layerLegend } from '../lib/layers.js'
import { zip } from '../lib/transforms.js'
import { state, subscribe } from '../state.js'
import { loadTeamSweep, loadTeamCoverage } from '../data.js'
import { sweepWidths, sweepRidges, orderedTeams, coverageCurves } from '../charts/teamSweep.js'

/**
 * The team you have, and the population you don't.
 *
 * Section 3 showed one player earning the model's trust. This section asks
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
        <p class="eyebrow">4 — The team you have, and the population you don't</p>
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

    const widthsLayers = legend('widths', [
      { id: 'team', label: "This team's sample average", marker: 'line', color: '#e69f00' },
      { id: 'mu', label: 'Population mean μ', marker: 'line', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'line', color: '#009e73' },
      { id: 'floor', label: 'τ/√8 floor (θ scale)', marker: 'dashed', color: '#94a3b8' },
      { id: 'replicates', label: 'Mean across 100 teams (θ scale)', marker: 'dashed', color: '#c3c9d0' }
    ])
    box.widths.innerHTML = ''
    box.widths.appendChild(sweepWidths({
      sweep, coverage, scale, layers: widthsLayers, width: widthOf(box.widths)
    }))

    const ridgeLayers = legend('ridges', [
      { id: 'team', label: "This team's sample average", marker: 'area', color: '#e69f00' },
      { id: 'mu', label: 'Population mean μ', marker: 'area', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'area', color: '#009e73' },
      { id: 'naive', label: 'No-pooling average of the eight', marker: 'dashed', color: '#6b7280', on: false },
      { id: 'truth', label: 'True μ', marker: 'rule-dashed', color: '#111' },
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
      { id: 'truth', label: 'True μ', marker: 'rule', color: '#111' }
    ])
    box.teams.innerHTML = ''
    box.teams.appendChild(orderedTeams({
      coverage, walkThroughSeed: coverage.walk_through_seed ?? sweep.seed, scale,
      layers: teamLayers, width: widthOf(box.teams)
    }))

    const coverageLayers = legend('coverage', [
      { id: 'team', label: "The team's sample average", marker: 'line', color: '#e69f00' },
      { id: 'mu', label: 'Population mean μ', marker: 'line', color: '#56b4e9' },
      { id: 'new', label: 'A player nobody has seen', marker: 'line', color: '#009e73' },
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

    // (a) widths
    el.querySelector('[data-role="caption-widths"]').textContent =
      `${J} players observed ${first} to ${last} times each, nested, refitted at every step. ` +
      `Widths of the 90% posterior intervals; numbers in the text are on the ability scale.`
    el.querySelector('[data-role="takeaway-widths"]').innerHTML = `
      The team's own average is the easy part: its 90% interval is
      ${fig(d0.team_width)} wide at ${first} serves per player and
      ${fig(dN.team_width)} at ${last} — it collapses. The population mean does
      not follow. Its interval is still ${fig(dN.mu_width)} wide at ${last}
      serves, against a floor of ${fig(floor)} that eight players can never get
      under (τ/√${J}, with τ = ${fig(tau, 1)}). And a player nobody has seen
      stays ${fig(dN.new_width)} wide — a population with spread τ puts 90% of
      its players in a band ${fig(2 * 1.645 * tau)} wide, and no amount of
      watching these eight can narrow that.
      <strong>More data on the same people sharpens the people, not the
      population.</strong>`

    // (b) ridges
    el.querySelector('[data-role="caption-ridges"]').textContent =
      `Posterior densities at each step, each scaled to its own peak. ` +
      `The dashed rule is the true population mean; the orange rule is this team's true average.` +
      seedNote
    const inside = dN.team_covers_mu
    const muInside = dN.mu_covers_mu
    el.querySelector('[data-role="takeaway-ridges"]').innerHTML = `
      Watch the orange curve. It slides onto this team's true average of
      ${fig(teamTruth, 3)} and away from μ. By ${last} serves the sample
      average is ${fig(dN.team_mean, 3)} with a 90% interval from
      ${fig(dN.team_low, 3)} to ${fig(dN.team_high, 3)} —
      ${inside
        ? 'which, on this team, still happens to contain μ = 0'
        : 'which no longer contains μ = 0, and is right not to: this team really does average above it'}.
      The blue curve for μ itself ${muInside ? 'still contains 0' : 'has slipped off 0 too'},
      because it is wider on purpose: it carries the uncertainty of having drawn
      only eight people. <strong>The team's average is not the population's,
      and the model knows the difference.</strong>`

    // (c) ordered teams
    el.querySelector('[data-role="caption-teams"]').textContent =
      `${coverage.n_teams} teams of ${coverage.n_players}, one facet per step, ranked by their posterior sample average. ` +
      `Orange bars contain μ, red bars miss it; blue bars are the same teams' intervals for μ, ` +
      `offset just below. The ringed bar is the walk-through team.`
    el.querySelector('[data-role="takeaway-teams"]').innerHTML = `
      A precisely known team average is allowed to miss μ. At ${first} serves
      per player the sample-average interval contains μ for ${pct(s0.team_covers_mu)}
      of the ${coverage.n_teams} teams; at ${last} it contains μ for
      ${pct(sN.team_covers_mu)}, because the bars have shrunk onto each team's
      own true average, which is almost never μ. The interval for μ itself
      contains it for ${pct(s0.mu_covers_mu)} of teams at ${first} serves and
      ${pct(sN.mu_covers_mu)} at ${last}. <strong>One falls toward zero, the
      other holds near its nominal 90%</strong> — the first is answering a
      different question.`

    // (d) coverage curves
    el.querySelector('[data-role="caption-coverage"]').textContent =
      `Share of ${coverage.n_teams} teams whose 90% interval contains the true μ, with 95% Wilson bands.`
    el.querySelector('[data-role="takeaway-coverage"]').innerHTML = `
      The same counts as curves: the sample-average interval covers μ in
      ${pct(s0.team_covers_mu)} of teams at ${first} serves and ${pct(sN.team_covers_mu)}
      at ${last}; μ's own interval covers it in ${pct(s0.mu_covers_mu)} and
      ${pct(sN.mu_covers_mu)}; the unseen-player interval in
      ${pct(s0.new_covers_mu)} and ${pct(sN.new_covers_mu)}.
      <strong>Knowing your eight players perfectly does not tell you the next
      eight.</strong> The population level is what carries over, and its
      uncertainty is set by how many people you have seen, not by how long you
      watched them.`
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
