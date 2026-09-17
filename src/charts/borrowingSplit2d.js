import * as Plot from '@observablehq/plot'
import { zip, plogis } from '../lib/transforms.js'
import { ellipseRows, toScale } from '../lib/ellipse.js'
import { keepBands } from '../lib/bandFilter.js'

/**
 * Where each player gets pulled TO in the skill plane, once the model knows a
 * grouping.
 *
 * One panel per ASSIGNED analysis group. Each panel has its own target -- a
 * diamond with a cross of 90% error bars -- and every player in it is pulled
 * toward that diamond from their own no-pooling estimate. The global target a
 * covariate-free model would have used stays as a faint blue crosshair in
 * every panel, so the reader can see how far the group means sit from it, and
 * the group's TRUE mean sits alongside as a green dashed crosshair -- a
 * crosshair, not an ×, so it cannot be mistaken for a player's truth -- so the
 * model's error about the group is visible separately from its error about
 * any player.
 *
 * Every mark here carries its own data, so every mark sets `fx`; without it
 * Plot repeats the mark in every panel (CLAUDE.md, "Charts").
 *
 * `bands` is the reader's filter on observation count: an array of n_train
 * values to draw, or null for everyone. Panels and targets are the model's,
 * so they stay even when a panel is emptied.
 */
