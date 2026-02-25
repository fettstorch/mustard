import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { supabase } from '@/background/supabase-client'
import { MustardIndex as MustardIndexClass } from '@/shared/model/MustardIndex'
import { LIMITS } from '@/shared/constants'

const SUPABASE_PROJECT_ID = 'dexvrkxjgitrebqetvjw'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleHZya3hqZ2l0cmVicWV0dmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5ODQwMTcsImV4cCI6MjA4MzU2MDAxN30.2hzb5-dpI0XYbklfqFsK5CkDeNXXlE1V78Q1eEgV4iI'
const GET_INDEX_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/get-index`

// Index cache with TTL (30 seconds for dev, increase for production)
const INDEX_CACHE_TTL_MS = 30 * 1000
let indexCache: { index: MustardIndex; userId: string; timestamp: number } | null = null

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

export class MustardNotesServiceRemote implements MustardNotesService {
  async queryIndex(userId?: string): Promise<MustardIndex> {
    if (!userId) {
      return new MustardIndexClass(new Map())
    }

    const now = Date.now()

    // Use cache if: exists, same user, and not expired
    if (
      indexCache &&
      indexCache.userId === userId &&
      now - indexCache.timestamp < INDEX_CACHE_TTL_MS
    ) {
      return indexCache.index
    }

    try {
      // Call the get-index Edge Function which fetches follows and builds the index
      const response = await fetch(GET_INDEX_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ did: userId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(`get-index failed: ${error.error || response.statusText}`)
      }

      const data: { index: Record<string, string[]> } = await response.json()

      // Convert Record to Map
      const indexMap = new Map<string, string[]>(Object.entries(data.index))
      const index = new MustardIndexClass(indexMap)

      // Cache the result
      indexCache = { index, userId, timestamp: now }

      return index
    } catch (error) {
      console.error('Failed to query remote index:', error)
      return new MustardIndexClass(new Map())
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

/** Clear the cached index. Call on login/logout to ensure fresh data. */
export function invalidateRemoteIndexCache(): void {
  indexCache = null
}
