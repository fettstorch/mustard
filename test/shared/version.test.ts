import { describe, expect, it } from 'vitest'
import { isOutdated } from '../../src/shared/version'

describe('isOutdated', () => {
  it('returns false when versions are equal', () => {
    expect(isOutdated('2.3.0', '2.3.0')).toBe(false)
  })

  it('returns false when current is ahead by patch', () => {
    expect(isOutdated('2.3.1', '2.3.0')).toBe(false)
  })

  it('returns false when current is ahead by minor', () => {
    expect(isOutdated('2.4.0', '2.3.0')).toBe(false)
  })

  it('returns false when current is ahead by major', () => {
    expect(isOutdated('3.0.0', '2.3.0')).toBe(false)
  })

  it('returns true when current is behind by patch', () => {
    expect(isOutdated('2.3.0', '2.3.1')).toBe(true)
  })

  it('returns true when current is behind by minor', () => {
    expect(isOutdated('2.2.9', '2.3.0')).toBe(true)
  })

  it('returns true when current is behind by major', () => {
    expect(isOutdated('1.99.99', '2.0.0')).toBe(true)
  })

  it('treats missing patch as 0', () => {
    expect(isOutdated('2.3', '2.3.0')).toBe(false)
    expect(isOutdated('2.3', '2.3.1')).toBe(true)
  })

  it('treats non-numeric tail as 0', () => {
    expect(isOutdated('2.3.0-beta', '2.3.0')).toBe(false)
  })
})
