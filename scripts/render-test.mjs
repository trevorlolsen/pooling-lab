// Headless render check: build every chart against real data in jsdom.
//
// The smoke test proves the data contract; this proves the charts actually
// construct. Between them the only thing left for a browser is how it looks.
//
//   node scripts/render-test.mjs

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { JSDOM } from 'jsdom'

const zipCol = (columns, key) => columns[key] ?? []

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
// Node 24 ships a read-only global navigator, so plain assignment throws.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true
})
globalThis.Node = dom.window.Node
globalThis.NodeList = dom.window.NodeList
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.SVGElement = dom.window.SVGElement
globalThis.Element = dom.window.Element
globalThis.getComputedStyle = dom.window.getComputedStyle

const { populationDensity } = await import('../src/charts/populationDensity.js')
const { playerRows } = await import('../src/charts/playerRows.js')
// Observable Plot reads `document` at module scope, so every chart module has
// to be imported after the globals above are installed. bayesGrid.js is pure,
// but it rides along here so the belief block reads as one unit.
const { beliefUpdate } = await import('../src/charts/beliefUpdate.js')
const { beliefTrace } = await import('../src/charts/beliefTrace.js')
const { thetaGrid, updateSequence } = await import('../src/lib/bayesGrid.js')

const D = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const read = (p) => JSON.parse(readFileSync(join(D, p), 'utf8'))
const index = read('index.json')
const tokens = new Map(index.arms.map((a) => [a.id, a]))

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.log('  FAIL:', msg); fails++ } }
const count = (svg, sel) => svg.querySelectorAll(sel).length

// Cover one scenario per population: a one-group population and a bimodal one
// exercise different branches (no group lines, no correct arm).
for (const p of index.populations) {
  const id = p.scenario_ids[0]
  const sc = read(`scenarios/${id}.json`)

  const dens = populationDensity({ scenario: sc, index, selectedPlayer: 1, width: 720 })
  ok(dens?.tagName === 'svg' || dens?.querySelector('svg'), `${id}: density chart should render an svg`)
  const densSvg = dens.tagName === 'svg' ? dens : dens.querySelector('svg')
  ok(count(densSvg, 'circle') >= sc.n_players * 0.5,
    `${id}: density should draw the players (found ${count(densSvg, 'circle')})`)

  for (const scale of ['probability', 'theta']) {
    for (const step of [0, 2, 4]) {
      const fig = playerRows({
        scenario: sc, index, tokens, scale, difficulty: 0, step,
        selectedPlayer: 1, width: 700
      })
      const svg = fig.tagName === 'svg' ? fig : fig.querySelector('svg')
      ok(svg, `${id} ${scale} step ${step}: should render an svg`)
      const circles = count(svg, 'circle')
      ok(circles >= sc.n_players,
        `${id} ${scale} step ${step}: expected at least ${sc.n_players} markers, got ${circles}`)
      // Step 2 adds the partial-pooling dots and the shrinkage segments.
      if (step >= 2) {
        ok(count(svg, 'line, path') > 0, `${id} step ${step}: shrinkage links should be drawn`)
      }
    }
  }
  console.log(`  ${id.padEnd(28)} ok  (${sc.n_players} players, arms: ${Object.keys(sc.arms).join(',')})`)
}

