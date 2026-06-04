import type { MustardNotificationsService, RawMention } from './MustardNotificationsService'
import { supabase } from '@/background/supabase-client'
import { makeMentionSentinelRegex } from '@/shared/mentions'

const QUERY_BATCH_SIZE = 200
const SNIPPET_MAX_LENGTH = 100

interface DbNotificationRow {
  note_id: string
}

interface DbMentionRow {
  id: string
  note_id: string
  comment_id: string | null
  actor_id: string
  created_at: string
  notes: { page_url: string; content: string } | null
  comments: { content: string } | null
}

/**
 * Collapse note/comment markdown into a short, plain-ish preview for the popup:
 * replace image markdown with a 🖼 marker, turn `@[did]` sentinels into a bare
 * `@…`, and squeeze whitespace. (Handles aren't known here — the DB only stores
 * DIDs.)
 */
function toSnippet(content: string): string {
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼')
    .replace(makeMentionSentinelRegex(), '@…')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > SNIPPET_MAX_LENGTH ? `${text.slice(0, SNIPPET_MAX_LENGTH - 1)}…` : text
}

export class MustardNotificationsServiceRemote implements MustardNotificationsService {
  async queryUnreadCountsForNotes(noteIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (noteIds.length === 0) return result

    for (let i = 0; i < noteIds.length; i += QUERY_BATCH_SIZE) {
      const batch = noteIds.slice(i, i + QUERY_BATCH_SIZE)
      // RLS filters to recipient_id = auth.jwt().sub automatically; no need to add it here.
      // type='comment' is essential: mention rows also carry note_id, so without
      // this filter a mention would be miscounted as an unread comment on that note.
      const { data, error } = await supabase
        .from('notifications')
        .select('note_id')
        .eq('type', 'comment')
        .in('note_id', batch)

      if (error) {
        throw new Error(`Failed to query notification counts: ${error.message}`)
      }

      for (const row of (data as DbNotificationRow[] | null) ?? []) {
        result.set(row.note_id, (result.get(row.note_id) ?? 0) + 1)
      }
    }

    return result
  }

  async markSeenForNote(noteId: string): Promise<void> {
    // RLS limits deletes to recipient_id = auth.jwt().sub.
    // type='comment' so opening a note's comment thread clears only comment
    // notifications — mention rows are acknowledged separately (markMentionSeen)
    // via the popup's Mentions section, not silently wiped here.
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('type', 'comment')
      .eq('note_id', noteId)
    if (error) {
      throw new Error(`Failed to mark notifications seen: ${error.message}`)
    }
  }

  async getTotalUnreadCount(): Promise<number> {
    // Deliberately counts ALL unread rows for the recipient — both comment and
    // mention types — so the action badge reflects total attention needed.
    // `head: true` makes Supabase return only the count, no rows.
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
    if (error) {
      throw new Error(`Failed to count notifications: ${error.message}`)
    }
    return count ?? 0
  }

  async getMyMentions(): Promise<RawMention[]> {
    // RLS scopes to recipient_id = auth.jwt().sub. Embeds pull the note's page
    // URL + the source content for the snippet.
    // supabase-js infers embedded resources as arrays, but a to-one FK embed
    // (notifications → notes/comments) returns a single object (or null) at
    // runtime — overrideTypes(merge:false) restates the real row shape.
    const { data, error } = await supabase
      .from('notifications')
      .select(
        'id, note_id, comment_id, actor_id, created_at, notes(page_url, content), comments(content)',
      )
      .eq('type', 'mention')
      .order('created_at', { ascending: false })
      .overrideTypes<DbMentionRow[], { merge: false }>()

    if (error) {
      throw new Error(`Failed to query mentions: ${error.message}`)
    }

    return (data ?? [])
      .filter((row) => row.notes != null)
      .map((row) => {
        const isComment = row.comment_id != null
        const rawContent = isComment ? (row.comments?.content ?? '') : (row.notes?.content ?? '')
        return {
          id: row.id,
          noteId: row.note_id,
          pageUrl: row.notes?.page_url ?? '',
          actorId: row.actor_id,
          source: isComment ? 'comment' : 'note',
          snippet: toSnippet(rawContent),
          createdAt: new Date(row.created_at).getTime(),
        } satisfies RawMention
      })
  }

  async markMentionSeen(notificationId: string): Promise<void> {
    // RLS limits deletes to recipient_id = auth.jwt().sub.
    const { error } = await supabase.from('notifications').delete().eq('id', notificationId)
    if (error) {
      throw new Error(`Failed to mark mention seen: ${error.message}`)
    }
  }
}
