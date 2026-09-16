import * as Plot from '@observablehq/plot'
import { zip } from '../lib/transforms.js'
import { ellipseRows, mixtureCovariance } from '../lib/ellipse.js'

/**
 * The team in the skill plane: the population they were drawn from, and the
 * players themselves.
 *
 * Each group is a bivariate normal with the shared within-group covariance, so
 * it is drawn as two nested highest-density ellipses (50% and 90%) filled with
 * the group colour. The marginal mixture -- what a model with no covariate
 * sees -- is outlined once, dashed, around the lot. Where the 1D chart stacked
 * component densities up to the mixture envelope, here the group ellipses sit
 * inside the marginal one: the same decomposition, in the plane.
 *
 * Always on the θ scale: this chart is about the simulation, not the fit.
 */
export function populationContours ({
  scenario, index, layers = {}, selectedPlayer, onSelect, width = 760, height = 480
}) {
  const on = (id) => layers[id] !== false
  const groups = zip(scenario.population.groups)
  const sigma = scenario.population.sigma
  const players = zip(scenario.truth)
  const hasGroups = groups.length > 1
  const showGroups = hasGroups && on('groups')

  // The 1D chart lays players out in rows by how often they were watched. The
  // plane has no spare axis for that, so the information band goes into the
  // dot size instead: one step per distinct count, 2.5 px for the least
  // watched. Without it the plot would drop the one variable this section is
  // about.
  const bands = [...new Set(players.map((p) => p.n_train))].sort((a, b) => a - b)
  const radiusFor = (n) => 2.5 + 1.2 * bands.indexOf(n)

  const shapeOf = (g) => ({ mean1: g.theta_mean_1, mean2: g.theta_mean_2, ...sigma })
  const marginal = mixtureCovariance(groups, sigma)
  const levels = [
    { p: 0.9, fillOpacity: 0.10 },
    { p: 0.5, fillOpacity: 0.18 }
  ]

  const marks = [
    Plot.frame({ stroke: '#e6e6e6' })
  ]

  // Filled regions. The line mark closes each polygon (the first vertex is
  // repeated last) and takes a fill, which is what makes it a region rather
  // than a ring. Outer level first so the inner one stacks darker on top.
  if (showGroups) {
    for (const level of levels) {
      const rows = groups.flatMap((g) => ellipseRows(shapeOf(g), {
        id: `${g.group}-${level.p}`, p: level.p, group: g.group
      }))
      marks.push(
        Plot.line(rows, {
          x: 'x', y: 'y', z: 'id',
          fill: 'group', fillOpacity: level.fillOpacity,
          stroke: 'group', strokeWidth: 1, strokeOpacity: 0.55
        })
      )
    }
  } else {
    // One population, or the groups switched off: the marginal alone, in the
    // same neutral the 1D density uses.
    for (const level of levels) {
      marks.push(
        Plot.line(ellipseRows(marginal, { id: `marginal-${level.p}`, p: level.p }), {
          x: 'x', y: 'y', z: 'id',
          fill: '#dbe4ec', fillOpacity: level.p === 0.5 ? 0.9 : 0.5,
          stroke: '#cbd5e1', strokeWidth: 1
        })
      )
    }
  }

  if (on('outline')) {
    marks.push(
      Plot.line(ellipseRows(marginal, { id: 'marginal-outline', p: 0.9 }), {
        x: 'x', y: 'y', z: 'id',
        fill: 'none', stroke: '#475569', strokeWidth: 1.6, strokeDasharray: '5 4'
      })
    )
  }

  if (showGroups && on('group_means')) {
    marks.push(
      Plot.dot(groups, {
        x: 'theta_mean_1', y: 'theta_mean_2',
        symbol: 'diamond', r: 5.5, fill: 'group', stroke: '#fff', strokeWidth: 1,
        title: (g) => `${g.group}: mean ability (${g.theta_mean_1.toFixed(2)}, ${g.theta_mean_2.toFixed(2)})`
      }),
      Plot.text(groups, {
        x: 'theta_mean_1', y: 'theta_mean_2',
        text: 'group', fill: 'group',
        dy: -12, fontWeight: 600, fontSize: 11
      })
    )
  }

  if (on('players')) {
    marks.push(
      Plot.dot(players, {
        x: 'theta1_true', y: 'theta2_true',
        r: (d) => radiusFor(d.n_train),
        fill: showGroups ? 'true_group' : '#64748b',
        fillOpacity: 0.8,
        stroke: (d) => (d.child_id === selectedPlayer ? '#111' : 'none'),
        strokeWidth: 1.5,
        title: (d) => `Player ${d.child_id}\n${d.n_train} training plays\n` +
          `True ability (${d.theta1_true.toFixed(2)}, ${d.theta2_true.toFixed(2)})` +
          (hasGroups ? `\nGroup: ${d.true_group}` : '')
      })
    )
  }

  const labels = scenario.skill_labels ?? ['Skill 1', 'Skill 2']
  const domain = index.domains.theta2d

  const figure = Plot.plot({
    ...squareBox({ width, height, marginLeft: 56, marginRight: 18, marginTop: 12, marginBottom: 42 }),
    x: { label: `${labels[0]} ability θ₁`, domain, grid: true },
    y: { label: `${labels[1]} ability θ₂`, domain, grid: true },
    // A function-valued r goes through Plot's sqrt radius scale by default,
    // which would squash the four band sizes together; radiusFor already
    // returns pixels.
    r: { type: 'identity' },
    color: {
      domain: groups.map((g) => g.group),
      // Okabe-Ito, matched to the arm palette so group identity never collides
      // with model identity.
      range: ['#0072b2', '#d55e00', '#cc79a7'],
      legend: false
    },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })

  if (onSelect) {
    figure.addEventListener('click', (event) => {
      const title = event.target?.querySelector?.('title')?.textContent
      const match = title?.match(/Player (\d+)/)
      if (match) onSelect(Number(match[1]))
    })
    figure.style.cursor = 'pointer'
  }

  return figure
}

/** Square plot area centred in the requested box; see playerEllipses.js. */
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
