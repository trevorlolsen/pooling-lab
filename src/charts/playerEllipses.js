import * as Plot from '@observablehq/plot'
import { zip } from '../lib/transforms.js'
import { ellipseRows, toScale } from '../lib/ellipse.js'
import { keepBands } from '../lib/bandFilter.js'

/**
 * The 2D flagship: every player as a point in the skill plane, and where each
 * model puts them.
 *
 * The arrow from the no-pooling estimate to the partial-pooling estimate IS the
 * shrinkage, now with a direction in two dimensions -- a player can be pulled
 * along one skill and barely at all along the other. In the posterior view the
 * 50% highest-density ellipse shows why: a tilted, wide ellipse is a posterior
 * that borrows across skills as well as across players.
 *
 * Step gating matches playerRows.js so the two flagships can share a scroll:
 *   0  no pooling alone
 *   1  + complete pooling (one diamond, every player shares it)
 *   2  + partial pooling, arrows
 *   3  + band emphasis (the sparsest band stays lit, the rest dim)
 *   4  + truth and the true population mean
 *
 * `bands` is the reader's filter on observation count: an array of n_train
 * values to draw, or null for everyone.
 */
export function playerEllipses ({
  scenario, index, tokens, scale, difficulty, step = 4, view = 'point',
  layers = {}, bands = null, selectedPlayer, onSelect, width = 760, height = 560
}) {
  const on = (id, atStep = 0) => layers[id] !== false && step >= atStep
  const at = (x, y) => toScale({ x, y }, scale, difficulty)

  const noPool = new Map(zip(scenario.arms.no_pool?.players2d).map((d) => [d.child_id, d]))
  const partial = new Map(zip(scenario.arms.none?.players2d).map((d) => [d.child_id, d]))
  const complete = zip(scenario.arms.complete?.players2d)[0] ?? null
  const truth = keepBands(zip(scenario.truth), bands)

  // Complete pooling gives every player the same point; draw it once.
  const completePoint = complete ? at(complete.mean1, complete.mean2) : null
  const [o1, o2] = scenario.population.overall_mean ?? []
  const trueMean = o1 != null ? at(o1, o2) : null

  const rows = truth.map((t) => {
    const np = noPool.get(t.child_id)
    const pp = partial.get(t.child_id)
    const npP = np ? at(np.mean1, np.mean2) : null
    const ppP = pp ? at(pp.mean1, pp.mean2) : null
    const tP = at(t.theta1_true, t.theta2_true)
    return {
      child_id: t.child_id,
      n_train: t.n_train,
      // 2D-only chart: skill 2 is not a serve, so the unit is "plays".
      band: `${t.n_train} plays`,
      np1: npP?.x, np2: npP?.y,
      pp1: ppP?.x, pp2: ppP?.y,
      t1: tP.x, t2: tP.y,
      shrinkage: npP && ppP ? Math.hypot(ppP.x - npP.x, ppP.y - npP.y) : 0,
      selected: t.child_id === selectedPlayer
    }
  })

  const bandLabels = [...new Set(rows.map((d) => d.band))]
    .sort((a, b) => parseInt(a) - parseInt(b))
  // Step 3 lights the sparsest band SHOWN and dims the rest.
  const emphasisBand = step === 3 ? bandLabels[0] : null
  const dim = (d) => (emphasisBand && d.band !== emphasisBand ? 0.18 : 1)

  const pt = (x, y) => `(${x?.toFixed(2)}, ${y?.toFixed(2)})`
  const labels = scenario.skill_labels ?? ['Skill 1', 'Skill 2']
  const axisLabel = (k) => (scale === 'theta'
    ? `${labels[k]} ability θ${k === 0 ? '₁' : '₂'}`
    : `${labels[k]} return probability at d* = ${difficulty.toFixed(2)}`)
  const domain = scale === 'theta' ? index.domains.theta2d : [0, 1]

  const marks = [
    Plot.frame({ stroke: '#e6e6e6' })
  ]

  if (on('complete', 1) && completePoint) {
    const color = tokens.get('complete').color
    marks.push(
      Plot.ruleX([completePoint.x], { stroke: color, strokeWidth: 1.2, strokeDasharray: '4 3', strokeOpacity: 0.8 }),
      Plot.ruleY([completePoint.y], { stroke: color, strokeWidth: 1.2, strokeDasharray: '4 3', strokeOpacity: 0.8 }),
      Plot.dot([completePoint], {
        x: 'x', y: 'y', symbol: 'diamond', r: 6, fill: color,
        title: () => `Complete pooling: every player at ${pt(completePoint.x, completePoint.y)}`
      })
    )
  }

  if (trueMean && on('true_mean', 4)) {
    marks.push(
      Plot.ruleX([trueMean.x], { stroke: index.truth_color, strokeWidth: 1.5, strokeDasharray: '2 3' }),
      Plot.ruleY([trueMean.y], { stroke: index.truth_color, strokeWidth: 1.5, strokeDasharray: '2 3' })
    )
  }

  if (view === 'posterior') {
    // One closed polygon per player, keyed by id so Plot draws forty ellipses
    // rather than one path wandering through all of them.
    const ellipsesOf = (players) => {
      const out = []
      for (const r of rows) {
        const shape = players.get(r.child_id)
        if (!shape) continue
        out.push(...ellipseRows(shape, { id: r.child_id, p: 0.5, scale, difficulty, band: r.band }))
      }
      return out
    }
    if (on('no_pool')) {
      marks.push(
        Plot.line(ellipsesOf(noPool), {
          x: 'x', y: 'y', z: 'id',
          stroke: tokens.get('no_pool').color, strokeWidth: 1.2, strokeOpacity: 0.7,
          fill: 'none', opacity: dim
        })
      )
    }
    if (on('partial', 2)) {
      marks.push(
        Plot.line(ellipsesOf(partial), {
          x: 'x', y: 'y', z: 'id',
          stroke: tokens.get('none').color, strokeWidth: 1.4,
          fill: tokens.get('none').color, fillOpacity: 0.1, opacity: dim
        })
      )
    }
  }

  if (on('partial', 2)) {
    marks.push(
      Plot.arrow(rows.filter((d) => d.np1 != null && d.pp1 != null), {
        x1: 'np1', y1: 'np2', x2: 'pp1', y2: 'pp2',
        stroke: '#9ca3af', strokeWidth: 1.4,
        headLength: 5, insetEnd: 3,
        opacity: dim
      })
    )
  }

  if (on('no_pool')) {
    marks.push(
      Plot.dot(rows, {
        x: 'np1', y: 'np2',
        r: 4, fill: 'none',
        stroke: tokens.get('no_pool').color, strokeWidth: 1.6,
        opacity: dim,
        title: (d) => `Player ${d.child_id} — ${d.n_train} plays\nNo pooling: ${pt(d.np1, d.np2)}`
      })
    )
  }

  if (on('partial', 2)) {
    marks.push(
      Plot.dot(rows, {
        x: 'pp1', y: 'pp2',
        r: 4, fill: tokens.get('none').color,
        opacity: dim,
        title: (d) => `Player ${d.child_id} — ${d.n_train} plays\n` +
          `Partial pooling: ${pt(d.pp1, d.pp2)}\nMoved ${d.shrinkage.toFixed(3)}`
      })
    )
  }

  if (on('truth', 4)) {
    marks.push(
      Plot.dot(rows, {
        x: 't1', y: 't2',
        symbol: 'times', r: 4,
        stroke: index.truth_color, strokeWidth: 2,
        opacity: dim,
        title: (d) => `Player ${d.child_id} — ${d.n_train} plays\nTruth: ${pt(d.t1, d.t2)}`
      })
    )
  }

  // Player numbers, off by default: forty of them are clutter. But in the
  // plane nothing says which × is whose -- in 1D the row does that -- so the
  // number is printed in the mark's own colour beside the truth and beside the
  // estimate, and matching numbers tie the two together.
  if (on('labels')) {
    const text = {
      text: (d) => String(d.child_id),
      fontSize: 9, fontWeight: 600, textAnchor: 'start', dx: 6, dy: -5,
      opacity: dim, pointerEvents: 'none'
    }
    if (on('partial', 2)) {
      marks.push(Plot.text(rows.filter((d) => d.pp1 != null), {
        x: 'pp1', y: 'pp2', fill: tokens.get('none').color, ...text
      }))
    } else if (on('no_pool')) {
      marks.push(Plot.text(rows.filter((d) => d.np1 != null), {
        x: 'np1', y: 'np2', fill: tokens.get('no_pool').color, ...text
      }))
    }
    if (on('truth', 4)) {
      marks.push(Plot.text(rows, { x: 't1', y: 't2', fill: index.truth_color, ...text }))
    }
  }

  // Selection ring, drawn last so it sits on top. It follows the partial mean
  // once that exists, and the no-pooling mean before then. Once truth is on
  // the chart, a dotted link runs from that estimate to the player's × -- one
  // player's error, followed without labelling all forty.
  const selected = rows.filter((d) => d.selected)
  if (selected.length) {
    const showPartial = on('partial', 2)
    const ex = showPartial ? 'pp1' : 'np1'
    const ey = showPartial ? 'pp2' : 'np2'
    if (on('truth', 4)) {
      marks.push(
        Plot.link(selected.filter((d) => d[ex] != null), {
          x1: ex, y1: ey, x2: 't1', y2: 't2',
          stroke: '#111', strokeWidth: 1, strokeDasharray: '2 3'
        }),
        Plot.dot(selected, { x: 't1', y: 't2', r: 8, stroke: '#111', strokeWidth: 1, strokeDasharray: '2 2', fill: 'none' })
      )
    }
    marks.push(
      Plot.dot(selected, { x: ex, y: ey, r: 8, stroke: '#111', strokeWidth: 1.5, fill: 'none' })
    )
  }

  const figure = Plot.plot({
    ...squareBox({ width, height, marginLeft: 56, marginRight: 16, marginTop: 8, marginBottom: 40 }),
    x: { label: axisLabel(0), domain, grid: true },
    y: { label: axisLabel(1), domain, grid: true },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })

  // Click selects a player globally. Selection must work by tap, not hover.
  if (onSelect) {
    figure.addEventListener('click', (event) => {
      const target = event.target
      const title = target?.querySelector?.('title')?.textContent ??
        target?.parentNode?.querySelector?.('title')?.textContent
      const match = title?.match(/Player (\d+)/)
      if (match) onSelect(Number(match[1]))
    })
    figure.style.cursor = 'pointer'
  }

  return figure
}

/**
 * Equal units on both axes. The two skills share one domain, so a square plot
 * area is what makes a circular posterior look circular. Plot's `aspectRatio`
 * only acts when `height` is omitted (0.6.17), so the square is fitted into the
 * requested box here and centred by widening the margins.
 */
function squareBox ({ width, height, marginLeft, marginRight, marginTop, marginBottom }) {
  const inner = Math.max(120, Math.min(width - marginLeft - marginRight, height - marginTop - marginBottom))
  const dx = Math.max(0, (width - marginLeft - marginRight - inner) / 2)
  const dy = Math.max(0, (height - marginTop - marginBottom - inner) / 2)
  return {
    width,
    height,
    marginLeft: marginLeft + dx,
    marginRight: marginRight + dx,
    marginTop: marginTop + dy,
    marginBottom: marginBottom + dy
  }
}
