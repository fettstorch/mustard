/**
 * Tiny semver-ish comparison for the client-version guard. We only ever compare
 * dotted numeric versions (`major.minor.patch`) that we control, so this is
 * deliberately minimal — no prerelease/build-metadata semantics. Any non-numeric
 * tail (e.g. `-beta`) is treated as 0, which is safe for a "are we below the
 * minimum?" check.
 */

/** Returns -1 if a < b, 1 if a > b, 0 if equal (component-wise, missing = 0). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/** True when `current` is strictly below `min` (i.e. an update is required). */
export function isOutdated(current: string, min: string): boolean {
  return compareVersions(current, min) < 0
}
