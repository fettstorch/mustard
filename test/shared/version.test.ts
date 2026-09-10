import { describe, expect, it } from 'vitest'
import { isMinorOrMajorUpdate, isOptionalUpdate, isOutdated } from '../../src/shared/version'

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

describe('isMinorOrMajorUpdate', () => {
  it('ignores patch-only changes', () => {
    expect(isMinorOrMajorUpdate('2.14.0', '2.14.1')).toBe(false)
    expect(isMinorOrMajorUpdate('2.14.9', '2.14.10')).toBe(false)
  })

  it('accepts newer minor and major versions', () => {
    expect(isMinorOrMajorUpdate('2.14.9', '2.15.0')).toBe(true)
    expect(isMinorOrMajorUpdate('2.14.9', '3.0.0')).toBe(true)
  })

  it('rejects older versions', () => {
    expect(isMinorOrMajorUpdate('2.14.0', '2.13.9')).toBe(false)
    expect(isMinorOrMajorUpdate('2.14.0', '1.99.0')).toBe(false)
  })
})

describe('isOptionalUpdate', () => {
  it('accepts patch updates when they are enabled', () => {
    expect(isOptionalUpdate('2.14.0', '2.14.1', true)).toBe(true)
  })

  it('ignores patch updates when they are disabled', () => {
    expect(isOptionalUpdate('2.14.0', '2.14.1', false)).toBe(false)
  })

  it('accepts minor and major updates in either mode', () => {
    expect(isOptionalUpdate('2.14.9', '2.15.0', true)).toBe(true)
    expect(isOptionalUpdate('2.14.9', '2.15.0', false)).toBe(true)
    expect(isOptionalUpdate('2.14.9', '3.0.0', true)).toBe(true)
    expect(isOptionalUpdate('2.14.9', '3.0.0', false)).toBe(true)
  })

  it('rejects equal and older versions', () => {
    expect(isOptionalUpdate('2.14.0', '2.14.0', true)).toBe(false)
    expect(isOptionalUpdate('2.14.0', '2.13.9', true)).toBe(false)
  })
})