// Band labels must fit in the margin they are drawn into. These sit in the left
// margin and read "30 observations"; too narrow a margin silently clips them,
// which is invisible to every other check here.
{
  const sc = read('scenarios/distinct__20260914.json')
  const fig = playerRows({
    scenario: sc, index, tokens, scale: 'probability', difficulty: 0, step: 4, width: 720
  })
  const svg = fig.tagName === 'svg' ? fig : fig.querySelector('svg')
  // Accumulate translate-x over every ancestor: Plot nests the margin offset,
  // the facet offset and the tick offset in separate <g> elements, so reading
  // only the immediate parent measures in the wrong coordinate space.
  const absoluteX = (node) => {
    let x = 0
    for (let n = node; n && n !== svg; n = n.parentNode) {
      const m = (n.getAttribute?.('transform') ?? '').match(/translate\(\s*([-\d.]+)/)
      if (m) x += Number(m[1])
    }
    return x
  }
  const inheritedAnchor = (node) => {
    for (let n = node; n && n !== svg; n = n.parentNode) {
      const a = n.getAttribute?.('text-anchor')
      if (a) return a
    }
    return 'start'
  }
  const labels = [...svg.querySelectorAll('text')]
    .map((t) => ({
      text: t.textContent,
      x: Number(t.getAttribute('x') || 0),
      shift: absoluteX(t),
      anchor: inheritedAnchor(t)
    }))
    .filter((t) => /(observations|serves|plays)$/.test(t.text))

  ok(labels.length >= 4, `expected one label per information band, found ${labels.length}`)
  for (const l of labels) {
    // ~6.2px per character at 12px Inter; generous enough to catch real clipping.
    const width = l.text.length * 6.2
    const left = l.shift + l.x - (l.anchor === 'end' ? width : 0)
    ok(left >= 0, `band label "${l.text}" is clipped (left edge ${left.toFixed(1)}px)`)
  }
  console.log(`  band labels: ${labels.length} found, leftmost edge ` +
    `${Math.min(...labels.map((l) => l.shift + l.x - (l.anchor === 'end' ? l.text.length * 6.2 : 0))).toFixed(1)}px`)
}

// Players must be positioned by their rank within their own band, not by a
// global ordering.
//
// Plot shares scales across facets, so a y domain of all 40 player ids gives
// every facet all 40 slots. Each band's ten players then bunch into one
// contiguous tenth with thirty empty slots below them -- which renders as
// clustered points and dead space, and which no other assertion here notices.
{
  const sc = read('scenarios/distinct__20260914.json')
  const fig = playerRows({
    scenario: sc, index, tokens, scale: 'probability', difficulty: 0, step: 4, width: 720
  })
  const bands = new Set(zipCol(sc.truth, 'n_train')).size
  const perBand = sc.n_players / bands
  const domain = fig.scale('y')?.domain ?? []

  // Linear, so violins can straddle a row by a continuous offset. It must still
  // span exactly one band's worth of rows -- if it spanned all 40 players, each
  // facet would use a tenth of its height and the rows would bunch.
  ok(domain.length === 2, `y scale should be continuous, got a ${domain.length}-value domain`)
  const span = Math.abs(domain[1] - domain[0])
  ok(span > perBand && span < perBand + 3,
    `y domain should span one band (~${perBand} rows), got ${span.toFixed(1)}`)
  ok(fig.scale('fy')?.domain.length === bands,
    `fy domain should hold one slot per band (${bands})`)

  // And the rows should actually use the height they are given.
  const svg = fig.tagName === 'svg' ? fig : fig.querySelector('svg')
  const cys = [...svg.querySelectorAll('circle')]
    .map((c) => Number(c.getAttribute('cy')))
    .filter((v) => Number.isFinite(v))
  const spread = new Set(cys.map((v) => v.toFixed(1))).size
  ok(spread >= perBand, `expected at least ${perBand} distinct row positions, got ${spread}`)
  console.log(`  row layout: y spans ${span.toFixed(1)} rows x ${bands} bands, ` +
    `${spread} distinct row positions`)
}

// The posterior view must draw a filled shape per player per arm, and it must
// differ from the point view. A violin is the only way to see WHY a sparse
// player shrinks further: their posterior is wider.
{
  const sc = read('scenarios/distinct__20260914.json')
  ok(Array.isArray(sc.theta_grid) && sc.theta_grid.length > 8,
    'scenario must ship a shared theta grid for the densities')
  for (const armId of Object.keys(sc.arms)) {
    const d = sc.arms[armId].player_density
    ok(Array.isArray(d) && d.length === sc.n_players,
      `arm ${armId}: one density row per player`)
    ok(d[0].length === sc.theta_grid.length,
      `arm ${armId}: density columns must match the theta grid`)
    ok(d.every((row) => row.every((v) => v >= 0)), `arm ${armId}: densities must be non-negative`)
  }

  for (const scale of ['probability', 'theta']) {
    const pointFig = playerRows({
      scenario: sc, index, tokens, scale, difficulty: 0, step: 4, view: 'point', width: 720
    })
    const postFig = playerRows({
      scenario: sc, index, tokens, scale, difficulty: 0, step: 4, view: 'posterior', width: 720
    })
    const pointSvg = pointFig.tagName === 'svg' ? pointFig : pointFig.querySelector('svg')
    const postSvg = postFig.tagName === 'svg' ? postFig : postFig.querySelector('svg')
    // Plot sets a constant fill on the parent <g>, not on each path, so count
    // paths rather than looking for a fill attribute on them.
    const paths = (svg) => svg.querySelectorAll('path').length
    ok(paths(postSvg) > paths(pointSvg) + sc.n_players,
      `${scale}: the posterior view should add a shape per player per arm ` +
      `(${paths(postSvg)} vs ${paths(pointSvg)})`)

    // Violins must be FACETED, not repeated. A mark carrying its own data is
    // drawn inside every facet unless it supplies a facet channel, which put all
    // forty players in each band and made the chart unreadable. Counting paths
    // in total cannot see that; counting per facet can.
    const bandCount = new Set(sc.truth.n_train).size
    const perBandPlayers = sc.n_players / bandCount
    // Plot nests one <g> per facet inside each mark's group, so the per-facet
    // count is the DIRECT children of those inner groups. Counting every
    // descendant instead measures the mark total and cannot tell "ten per band"
    // from "forty repeated in every band" -- which is exactly the bug that
    // shipped once already.
    const boxMarks = [...postSvg.querySelectorAll('g[aria-label="rect"]')]
    ok(boxMarks.length > 0, `${scale}: expected posterior box marks`)
    for (const mark of boxMarks) {
      const facets = [...mark.querySelectorAll(':scope > g')]
      ok(facets.length === bandCount,
        `${scale}: expected ${bandCount} facets of boxes, found ${facets.length}`)
      for (const f of facets) {
        const n = f.querySelectorAll(':scope > rect').length
        ok(n === perBandPlayers,
          `${scale}: each band should hold exactly ${perBandPlayers} boxes, found ${n}`)
      }
    }

    // A box is only informative if its quartiles are ordered and nested inside
    // the whiskers.
    const players = sc.arms.no_pool.players
    for (let i = 0; i < players.child_id.length; i++) {
      ok(players.theta_low[i] <= players.theta_q25[i] &&
         players.theta_q25[i] <= players.theta_median[i] &&
         players.theta_median[i] <= players.theta_q75[i] &&
         players.theta_q75[i] <= players.theta_high[i],
        `player ${players.child_id[i]}: box quantiles out of order`)
    }
    ok(postSvg.outerHTML !== pointSvg.outerHTML, `${scale}: the two views must differ`)
  }

  // The sparse band's posteriors must be visibly wider than the dense band's --
  // if that is not true the whole adaptive-shrinkage argument has no mechanism.
  const truth = sc.truth
  const widthOf = (j) => {
    const row = sc.arms.no_pool.player_density[j]
    const total = row.reduce((a, b) => a + b, 0)
    const mean = row.reduce((a, b, k) => a + b * sc.theta_grid[k], 0) / total
    return Math.sqrt(row.reduce((a, b, k) => a + b * (sc.theta_grid[k] - mean) ** 2, 0) / total)
  }
  const sparse = truth.child_id.filter((_, j) => truth.n_train[j] === 5).map((id) => widthOf(id - 1))
  const dense = truth.child_id.filter((_, j) => truth.n_train[j] === 30).map((id) => widthOf(id - 1))
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  ok(avg(sparse) > avg(dense) * 1.5,
    `sparse posteriors should be much wider (${avg(sparse).toFixed(3)} vs ${avg(dense).toFixed(3)})`)
  console.log(`  posterior width: n=5 players ${avg(sparse).toFixed(3)}, ` +
    `n=30 players ${avg(dense).toFixed(3)}`)
}

// Layers must actually suppress their marks, not just dim a legend entry.
{
  const sc = read('scenarios/distinct__20260914.json')
  const base = { scenario: sc, index, tokens, scale: 'probability', difficulty: 0, step: 4, width: 720 }
  const countOf = (fig, label) => {
    const svg = fig.tagName === 'svg' ? fig : fig.querySelector('svg')
    return svg.querySelectorAll(`g[aria-label="${label}"] path, g[aria-label="${label}"] circle`).length
  }
  const all = playerRows({ ...base, layers: {} })
  const dotsAll = countOf(all, 'dot')
  const noTruth = playerRows({ ...base, layers: { truth: false } })
  ok(countOf(noTruth, 'dot') < dotsAll, 'hiding truth should remove its marks')

  const onlyTruth = playerRows({
    ...base,
    layers: { complete: false, no_pool: false, partial: false, true_mean: false }
  })
  ok(countOf(onlyTruth, 'dot') < dotsAll,
    'hiding every model should leave far fewer marks')
  ok(countOf(onlyTruth, 'dot') > 0, 'truth should survive when only the models are hidden')

  // A layer that the scroll step has not reached stays hidden even when enabled.
  const earlyStep = playerRows({ ...base, step: 0, layers: {} })
  ok(countOf(earlyStep, 'dot') < dotsAll,
    'step 0 should show fewer marks than step 4 regardless of layer state')
  console.log(`  layers: all=${dotsAll} marks, truth off=${countOf(noTruth, 'dot')}, ` +
    `models off=${countOf(onlyTruth, 'dot')}, step 0=${countOf(earlyStep, 'dot')}`)
}

// A non-zero reference difficulty must move the estimates, not error.
const sc = read('scenarios/distinct__20260914.json')
const at0 = playerRows({ scenario: sc, index, tokens, scale: 'probability', difficulty: 0, step: 4, width: 700 })
const at1 = playerRows({ scenario: sc, index, tokens, scale: 'probability', difficulty: 1.2, step: 4, width: 700 })
ok(at0.outerHTML !== at1.outerHTML, 'changing d* should change the chart')

// --- belief update ------------------------------------------------------
// The section drives these modules by scroll step and by a slider, so every
// step has to construct on its own. jsdom has no IntersectionObserver, so the
// interaction harness only ever reaches step 0 -- step coverage lives here.
{
  const sc = read('scenarios/one_population__20260914.json')
  const rowsForPlayer = (o, child) => {
    const rows = []
    for (let i = 0; i < o.child_id.length; i++) if (o.child_id[i] === child) rows.push(i)
    return rows
  }
  const g = thetaGrid()
  const rows = rowsForPlayer(sc.observations, 31) // the 30-serve walk-through player
  const frames = updateSequence({ grid: g, prior: { mean: 0, sd: 2 }, observations: sc.observations, rows })

  for (const step of [0, 1, 5, 29, 30]) {
    const fig = beliefUpdate({ frames, step, domain: index.domains.theta, width: 700 })
    const svgs = fig.querySelectorAll('svg')
    ok(svgs.length === 2, `belief step ${step}: belief panel + likelihood strip (got ${svgs.length})`)
    ok(count(svgs[0], 'path') > 0, `belief step ${step}: the posterior curve should be drawn`)
    // The prior-only frame has no serve, so the likelihood strip must be empty.
    ok(count(svgs[1], 'path') === (step === 0 ? 0 : 1),
      `belief step ${step}: likelihood drawn only once a serve exists`)
  }

  // Every step must look different from the one before it.
  const html = [0, 1, 5, 29].map((s) =>
    beliefUpdate({ frames, step: s, domain: index.domains.theta, width: 700 }).outerHTML)
  ok(new Set(html).size === html.length, 'each step should redraw the belief panel')

  // The display domain must widen to hold a wide early posterior rather than clip it.
  const wide = beliefUpdate({ frames, step: 1, domain: index.domains.theta, width: 700 })
  const dom1 = wide.querySelector('svg').__domain
  ok(dom1[0] <= frames[1].summary.mean - 3 * frames[1].summary.sd,
    'an early wide posterior must not be clipped by the default theta domain')

  // Layers suppress.
  const bare = beliefUpdate({ frames, step: 10, domain: index.domains.theta, width: 700, layers: { ghosts: false } })
  const full = beliefUpdate({ frames, step: 10, domain: index.domains.theta, width: 700 })
  ok(bare.outerHTML !== full.outerHTML, 'turning off the ghost trail should change the drawing')

  const trace = beliefTrace({ frames, width: 700 })
  const tsvg = trace.tagName === 'svg' ? trace : trace.querySelector('svg')
  ok(tsvg, 'belief trace should render an svg')
  ok(/rate/i.test(tsvg.textContent), 'the trace axis should be labelled as a rate')
  const domAt = (s) => beliefUpdate({ frames, step: s, domain: index.domains.theta, width: 700 })
    .querySelector('svg').__domain
  console.log(`  belief update ok (${frames.length} frames, player 31), domain ` +
    `[${domAt(1).map((v) => v.toFixed(2)).join(', ')}] at step 1 -> ` +
    `[${domAt(30).map((v) => v.toFixed(2)).join(', ')}] at step 30`)
}

// --- the per-individual convergence sweep --------------------------------
if (existsSync(join(D, 'convergence.json'))) {
  const { convergenceTracks, convergenceShrinkage } =
    await import('../src/charts/convergence.js')
  const payload = read('convergence.json')

  ok(payload.focal.length >= 2, 'expected several focal players')
  ok(payload.steps.length >= 5, 'expected a range of observation counts')

  for (const f of payload.focal) {
    const n = f.steps.n_keep
    ok(n.length === payload.steps.length, `player ${f.focal_id}: one row per step`)
    ok(n.every((v, i) => i === 0 || v > n[i - 1]), `player ${f.focal_id}: steps ascending`)
    // The design's core promise: the SAME person throughout.
    ok(f.steps.theta_true.every((v) => v === f.theta_true),
      `player ${f.focal_id}: true ability must be constant across the sweep`)
  }

  const first = payload.steps[0]
  const last = payload.steps[payload.steps.length - 1]
  for (const f of payload.focal) {
    const at = (n) => {
      const i = f.steps.n_keep.indexOf(n)
      return { pull: Math.abs(f.steps.shrinkage[i]), sd: f.steps.no_pool_sd[i] }
    }
    const a = at(first)
    const b = at(last)
    // Own-data uncertainty is the mechanism and really is monotone.
    const sds = f.steps.no_pool_sd
    ok(sds.every((v, i) => i === 0 || v < sds[i - 1]),
      `player ${f.focal_id}: own-data uncertainty should narrow at every step`)
    // The pull is a noisy consequence of it, so only the endpoints are asserted.
    // It genuinely wanders in between and the copy says so.
    ok(b.pull < a.pull / 5,
      `player ${f.focal_id}: pull should collapse (${a.pull.toFixed(3)} -> ${b.pull.toFixed(3)})`)
  }

  const lead = [...payload.focal].sort((x, y) =>
    Math.abs(y.steps.shrinkage[0]) - Math.abs(x.steps.shrinkage[0]))[0]
  const sd = lead.steps.no_pool_sd
  console.log(`  convergence: player ${lead.focal_id} pulled ` +
    `${Math.abs(lead.steps.shrinkage[0]).toFixed(2)} at n=${first} and ` +
    `${Math.abs(lead.steps.shrinkage[sd.length - 1]).toFixed(2)} at n=${last}; ` +
    `own-data sd ${sd[0].toFixed(2)} -> ${sd[sd.length - 1].toFixed(2)}`)

  const tracks = convergenceTracks({ payload, width: 720 })
  const tsvg = tracks.tagName === 'svg' ? tracks : tracks.querySelector('svg')
  ok(tsvg, 'convergence tracks should render')
  ok(tsvg.querySelectorAll('circle').length >= payload.focal.length * payload.steps.length,
    'expected a marker per player per step')

  const bare = convergenceTracks({ payload, width: 720, layers: { no_pool: false, interval: false } })
  const bsvg = bare.tagName === 'svg' ? bare : bare.querySelector('svg')
  ok(bsvg.querySelectorAll('circle').length < tsvg.querySelectorAll('circle').length,
    'hiding a layer should remove its marks')

  const pull = convergenceShrinkage({ payload, width: 720 })
  ok(pull.tagName === 'svg' || pull.querySelector('svg'), 'shrinkage decay should render')
} else {
  console.log('  convergence: skipped, convergence.json not generated')
}

const svgOf = (fig) => (fig.tagName === 'svg' ? fig : fig.querySelector('svg'))

// --- the two-skill story ------------------------------------------------
// Every 2D chart draws its posteriors as polygons computed on the client, so
// there is more to go wrong between the JSON and the pixels than in 1D. The
// same three things are asserted as for the row chart: it constructs on both
// scales at every step, the posterior view really adds a shape per player, and
// the faceted split holds each player in ONE panel.
if (existsSync(join(D, 'scenarios-2d', 'distinct__20260914__2d.json'))) {
  const { playerEllipses } = await import('../src/charts/playerEllipses.js')
  const { populationContours } = await import('../src/charts/populationContours.js')
  const { borrowingSplit2d } = await import('../src/charts/borrowingSplit2d.js')
  const paths = (svg) => svg.querySelectorAll('path').length

  // A grouped population and the one-group one: the contour chart, the split
  // and the arms available all take different branches between them.
  const ids = ['distinct__20260914__2d', 'one_population__20260914__2d']
    .filter((id) => existsSync(join(D, 'scenarios-2d', `${id}.json`)))
  for (const id of ids) {
    const sc = read(`scenarios-2d/${id}.json`)

    // The population chart is about the simulation, not the fit: theta only.
    const cont = svgOf(populationContours({ scenario: sc, index, selectedPlayer: 1, width: 720 }))
    ok(cont, `${id}: contour chart should render an svg`)
    ok(count(cont, 'circle') >= sc.n_players,
      `${id}: contours should draw the players (found ${count(cont, 'circle')})`)
    ok(count(cont, 'g[aria-label="line"] path') >= 2,
      `${id}: contours should draw at least the two marginal levels`)

    const splitArms = ['correct', 'wrong'].filter((a) => sc.arms[a] && sc.analysis_covariates?.[a])
    ok(splitArms.includes('wrong'), `${id}: every population should carry a scrambled covariate`)

    for (const scale of ['probability', 'theta']) {
      for (const step of [0, 2, 4]) {
        const view = {}
        for (const v of ['point', 'posterior']) {
          const svg = svgOf(playerEllipses({
            scenario: sc, index, tokens, scale, difficulty: 0, step, view: v, selectedPlayer: 1, width: 720
          }))
          ok(svg, `${id} ${scale} step ${step} ${v}: should render an svg`)
          ok(count(svg, 'circle') >= sc.n_players,
            `${id} ${scale} step ${step} ${v}: expected a no-pooling dot per player, got ${count(svg, 'circle')}`)
          view[v] = svg
        }
        // The posterior view adds one closed polygon per player per arm on
        // top of everything the point view draws.
        ok(paths(view.posterior) >= paths(view.point) + sc.n_players,
          `${id} ${scale} step ${step}: the posterior view should add an ellipse per player ` +
          `(${paths(view.posterior)} vs ${paths(view.point)})`)
        ok(view.posterior.outerHTML !== view.point.outerHTML,
          `${id} ${scale} step ${step}: the two views must differ`)
      }

      for (const armId of splitArms) {
        const view = {}
        for (const v of ['point', 'posterior']) {
          const svg = svgOf(borrowingSplit2d({
            scenario: sc, index, tokens, armId, scale, difficulty: 0, view: v, width: 720
          }))
          ok(svg, `${id} ${scale} ${armId} ${v}: split should render an svg`)
          view[v] = svg
        }
        ok(paths(view.posterior) >= paths(view.point) + sc.n_players,
          `${id} ${scale} ${armId}: the posterior split should add an ellipse per player ` +
          `(${paths(view.posterior)} vs ${paths(view.point)})`)
      }
    }
    console.log(`  ${id.padEnd(28)} ok  (${sc.n_players} players, split arms: ${splitArms.join(',')})`)
  }

  // Each player must appear in exactly one panel of the split. Every mark in
  // that chart carries its own data, so every mark has to set `fx` -- drop it
  // on one and Plot repeats all forty players in every panel, which the total
  // count cannot see. As in the row chart, the per-facet count is the DIRECT
  // children of the facet <g>, never every descendant.
  {
    const sc = read('scenarios-2d/distinct__20260914__2d.json')
    const levels = sc.analysis_covariates.correct.levels
    for (const scale of ['probability', 'theta']) {
      const svg = svgOf(borrowingSplit2d({
        scenario: sc, index, tokens, armId: 'correct', scale, difficulty: 0, width: 720
      }))
      // The player dots are the dot marks drawn as circles: no pooling and the
      // pooled estimate. Truth and the targets are symbols, which are paths.
      const dotMarks = [...svg.querySelectorAll('g[aria-label="dot"]')]
        .filter((m) => m.querySelectorAll('circle').length > 0)
      ok(dotMarks.length >= 2, `${scale}: expected player dot marks in the split, found ${dotMarks.length}`)
      for (const mark of dotMarks) {
        const facets = [...mark.querySelectorAll(':scope > g')]
        ok(facets.length === levels.length,
          `${scale}: expected ${levels.length} panels of dots, found ${facets.length}`)
        const counts = facets.map((f) => f.querySelectorAll(':scope > circle').length)
        ok(counts.reduce((a, b) => a + b, 0) === sc.n_players,
          `${scale}: the panels should hold every player once (${counts.join('+')} vs ${sc.n_players})`)
        ok(counts.every((c) => c > 0 && c < sc.n_players),
          `${scale}: no panel should hold every player (${counts.join(', ')})`)
      }
      console.log(`  split panels (${scale}): ${dotMarks.length} dot marks x ${levels.length} panels, ` +
        `${[...dotMarks[0].querySelectorAll(':scope > g')].map((f) => f.querySelectorAll(':scope > circle').length).join('+')} players`)
    }
  }

  // Layers must suppress their marks, and d* must move the chart.
  {
    const sc = read('scenarios-2d/distinct__20260914__2d.json')
    const base = { scenario: sc, index, tokens, scale: 'probability', difficulty: 0, step: 4, width: 720 }
    const dots = (fig) =>
      svgOf(fig).querySelectorAll('g[aria-label="dot"] path, g[aria-label="dot"] circle').length

    const all = playerEllipses({ ...base, layers: {} })
    const noTruth = playerEllipses({ ...base, layers: { truth: false } })
    ok(dots(noTruth) < dots(all), 'ellipses: hiding truth should remove its marks')
    const splitAll = borrowingSplit2d({ ...base, armId: 'correct', layers: {} })
    const splitNoTruth = borrowingSplit2d({ ...base, armId: 'correct', layers: { truth: false } })
    ok(dots(splitNoTruth) < dots(splitAll), 'split: hiding truth should remove its marks')
    const contAll = populationContours({ scenario: sc, index, width: 720 })
    const contNoPlayers = populationContours({ scenario: sc, index, width: 720, layers: { players: false } })
    ok(dots(contNoPlayers) < dots(contAll), 'contours: hiding the players should remove their dots')

    // A layer the scroll step has not reached stays hidden even when enabled.
    const early = playerEllipses({ ...base, step: 0, layers: {} })
    ok(dots(early) < dots(all), 'ellipses: step 0 should show fewer marks than step 4')

    ok(playerEllipses({ ...base, difficulty: 1.2 }).outerHTML !== all.outerHTML,
      'ellipses: changing d* should change the chart')
    ok(borrowingSplit2d({ ...base, armId: 'correct', difficulty: 1.2 }).outerHTML !== splitAll.outerHTML,
      'split: changing d* should change the chart')
    console.log(`  2D layers: ellipses all=${dots(all)}, truth off=${dots(noTruth)}, step 0=${dots(early)}; ` +
      `split all=${dots(splitAll)}, truth off=${dots(splitNoTruth)}`)
  }
} else {
  console.log('  2D: skipped, scenarios-2d not generated')
}

// --- the per-individual convergence sweep, in two skills ---------------------
if (existsSync(join(D, 'convergence-2d.json'))) {
  const { convergenceTracks2d, convergenceArea2d } = await import('../src/charts/convergence2d.js')
  const payload = read('convergence-2d.json')

  ok(payload.dimensions === 2, 'the 2D sweep should say it is 2D')
  ok(payload.focal.length >= 2, 'expected several focal players')
  ok(payload.steps.length >= 5, 'expected a range of observation counts')

  const first = payload.steps[0]
  const last = payload.steps[payload.steps.length - 1]
  for (const f of payload.focal) {
    ok(f.skills?.length === 2, `player ${f.focal_id}: one step series per skill`)
    ok(f.joint?.n_keep?.length === payload.steps.length, `player ${f.focal_id}: one joint row per step`)
    ok(Array.isArray(f.theta_true) && f.theta_true.length === 2,
      `player ${f.focal_id}: true ability should be a pair`)
    // The joint block is a covariance at every step, or the ellipse is not one.
    const j = f.joint
    ok(j.no_pool_var1.every((v, i) => v * j.no_pool_var2[i] - j.no_pool_cov12[i] ** 2 >= -1e-9) &&
       j.partial_var1.every((v, i) => v * j.partial_var2[i] - j.partial_cov12[i] ** 2 >= -1e-9),
    `player ${f.focal_id}: joint covariances must be positive semi-definite`)

    for (const [k, skill] of f.skills.entries()) {
      const s = skill.steps
      ok(s.n_keep.length === payload.steps.length, `player ${f.focal_id} skill ${k + 1}: one row per step`)
      // Same assertions as the 1D sweep, per skill: own-data uncertainty is
      // the mechanism and really is monotone; the pull is its noisy
      // consequence, so only the endpoints are held to anything.
      const sds = s.no_pool_sd
      ok(sds.every((v, i) => i === 0 || v < sds[i - 1]),
        `player ${f.focal_id} skill ${k + 1}: own-data uncertainty should narrow at every step`)
      const a = Math.abs(s.shrinkage[s.n_keep.indexOf(first)])
      const b = Math.abs(s.shrinkage[s.n_keep.indexOf(last)])
      ok(b < a / 5,
        `player ${f.focal_id} skill ${k + 1}: pull should collapse (${a.toFixed(3)} -> ${b.toFixed(3)})`)
    }
  }

  const tracks = svgOf(convergenceTracks2d({ payload, width: 720 }))
  ok(tracks, '2D convergence tracks should render')
  // One ellipse per cell per arm: a line mark per arm, a facet per cell, one
  // closed path in each. Counting per facet is what catches a mark that lost
  // its facet channel and drew every cell's ellipse in every cell.
  const cells = payload.steps.length * payload.focal.length
  const ellipseMarks = [...tracks.querySelectorAll('g[aria-label="line"]')]
  ok(ellipseMarks.length === 2, `expected an ellipse mark per arm, found ${ellipseMarks.length}`)
  for (const mark of ellipseMarks) {
    const facets = [...mark.querySelectorAll(':scope > g')]
    ok(facets.length === cells, `expected ${cells} cells of ellipses, found ${facets.length}`)
    ok(facets.every((f) => f.querySelectorAll(':scope > path').length === 1),
      'each cell should hold exactly one ellipse per arm')
  }
  const bare = svgOf(convergenceTracks2d({ payload, width: 720, layers: { no_pool: false } }))
  ok(bare.querySelectorAll('g[aria-label="line"]').length < ellipseMarks.length,
    'hiding an arm should remove its ellipses')

  const area = svgOf(convergenceArea2d({ payload, width: 720 }))
  ok(area, '2D convergence area should render')
  ok(count(area, 'g[aria-label="line"] path') === 2 * payload.focal.length,
    `area chart should draw one line per player per arm (found ${count(area, 'g[aria-label="line"] path')})`)
  console.log(`  convergence 2D: ${payload.focal.length} players x ${payload.steps.length} steps, ` +
    `${cells} cells x ${ellipseMarks.length} arms of ellipses`)
} else {
  console.log('  convergence 2D: skipped, convergence-2d.json not generated')
}

// --- the team sweep --------------------------------------------------------
if (existsSync(join(D, 'team-sweep.json')) && existsSync(join(D, 'team-coverage.json'))) {
  const { sweepWidths, sweepRidges, orderedTeams, coverageCurves } =
    await import('../src/charts/teamSweep.js')
  const sweep = read('team-sweep.json')
  const coverage = read('team-coverage.json')
  const walk = coverage.walk_through_seed ?? sweep.seed

  const bySc = {}
  for (const scale of ['probability', 'theta']) {
    const charts = {
      widths: sweepWidths({ sweep, coverage, scale, width: 720 }),
      ridges: sweepRidges({ sweep, scale, width: 720 }),
      teams: orderedTeams({ coverage, walkThroughSeed: walk, scale, width: 720 }),
      coverage: coverageCurves({ coverage, width: 720 })
    }
    for (const [name, fig] of Object.entries(charts)) {
      ok(svgOf(fig), `${name} (${scale}): should render an svg`)
    }
    // Three tracked quantities, a dot per step each.
    ok(count(svgOf(charts.widths), 'g[aria-label="dot"] circle') === 3 * sweep.steps.length,
      `widths (${scale}): expected a dot per quantity per step`)
    bySc[scale] = charts
  }
  ok(svgOf(bySc.theta.widths).outerHTML !== svgOf(bySc.probability.widths).outerHTML,
    'the widths chart should differ between scales')
  ok(svgOf(bySc.theta.teams).outerHTML !== svgOf(bySc.probability.teams).outerHTML,
    'the ordered teams should differ between scales')

  // The team layer alone: one bar per team in every facet. Rank is within the
  // facet, so a facet with fewer than n_teams bars means a shared y domain
  // swallowed them, and one with more means a mark lost its facet channel.
  const teamOnly = svgOf(orderedTeams({
    coverage, walkThroughSeed: null, scale: 'theta', width: 720, layers: { mu: false }
  }))
  const bars = [...teamOnly.querySelectorAll('g[aria-label="link"]')]
  ok(bars.length === 1, `team layer alone should be one link mark, found ${bars.length}`)
  for (const mark of bars) {
    const facets = [...mark.querySelectorAll(':scope > g')]
    ok(facets.length === coverage.steps.length,
      `expected ${coverage.steps.length} facets of team bars, found ${facets.length}`)
    for (const f of facets) {
      const n = f.querySelectorAll(':scope > path').length
      ok(n === coverage.n_teams, `each facet should hold exactly ${coverage.n_teams} bars, found ${n}`)
    }
  }
  const full = svgOf(bySc.theta.teams)
  const noMu = svgOf(orderedTeams({ coverage, walkThroughSeed: walk, scale: 'theta', width: 720, layers: { mu: false } }))
  ok(count(noMu, 'g[aria-label="link"] path') < count(full, 'g[aria-label="link"] path'),
    'hiding the mu intervals should remove their bars')
  ok(count(full, 'g[aria-label="link"] path') >= 2 * coverage.n_teams * coverage.steps.length,
    'the full chart should carry a team bar and a mu bar per team per step')

  // One coverage curve per tracked quantity.
  const curves = count(svgOf(bySc.theta.coverage), 'g[aria-label="line"] path')
  ok(curves === 3, `expected three coverage curves, found ${curves}`)
  console.log(`  team sweep: ${sweep.n_players} players x ${sweep.steps.length} steps, ` +
    `${coverage.n_teams} teams x ${coverage.steps.length} facets, ${curves} coverage curves`)
} else {
  console.log('  team sweep: skipped, team-sweep.json / team-coverage.json not generated')
}

console.log(fails === 0 ? '\nOK - all charts render' : `\n${fails} FAILURE(S)`)
process.exit(fails ? 1 : 0)
