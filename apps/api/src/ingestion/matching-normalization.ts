// Explicit whitespace set shared with PostgreSQL; accents and punctuation remain identities.
export const matchingWhitespace = '[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+'
const whitespace = new RegExp(matchingWhitespace, 'gu')
export function normalizeMatchName(value: string | null): string {
  if (!value || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return ''
  return value.normalize('NFC').toLowerCase().replace(whitespace, ' ').replace(/^ +| +$/g, '')
}
export function matchSlug(value: string | null): string {
  return normalizeMatchName(value).normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
export function externalIdSlug(value: string | null): string {
  // An opaque identifier is never fetched or interpreted as a URL.
  if (!value || /[?#]|:\/\//.test(value)) return ''
  const basename = value.split(/[\\/]/).at(-1) ?? ''
  return matchSlug(basename.replace(/\.(?:md|markdown|txt|json|ya?ml|html?)$/i, ''))
}
export function compareMatchText(a: string, b: string): number {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!
  return left.length - right.length
}
export function matchSimilarity(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b), length = Math.max(left.length, right.length)
  if (Math.min(left.length, right.length) < 5 || length > 250) return 0
  const maxDistance = Math.floor(length * 15 / 100)
  if (Math.abs(left.length - right.length) > maxDistance) return 0
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    const current = Array<number>(right.length + 1).fill(Infinity)
    current[0] = i
    for (let j = Math.max(1, i - maxDistance); j <= Math.min(right.length, i + maxDistance); j++)
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1))
    if (Math.min(...current) > maxDistance) return 0
    previous = current
  }
  const distance = previous[right.length]!
  return distance <= maxDistance ? 1 - distance / length : 0
}
export function similarityChunks(name: string): string[] {
  const points = Array.from(name)
  if (points.length < 5 || points.length > 250) return []
  // At the 85% threshold a longer candidate may allow more edits than the input.
  // d+1 disjoint chunks guarantee one survives d Levenshtein edits.
  const maxDistance = Math.floor(Math.floor(points.length * 100 / 85) * 15 / 100)
  const count = maxDistance + 1
  return [...new Set(Array.from({ length: count }, (_, i) =>
    points.slice(Math.floor(i * points.length / count), Math.floor((i + 1) * points.length / count)).join('')))]
}
