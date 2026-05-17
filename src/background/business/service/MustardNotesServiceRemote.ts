import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { supabase } from '@/background/supabase-client'
import { getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { MustardIndex as MustardIndexClass } from '@/shared/model/MustardIndex'
import { LIMITS } from '@/shared/constants'

const GET_INDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-index`

// Index cache with TTL (30 seconds for dev, increase for production)
const INDEX_CACHE_TTL_MS = 30 * 1000

type IndexCachePayload = {
  index: MustardIndex
  /** pageUrl → unread comment-notification count for the cached user (only their own pages) */
  myUnreadByPage: Record<string, number>
  /** pageUrl → most recent updated_at (Unix ms) across the cached user's own notes */
  latestNoteAtByPage: Record<string, number>
}

let indexCache: (IndexCachePayload & { userId: string; timestamp: number }) | null = null

interface DbNote {
  id: string
  author_id: string
  page_url: string
  content: string
  element_selector: string | null
  relative_position_x: number
  relative_position_y: number
  click_position_x: number
  click_position_y: number
  updated_at: string
}

interface GetIndexResponse {
  index: Record<string, string[]>
  myUnreadByPage?: Record<string, number>
  latestNoteAtByPage?: Record<string, number>
}

/**
 * Fetch the get-index response (cached). Returns the index plus
 * the per-page overview data the popup needs.
 *
 * Returns null when:
 *   - userId is missing, or
 *   - the Supabase JWT can't be obtained (e.g. session expired).
 */
async function getCachedIndexPayload(userId?: string): Promise<IndexCachePayload | null> {
  if (!userId) return null

  // Validate JWT — detects session expiry and triggers logout/banner as a side effect.
  // O(1) from cache when valid; only hits the network when JWT needs refreshing (~hourly).
  const jwt = await getSupabaseJwt()
  if (!jwt) return null

  const now = Date.now()
  if (
    indexCache &&
    indexCache.userId === userId &&
    now - indexCache.timestamp < INDEX_CACHE_TTL_MS
  ) {
    return indexCache
  }

  try {
    const response = await fetch(GET_INDEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ did: userId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(`get-index failed: ${error.error || response.statusText}`)
    }

    const data: GetIndexResponse = await response.json()

    const indexMap = new Map<string, string[]>(Object.entries(data.index))
    const index = new MustardIndexClass(indexMap)

    const payload: IndexCachePayload = {
      index,
      myUnreadByPage: data.myUnreadByPage ?? {},
      latestNoteAtByPage: data.latestNoteAtByPage ?? {},
    }

    indexCache = { ...payload, userId, timestamp: now }

    return payload
  } catch (error) {
    console.error('Failed to query remote index:', error)
    return null
  }
}

export class MustardNotesServiceRemote implements MustardNotesService {
  async queryIndex(userId?: string): Promise<MustardIndex> {
    const payload = await getCachedIndexPayload(userId)
    return payload?.index ?? new MustardIndexClass(new Map())
  }

  /** Per-page overview data for the current user. Empty object if not logged in / not cached. */
  async queryMyOverviewData(userId?: string): Promise<{
    myUnreadByPage: Record<string, number>
    latestNoteAtByPage: Record<string, number>
  }> {
    const payload = await getCachedIndexPayload(userId)
    if (!payload) return { myUnreadByPage: {}, latestNoteAtByPage: {} }
    return {
      myUnreadByPage: payload.myUnreadByPage,
      latestNoteAtByPage: payload.latestNoteAtByPage,
    }
  }

  async queryNotes(pageUrl: string, userId?: string): Promise<MustardNote[]> {
    if (!userId) {
      return []
    }

    try {
      // First, get the index to know which authors to query
      const index = await this.queryIndex(userId)
      const authorIds = index.getUsersForPage(pageUrl)

      if (authorIds.length === 0) {
        return []
      }

      // Query notes for this page from these authors
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('page_url', pageUrl)
        .in('author_id', authorIds)

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`)
      }

      return (data || []).map(dbNoteToMustardNote)
    } catch (error) {
      console.error('Failed to query remote notes:', error)
      return []
    }
  }

  async upsertNote(note: MustardNote): Promise<void> {
    // Validate content length
    if (note.content.length > LIMITS.CONTENT_MAX_LENGTH) {
      throw new Error(`Content exceeds ${LIMITS.CONTENT_MAX_LENGTH} character limit`)
    }

    // Validate page URL length
    if (note.anchorData.pageUrl.length > LIMITS.PAGE_URL_MAX_LENGTH) {
      throw new Error(`Page URL exceeds ${LIMITS.PAGE_URL_MAX_LENGTH} character limit`)
    }

    // Validate selector length
    if (
      note.anchorData.elementSelector &&
      note.anchorData.elementSelector.length > LIMITS.SELECTOR_MAX_LENGTH
    ) {
      throw new Error(`Element selector exceeds ${LIMITS.SELECTOR_MAX_LENGTH} character limit`)
    }

    const dbNote: Partial<DbNote> = {
      author_id: note.authorId,
      page_url: note.anchorData.pageUrl,
      content: note.content,
      element_selector: note.anchorData.elementSelector,
      relative_position_x: note.anchorData.relativePosition.xP,
      relative_position_y: note.anchorData.relativePosition.yP,
      click_position_x: note.anchorData.clickPosition.xVw,
      click_position_y: note.anchorData.clickPosition.yPx,
      updated_at: note.updatedAt.toISOString(),
    }

    if (note.id) {
      // Update existing note
      const { error } = await supabase.from('notes').update(dbNote).eq('id', note.id)

      if (error) {
        throw new Error(`Failed to update note: ${error.message}`)
      }
    } else {
      // Insert new note
      const { error } = await supabase.from('notes').insert(dbNote)

      if (error) {
        throw new Error(`Failed to insert note: ${error.message}`)
      }
    }
  }

  async deleteNote(noteId: string, _pageUrl: string): Promise<void> {
    const { error } = await supabase.from('notes').delete().eq('id', noteId)

    if (error) {
      throw new Error(`Failed to delete note: ${error.message}`)
    }
  }
}

// Helper to convert database row to MustardNote
function dbNoteToMustardNote(dbNote: DbNote): MustardNote {
  return {
    id: dbNote.id,
    authorId: dbNote.author_id,
    content: dbNote.content,
    anchorData: {
      pageUrl: dbNote.page_url,
      elementSelector: dbNote.element_selector,
      relativePosition: {
        xP: dbNote.relative_position_x,
        yP: dbNote.relative_position_y,
      },
      clickPosition: {
        xVw: dbNote.click_position_x,
        yPx: dbNote.click_position_y,
      },
    },
    updatedAt: new Date(dbNote.updated_at),
  }
}

/** Clear the cached index. Call on login/logout/mutations to ensure fresh data. */
export function invalidateRemoteIndexCache(): void {
  indexCache = null
}
