import * as Plot from '@observablehq/plot'

const SAMPLE = '#e69f00' // --no-pool
const PREDICTED = '#56b4e9' // --partial

/**
 * The running success rate against what the model actually predicts.
 *
 * The lesson is in the first few serves: the sample rate is pinned at 0 or 1
 * and flails, while the predictive rate never claims this player is a 0%
 * server on the strength of three misses. They converge, and the reader can
 * see how long that takes.
 *
 * The blue line is the posterior predictive rate over THIS player's own
 * observed difficulties -- not plogis(posterior mean θ). Difficulties are
 * drawn U(-1.5, 1.5), so the sample mean converges to E_d[plogis(θ - d)], and
 * comparing it to plogis(θ) teaches something false.
 */
export function beliefTrace ({ frames, layers = {}, width = 760, height = 220 }) {
  const on = (id) => layers[id] !== false
  const data = frames
    .filter((f) => f.n > 0 && f.sampleRate != null)
    .map((f) => ({ n: f.n, sample: f.sampleRate, predicted: f.predictedRate }))
  const lastN = data.length > 0 ? data[data.length - 1].n : 1

  const marks = [Plot.ruleY([0], { stroke: '#cbd5e1' })]

  if (on('sample')) {
    marks.push(
      Plot.lineY(data, {
        x: 'n', y: 'sample', stroke: SAMPLE, strokeWidth: 2, curve: 'step-after'
      }),
      Plot.text(data.slice(-1), {
        x: 'n',
        y: 'sample',
        text: () => 'running success rate',
        fill: SAMPLE,
        fontSize: 11,
        fontWeight: 600,
        textAnchor: 'end',
        dy: -8
      })
    )
  }

  if (on('predicted')) {
    marks.push(
      Plot.lineY(data, {
        x: 'n', y: 'predicted', stroke: PREDICTED, strokeWidth: 2, curve: 'basis'
      }),
      Plot.text(data.slice(-1), {
        x: 'n',
        y: 'predicted',
        text: () => 'predicted rate',
        fill: PREDICTED,
        fontSize: 11,
        fontWeight: 600,
        textAnchor: 'end',
        dy: 14
      })
    )
  }

  return Plot.plot({
    width,
    height,
    marginLeft: 64,
    marginRight: 20,
    marginTop: 20,
    marginBottom: 40,
    x: { label: 'Serves absorbed', domain: [1, Math.max(2, lastN)], grid: true },
    y: { label: 'Success rate', domain: [0, 1], grid: true, percent: false },
    style: { fontSize: '12px', background: 'transparent' },
    marks
  })
}
