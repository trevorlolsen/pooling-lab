import * as Plot from '@observablehq/plot'
import { zip } from '../lib/transforms.js'

/**
 * The team: the population they were drawn from, and the players themselves.
 *
 * The mixture density is the population a reader would actually meet. The
 * component densities are drawn underneath it so a bimodal population reads as
 * two overlapping groups rather than one lumpy curve.
 *
 * Players sit on the same ability axis, jittered into rows by how many
 * observations each has -- information is a first-class variable here, not an
 * annotation.
 */
export function populationDensity ({
  scenario, index, layers = {},
  selectedPlayer, onSelect, width = 760
}) {
  const on = (id) => layers[id] !== false
  const components = zip(scenario.population.components)
  const players = zip(scenario.truth)
  const groups = zip(scenario.population.groups)
  const hasGroups = groups.length > 1
  const showGroups = on('groups')
  const showPlayers = on('players')

  const peak = Math.max(...components.map((d) => d.mixture_density))
  const bands = [...new Set(players.map((p) => p.n_train))].sort((a, b) => a - b)
  // Lay the players out below the curve, one row per information band.
  const rowFor = (n) => -peak * (0.10 + 0.085 * bands.indexOf(n))

  // component_density is weight * dnorm, and mixture_density is literally their
  // sum -- the same information at two levels. Drawing both as filled shapes
  // with their own outlines read as two unrelated layers and invited comparing
  // peak heights between them, which means nothing.
  //
  // Instead: fill each group, outline the total. The groups visibly stack up to
  // the envelope, which is what the decomposition actually says.
  const marks = []

  if (hasGroups && showGroups) {
    marks.push(
      Plot.areaY(components, {
        x: 'x',
        y: 'component_density',
        z: 'group',
        fill: 'group',
        fillOpacity: 0.28,
        curve: 'basis'
      })
    )
  } else {
    marks.push(
      Plot.areaY(components, {
        x: 'x',
        y: 'mixture_density',
        fill: '#dbe4ec',
        fillOpacity: 0.9,
        curve: 'basis'
      })
    )
  }

  if (on('outline')) {
    marks.push(
      Plot.lineY(components, {
        x: 'x',
        y: 'mixture_density',
        stroke: '#475569',
        strokeWidth: 1.6,
        curve: 'basis'
      })
    )
  }

  if (hasGroups && showGroups) {
    marks.push(
      ...(on('group_means') ? [Plot.ruleX(groups, {
        x: 'theta_mean',
        stroke: 'group',
        strokeWidth: 1.2,
        strokeOpacity: 0.65
      })] : []),
      Plot.text(groups, {
        x: 'theta_mean',
        y: () => peak * 1.04,
        text: 'group',
        fill: 'group',
        fontWeight: 600,
        fontSize: 11
      })
    )
  }

  if (showPlayers) {
    marks.push(
      Plot.dot(players, {
        x: 'theta_true',
        y: (d) => rowFor(d.n_train),
        r: 4,
        fill: hasGroups && showGroups ? 'true_group' : '#64748b',
        fillOpacity: 0.75,
        stroke: (d) => (d.child_id === selectedPlayer ? '#111' : 'none'),
        strokeWidth: 1.5,
        title: (d) => `Player ${d.child_id}\n${d.n_train} training observations\n` +
          `True ability ${d.theta_true.toFixed(2)}` +
          (hasGroups ? `\nGroup: ${d.true_group}` : '')
      }),
      // In the left margin with an end anchor: at the axis edge these collided
      // with each other and with the leftmost players.
      Plot.text(bands.map((n) => ({ n })), {
        x: () => index.domains.theta[0],
        y: (d) => rowFor(d.n),
        text: (d) => `${d.n} serves`,
        textAnchor: 'end',
        dx: -8,
        fontSize: 10,
        fill: '#6b7280'
      })
    )
  }

  marks.push(Plot.ruleY([0], { stroke: '#cbd5e1' }))

  const figure = Plot.plot({
    width,
    height: 360,
    marginLeft: 76,
    marginRight: 18,
    marginTop: 26,
    marginBottom: 42,
    x: {
      label: 'Latent ability θ',
      domain: index.domains.theta,
      grid: true
    },
    y: { label: null, ticks: [], axis: null },
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
