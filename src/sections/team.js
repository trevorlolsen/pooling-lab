import { state, subscribe, setState, teamLabel, is2d, skillLabel } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { numberOf, refTo } from '../lib/sectionOrder.js'
import { zip } from '../lib/transforms.js'
import { populationDensity } from '../charts/populationDensity.js'
import { populationContours } from '../charts/populationContours.js'
import { layerLegend } from '../lib/layers.js'

/**
 * Section 1 — the team. Who these players are, where they came from, and the
 * fact that we have wildly different amounts of information about each of them.
 *
 * In two skills the population is a mixture of bivariate normals rather than a
 * density curve, so the chart becomes a contour plot. The population block's
 * scalar fields become length-2 arrays (one per skill) and are indexed here.
 */
export function theTeam () {
  const el = document.createElement('section')
  el.id = 'team'
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('team')} — The team</p>
        <h2 data-role="headline"></h2>
        <p data-role="lede"></p>
      </header>
      <figure class="chart-panel">
        <div data-role="legend"></div>
        <div data-role="chart"></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>

      <h3 class="subhead">How this population is generated</h3>
      <p>Every number on this page comes from data we simulated, so the recipe
         is worth stating exactly. It has three steps, and only the first two
         change between populations.</p>
      <div class="dgp" data-role="dgp"></div>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  let legend = null
  // How many groups the current legend was built for. The population switcher
  // can move between one group and two without remounting the section, and
  // the one-group legend has fewer entries, so the legend is rebuilt when this
  // changes.
  let legendGroups = 0

  function render () {
    const { scenario, index } = state
    if (!scenario) return

    const twoD = is2d()
    const pop = scenario.population
    const players = zip(scenario.truth)
    const bands = [...new Set(players.map((p) => p.n_train))].sort((a, b) => a - b)
    const groups = zip(pop.groups)
    const grouped = groups.length > 1
    // Skill 2 is Reception, so the unit of data is a "play" once there are two
    // skills; the 1D story is about serves alone.
    const unit = twoD ? 'plays' : 'serves'
    // In 2D every population summary is a pair; the headline only needs one
    // verdict, and the two skills share the same separation by construction.
    const bimodal = twoD ? pop.bimodal[0] : pop.bimodal

    el.querySelector('[data-role="headline"]').textContent = bimodal
      ? 'These players come from two genuinely different groups'
      : grouped
        ? 'These players carry a group label — but the groups barely differ'
        : 'These players are a sample from one population'

    el.querySelector('[data-role="lede"]').innerHTML = `
      ${players.length} players, drawn from ${grouped
        ? `a population made of ${groups.length} groups`
        : 'a single population'}.
      We watched them unequal numbers of times: ${bands.join(', ')} ${unit} each.
      That difference is the whole reason this is interesting.`

    // The section is remounted when the dimension changes, so this closure is
    // fresh and the legend is rebuilt with the right markers for the chart.
    // Within a mount it is rebuilt only when the group count changes, carrying
    // the reader's toggles across so a population switch does not reset them.
    if (!legend || legendGroups !== groups.length) {
      const previous = legend ? legend.get() : {}
      const was = (id) => previous[id] !== false
      // The dots take their group's colour when there are groups, and the
      // swatch cannot show two colours at once -- so the label says so.
      const playersLabel = grouped
        ? `The ${players.length} players on this team, in their group's colour`
        : `The ${players.length} players on this team`
      // With one group there is nothing for the group layers to draw, and in
      // 2D the dashed 90% outline coincides with the grey 90% ring, so those
      // entries would be dead toggles: omit them.
      const items = twoD
        ? [
            ...(grouped ? [
              { id: 'groups', label: 'Each group: 50% and 90% of its players, in its own colour', marker: 'area', color: '#0072b2', on: was('groups') },
              { id: 'outline', label: 'Whole population: 90%', marker: 'dashed', color: '#475569', on: was('outline') },
              { id: 'group_means', label: 'True group means', marker: 'diamond', color: '#0072b2', on: was('group_means') }
            ] : []),
            { id: 'players', label: playersLabel, marker: 'dot', color: '#64748b', on: was('players') }
          ]
        : [
            ...(grouped ? [
              { id: 'groups', label: 'Each group, in its own colour', marker: 'area', color: '#0072b2', on: was('groups') }
            ] : []),
            { id: 'outline', label: 'Whole population', marker: 'line', color: '#475569', on: was('outline') },
            ...(grouped ? [
              { id: 'group_means', label: 'True group means', marker: 'rule', color: '#0072b2', on: was('group_means') }
            ] : []),
            { id: 'players', label: playersLabel, marker: 'dot', color: '#64748b', on: was('players') }
          ]
      const host = el.querySelector('[data-role="legend"]')
      host.innerHTML = ''
      legend = layerLegend(items, () => render())
      legendGroups = groups.length
      host.appendChild(legend.el)
    }
    const layers = legend.get()
    // On a grouped population with the group fill hidden, the chart falls back
    // to one grey shape for the mixture -- the caption has to say what that is.
    const groupsHidden = grouped && layers.groups === false

    const draw = twoD ? populationContours : populationDensity
    chart.innerHTML = ''
    chart.appendChild(draw({
      scenario,
      index,
      layers,
      // Null until clicked, matching the shrinkage chart: an outline on player 1 that
      // nobody chose reads as a bug, not a highlight.
      selectedPlayer: state.selectedPlayer,
      onSelect: (id) => setState({ selectedPlayer: id }, 'select'),
      width: chart.clientWidth || 760
    }))

    // The team readout makes the seed switcher unmistakably live. Without it,
    // swapping teams changes forty dots subtly and reads as "nothing happened".
    const s1 = skillLabel(1)
    const s2 = skillLabel(2)
    // The rings are the population's own truth -- fixed for a preset, so they
    // hold still when the team changes and only the dots move. Say so, or a
    // reader reasonably takes the inner ring for something about this team.
    // The 2D chart has no rows to carry the information bands, so it carries
    // them in the dot size instead; the sentence quotes the bands actually
    // simulated rather than a typed-in ladder.
    const sizes = `Bigger dots were watched more: ${bands.join(', ')} ${unit} each.`
    const select = 'Click a player to follow them through the story; the black ring marks your choice.'
    const base = twoD
      ? (groupsHidden
          ? `${s1} runs left to right and ${s2} bottom to top. With the groups hidden,
             the grey shape is the whole population: the inner ring encloses 50% of it
             and the outer ring 90% — the population itself, not this team, so they
             stay put when you switch teams. Dots are the ${players.length} players
             actually drawn, each at their true ability in both skills, in grey while
             their groups are hidden. ${sizes}`
          : grouped
            ? `${s1} runs left to right and ${s2} bottom to top. Around each group's true
             mean, the inner ring encloses 50% of that group's players and the outer
             ring 90% — the population the group is drawn from, not this team, so they
             stay put when you switch teams. The dashed outline is 90% of the whole
             population. Dots are the ${players.length} players actually drawn, each at
             their true ability in both skills. ${sizes}`
            : `${s1} runs left to right and ${s2} bottom to top. The inner ring encloses
             50% of the population and the outer ring 90% — the population itself, so
             they stay put when you switch teams. Dots are the ${players.length} players
             actually drawn, each at their true ability in both skills. ${sizes}`)
      : groupsHidden
        ? `With the groups hidden, the grey shape is the whole population — the one you
           would actually sample from. Dots are the ${players.length} players drawn, in
           rows by how often we watched them, in grey while their groups are hidden.`
        : grouped
          ? `Each group is shaded in its own colour and the two stack up to the dark
           outline, which is the population you would actually sample from. Dots are
           the ${players.length} players drawn, in rows by how often we watched them.`
          : `Shaded: the population you would sample from. Dots are the
           ${players.length} players drawn, in rows by how often we watched them.`
    el.querySelector('[data-role="caption"]').innerHTML =
      `<strong>${teamLabel()}</strong> — ${base} ${select} Every team is a fresh draw from the same population.`

    el.querySelector('[data-role="takeaway"]').innerHTML = twoD
      ? takeaway2d(pop, groups, bimodal, s1, s2)
      : takeaway1d(pop, groups)

    el.querySelector('[data-role="dgp"]').innerHTML = generativeProcess(scenario, index, players, groups, twoD)
  }

  /**
   * The data-generating process, with this population's own numbers.
   *
   * Written from the payload rather than hard-coded so it cannot drift from
   * what was actually simulated: group shares and means come from
   * `population.groups`, the ladder and holdout from `truth`, the difficulty
   * range from the shared index, and the analysis labels from
   * `analysis_covariates`.
   */
  function generativeProcess (scenario, index, players, groups, twoD) {
    const pop = scenario.population
    const s1 = skillLabel(1)
    const s2 = skillLabel(2)
    const grouped = groups.length > 1
    const [dLo, dHi] = index.domains.difficulty
    const holdout = players[0]?.n_holdout ?? 0
    const ladder = new Map()
    for (const p of players) ladder.set(p.n_train, (ladder.get(p.n_train) ?? 0) + 1)
    const ladderText = [...ladder.entries()].sort((a, b) => a[0] - b[0])
      .map(([n, k]) => `${k} players × ${n}`).join(', ')
    const share = (w) => `${Math.round(100 * w / groups.reduce((s, g) => s + g.weight, 0))}%`
    const f2 = (x) => x.toFixed(2)

    const sd = twoD ? pop.within_sd[0] : pop.within_sd
    // The mean is per group when there are groups, and just μ when there are not.
    const mu = grouped ? 'μ<sub>g(i)</sub>' : 'μ'
    const model = twoD
      ? `θ<sub>i</sub> = (θ<sub>i1</sub>, θ<sub>i2</sub>) ~ MVN(${mu}, Σ),
         &nbsp; Σ = τ<sup>2</sup> <span class="mat">[1 ρ; ρ 1]</span>
         with τ = ${f2(sd)} and ρ = ${f2(pop.rho)}`
      : `θ<sub>i</sub> ~ Normal(${mu}, τ) with τ = ${f2(sd)}`

    // Group sizes are exact shares of the team dealt out in a random order,
    // not a coin flip per player -- allocate_group_counts() in R/simulation.R.
    // Name the covariate here, because this is the word the later sections'
    // legends lean on ("Partial pooling + Experience") without redefining it.
    const covariateName = grouped && pop.covariate_name
      ? ` The group label is called <em>${pop.covariate_name}</em>
         (levels: ${groups.map((g) => g.group).join(', ')}).`
      : ''
    const groupStep = grouped
      ? `The ${players.length} players are dealt into their true groups in a random order,
         ${groups.map((g) => `${share(g.weight)} <em>${g.group}</em>`).join(' and ')}.${covariateName}
         Each player's ability is then drawn around their group's mean —
         <span class="figures">${model}</span>.`
      : `There are no groups. Each of the ${players.length} players' ability is drawn
         from one population — <span class="figures">${model}</span> and
         μ = ${twoD ? `(${f2(pop.true_mu[0])}, ${f2(pop.true_mu[1])})` : f2(pop.true_mu)}.`

    const serveStep = twoD
      ? `For each player and <em>each skill separately</em>, serves are generated on a
         ladder — ${ladderText} training plays per skill — plus ${holdout} holdout plays per
         skill that never reach the model. Every play gets a difficulty
         d ~ Uniform(${dLo}, ${dHi}) and an outcome
         <span class="figures">y ~ Bernoulli(logit<sup>−1</sup>(θ<sub>ik</sub> − d))</span>,
         where k is the skill.`
      : `For each player, serves are generated on a ladder — ${ladderText} training serves —
         plus ${holdout} holdout serves that never reach the model. Every serve gets a
         difficulty d ~ Uniform(${dLo}, ${dHi}) and an outcome
         <span class="figures">y ~ Bernoulli(logit<sup>−1</sup>(θ<sub>i</sub> − d))</span>.`

    const cov = scenario.analysis_covariates ?? {}
    const wrong = cov.wrong
    const wrongText = !wrong ? ''
      : wrong.type === 'permuted'
        ? `The <em>scrambled</em> label shuffles the true groups among the players${
            wrong.overlap?.n_matching != null
              ? ` (${wrong.overlap.n_matching} of ${wrong.overlap.n_total} happen to keep theirs)`
              : ''}.`
        : `The <em>invented</em> label splits the players into ${wrong.G} random groups
           that correspond to nothing.`
    const labelStep = `Nothing above depends on which label the model is later given.
      ${cov.correct ? 'The <em>correct</em> label is the true group. ' : ''}${wrongText}
      Every team is a fresh draw of all three steps at its own seed; the fits in
      ${refTo(['covariate-correct', 'covariate-wrong'])} see byte-identical
      serves and differ only in the label.`

    const table = `
      <table class="metric-table figures dgp-table">
        <thead><tr>
          <th>Group</th><th>Share</th>
          ${twoD ? `<th>Mean ${s1} θ<sub>1</sub></th><th>Mean ${s2} θ<sub>2</sub></th>` : '<th>Mean θ</th>'}
          <th>Within-group sd τ</th>${twoD ? '<th>ρ</th>' : ''}
        </tr></thead>
        <tbody>
          ${groups.map((g) => `
            <tr>
              <td>${g.group}</td>
              <td>${share(g.weight)}</td>
              ${twoD
                ? `<td>${f2(g.theta_mean_1)}</td><td>${f2(g.theta_mean_2)}</td>`
                : `<td>${f2(g.theta_mean)}</td>`}
              <td>${f2(sd)}</td>${twoD ? `<td>${f2(pop.rho)}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>`

    return `
      <ol class="dgp-steps">
        <li><strong>Who the players are.</strong> ${groupStep}</li>
        <li><strong>What we watched.</strong> ${serveStep}</li>
        <li><strong>What the model is told.</strong> ${labelStep}</li>
      </ol>
      ${table}
      <p class="aside">On the ability scale θ, a serve at difficulty d = 0 is returned with
         probability logit<sup>−1</sup>(θ); θ = 0 is a coin flip, θ = ±1 is about ${
           (100 / (1 + Math.exp(-1))).toFixed(0)}% either way. The difficulty range
         ${dLo} to ${dHi} is shared by every population.</p>`
  }

  function takeaway1d (pop, groups) {
    const spread = pop.separation_ratio
    return pop.bimodal
      ? `The two groups sit <strong class="figures">${pop.mean_separation.toFixed(1)}</strong>
         apart on the ability scale while players within a group vary by only
         <strong class="figures">${pop.within_sd.toFixed(2)}</strong> — a ratio of
         <strong class="figures">${spread.toFixed(1)}</strong>. The population has
         two humps, and <strong>its average describes nobody.</strong> Hold on to that.`
      : groups.length > 1
        ? `The group means differ by only
           <strong class="figures">${pop.mean_separation.toFixed(1)}</strong> while players
           within a group vary by <strong class="figures">${pop.within_sd.toFixed(2)}</strong>.
           The label exists, but it is <strong>barely worth knowing</strong>.`
        : `Every player is drawn from one normal population. There is no group
           label to use, and <strong>nothing to condition on</strong> — which makes
           this the cleanest place to see what pooling does on its own.`
  }

  /**
   * Two skills: quote the separation in each, then the fact the 2D view is
   * really about -- the within-group correlation, and how the group structure
   * inflates it when you look at the whole population at once.
   */
  function takeaway2d (pop, groups, bimodal, s1, s2) {
    const rho = pop.rho
    const rhoM = pop.rho_marginal
    const correlation = `The two skills are correlated at
      <strong class="figures">ρ = ${rho.toFixed(2)}</strong> within a group; across the
      whole population that looks like
      <strong class="figures">${rhoM.toFixed(2)}</strong>${
        groups.length > 1 && Math.abs(rhoM - rho) > 0.05
          ? ', because players who are strong in one skill tend to be in the group that is strong in both'
          : ''}.`
    if (bimodal) {
      return `The two groups sit <strong class="figures">${pop.mean_separation[0].toFixed(1)}</strong>
         apart in ${s1} and <strong class="figures">${pop.mean_separation[1].toFixed(1)}</strong>
         in ${s2}, while players within a group vary by only
         <strong class="figures">${pop.within_sd[0].toFixed(2)}</strong> and
         <strong class="figures">${pop.within_sd[1].toFixed(2)}</strong> — ratios of
         <strong class="figures">${pop.separation_ratio[0].toFixed(1)}</strong> and
         <strong class="figures">${pop.separation_ratio[1].toFixed(1)}</strong>.
         The population has two islands, and <strong>its average sits in the water
         between them.</strong> ${correlation}`
    }
    if (groups.length > 1) {
      return `The group means differ by only
         <strong class="figures">${pop.mean_separation[0].toFixed(1)}</strong> in ${s1} and
         <strong class="figures">${pop.mean_separation[1].toFixed(1)}</strong> in ${s2}, while
         players within a group vary by
         <strong class="figures">${pop.within_sd[0].toFixed(2)}</strong> and
         <strong class="figures">${pop.within_sd[1].toFixed(2)}</strong> — ratios of
         <strong class="figures">${pop.separation_ratio[0].toFixed(1)}</strong> and
         <strong class="figures">${pop.separation_ratio[1].toFixed(1)}</strong>.
         The label exists, but it is <strong>barely worth knowing</strong>. ${correlation}`
    }
    // One group: the within-group and marginal correlations coincide, so
    // quoting both would be a distinction without a difference.
    return `Every player is drawn from one bivariate normal population. There is no
       group label to use, and <strong>nothing to condition on</strong> — but the two
       skills are not independent: they are correlated at
       <strong class="figures">ρ = ${rho.toFixed(2)}</strong>, so a player who is strong
       in ${s1} tends to be strong in ${s2} too.`
  }

  function mount () {
    renderWhenNear(el, render)
    const off = subscribe((reason) => {
      if (['scenario', 'select', 'scale'].includes(reason)) render()
    })
    return off
  }

  return { el, mount }
}
