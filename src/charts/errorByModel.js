import * as Plot from '@observablehq/plot'

/**
 * Accuracy against the simulated truth, every team at once.
 *
 * Five teams by five models drawn as individual lines was unreadable -- twenty
 * five overlapping paths. Each model is now a mean line with a shaded band
 * covering the range across teams, which carries the same information (how much
 * a single team's conclusion is worth) in a fraction of the ink.
 *
 * Labels live in an external legend rather than at the end of each line: model
 * names collide whenever two models score similarly, which is exactly when the
 * reader most needs to tell them apart.
 *
 * `rows` is one record per (team, arm, band): {team, arm, label, n_train, value}.
 * With `facet` set to a row field (the two-skill story passes 'skill'), the
 * chart is split into one panel per value of that field and the summary is
 * taken per (arm, band, facet value). Every mark carries the facet channel:
 * a mark with its own data is otherwise drawn in every panel.
 *
 * `unit` names one training datum on the axis and in the tooltip: 'serves'
 * in one skill, 'plays' in two (skill 2 is reception, so "serves" is wrong).
 *
 * The two covariate arms share one colour in the design tokens and are told
 * apart there by symbol: filled diamond for the correct covariate, open for
 * the scrambled one. A line has no symbol, so the open-diamond arm gets the
 * line equivalent -- dashed, with open dots. `isDashedArm` is exported so the
 * legend the section builds can show the same swatch.
 */
export const isDashedArm = (arm) => arm.id === 'wrong'

export function errorByModel ({
  rows, metric, scale, arms, layers = {}, facet = null, unit = 'serves', width = 760, height = 400
}) {
  const on = (id) => layers[id] !== false
  // Hiding a model rescales the y axis, which is the point: complete pooling's
  // error is several times the others and flattens them against the floor.
  const visible = arms.filter((a) => on(a.id))
  if (!visible.length) return Plot.plot({ width, height: 80, marks: [] })

  const armIds = visible.map((a) => a.id)
  const dashedIds = new Set(visible.filter(isDashedArm).map((a) => a.id))
  rows = rows.filter((r) => armIds.includes(r.arm))
  const bands = [...new Set(rows.map((r) => r.n_train))].sort((a, b) => a - b)
  const facets = facet ? [...new Set(rows.map((r) => r[facet]))] : [null]
  const colorFor = new Map(visible.map((a) => [a.id, a.color]))
  const labelFor = new Map(visible.map((a) => [a.id, a.label]))

  const summary = []
  for (const id of armIds) {
    for (const n of bands) {
      for (const f of facets) {
        const values = rows
          .filter((r) => r.arm === id && r.n_train === n && (!facet || r[facet] === f))
          .map((r) => r.value)
        if (!values.length) continue
        summary.push({
          arm: id,
          label: labelFor.get(id),
          n_train: n,
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          lo: Math.min(...values),
          hi: Math.max(...values),
          teams: values.length,
          ...(facet ? { [facet]: f } : {})
        })
      }
    }
  }

  const metricLabel = metric === 'rmse' ? 'RMSE' : 'Mean absolute error'
  const errorUnit = scale === 'theta' ? 'ability units' : 'probability'
  const fx = facet ? { fx: facet } : {}
  const solid = summary.filter((d) => !dashedIds.has(d.arm))
  const dashed = summary.filter((d) => dashedIds.has(d.arm))
  const title = (d) => `${d.label}${facet ? ` — ${d[facet]}` : ''}\n${d.n_train} ${unit} per player\n` +
    `${metricLabel}: ${d.mean.toFixed(4)}\n` +
    `across ${d.teams} teams: ${d.lo.toFixed(4)} to ${d.hi.toFixed(4)}`
  const lineOf = (data, extra = {}) => Plot.line(data, {
    x: 'n_train', y: 'mean', z: 'arm', stroke: 'arm', strokeWidth: 2.5, curve: 'monotone-x', ...fx, ...extra
  })

  return Plot.plot({
    width,
    height,
    marginLeft: 68,
    marginRight: 20,
    marginTop: 14,
    marginBottom: 46,
    x: {
      label: `Training ${unit} per player`,
      type: 'point',
      domain: bands,
      grid: true
    },
    y: {
      label: `${metricLabel} against truth (${errorUnit})`,
      zero: true,
      grid: true,
      nice: true
    },
    color: {
      domain: armIds,
      range: armIds.map((id) => colorFor.get(id)),
      legend: false
    },
    ...(facet ? { facet: { data: summary, x: facet }, fx: { label: null, domain: facets } } : {}),
    style: { fontSize: '12px', background: 'transparent' },
    marks: [
      Plot.frame({ stroke: '#e6e6e6' }),
      // Range across teams: how much the answer moves between random draws.
      ...(on('range') ? [Plot.areaY(summary, {
        x: 'n_train',
        y1: 'lo',
        y2: 'hi',
        z: 'arm',
        fill: 'arm',
        fillOpacity: 0.13,
        curve: 'monotone-x',
        ...fx
      })] : []),
      // Mean across teams: solid with filled dots, except the scrambled
      // covariate, which shares the correct covariate's colour and is dashed
      // with open dots so the two can be told apart without hovering.
      ...(solid.length ? [
        lineOf(solid),
        Plot.dot(solid, { x: 'n_train', y: 'mean', fill: 'arm', r: 4, ...fx, title })
      ] : []),
      ...(dashed.length ? [
        lineOf(dashed, { strokeDasharray: '5 3' }),
        Plot.dot(dashed, {
          x: 'n_train', y: 'mean', fill: 'none', stroke: 'arm', strokeWidth: 1.8, r: 4, ...fx, title
        })
      ] : [])
    ]
  })
}
