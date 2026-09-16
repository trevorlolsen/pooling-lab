import * as Plot from '@observablehq/plot'
import { armEstimates, truthValues, borrowingTargets, zip, plogis } from '../lib/transforms.js'
import { posteriorBoxes, boxMarks } from './posteriorBoxes.js'

/**
 * Where each player gets pulled TO, once the model knows a grouping.
 *
 * Without a covariate every player is pulled toward one number. With a covariate
 * each player is pulled toward the mean of their own group -- so the single
 * target splits in two, and players in different groups move in different
 * directions. That split is the whole lesson.
 *
 * Faceted by the ANALYSIS group rather than by observation count, because the
 * question here is "which target did this player get", not "how much data did
 * they have". The global target stays on the chart as a faint reference so the
 * reader can see how far the group means sit from it.
 */
export function borrowingSplit ({
  scenario, index, tokens, armId, scale, difficulty, view = 'point',
  layers = {}, width = 760, height = 520
}) {
  const on = (id) => layers[id] !== false
  const opts = { scale, difficulty, difficultyGrid: index.difficulty_grid }
  const arm = scenario.arms[armId]
  const cov = scenario.analysis_covariates?.[armId]
  if (!arm || !cov) return Plot.plot({ width, height: 60, marks: [] })

  const noPool = new Map(armEstimates(scenario.arms.no_pool, opts).map((d) => [d.child_id, d]))
  const pooled = new Map(armEstimates(arm, opts).map((d) => [d.child_id, d]))
  const truth = truthValues(scenario.truth, opts)
  const targets = new Map(borrowingTargets(arm, opts).map((t) => [t.child_id, t]))

  // The one target a covariate-free model would have used, for contrast.
  const globalTarget = borrowingTargets(scenario.arms.none, opts)[0]?.target ?? null

  const rows = truth.map((t) => {
    const g = cov.group[t.child_id - 1]
    return {
      child_id: t.child_id,
      group: cov.levels[g - 1],
      true_group: t.true_group,
      n_train: t.n_train,
      truth: t.truth_value,
      no_pool: noPool.get(t.child_id)?.estimate,
      pooled: pooled.get(t.child_id)?.estimate,
      target: targets.get(t.child_id)?.target,
      // Whether the model's grouping actually matches reality. On a scrambled
      // covariate this is false for about half the players, and saying so is
      // the whole point of the contrast section.
      matches: t.true_group === cov.levels[g - 1]
    }
  })

  const groups = cov.levels
  const byGroup = new Map(groups.map((g) => [g, []]))
  for (const row of rows) byGroup.get(row.group)?.push(row)
  let widest = 0
  for (const members of byGroup.values()) {
    members.sort((a, b) => a.no_pool - b.no_pool)
    members.forEach((row, i) => { row.rank = i + 1 })
    widest = Math.max(widest, members.length)
  }

  // One row per group giving that group's ESTIMATED target and its TRUE mean.
  //
  // The true mean per analysis level is composition weighted -- for a scrambled
  // grouping there is no "true mean of group B", so it is the mean true ability
  // of whoever landed in B. That is why it collapses to the overall mean there,
  // and the chart should show that rather than pretend the group has a truth.
  const trueByGroup = new Map(
    zip(scenario.derived?.group_means_estimated?.[armId] ?? {})
      .map((r) => [r.analysis_group, r.true_theta_mean])
  )
  const toScale = (t) => (t == null ? null
    : scale === 'theta' ? t : plogis(t - difficulty))
  const groupTargets = groups.map((g) => ({
    group: g,
    target: byGroup.get(g)?.[0]?.target ?? null,
    trueMean: toScale(trueByGroup.get(g))
  })).filter((d) => d.target != null)

  const armColor = tokens.get(armId)?.color ?? '#cc79a7'
  const xLabel = scale === 'theta'
    ? 'Latent ability θ'
    : `Return probability at d* = ${difficulty.toFixed(2)}`

  const marks = [
    Plot.frame({ stroke: '#e6e6e6' })
  ]

  if (globalTarget != null && on('global_target')) {
    marks.push(
      Plot.ruleX([globalTarget], {
        stroke: tokens.get('none')?.color ?? '#56b4e9',
        strokeWidth: 1.2,
        strokeDasharray: '3 3',
        strokeOpacity: 0.7
      })
    )
  }

  if (view === 'posterior') {
    // Carry the assigned group through so each violin lands in its own panel;
    // marks with their own data are otherwise repeated in every facet.
    const byId = new Map(rows.map((r) => [r.child_id, r]))
    const metaOf = (childId) => {
      const row = byId.get(childId)
      return row ? { rank: row.rank, facet: row.group } : null
    }
    const bopts = { metaOf, scale, difficulty }
    if (on('no_pool')) {
      marks.push(...boxMarks(
        posteriorBoxes({ arm: scenario.arms.no_pool, ...bopts }),
        { color: tokens.get('no_pool').color, fillOpacity: 0.18 }
      ))
    }
    if (on('pooled')) {
      marks.push(...boxMarks(
        posteriorBoxes({ arm, ...bopts }),
        { color: armColor, fillOpacity: 0.3 }
      ))
    }
  }

  if (on('true_group_mean')) marks.push(
    // What each group's ability ACTUALLY averages, against where the model
    // decided to pull. The gap between these two lines is the model's error
    // about the group, not about any individual.
    Plot.ruleX(groupTargets.filter((d) => d.trueMean != null), {
      x: 'trueMean',
      fy: 'group',
      stroke: index.truth_color,
      strokeWidth: 1.5,
      strokeDasharray: '2 3'
    })
  )

  if (on('targets')) marks.push(
    // Each facet gets its OWN target line. Two facets, two lines, in different
    // places -- that is the split, drawn.
    Plot.ruleX(groupTargets, {
      x: 'target',
      fy: 'group',
      stroke: armColor,
      strokeWidth: 2
    })
  )

  // The pull itself only means anything when both ends of it are on the chart.
  if (on('no_pool') && on('pooled')) {
    marks.push(
      Plot.link(rows, {
        x1: 'no_pool', x2: 'pooled',
        y1: 'rank', y2: 'rank',
        stroke: '#9ca3af',
        strokeWidth: 1.5
      })
    )
  }

  if (on('no_pool')) {
    marks.push(
      Plot.dot(rows, {
        x: 'no_pool', y: 'rank',
        r: 4, fill: 'none',
        stroke: tokens.get('no_pool').color, strokeWidth: 1.6,
        title: (d) => `Player ${d.child_id} — ${d.n_train} serves\n` +
          `Assigned group: ${d.group}\nTrue group: ${d.true_group}\n` +
          `No pooling: ${d.no_pool?.toFixed(3)}`
      })
    )
  }

  if (on('pooled')) {
    // A player sitting in a panel that is not their true group gets an open
    // dot rather than a filled one -- the visual counterpart of the lede's
    // "N of 40 keep their real group". The `mismatch` legend entry toggles the
    // distinction; with it off, everyone is drawn filled.
    const flag = on('mismatch')
    const pooledTitle = (d) => `Player ${d.child_id}\nPulled toward ${d.group} (${d.target?.toFixed(3)})\n` +
      `Estimate: ${d.pooled?.toFixed(3)}` +
      (d.matches ? '' : `\nAssigned to ${d.group}, truly ${d.true_group}`)
    // Filtered arrays are not the facet data, so each carries its own `fy`;
    // otherwise Plot repeats them in every panel (CLAUDE.md, "Charts").
    marks.push(
      Plot.dot(rows.filter((d) => d.matches || !flag), {
        x: 'pooled', y: 'rank', fy: 'group',
        r: 4, fill: armColor,
        title: pooledTitle
      }),
      Plot.dot(rows.filter((d) => !d.matches && flag), {
        x: 'pooled', y: 'rank', fy: 'group',
        r: 4, fill: 'none', stroke: armColor, strokeWidth: 1.8,
        title: pooledTitle
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.dot(rows, {
        x: 'truth', y: 'rank',
        symbol: 'times', r: 4,
        stroke: index.truth_color, strokeWidth: 2,
        title: (d) => `Player ${d.child_id}\nTruth: ${d.truth?.toFixed(3)}`
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 118,
    marginRight: 16,
    marginTop: 6,
    marginBottom: 40,
    x: {
      label: xLabel,
      domain: scale === 'theta' ? index.domains.theta : [0, 1],
      grid: true
    },
    y: { type: 'linear', domain: [widest + 0.6, 0.4], axis: null, label: null },
    fy: { domain: groups, label: null, axis: 'left' },
    facet: { data: rows, y: 'group' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}
