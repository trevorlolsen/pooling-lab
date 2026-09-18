import { state, subscribe, is2d, skillLabel } from '../state.js'
import { renderWhenNear } from '../lib/scroll.js'
import { numberOf } from '../lib/sectionOrder.js'
import { zip, scenarioAccuracy } from '../lib/transforms.js'
import { loadAllTeams, orderedArms } from '../data.js'
import { errorByModel, isDashedArm } from '../charts/errorByModel.js'
import { layerLegend } from '../lib/layers.js'

/**
 * Did it help?
 *
 * Shrinkage is a mechanism. This section asks whether the movement actually paid
 * -- against the truth we simulated from, and against serves the model never
 * saw. Both questions are asked across all five teams, because one team cannot
 * answer either.
 *
 * In two skills every scenario carries a complete 1D payload per skill, so the
 * scoring runs once per skill and the chart is faceted by it. The takeaways
 * lead with the first skill and report the second beside it.
 */
export function evidence () {
  const el = document.createElement('section')
  el.id = 'evidence'
  el.innerHTML = `
    <div class="wrap">
      <header>
        <p class="eyebrow">${numberOf('evidence')} — Did it help?</p>
        <h2 data-role="headline">Shrinkage is a mechanism. Was it an improvement?</h2>
        <p>Moving an estimate is not the same as improving it. We score each
           model against the truth, and against serves it was never shown.<span
           class="detail"> Because we simulated this population, we know every
           player's true ability.</span></p>
      </header>

      <div class="controls" data-role="controls">
        <span class="seg" data-role="metric">
          <button data-metric="mae" aria-pressed="true">Mean absolute error</button>
          <button data-metric="rmse" aria-pressed="false">RMSE</button>
        </span>
        <span class="control-note">Lower is better.<span class="detail"> Click a model below to hide it — the axis rescales, which is how you see past complete pooling.</span></span>
      </div>

      <figure class="chart-panel">
        <div data-role="legend"></div>
        <div data-role="chart"><div class="loading">Loading all five teams…</div></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>

      <h3 class="subhead">Prediction on serves the model never saw</h3>
      <p>Every player has twenty further serves the model never saw. Root
         likelihood is how well it predicted them — higher is better, and 0.5 is
         a coin flip.<span class="detail"> Truth-scoring uses knowledge only a
         simulator has; holdout scoring does not — those serves were generated at
         the same time and never passed to Stan. Root likelihood is the geometric
         mean probability the model assigned to what actually happened.</span></p>
      <figure class="chart-panel">
        <div data-role="rlh"></div>
        <figcaption>In-sample is the serves the model was fitted on; out-of-sample is the untouched holdout.<span class="detail"> Averaged over all five teams.</span></figcaption>
      </figure>
      <p class="takeaway" data-role="rlh-takeaway"></p>
    </div>`

  const chart = el.querySelector('[data-role="chart"]')
  const rlhBox = el.querySelector('[data-role="rlh"]')
  let metric = 'mae'
  let teams = null
  let legend = null

  async function ensureTeams () {
    const population = state.population
    const dimension = state.dimension
    teams = { population, dimension, list: await loadAllTeams(state.index, population, dimension) }
    return teams.list
  }

  /** The skills to score: both in 2D, else one unlabelled pass. */
  const skillsOf = (sc) => (is2d() && sc.skills
    ? sc.skills.map((s, i) => ({ scenario: s, label: skillLabel(i + 1) }))
    : [{ scenario: sc, label: null }])

  function accuracyRows (list) {
    const { index, scale, difficulty } = state
    const opts = { scale, difficulty, difficultyGrid: index.difficulty_grid }
    const arms = orderedArms(index, skillsOf(list[0])[0].scenario)
    const rows = []
    for (const [t, sc] of list.entries()) {
      for (const { scenario, label: skill } of skillsOf(sc)) {
        const acc = scenarioAccuracy(scenario, opts)
        for (const { id, token } of arms) {
          if (!acc[id]) continue
          for (const band of acc[id].byBand) {
            rows.push({
              team: t, arm: id, label: token.label,
              n_train: band.n_train, value: metric === 'rmse' ? band.rmse : band.mae,
              ...(skill != null ? { skill } : {})
            })
          }
        }
      }
    }
    return { rows, arms: arms.map((a) => a.token) }
  }

  async function render () {
    if (!state.scenario) return
    if (!teams || teams.population !== state.population || teams.dimension !== state.dimension) {
      chart.innerHTML = '<div class="loading">Loading all five teams…</div>'
      await ensureTeams()
    }
    const list = teams.list
    if (!list.length) {
      chart.innerHTML = '<div class="note">No teams have been exported for this population yet.</div>'
      return
    }
    const twoD = is2d()
    const { rows, arms } = accuracyRows(list)

    // One training datum is a serve in one skill and a play in two.
    const unit = twoD ? 'plays' : 'serves'

    // Rebuild the legend whenever the available arms change -- a one-group
    // population has no `correct` arm to offer. The scrambled covariate shares
    // the correct one's colour, so its swatch is dashed like its line.
    const armKey = arms.map((a) => a.id).join(',')
    if (!legend || legend.key !== armKey) {
      const control = layerLegend([
        ...arms.map((a) => ({
          id: a.id, label: a.label, marker: isDashedArm(a) ? 'dashed' : 'line', color: a.color
        })),
        { id: 'range', label: "Range across teams, in each model's colour", marker: 'area', color: '#94a3b8' }
      ], () => render())
      legend = { key: armKey, control }
      const box = el.querySelector('[data-role="legend"]')
      box.innerHTML = ''
      box.appendChild(control.el)
    }
    const layers = legend.control.get()

    chart.innerHTML = ''
    chart.appendChild(errorByModel({
      rows, metric, arms, layers, scale: state.scale, unit,
      ...(twoD ? { facet: 'skill' } : {}),
      width: chart.clientWidth || 760
    }))

    // Visibly, the caption only names the marks: what the axes carry, and that
    // the line is a mean and the band a range. Everything that explains rather
    // than names -- the team and model counts, what the left edge and the band's
    // width imply, why the scrambled arm borrows the correct arm's colour -- goes
    // behind the rail's Detail toggle. The scoreboard figures that settle the
    // comparison stay visible in the takeaway below.
    el.querySelector('[data-role="caption"]').innerHTML =
      `<span class="detail">${list.length} teams, ${arms.length} models. </span>` +
      `How far each model's estimates sit from the abilities we simulated from` +
      `${twoD ? ', one panel per skill' : ''}. ` +
      `Left to right is training ${unit} per player; ` +
      'the line is the mean across teams, the band their range.' +
      `<span class="detail"> The left edge is the thinly-observed end, and the band's ` +
      `width is how much a single team's answer can move.` +
      (arms.some(isDashedArm)
        ? ' The scrambled covariate shares the correct covariate\'s colour and is drawn dashed with open dots.'
        : '') +
      '</span>'

    renderTakeaway(rows, arms, unit)
    // The table and the takeaway stay complete when a model is hidden. The
    // toggles exist to declutter the chart, not to retract a finding -- and a
    // scoreboard that empties out when you hide everything is no use to anyone.
    renderRlh(list, arms)
  }

  /**
   * The three comparisons, computed over one set of rows. In 2D the first
   * skill's rows carry the verdicts in prose and the second skill's verdicts
   * are stated beside them, with both skills' figures behind the Detail toggle.
   */
  function comparisons (rows) {
    const mean = (armId, band) => {
      const s = rows.filter((r) => r.arm === armId && (band == null || r.n_train === band))
      return s.length ? s.reduce((a, r) => a + r.value, 0) / s.length : null
    }
    const bands = [...new Set(rows.map((r) => r.n_train))].sort((a, b) => a - b)
    const lo = bands[0]
    const hi = bands[bands.length - 1]
    const has = (id) => rows.some((r) => r.arm === id)
    return {
      lo,
      hi,
      pooling: has('no_pool') && has('none')
        ? { gainLo: mean('no_pool', lo) - mean('none', lo), gainHi: mean('no_pool', hi) - mean('none', hi) }
        : null,
      correct: has('correct') && has('none') ? mean('none') - mean('correct') : null,
      wrong: has('wrong') && has('none') ? Math.abs(mean('none') - mean('wrong')) : null
    }
  }

  function renderTakeaway (rows, arms, unit) {
    const twoD = is2d()
    const lead = twoD ? rows.filter((r) => r.skill === skillLabel(1)) : rows
    const c = comparisons(lead)

    const parts = []
    // This is the section whose job is to report a comparison, so each verdict
    // keeps the one figure that settles it -- and nothing else. The supporting
    // walk-downs (the second reading of the same comparison at the far end of
    // the ladder, the per-arm values the reader can lift straight off the chart)
    // go behind the Detail toggle.
    if (c.pooling) {
      const { gainLo, gainHi } = c.pooling
      parts.push(`${twoD ? `In ${skillLabel(1)}, at` : 'At'} <strong class="figures">${c.lo}</strong> ${unit} per player, partial pooling beats
        no pooling by <strong class="figures">${gainLo.toFixed(4)}</strong>.
        <span class="detail">At <strong class="figures">${c.hi}</strong> the gap is
        <strong class="figures">${gainHi.toFixed(4)}</strong>.${
          gainHi < gainLo * 0.5
            ? ' By the far end of the ladder most of that edge is gone — the advantage is concentrated where data is thin.'
            : ''}</span>`)
    }
    if (c.correct != null) {
      parts.push(c.correct > 0
        ? `The <strong>correct covariate</strong> gains
           <strong class="figures">${c.correct.toFixed(4)}</strong> on plain partial pooling.`
        : `The correct covariate did <strong>not</strong> beat plain partial pooling.`)
    }
    if (c.wrong != null) {
      parts.push(`The <strong>scrambled covariate</strong> lands on the
        no-covariate line<span class="detail">, within
        <strong class="figures">${c.wrong.toFixed(4)}</strong> of it overall</span> —
        it buys nothing.`)
    }

    if (twoD) {
      const second = comparisons(rows.filter((r) => r.skill === skillLabel(2)))
      const bits = []
      if (second.pooling) {
        bits.push(`partial pooling beats no pooling by
          <strong class="figures">${second.pooling.gainLo.toFixed(4)}</strong> at ${second.lo}
          ${unit} and <strong class="figures">${second.pooling.gainHi.toFixed(4)}</strong> at ${second.hi}`)
      }
      if (second.correct != null) {
        bits.push(second.correct > 0
          ? `the correct covariate improves on plain partial pooling by
             <strong class="figures">${second.correct.toFixed(4)}</strong> overall`
          : 'the correct covariate does not improve on plain partial pooling')
      }
      if (second.wrong != null) {
        bits.push(`the scrambled covariate lands within
          <strong class="figures">${second.wrong.toFixed(4)}</strong> of no covariate`)
      }
      if (bits.length) {
        // The verdict for the second skill stays in words -- it can differ from
        // the first skill's, and that difference is the reason for two panels.
        // With no covariate to judge there is no verdict, so the visible line
        // falls back to naming the panel.
        const verdict = second.correct == null
          ? `The second panel is ${skillLabel(2)}.`
          : `In ${skillLabel(2)}, the correct covariate
             <strong>${second.correct > 0 ? 'does' : 'does not'}</strong> improve on plain
             partial pooling.`
        parts.push(`${verdict}
          <span class="detail">Scored the same way over the same teams.
          In ${skillLabel(2)}: ${bits.join('; ')}.</span>`)
      }
    }
    el.querySelector('[data-role="takeaway"]').innerHTML = parts.join(' ')
  }

  function renderRlh (list, arms) {
    const twoD = is2d()
    // One row per arm in 1D; per arm per skill in 2D, arms kept together.
    const skills = twoD
      ? [1, 2].map((k) => ({ k, label: skillLabel(k), pick: (sc) => sc.skills[k - 1] }))
      : [{ k: 1, label: null, pick: (sc) => sc }]
    const avg = (id, key, pick) => {
      const vals = list.map((sc) => pick(sc).arms[id]?.metrics?.[key]).filter((v) => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    // RLH over BOTH skills at once: the geometric mean over every play, which
    // is the observation-weighted mean of the two skills' log-RLHs, taken per
    // team and then averaged across teams like the per-skill numbers.
    const combined = (id, key, nKey) => {
      const vals = list.map((sc) => {
        let logSum = 0; let n = 0
        for (const s of skills) {
          const m = s.pick(sc).arms[id]?.metrics
          if (!m || m[key] == null) return null
          logSum += m[nKey] * Math.log(m[key])
          n += m[nKey]
        }
        return n ? Math.exp(logSum / n) : null
      }).filter((v) => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    const rows = []
    for (const a of arms) {
      if (!skills[0].pick(list[0]).arms[a.id]) continue
      if (twoD) {
        rows.push({
          label: a.label, color: a.color, skill: 'Both', total: true,
          inSample: combined(a.id, 'in_sample_rlh', 'n_training'),
          outSample: combined(a.id, 'out_of_sample_rlh', 'n_holdout')
        })
      }
      for (const s of skills) {
        rows.push({
          label: a.label,
          color: a.color,
          skill: s.label,
          total: !twoD,
          inSample: avg(a.id, 'in_sample_rlh', s.pick),
          outSample: avg(a.id, 'out_of_sample_rlh', s.pick)
        })
      }
    }
    if (!rows.length) { rlhBox.innerHTML = ''; return }
    // The verdict is judged on the whole, not on whichever skill happens to
    // score highest.
    const totals = rows.filter((r) => r.total)
    const bestOut = Math.max(...totals.map((r) => r.outSample))

    rlhBox.innerHTML = `
      <table class="metric-table figures">
        <thead>
          <tr><th>Model</th>${twoD ? '<th>Skill</th>' : ''}<th>In-sample RLH</th><th>Out-of-sample RLH</th><th>Gap</th></tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr${r.total && r.outSample === bestOut ? ' class="best"' : ''}${
              twoD && !r.total ? ' class="sub"' : ''}>
              <td>${r.total
                ? `<span class="swatch" style="background:${r.color}"></span>${r.label}`
                : ''}</td>
              ${twoD ? `<td>${r.total ? '<b>Both</b>' : r.skill}</td>` : ''}
              <td>${r.inSample.toFixed(4)}</td>
              <td>${r.total ? `<b>${r.outSample.toFixed(4)}</b>` : r.outSample.toFixed(4)}</td>
              <td>${(r.inSample - r.outSample).toFixed(4)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`

    const best = totals.find((r) => r.outSample === bestOut)
    const noPool = totals.find((r) => /no pooling/i.test(r.label))
    // Two verdicts, each keeping the one figure that settles it: who wins on
    // held-out data, and how far no pooling flatters itself. Both figures stay
    // visible -- the winner's score alone can tie between populations, and the
    // Gap is what tells them apart. What goes behind the Detail toggle is the
    // pointer to the highlighted row, the pair of cells the gap is computed
    // from, and the gloss on what the gap means.
    el.querySelector('[data-role="rlh-takeaway"]').innerHTML = `
      <strong>${best.label}</strong> predicts unseen ${twoD ? 'plays' : 'serves'} best, at
      <strong class="figures">${best.outSample.toFixed(4)}</strong>.<span class="detail"> ${
        twoD ? 'Across both skills; that is' : 'That is'} the highlighted row above.</span>
      ${noPool ? `The <strong>Gap</strong> column: no pooling scores
        <strong class="figures">${(noPool.inSample - noPool.outSample).toFixed(4)}</strong> better on the
        ${twoD ? 'plays' : 'serves'} it trained on than on ones it never saw<span class="detail">
        (<span class="figures">${noPool.inSample.toFixed(4)}</span> against
         <span class="figures">${noPool.outSample.toFixed(4)}</span>) — it is fitting
        noise it cannot reproduce</span>. <strong>That gap is what pooling is buying.</strong>` : ''}`
  }

  function mount () {
    renderWhenNear(el, render)

    el.querySelector('[data-role="metric"]').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-metric]')
      if (!button) return
      for (const b of el.querySelectorAll('[data-role="metric"] button')) {
        b.setAttribute('aria-pressed', String(b === button))
      }
      metric = button.dataset.metric
      render()
    })

    return subscribe((reason) => {
      if (['scenario', 'scale', 'difficulty'].includes(reason)) render()
    })
  }

  return { el, mount }
}
