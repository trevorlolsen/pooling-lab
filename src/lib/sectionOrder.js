// The one place the reading order of the story is written down.
//
// Section numbers used to live in eight hand-typed eyebrow strings, five prose
// cross-references and a tooltip, and reordering meant finding all fourteen.
// lib/sectionNav.js derives the rail nav by splitting each eyebrow on its em
// dash, so a missed one silently renumbers the nav too.
//
// Now the eyebrows ask for their number and the prose asks for its references,
// and reordering is editing this array. main.js asserts that the sections it
// mounts match it, in order.
//
// Deliberately pure: no imports, so scripts/interaction-test.mjs can read the
// expected order under plain Node rather than keeping its own copy.

/** Section ids, in reading order. This array IS the running order of the site. */
export const SECTION_ORDER = [
  'team',
  'complete-pooling',
  'no-pooling',
  'shrinkage',
  'covariate-correct',
  'covariate-wrong',
  'evidence',
  'convergence',
  'team-sweep'
]

/**
 * The number a section wears, 1-based.
 *
 * Throws on an unknown id rather than returning 0. An id that has been renamed
 * or removed is a coding error, and a throw surfaces it immediately through
 * main.js's error banner -- where returning -1 + 1 would quietly ship the words
 * "section 0" into the reader's prose.
 */
export function numberOf (id) {
  const i = SECTION_ORDER.indexOf(id)
  if (i < 0) throw new Error(`unknown section id "${id}" -- add it to SECTION_ORDER`)
  return i + 1
}

/**
 * A prose reference to one or more sections.
 *
 *   refTo('shrinkage')                     -> "section 2"
 *   refTo(['covariate-correct', 'covariate-wrong'])  -> "sections 6 and 7"
 *   refTo(['shrinkage', 'convergence'], { cap: true }) -> "Sections 2 and 4"
 *
 * It takes a list because two call sites are plural and the Scale tooltip names
 * five, and it owns the word "section" because one reference is sentence-initial
 * and `.replace(/^s/, 'S')` at the call site would be worse than the hardcoded
 * string this replaces.
 */
export function refTo (ids, { cap = false } = {}) {
  const ns = (Array.isArray(ids) ? ids : [ids]).map(numberOf)
  const word = `${cap ? 'S' : 's'}ection${ns.length > 1 ? 's' : ''}`
  const joined = ns.length > 1
    ? `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`
    : String(ns[0])
  return `${word} ${joined}`
}
