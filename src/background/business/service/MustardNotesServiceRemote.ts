import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { supabase } from '@/background/supabase-client'
import { getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { MustardIndex as MustardIndexClass } from '@/shared/model/MustardIndex'
import { LIMITS } from '@/shared/constants'
import { deriveMentions } from '@/shared/mentions'
import { retryable } from '@fettstorch/jule'
import { RateLimitError } from '@/shared/errors'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { extractFirstLinkUrl, normalizeHttpUrl } from '@/shared/link-preview'
import {
  deleteLinkPreviewThumbnail,
  ensureLinkPreviewThumbnailStored,
  isLinkPreviewThumbnailPath,
  isLinkPreviewThumbnailPathForAuthor,
  prepareLinkPreviewThumbnail,
} from './LinkPreviewThumbnailServiceRemote'

// Versioned endpoint. The client sends its Supabase JWT (minted server-side by
// the auth-bridge edge function at login, refreshed there on expiry) to
// `get-index-v2`, which strictly verifies the JWT and serves the index from a
// server-side follows cache.
const GET_INDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-index-v2`

// Index cache TTL. The index only changes when someone you follow publishes,
// reposts, or mentions you — 5 min staleness is acceptable; the user's own
// mutations invalidate this cache explicitly (invalidateRemoteIndexCache).
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000

// The index cache lives in storage.session (not a background-memory variable):
// the background process can be torn down between page loads, which would
// otherwise drop the cache and defeat the TTL. storage.session survives those
// restarts and clears when the browser closes.
const INDEX_CACHE_KEY = 'mustard-remote-index-cache'

// The index fields shared by every representation (wire / runtime / persisted).
// Declared once so adding an index field means editing one place. The `index`
// field is NOT here because its shape differs per representation (raw record vs
// MustardIndex) — each type below declares its own.
type IndexData = {
  /** pageUrl → most recent updated_at (Unix ms) across the cached user's own notes */
  latestNoteAtByPage: Record<string, number>
  /** Note ids visible to the cached user via repost (reposted by them or someone they follow). */
  repostedNoteIds: string[]
  /** Note ids visible to the cached user because they're @-mentioned in the note or one of its comments. */
  mentionedNoteIds: string[]
  /**
   * noteId → ALL DIDs who reposted it (global, not just the viewer's follows).
   * Only populated for notes the viewer can already see, so it never widens
   * visibility — it just drives the full avatar stack / social-proof display.
   */
  repostersByNoteId: Record<string, string[]>
}

// Runtime shape returned to callers: the index as a queryable MustardIndex.
type IndexCachePayload = IndexData & {
  index: MustardIndex
}

// JSON-safe shape actually persisted in storage.session. `index` is the raw
// record (a MustardIndex wraps a Map, which doesn't survive serialization);
// userId + timestamp drive the hit check.
type StoredIndexCache = IndexData & {
  userId: string
  timestamp: number
  index: Record<string, string[]>
}

interface DbNote {
  id: string
  author_id: string
  page_url: string
  content: string
  link_preview?: DbLinkPreview | null
  mentions: string[]
  element_selector: string | null
  relative_position_x: number
  relative_position_y: number
  click_position_x: number
  click_position_y: number
  updated_at: string
}

type DbLinkPreview = Omit<LinkPreview, 'imageDataUrl' | 'imageUrl'>

interface GetIndexResponse {
  index: Record<string, string[]>
  latestNoteAtByPage?: Record<string, number>
  repostedNoteIds?: string[]
  mentionedNoteIds?: string[]
  repostersByNoteId?: Record<string, string[]>
}

/** Fetch notes by id (scoped to a page), batched to stay within PostgREST URI limits. */
async function fetchNotesByIdForPage(
  pageUrl: string,
  noteIds: string[],
  into: Map<string, DbNote>,
): Promise<void> {
  const BATCH_SIZE = 200
  for (let i = 0; i < noteIds.length; i += BATCH_SIZE) {
    const batch = noteIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('page_url', pageUrl)
      .in('id', batch)

    if (error) {
      throw new Error(`Supabase by-id notes query failed: ${error.message}`)
    }
    for (const row of (data || []) as DbNote[]) into.set(row.id, row)
  }
}

/**
 * Fetch reposters for a batch of note ids → `noteId → reposterId[]` (all
 * reposters, global — the reposts table is public-read). Batched to stay within
 * PostgREST URI limits. Mirrors what `get_index_payload` bakes into
 * `repostersByNoteId`, but resolved client-side for the "show all notes" path
 * which bypasses the follow index entirely.
 */
async function fetchRepostersForNotes(noteIds: string[]): Promise<Map<string, string[]>> {
  const byNoteId = new Map<string, string[]>()
  const BATCH_SIZE = 200
  for (let i = 0; i < noteIds.length; i += BATCH_SIZE) {
    const batch = noteIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('reposts')
      .select('note_id, reposter_id')
      .in('note_id', batch)

    if (error) {
      throw new Error(`Supabase reposts query failed: ${error.message}`)
    }
    for (const row of (data || []) as { note_id: string; reposter_id: string }[]) {
      const list = byNoteId.get(row.note_id) ?? []
      list.push(row.reposter_id)
      byNoteId.set(row.note_id, list)
    }
  }
  return byNoteId
}

/** Rebuild the runtime payload (with a MustardIndex) from the stored raw shape. */
function hydrateIndexCache(stored: StoredIndexCache): IndexCachePayload {
  return {
    index: new MustardIndexClass(new Map(Object.entries(stored.index))),
    latestNoteAtByPage: stored.latestNoteAtByPage,
    repostedNoteIds: stored.repostedNoteIds,
    mentionedNoteIds: stored.mentionedNoteIds,
    repostersByNoteId: stored.repostersByNoteId,
  }
}

/**
 * Get the (cached) get-index-v2 payload: the visibility index + the
 * repost/mention id lists + latestNoteAtByPage. Served from storage.session
 * within INDEX_CACHE_TTL_MS; otherwise refetched from the edge and re-cached.
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
  const store = await browser.storage.session.get(INDEX_CACHE_KEY)
  const cached = store[INDEX_CACHE_KEY] as StoredIndexCache | undefined
  if (cached && cached.userId === userId && now - cached.timestamp < INDEX_CACHE_TTL_MS) {
    return hydrateIndexCache(cached)
  }

  try {
    const data = await retryable(async ({ retry, tryCount }) => {
      const response = await fetch(GET_INDEX_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ userId }),
      })

      if (!response.ok) {
        const isTransient =
          response.status === 408 || response.status === 429 || response.status >= 500
        if (isTransient && tryCount < 3) retry({ backoffMs: 250 * tryCount })
        const error = (await response.json().catch(() => ({}))) as Record<string, string>
        throw new Error(`get-index failed: ${error.error ?? response.statusText}`)
      }

      return response.json() as Promise<GetIndexResponse>
    })

    const stored: StoredIndexCache = {
      userId,
      timestamp: now,
      index: data.index,
      latestNoteAtByPage: data.latestNoteAtByPage ?? {},
      repostedNoteIds: data.repostedNoteIds ?? [],
      mentionedNoteIds: data.mentionedNoteIds ?? [],
      repostersByNoteId: data.repostersByNoteId ?? {},
    }
    await browser.storage.session.set({ [INDEX_CACHE_KEY]: stored })
    return hydrateIndexCache(stored)
  } catch (error) {
    console.error('Failed to query remote index:', error)
    return null
  }
}

class MustardNotesServiceRemote implements MustardNotesService {
  async queryIndex(userId?: string): Promise<MustardIndex> {
    const payload = await getCachedIndexPayload(userId)
    return payload?.index ?? new MustardIndexClass(new Map())
  }

  /** pageUrl → latest own-note timestamp for the current user. Empty object if not logged in / not cached. */
  async queryMyLatestNoteAtByPage(userId?: string): Promise<Record<string, number>> {
    const payload = await getCachedIndexPayload(userId)
    return payload?.latestNoteAtByPage ?? {}
  }

  async queryNotes(pageUrl: string, userId?: string): Promise<MustardNote[]> {
    if (!userId) {
      return []
    }

    try {
      const payload = await getCachedIndexPayload(userId)
      if (!payload) return []

      const { index, repostedNoteIds, mentionedNoteIds, repostersByNoteId } = payload
      const authorIds = index.getUsersForPage(pageUrl)

      // Three visibility channels, merged below:
      //   1. author channel — notes on this page by authors I follow (the existing path)
      //   2. repost channel — specific notes reposted by me or someone I follow
      //   3. mention channel — specific notes where I'm @-mentioned (in the note
      //      or one of its comments)
      // Channels 2 & 3 are fetched by id so we DON'T over-fetch the original
      // author's other notes on this page.
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

      await fetchNotesByIdForPage(pageUrl, repostedNoteIds, notesById)
      await fetchNotesByIdForPage(pageUrl, mentionedNoteIds, notesById)

      return [...notesById.values()].map((row) =>
        dbNoteToMustardNote(row, repostersByNoteId[row.id] ?? []),
      )
    } catch (error) {
      console.error('Failed to query remote notes:', error)
      return []
    }
  }

  /**
   * Fetch EVERY published note on a page, ignoring the viewer's follow graph.
   * Backs the one-shot "Show all notes on this page" action. Relies on the
   * public-read RLS policies on `notes` and `reposts`, so no index/follow
   * resolution is needed — just a direct page-scoped select plus a reposts
   * lookup for the matched notes (so avatar stacks still render). A generous
   * `limit` caps pathological pages.
   */
  async queryAllNotesForPage(pageUrl: string): Promise<MustardNote[]> {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('page_url', pageUrl)
        .limit(500)

      if (error) {
        throw new Error(`Supabase all-notes query failed: ${error.message}`)
      }
      const rows = (data || []) as DbNote[]

      const repostersByNoteId = await fetchRepostersForNotes(rows.map((r) => r.id))
      return rows.map((row) => dbNoteToMustardNote(row, repostersByNoteId.get(row.id) ?? []))
    } catch (error) {
      console.error('Failed to query all remote notes:', error)
      return []
    }
  }

  async upsertNote(note: MustardNote): Promise<MustardNote> {
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

    const previousThumbnailPath = note.linkPreview?.thumbnailPath
    const preparedPreview = await prepareLinkPreviewThumbnail(note.linkPreview, note.authorId)
    const dbNote: Partial<DbNote> = {
      author_id: note.authorId,
      page_url: note.anchorData.pageUrl,
      content: note.content,
      link_preview: toDbLinkPreview(preparedPreview.preview),
      // Mentions are derived from content at this write boundary (content is the
      // source of truth); the column exists only for the notification trigger.
      mentions: deriveMentions(note.content),
      element_selector: note.anchorData.elementSelector,
      relative_position_x: note.anchorData.relativePosition.xP,
      relative_position_y: note.anchorData.relativePosition.yP,
      click_position_x: note.anchorData.clickPosition.xVw,
      click_position_y: note.anchorData.clickPosition.yPx,
      updated_at: note.updatedAt.toISOString(),
    }

    if (note.id) {
      // Update existing note. `.select().single()` returns the updated row so
      // callers can merge it directly instead of re-querying the whole index.
      const updateResult = await supabase
        .from('notes')
        .update(dbNote)
        .eq('id', note.id)
        .select()
        .single()

      if (updateResult.error) {
        throwNoteError('update', updateResult.status, updateResult.error.message)
      }
      let storedRow = updateResult.data as DbNote
      let includeRuntimeThumbnail = false
      if (preparedPreview.thumbnail) {
        includeRuntimeThumbnail = await ensureLinkPreviewThumbnailStored(preparedPreview.thumbnail)
        if (!includeRuntimeThumbnail) {
          storedRow = await clearThumbnailReference(storedRow, preparedPreview.preview)
          await cleanupUnreferencedThumbnail(preparedPreview.thumbnail.path)
        }
      }
      const currentThumbnailPath = fromDbThumbnailPath(storedRow.link_preview, note.authorId)
      await cleanupRemovedThumbnail(previousThumbnailPath, currentThumbnailPath)
      // Reposters aren't part of the write payload; preserve what the caller knew.
      return withRuntimePreview(
        dbNoteToMustardNote(storedRow, note.reposterIds),
        includeRuntimeThumbnail ? preparedPreview.preview : undefined,
      )
    }

    // The committed note reference authorizes the subsequent immutable object
    // upload through Storage RLS. Identical thumbnails reuse the same path.
    const insertResult = await supabase.from('notes').insert(dbNote).select().single()

    if (insertResult.error) {
      throwNoteError('insert', insertResult.status, insertResult.error.message)
    }
    let storedRow = insertResult.data as DbNote
    let includeRuntimeThumbnail = false
    if (preparedPreview.thumbnail) {
      includeRuntimeThumbnail = await ensureLinkPreviewThumbnailStored(preparedPreview.thumbnail)
      if (!includeRuntimeThumbnail) {
        storedRow = await clearThumbnailReference(storedRow, preparedPreview.preview)
        await cleanupUnreferencedThumbnail(preparedPreview.thumbnail.path)
      }
    }
    return withRuntimePreview(
      dbNoteToMustardNote(storedRow),
      includeRuntimeThumbnail ? preparedPreview.preview : undefined,
    )
  }

  async deleteNote(noteId: string, _pageUrl: string): Promise<void> {
    const existing = await supabase
      .from('notes')
      .select('link_preview')
      .eq('id', noteId)
      .maybeSingle()
    const thumbnailPath = fromDbThumbnailPath(
      (existing.data as Pick<DbNote, 'link_preview'> | null)?.link_preview,
    )
    const { error } = await supabase.from('notes').delete().eq('id', noteId)

    if (error) {
      throw new Error(`Failed to delete note: ${error.message}`)
    }
    if (thumbnailPath) {
      cleanupUnreferencedThumbnail(thumbnailPath).catch((error) =>
        console.debug('mustard [link-preview] thumbnail cleanup failed:', error),
      )
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

/**
 * Shared singleton. The index cache lives in storage.session (keyed globally),
 * so this service is inherently process-wide — exporting one instance keeps
 * every consumer (notes + notifications managers) on one code path instead of
 * each `new`-ing its own object.
 */
export const mustardNotesServiceRemote = new MustardNotesServiceRemote()

function throwNoteError(op: string, status: number, message: string): never {
  if (status === 429) throw new RateLimitError()
  throw new Error(`Failed to ${op} note: ${message}`)
}

// Helper to convert database row to MustardNote
function dbNoteToMustardNote(dbNote: DbNote, reposterIds: string[] = []): MustardNote {
  const linkPreview = fromDbLinkPreview(dbNote.link_preview, dbNote.content, dbNote.author_id)
  return {
    id: dbNote.id,
    authorId: dbNote.author_id,
    content: dbNote.content,
    ...(linkPreview ? { linkPreview } : {}),
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

/** Keep the image binary in extension storage, never in the public notes row. */
function toDbLinkPreview(preview?: LinkPreview): DbLinkPreview | null {
  if (!preview) return null
  const { imageDataUrl: _imageDataUrl, imageUrl: _imageUrl, ...stored } = preview
  return stored
}

function toDbLinkPreviewWithoutThumbnail(preview?: LinkPreview): DbLinkPreview | null {
  const stored = toDbLinkPreview(preview)
  if (!stored) return null
  const { thumbnailPath: _thumbnailPath, ...metadata } = stored
  return metadata
}

function fromDbLinkPreview(
  value: DbLinkPreview | null | undefined,
  content: string,
  authorId: string,
): LinkPreview | undefined {
  const preview = value
  const url = preview && typeof preview.url === 'string' ? normalizeHttpUrl(preview.url) : undefined
  if (!preview || !url || url !== extractFirstLinkUrl(content)) return undefined
  const optionalText = (field: keyof DbLinkPreview, maxLength: number): string | undefined => {
    const item = preview[field]
    return typeof item === 'string' ? item.slice(0, maxLength) : undefined
  }
  const title = optionalText('title', 200)
  const description = optionalText('description', 300)
  const siteName = optionalText('siteName', 80)
  const thumbnailPath = fromDbThumbnailPath(preview, authorId)
  return {
    url: url.slice(0, LIMITS.PAGE_URL_MAX_LENGTH),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(siteName ? { siteName } : {}),
    ...(thumbnailPath ? { thumbnailPath } : {}),
  }
}

function fromDbThumbnailPath(
  preview: DbLinkPreview | null | undefined,
  authorId?: string,
): string | undefined {
  const path = preview?.thumbnailPath
  if (typeof path !== 'string' || !isLinkPreviewThumbnailPath(path)) return undefined
  return !authorId || isLinkPreviewThumbnailPathForAuthor(path, authorId) ? path : undefined
}

function withRuntimePreview(note: MustardNote, preview?: LinkPreview): MustardNote {
  if (!note.linkPreview || !preview?.imageDataUrl) return note
  return { ...note, linkPreview: { ...note.linkPreview, imageDataUrl: preview.imageDataUrl } }
}

async function cleanupRemovedThumbnail(previousPath?: string, currentPath?: string): Promise<void> {
  if (!previousPath || previousPath === currentPath) return
  try {
    await cleanupUnreferencedThumbnail(previousPath)
  } catch (error) {
    console.debug('mustard [link-preview] replaced-thumbnail cleanup failed:', error)
  }
}

/** Remove a failed thumbnail path from the note while preserving text metadata. */
async function clearThumbnailReference(row: DbNote, preview?: LinkPreview): Promise<DbNote> {
  const linkPreview = toDbLinkPreviewWithoutThumbnail(preview)
  try {
    const result = await supabase
      .from('notes')
      .update({ link_preview: linkPreview })
      .eq('id', row.id)
      .select()
      .single()
    if (!result.error) return result.data as DbNote
    console.debug(
      'mustard [link-preview] thumbnail reference cleanup failed:',
      result.error.message,
    )
  } catch (error) {
    console.debug('mustard [link-preview] thumbnail reference cleanup failed:', error)
  }
  return row
}

/** Delete an immutable object only after its final note reference is gone. */
async function cleanupUnreferencedThumbnail(path: string): Promise<void> {
  const { count, error } = await supabase
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('link_preview->>thumbnailPath', path)
  if (error) throw new Error(`Failed to count thumbnail references: ${error.message}`)
  if (count === 0) await deleteLinkPreviewThumbnail(path)
}

/** Clear the cached index. Call on login/logout/mutations to ensure fresh data. */
export async function invalidateRemoteIndexCache(): Promise<void> {
  await browser.storage.session.remove(INDEX_CACHE_KEY)
}