export function borrowingSplit2d ({
  scenario, index, tokens, armId, scale, difficulty, view = 'point',
  layers = {}, bands = null, width = 760, height = 520
}) {
  const on = (id) => layers[id] !== false
  const arm = scenario.arms?.[armId]
  const cov = scenario.analysis_covariates?.[armId]
  if (!arm || !cov) return Plot.plot({ width, height: 60, marks: [] })

  const at = (x, y) => toScale({ x, y }, scale, difficulty)
  const at1 = (v) => (v == null ? null : scale === 'theta' ? v : plogis(v - difficulty))

  const noPool = new Map(zip(scenario.arms.no_pool?.players2d).map((d) => [d.child_id, d]))
  const pooled = new Map(zip(arm.players2d).map((d) => [d.child_id, d]))
  const targets = new Map(zip(arm.borrowing_targets2d).map((t) => [t.child_id, t]))
  const truth = zip(scenario.truth)
  const groups = cov.levels
  const groupOf = (childId) => groups[cov.group[childId - 1] - 1]

  const pt = (x, y) => `(${x?.toFixed(2)}, ${y?.toFixed(2)})`

  // Every player, before the reader's band filter: the group targets are read
  // from here, so hiding a band never removes a panel's diamond.
  const allRows = truth.map((t) => {
    const np = noPool.get(t.child_id)
    const pp = pooled.get(t.child_id)
    const npP = np ? at(np.mean1, np.mean2) : null
    const ppP = pp ? at(pp.mean1, pp.mean2) : null
    const tP = at(t.theta1_true, t.theta2_true)
    const group = groupOf(t.child_id)
    return {
      child_id: t.child_id,
      group,
      true_group: t.true_group,
      n_train: t.n_train,
      np1: npP?.x, np2: npP?.y,
      pp1: ppP?.x, pp2: ppP?.y,
      t1: tP.x, t2: tP.y,
      // Whether the model's grouping matches reality; false for about half the
      // players under a scrambled covariate, which is the contrast's point.
      matches: t.true_group === group
    }
  })
  const rows = keepBands(allRows, bands)

  // One row per panel: the group's estimated target with its 90% cross, and
  // its true mean. The true mean per analysis level is composition weighted --
  // for a scrambled grouping it is the mean ability of whoever landed there.
  const trueMeanOf = (k) => new Map(
    zip(scenario.skills?.[k]?.derived?.group_means_estimated?.[armId] ?? {})
      .map((r) => [r.analysis_group, r.true_theta_mean])
  )
  const true1 = trueMeanOf(0)
  const true2 = trueMeanOf(1)
  const groupRows = groups.map((g, gi) => {
    // The target is per player but identical within a group; take the first.
    const member = allRows.find((r) => r.group === g)
    const t = member ? targets.get(member.child_id) : null
    const m1 = true1.get(g) ?? true1.get(gi + 1)
    const m2 = true2.get(g) ?? true2.get(gi + 1)
    return {
      group: g,
      target1: at1(t?.target1), target2: at1(t?.target2),
      low1: at1(t?.low1), high1: at1(t?.high1),
      low2: at1(t?.low2), high2: at1(t?.high2),
      true1: at1(m1), true2: at1(m2)
    }
  })
  const targetRows = groupRows.filter((d) => d.target1 != null && d.target2 != null)
  const trueRows = groupRows.filter((d) => d.true1 != null && d.true2 != null)

  // The one target a covariate-free model would have used, drawn in every panel
  // for contrast -- explicitly, one row per panel.
  const gt = scenario.arms.none?.borrowing_targets2d
  const globalRows = gt && gt.target1?.length
    ? groups.map((g) => ({ group: g, ...at(gt.target1[0], gt.target2[0]) }))
    : []

  const armColor = tokens.get(armId)?.color ?? '#cc79a7'
  const labels = scenario.skill_labels ?? ['Skill 1', 'Skill 2']
  const axisLabel = (k) => (scale === 'theta'
    ? `${labels[k]} ability θ${k === 0 ? '₁' : '₂'}`
    : `${labels[k]} return probability at d* = ${difficulty.toFixed(2)}`)
  const domain = scale === 'theta' ? index.domains.theta2d : [0, 1]

  const marks = [
    Plot.frame({ stroke: '#e6e6e6' })
  ]

  if (globalRows.length && on('global_target')) {
    const color = tokens.get('none')?.color ?? '#56b4e9'
    marks.push(
      Plot.ruleX(globalRows, { x: 'x', fx: 'group', stroke: color, strokeWidth: 1.2, strokeDasharray: '3 3', strokeOpacity: 0.7 }),
      Plot.ruleY(globalRows, { y: 'y', fx: 'group', stroke: color, strokeWidth: 1.2, strokeDasharray: '3 3', strokeOpacity: 0.7 })
    )
  }

  if (view === 'posterior') {
    const ellipsesOf = (players) => {
      const out = []
      for (const r of rows) {
        const shape = players.get(r.child_id)
        if (!shape) continue
        out.push(...ellipseRows(shape, { id: r.child_id, facet: r.group, p: 0.5, scale, difficulty }))
      }
      return out
    }
    if (on('no_pool')) {
      marks.push(
        Plot.line(ellipsesOf(noPool), {
          x: 'x', y: 'y', z: 'id', fx: 'facet',
          stroke: tokens.get('no_pool').color, strokeWidth: 1.2, strokeOpacity: 0.7, fill: 'none'
        })
      )
    }
    if (on('pooled')) {
      marks.push(
        Plot.line(ellipsesOf(pooled), {
          x: 'x', y: 'y', z: 'id', fx: 'facet',
          stroke: armColor, strokeWidth: 1.4, fill: armColor, fillOpacity: 0.1
        })
      )
    }
  }

  // The pull itself only means anything when both ends of it are on the chart.
  // An arrow, as in the ellipse chart, so the direction reads without the dots.
  if (on('no_pool') && on('pooled')) {
    marks.push(
      Plot.arrow(rows.filter((d) => d.np1 != null && d.pp1 != null), {
        x1: 'np1', y1: 'np2', x2: 'pp1', y2: 'pp2', fx: 'group',
        stroke: '#9ca3af', strokeWidth: 1.4,
        headLength: 5, insetEnd: 3
      })
    )
  }

  if (trueRows.length && on('true_group_mean')) {
    // Two dashed rules through the group's true mean, one per skill, so it
    // reads as a reference line like its 1D counterpart and not as a player.
    const trueTitle = (d) => `${d.group}: true mean ability ${pt(d.true1, d.true2)}`
    marks.push(
      Plot.ruleX(trueRows, {
        x: 'true1', fx: 'group',
        stroke: index.truth_color, strokeWidth: 1.5, strokeDasharray: '2 3', title: trueTitle
      }),
      Plot.ruleY(trueRows, {
        y: 'true2', fx: 'group',
        stroke: index.truth_color, strokeWidth: 1.5, strokeDasharray: '2 3', title: trueTitle
      })
    )
  }

  if (targetRows.length && on('targets')) {
    marks.push(
      // A cross of 90% error bars through the target: the model's uncertainty
      // about the group mean, per skill.
      Plot.link(targetRows, {
        x1: 'low1', x2: 'high1', y1: 'target2', y2: 'target2', fx: 'group',
        stroke: armColor, strokeWidth: 1.5, strokeOpacity: 0.8
      }),
      Plot.link(targetRows, {
        x1: 'target1', x2: 'target1', y1: 'low2', y2: 'high2', fx: 'group',
        stroke: armColor, strokeWidth: 1.5, strokeOpacity: 0.8
      }),
      Plot.dot(targetRows, {
        x: 'target1', y: 'target2', fx: 'group',
        symbol: 'diamond', r: 6.5, fill: armColor, stroke: '#fff', strokeWidth: 1,
        title: (d) => `${d.group}: pulled toward ${pt(d.target1, d.target2)}`
      })
    )
  }

  if (on('no_pool')) {
    marks.push(
      Plot.dot(rows, {
        x: 'np1', y: 'np2', fx: 'group',
        r: 4, fill: 'none', stroke: tokens.get('no_pool').color, strokeWidth: 1.6,
        title: (d) => `Player ${d.child_id} — ${d.n_train} plays\n` +
          `Assigned group: ${d.group}\nTrue group: ${d.true_group}\n` +
          `No pooling: ${pt(d.np1, d.np2)}`
      })
    )
  }

  if (on('pooled')) {
    // A player sitting in a panel that is not their true group gets an open
    // dot rather than a filled one -- the visual counterpart of the lede's
    // "N of 40 keep their real group". The `mismatch` legend entry toggles the
    // distinction; with it off, everyone is drawn filled.
    const flag = on('mismatch')
    const pooledTitle = (d) => `Player ${d.child_id}\nPulled toward ${d.group}\n` +
      `Estimate: ${pt(d.pp1, d.pp2)}` +
      (d.matches ? '' : `\nAssigned to ${d.group}, truly ${d.true_group}`)
    marks.push(
      Plot.dot(rows.filter((d) => d.matches || !flag), {
        x: 'pp1', y: 'pp2', fx: 'group',
        r: 4, fill: armColor,
        title: pooledTitle
      }),
      Plot.dot(rows.filter((d) => !d.matches && flag), {
        x: 'pp1', y: 'pp2', fx: 'group',
        r: 4, fill: 'none', stroke: armColor, strokeWidth: 1.8,
        title: pooledTitle
      })
    )
  }

  if (on('truth')) {
    marks.push(
      Plot.dot(rows, {
        x: 't1', y: 't2', fx: 'group',
        symbol: 'times', r: 4, stroke: index.truth_color, strokeWidth: 2,
        title: (d) => `Player ${d.child_id}\nTruth: ${pt(d.t1, d.t2)}`
      })
    )
  }

  // Player numbers, off by default, in the mark's own colour beside the truth
  // and beside the estimate: matching numbers tie a × to its point, which
  // nothing else in the plane does (see playerEllipses).
  if (on('labels')) {
    const text = {
      text: (d) => String(d.child_id), fx: 'group',
      fontSize: 9, fontWeight: 600, textAnchor: 'start', dx: 6, dy: -5,
      pointerEvents: 'none'
    }
    if (on('pooled')) {
      marks.push(Plot.text(rows.filter((d) => d.pp1 != null), { x: 'pp1', y: 'pp2', fill: armColor, ...text }))
    } else if (on('no_pool')) {
      marks.push(Plot.text(rows.filter((d) => d.np1 != null), { x: 'np1', y: 'np2', fill: tokens.get('no_pool').color, ...text }))
    }
    if (on('truth')) {
      marks.push(Plot.text(rows, { x: 't1', y: 't2', fill: index.truth_color, ...text }))
    }
  }

  // Near-square panels: the facet band (d3 paddingInner 0.1) gives each panel
  // 0.9·W/(G − 0.1) of the inner width; ask for that much height, capped.
  const marginLeft = 56; const marginRight = 16; const marginTop = 28; const marginBottom = 40
  const panelWidth = (0.9 * (width - marginLeft - marginRight)) / (groups.length - 0.1)
  const figureHeight = Math.round(Math.min(height, panelWidth + marginTop + marginBottom))

  return Plot.plot({
    width,
    height: figureHeight,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    x: { label: axisLabel(0), domain, grid: true },
    y: { label: axisLabel(1), domain, grid: true },
    fx: { domain: groups, label: null, axis: 'top' },
    facet: { data: rows, x: 'group' },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}
