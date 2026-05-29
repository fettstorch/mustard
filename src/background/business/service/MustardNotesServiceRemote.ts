import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { supabase } from '@/background/supabase-client'
import { getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { MustardIndex as MustardIndexClass } from '@/shared/model/MustardIndex'
import { LIMITS } from '@/shared/constants'

// Versioned endpoint. The legacy `get-index` function is kept deployed for
// older clients (which send the anon key as Bearer); this client mints a
// per-user JWT and uses `get-index-v2`, which strictly verifies the JWT and
// also returns the myUnreadByPage / latestNoteAtByPage fields the popup's
// "My Mustard Notes" overview needs.
const GET_INDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-index-v2`

// Index cache with TTL (30 seconds for dev, increase for production)
const INDEX_CACHE_TTL_MS = 30 * 1000

type IndexCachePayload = {
  index: MustardIndex
  /** pageUrl → unread comment-notification count for the cached user (only their own pages) */
  myUnreadByPage: Record<string, number>
  /** pageUrl → most recent updated_at (Unix ms) across the cached user's own notes */
  latestNoteAtByPage: Record<string, number>
  /** Note ids visible to the cached user via repost (reposted by them or someone they follow). */
  repostedNoteIds: string[]
  /** noteId → DIDs (cached user + their follows) who reposted it. Drives the avatar stack. */
  repostersByNoteId: Record<string, string[]>
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
  repostedNoteIds?: string[]
  repostersByNoteId?: Record<string, string[]>
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
      repostedNoteIds: data.repostedNoteIds ?? [],
      repostersByNoteId: data.repostersByNoteId ?? {},
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
      const payload = await getCachedIndexPayload(userId)
      if (!payload) return []

      const { index, repostedNoteIds, repostersByNoteId } = payload
      const authorIds = index.getUsersForPage(pageUrl)

      // Two visibility channels, merged below:
      //   1. author channel — notes on this page by authors I follow (the existing path)
      //   2. repost channel — specific notes reposted by me or someone I follow,
      //      fetched by id so we DON'T over-fetch the original author's other notes.
      const notesById = new Map<string, DbNote>()

      if (authorIds.length > 0) {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('page_url', pageUrl)
          .in('author_id', authorIds)

        if (error) {
          throw new Error(`Supabase query failed: ${error.message}`)
        }
        for (const row of (data || []) as DbNote[]) notesById.set(row.id, row)
      }

      if (repostedNoteIds.length > 0) {
        // Batch the id filter to stay within PostgREST URI limits.
        const BATCH_SIZE = 200
        for (let i = 0; i < repostedNoteIds.length; i += BATCH_SIZE) {
          const batch = repostedNoteIds.slice(i, i + BATCH_SIZE)
          const { data, error } = await supabase
            .from('notes')
            .select('*')
            .eq('page_url', pageUrl)
            .in('id', batch)

          if (error) {
            throw new Error(`Supabase reposted-notes query failed: ${error.message}`)
          }
          for (const row of (data || []) as DbNote[]) notesById.set(row.id, row)
        }
      }

      return [...notesById.values()].map((row) =>
        dbNoteToMustardNote(row, repostersByNoteId[row.id] ?? []),
      )
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

  /**
   * Repost a note (grant visibility to the current user's followers).
   * The reposter_id is enforced by RLS to be the authenticated user.
   *
   * `ignoreDuplicates: true` makes this emit `ON CONFLICT DO NOTHING`, so a
   * retry / double-click on an existing (note_id, reposter_id) row is a silent
   * no-op. We deliberately avoid the default upsert (`DO UPDATE`), which would
   * require an UPDATE RLS policy we don't want to grant — keeping the table
   * insert/delete-only.
   */
  async repostNote(noteId: string, reposterId: string): Promise<void> {
    const { error } = await supabase
      .from('reposts')
      .upsert(
        { note_id: noteId, reposter_id: reposterId },
        { onConflict: 'note_id,reposter_id', ignoreDuplicates: true },
      )

    if (error) {
      throw new Error(`Failed to repost note: ${error.message}`)
    }
  }

  /** Remove the current user's repost of a note. */
  async unrepostNote(noteId: string, reposterId: string): Promise<void> {
    const { error } = await supabase
      .from('reposts')
      .delete()
      .eq('note_id', noteId)
      .eq('reposter_id', reposterId)

    if (error) {
      throw new Error(`Failed to remove repost: ${error.message}`)
    }
  }
}

// Helper to convert database row to MustardNote
function dbNoteToMustardNote(dbNote: DbNote, reposterIds: string[] = []): MustardNote {
  return {
    id: dbNote.id,
    authorId: dbNote.author_id,
    content: dbNote.content,
    reposterIds,
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
