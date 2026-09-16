// Bivariate-normal geometry for the two-dimensional charts.
//
// A 2D posterior ships as a mean vector and a 2x2 covariance, never as draws
// (CLAUDE.md: estimates are grids and summaries, not samples). Every contour on
// the client is a highest-density ellipse of that normal, drawn as a polygon.
// The probability scale maps each vertex through plogis(x - d*) per axis; the
// map is monotone in each coordinate, so the region stays a region.

import { plogis } from './transforms.js'

/**
 * The boundary of the central `p` region of N(mean, cov), as `n` points.
 * `{ mean1, mean2, var1, var2, cov12 }` is the shape every 2D block ships.
 */
export function ellipsePoints ({ mean1, mean2, var1, var2, cov12 }, p = 0.5, n = 48) {
  // chi-square with 2 df: the squared Mahalanobis radius enclosing mass p.
  const r2 = -2 * Math.log(1 - p)
  const tr = var1 + var2
  const det = Math.max(0, var1 * var2 - cov12 * cov12)
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = Math.max(tr / 2 + disc, 1e-12)
  const l2 = Math.max(tr / 2 - disc, 1e-12)
  // Orientation of the major axis. When the covariance is (near) zero the
  // eigenvectors are the coordinate axes.
  const angle = Math.abs(cov12) < 1e-12
    ? (var1 >= var2 ? 0 : Math.PI / 2)
    : Math.atan2(l1 - var1, cov12)
  const a = Math.sqrt(l1 * r2)
  const b = Math.sqrt(l2 * r2)
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const points = new Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n
    const u = a * Math.cos(t)
    const v = b * Math.sin(t)
    points[i] = { x: mean1 + u * ca - v * sa, y: mean2 + u * sa + v * ca, i }
  }
  return points
}

/** Area of the `p` ellipse: how much of the plane the posterior occupies. */
export function ellipseArea ({ var1, var2, cov12 }, p = 0.5) {
  const r2 = -2 * Math.log(1 - p)
  return Math.PI * r2 * Math.sqrt(Math.max(0, var1 * var2 - cov12 * cov12))
}

/** A point on the displayed scale. */
export function toScale (point, scale, difficulty = 0) {
  if (scale === 'theta') return point
  return { ...point, x: plogis(point.x - difficulty), y: plogis(point.y - difficulty) }
}

export function pointsToScale (points, scale, difficulty = 0) {
  return scale === 'theta' ? points : points.map((pt) => toScale(pt, scale, difficulty))
}

/**
 * Polygon rows for one ellipse, tagged with an id and a facet so Plot draws it
 * once, in the right panel. Marks carrying their own data are otherwise drawn
 * in every facet.
 */
export function ellipseRows (shape, { id, facet, p = 0.5, n = 48, scale = 'theta', difficulty = 0, ...extra } = {}) {
  return pointsToScale(ellipsePoints(shape, p, n), scale, difficulty)
    .map((pt) => ({ ...pt, id, facet, ...extra }))
}

/**
 * The marginal covariance of a mixture of bivariate normals with the shared
 * within-group covariance `sigma`: what a model with no covariate sees.
 */
export function mixtureCovariance (groups, sigma) {
  const w = groups.map((g) => g.weight)
  const total = w.reduce((a, b) => a + b, 0)
  const m1 = groups.reduce((s, g, i) => s + (w[i] / total) * g.theta_mean_1, 0)
  const m2 = groups.reduce((s, g, i) => s + (w[i] / total) * g.theta_mean_2, 0)
  let var1 = sigma.var1; let var2 = sigma.var2; let cov12 = sigma.cov12
  for (const [i, g] of groups.entries()) {
    const d1 = g.theta_mean_1 - m1
    const d2 = g.theta_mean_2 - m2
    var1 += (w[i] / total) * d1 * d1
    var2 += (w[i] / total) * d2 * d2
    cov12 += (w[i] / total) * d1 * d2
  }
  return { mean1: m1, mean2: m2, var1, var2, cov12 }
}
