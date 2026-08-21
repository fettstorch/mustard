import { describe, expect, it } from 'vitest'
import { getPageKey } from '../../src/shared/page-key'

describe('getPageKey', () => {
  it('uses origin and pathname for default pages', () => {
    expect(getPageKey('https://example.com/article?ref=home#comments')).toBe(
      'https://example.com/article',
    )
  })

  it('uses the YouTube watch video id as the page identity', () => {
    expect(getPageKey('https://www.youtube.com/watch?v=video-123')).toBe(
      'https://www.youtube.com/watch?v=video-123',
    )
  })

  it('ignores other YouTube watch parameters and fragments', () => {
    const first = getPageKey(
      'https://www.youtube.com/watch?v=video-123&t=30s&list=playlist&si=tracking#comments',
    )
    const second = getPageKey('https://www.youtube.com/watch?list=other&v=video-123&t=90s')

    expect(first).toBe('https://www.youtube.com/watch?v=video-123')
    expect(second).toBe(first)
  })

  it('keeps different YouTube video ids distinct', () => {
    expect(getPageKey('https://youtube.com/watch?v=video-123')).not.toBe(
      getPageKey('https://youtube.com/watch?v=video-456'),
    )
  })

  it('does not apply YouTube identity to lookalike or unsupported URLs', () => {
    expect(getPageKey('https://m.youtube.com/watch?v=video-123&feature=share')).toBe(
      'https://m.youtube.com/watch',
    )
    expect(getPageKey('https://youtube.com/shorts/video-123?v=other')).toBe(
      'https://youtube.com/shorts/video-123',
    )
    expect(getPageKey('https://youtube.com.evil.example/watch?v=video-123')).toBe(
      'https://youtube.com.evil.example/watch',
    )
  })

  it('falls back to the default key when a YouTube watch URL has no non-empty v', () => {
    expect(getPageKey('https://www.youtube.com/watch?t=30s#comments')).toBe(
      'https://www.youtube.com/watch',
    )
    expect(getPageKey('https://www.youtube.com/watch?v=')).toBe('https://www.youtube.com/watch')
    expect(getPageKey('https://www.youtube.com/watch?v=%20%20')).toBe(
      'https://www.youtube.com/watch',
    )
  })
})
