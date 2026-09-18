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
        <p>Moving an estimate is not the same as improving it. Because we
           simulated this population, we know every player's true ability — so we
           can simply score each model against it, and against serves it was
           never shown.</p>
      </header>

      <div class="controls" data-role="controls">
        <span class="seg" data-role="metric">
          <button data-metric="mae" aria-pressed="true">Mean absolute error</button>
          <button data-metric="rmse" aria-pressed="false">RMSE</button>
        </span>
        <span class="control-note">Lower is better. Click a model below to hide it — the axis rescales, which is how you see past complete pooling.</span>
      </div>

      <figure class="chart-panel">
        <div data-role="legend"></div>
        <div data-role="chart"><div class="loading">Loading all five teams…</div></div>
        <figcaption data-role="caption"></figcaption>
      </figure>
      <p class="takeaway" data-role="takeaway"></p>

      <h3 class="subhead">Prediction on serves the model never saw</h3>
      <p>Truth-scoring uses knowledge only a simulator has. Holdout scoring does
         not: every player has twenty further serves that were generated at the
         same time and never passed to Stan. Root likelihood is the geometric
         mean probability the model assigned to what actually happened — higher
         is better, and 0.5 is a coin flip.</p>
      <figure class="chart-panel">
        <div data-role="rlh"></div>
        <figcaption>In-sample uses the training serves the model was fitted on. Out-of-sample uses the untouched holdout. Averaged over all five teams.</figcaption>
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

    el.querySelector('[data-role="caption"]').textContent =
      `${list.length} teams, ${arms.length} models${twoD ? ', one panel per skill' : ''}, ` +
      `scored at each count of training ${unit} per player. ` +
      'The line is the mean across teams; ' +
      `the shaded band is the full range, so its width is how much a single team's answer can move. ` +
      (arms.some(isDashedArm)
        ? 'The scrambled covariate shares the correct covariate\'s colour and is drawn dashed with open dots.'
        : '')

    renderTakeaway(rows, arms, unit)
    // The table and the takeaway stay complete when a model is hidden. The
    // toggles exist to declutter the chart, not to retract a finding -- and a
    // scoreboard that empties out when you hide everything is no use to anyone.
    renderRlh(list, arms)
  }

  /**
   * The three comparisons, computed over one set of rows. In 2D the first
   * skill's rows carry the full sentences and the second skill's are reduced
   * to their numbers.
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
    if (c.pooling) {
      const { gainLo, gainHi } = c.pooling
      parts.push(`${twoD ? `In ${skillLabel(1)}, at` : 'At'} <strong class="figures">${c.lo}</strong> ${unit} per player, partial pooling beats
        no pooling by <strong class="figures">${gainLo.toFixed(4)}</strong>. At
        <strong class="figures">${c.hi}</strong> the gap is
        <strong class="figures">${gainHi.toFixed(4)}</strong>${
          gainHi < gainLo * 0.5 ? ' — the advantage is concentrated where data is thin' : ''}.`)
    }
    if (c.correct != null) {
      parts.push(c.correct > 0
        ? `The <strong>correct covariate</strong> improves on plain partial pooling by
           <strong class="figures">${c.correct.toFixed(4)}</strong> overall.`
        : `The correct covariate did <strong>not</strong> improve on plain partial pooling here.`)
    }
    if (c.wrong != null) {
      parts.push(`The <strong>scrambled covariate</strong> lands within
        <strong class="figures">${c.wrong.toFixed(4)}</strong> of using no covariate at all —
        it costs nothing and buys nothing.`)
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
      if (bits.length) parts.push(`The same in ${skillLabel(2)}: ${bits.join('; ')}.`)
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
    el.querySelector('[data-role="rlh-takeaway"]').innerHTML = `
      <strong>${best.label}</strong> predicts unseen ${twoD ? 'plays, across both skills,' : 'serves'} best, at
      <strong class="figures">${best.outSample.toFixed(4)}</strong>.
      ${noPool ? `No pooling looks better in-sample than out
        (<span class="figures">${noPool.inSample.toFixed(4)}</span> against
         <span class="figures">${noPool.outSample.toFixed(4)}</span>) — it is fitting
        noise it cannot reproduce. <strong>That gap is what pooling is buying.</strong>` : ''}`
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
