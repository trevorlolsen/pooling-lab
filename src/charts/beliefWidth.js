import * as Plot from '@observablehq/plot'

/**
 * How fast a shared belief narrows, against how many serves went into it.
 *
 * The companion to the pinned belief panel in the complete-pooling section.
 * That panel holds one fixed ruler across all 650 serves, which is what makes
 * the narrowing honest -- but it also means the last few hundred serves are
 * visually indistinguishable from each other. This is where they become legible.
 *
 * LINEAR x, deliberately, and this is the whole design decision:
 *
 *   - n = 0 is the frame the section opens on, and a log axis cannot plot it.
 *   - The shape being taught is diminishing returns, and that is a linear-x
 *     phenomenon. Measured on one_population__20260914, the first 40 serves take
 *     sd from 2.00 to 0.35; the remaining 610 take it from 0.35 to 0.085. On
 *     linear x that is a cliff and then a floor -- which is exactly the claim
 *     the last two sections of the site collect on. On log x it straightens into
 *     a line and says nothing.
 *
 * The dashed reference is c/sqrt(n). Measured, sd*sqrt(n) is flat at about 2.18
 * from n = 50 onward in every population shipped, and the final sd is 0.085 in
 * all of them to three decimals -- because by then the width is set by the
 * spread of serve difficulties rather than by anything about the population.
 * So the curve carries "returns diminish" and the reference carries the law:
 * to halve the width, quadruple the data.
 */
export function beliefWidth ({
  frames, mark = null, reference = true, width = 760, height = 260
}) {
  const rows = frames.map((f) => ({ n: f.n, sd: f.summary.sd }))
  const last = rows[rows.length - 1]

  // Fitted on the tail, where the asymptotic law actually holds. Fitting it on
  // n = 1 would drag the constant toward the prior-dominated frames, and the
  // reference would then miss the frames it is meant to explain.
  const tail = rows.filter((r) => r.n >= Math.max(20, last.n / 8))
  const c = tail.length
    ? tail.reduce((a, r) => a + r.sd * Math.sqrt(r.n), 0) / tail.length
    : last.sd * Math.sqrt(last.n)

  const marks = [
    Plot.ruleY([0]),
    Plot.lineY(rows, { x: 'n', y: 'sd', stroke: '#e69f00', strokeWidth: 2 })
  ]

  if (reference) {
    // From n = 1: at n = 0 the reference is infinite and there is nothing to
    // compare it against anyway.
    const ref = rows.filter((r) => r.n >= 1).map((r) => ({ n: r.n, sd: c / Math.sqrt(r.n) }))
    marks.push(Plot.lineY(ref, {
      x: 'n', y: 'sd', stroke: '#64748b', strokeWidth: 1.4, strokeDasharray: '4 3'
    }))
  }

  // Where the reader is standing in the scrolly above.
  if (mark != null) {
    const here = rows[Math.max(0, Math.min(mark, rows.length - 1))]
    marks.push(
      Plot.ruleX([here.n], { stroke: '#94a3b8', strokeWidth: 1 }),
      Plot.dot([here], { x: 'n', y: 'sd', r: 4, fill: '#e69f00' })
    )
  }

  const svg = Plot.plot({
    width,
    height,
    marginLeft: 56,
    marginBottom: 38,
    x: { label: 'Serves absorbed →', nice: true, grid: true },
    y: { label: 'Width of the shared belief (sd on θ)', zero: true, nice: true, grid: true },
    marks
  })
  // Read back by render-test; the constant is the claim, so it has to be
  // inspectable rather than only visible.
  svg.__refConstant = c
  return svg
}
