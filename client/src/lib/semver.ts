/** Compare semver triples (X.Y.Z). Returns >0 if a > b, <0 if a < b,
 *  0 if equal. Pre-release suffixes (-rc.1, +build.5) are stripped before
 *  comparison — we only ship stable releases, and treating "2.3.0-rc.1"
 *  as equal to "2.3.0" is the safe default (no false "outdated" prompt).
 *
 *  Tolerant on malformed input: any non-numeric segment becomes 0, so
 *  garbage from a misconfigured GitHub release won't crash the UI. */
export function semverCompare(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function parts(v: string): number[] {
  return v.replace(/^v/, '').split(/[-+]/, 1)[0].split('.').map(n => parseInt(n, 10) || 0)
}
