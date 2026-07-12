import { describe, expect, it } from 'vitest'
import {
  deriveMentions,
  extractMentions,
  makeMentionSentinelRegex,
  shortAccountId,
} from '../../src/shared/mentions'

describe('makeMentionSentinelRegex', () => {
  it('matches a valid atproto sentinel', () => {
    const match = '@[p:atproto:did:plc:abcdef]'.match(makeMentionSentinelRegex())
    expect(match).not.toBeNull()
  })

  it('matches a valid github sentinel', () => {
    const match = '@[p:github:12345]'.match(makeMentionSentinelRegex())
    expect(match).not.toBeNull()
  })

  it('does not match a bare @handle', () => {
    const match = '@fettstorch'.match(makeMentionSentinelRegex())
    expect(match).toBeNull()
  })

  it('does not match a legacy bare-DID mention', () => {
    const match = '@[did:plc:abcdef]'.match(makeMentionSentinelRegex())
    expect(match).toBeNull()
  })
})

describe('extractMentions', () => {
  it('extracts a single atproto mention', () => {
    const result = extractMentions('Hello @[p:atproto:did:plc:abc123]!')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ provider: 'atproto', accountId: 'did:plc:abc123' })
  })

  it('extracts a single github mention', () => {
    const result = extractMentions('cc @[p:github:999]')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ provider: 'github', accountId: '999' })
  })

  it('extracts multiple distinct mentions preserving order', () => {
    const result = extractMentions('@[p:atproto:did:plc:aaa] and @[p:github:42]')
    expect(result).toHaveLength(2)
    expect(result[0]?.provider).toBe('atproto')
    expect(result[1]?.provider).toBe('github')
  })

  it('deduplicates the same mention appearing twice', () => {
    const result = extractMentions('@[p:github:7] @[p:github:7]')
    expect(result).toHaveLength(1)
  })

  it('returns empty array for content with no mentions', () => {
    expect(extractMentions('plain text without mentions')).toEqual([])
  })

  it('treats unknown providers as atproto', () => {
    const result = extractMentions('@[p:bluesky:did:plc:xyz]')
    expect(result[0]?.provider).toBe('atproto')
  })
})

describe('deriveMentions', () => {
  it('returns unique provider account ids from the content', () => {
    const ids = deriveMentions('Hi @[p:github:42] and @[p:atproto:did:plc:abc]')
    expect(ids).toContain('42')
    expect(ids).toContain('did:plc:abc')
    expect(ids).toHaveLength(2)
  })

  it('deduplicates the same id even across repeated sentinels', () => {
    const ids = deriveMentions('@[p:github:1] @[p:github:1] @[p:github:1]')
    expect(ids).toHaveLength(1)
    expect(ids[0]).toBe('1')
  })

  it('returns empty array for content with no mentions', () => {
    expect(deriveMentions('no mentions here')).toEqual([])
  })
})

describe('shortAccountId', () => {
  it('strips did: prefix and truncates long DIDs', () => {
    const result = shortAccountId('did:plc:abcdefghijklmn')
    expect(result).toBe('plc:abcdefgh…')
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns full string without truncation for short ids', () => {
    expect(shortAccountId('12345')).toBe('12345')
  })

  it('handles a non-DID github id (short)', () => {
    expect(shortAccountId('99999')).toBe('99999')
  })

  it('handles a very long non-DID id by truncating at 14 chars', () => {
    const id = '1234567890123456'
    const result = shortAccountId(id)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(14)
  })
})
