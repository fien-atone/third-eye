import { describe, it, expect } from 'vitest'
import { semverCompare } from './semver'

describe('semverCompare', () => {
  it('returns 0 for equal versions', () => {
    expect(semverCompare('1.2.3', '1.2.3')).toBe(0)
  })

  it('returns positive when a > b', () => {
    expect(semverCompare('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(semverCompare('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(semverCompare('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })

  it('returns negative when a < b', () => {
    expect(semverCompare('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(semverCompare('1.9.0', '1.10.0')).toBeLessThan(0)
  })

  it('strips leading "v"', () => {
    expect(semverCompare('v2.3.0', '2.3.0')).toBe(0)
    expect(semverCompare('v2.3.0', 'v2.2.2')).toBeGreaterThan(0)
  })

  it('strips pre-release / build suffixes (treats them as equal to base)', () => {
    expect(semverCompare('2.3.0-rc.1', '2.3.0')).toBe(0)
    expect(semverCompare('2.3.0+build.5', '2.3.0')).toBe(0)
  })

  it('tolerates malformed input by treating non-numeric segments as 0', () => {
    expect(semverCompare('garbage', '0.0.0')).toBe(0)
    expect(semverCompare('1.x.0', '1.0.0')).toBe(0)
  })

  it('handles missing minor/patch as 0', () => {
    expect(semverCompare('2', '2.0.0')).toBe(0)
    expect(semverCompare('2.1', '2.0.99')).toBeGreaterThan(0)
  })

  // Real-world regression cases that motivated this util:
  it('correctly orders the v2.x series shipped on this project', () => {
    expect(semverCompare('2.3.0', '2.2.2')).toBeGreaterThan(0)
    expect(semverCompare('2.2.2', '2.2.1')).toBeGreaterThan(0)
    expect(semverCompare('2.2.1', '2.2.0')).toBeGreaterThan(0)
  })
})
