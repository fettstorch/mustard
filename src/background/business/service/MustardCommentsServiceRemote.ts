import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardCommentsService } from './MustardCommentsService'
import { supabase } from '@/background/supabase-client'
import { LIMITS } from '@/shared/constants'
import { deriveMentions } from '@/shared/mentions'

interface DbComment {
  id: string
  note_id: string
  author_id: string
  content: string
  mentions: string[]
  created_at: string
  updated_at: string
}

// PostgREST .in(...) builds the filter list into the URL. We chunk to stay
// well under typical URI length limits (the existing get-index uses 200).
const QUERY_BATCH_SIZE = 200

export class MustardCommentsServiceRemote implements MustardCommentsService {
  async queryComments(noteIds: string[]): Promise<Map<string, MustardComment[]>> {
    const result = new Map<string, MustardComment[]>()
    if (noteIds.length === 0) return result

    // Seed every requested note id with an empty list so callers can
    // distinguish "fetched, no comments" from "not fetched".
    for (const id of noteIds) result.set(id, [])

    for (let i = 0; i < noteIds.length; i += QUERY_BATCH_SIZE) {
      const batch = noteIds.slice(i, i + QUERY_BATCH_SIZE)
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .in('note_id', batch)
        .order('created_at', { ascending: true })

      if (error) {
        throw new Error(`Failed to query comments: ${error.message}`)
      }

      for (const row of (data as DbComment[] | null) ?? []) {
        const comment = dbCommentToMustardComment(row)
        const list = result.get(comment.noteId)
        if (list) list.push(comment)
        else result.set(comment.noteId, [comment])
      }
    }

    return result
  }

  async upsertComment(comment: MustardComment): Promise<void> {
    if (comment.content.length === 0) {
      throw new Error('Comment content must not be empty')
    }
    if (comment.content.length > LIMITS.COMMENT_CONTENT_MAX_LENGTH) {
      throw new Error(
        `Comment content exceeds ${LIMITS.COMMENT_CONTENT_MAX_LENGTH} character limit`,
      )
    }

    const row: Partial<DbComment> = {
      note_id: comment.noteId,
      author_id: comment.authorId,
      content: comment.content,
      // Mentions are derived from content at this write boundary (content is the
      // source of truth); the column exists only for the notification trigger.
      mentions: deriveMentions(comment.content, comment.authorId),
      updated_at: comment.updatedAt.toISOString(),
    }

    if (comment.id) {
      const { error } = await supabase.from('comments').update(row).eq('id', comment.id)
      if (error) {
        throw new Error(`Failed to update comment: ${error.message}`)
      }
    } else {
      const { error } = await supabase.from('comments').insert(row)
      if (error) {
        throw new Error(`Failed to insert comment: ${error.message}`)
      }
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from('comments').delete().eq('id', commentId)
    if (error) {
      throw new Error(`Failed to delete comment: ${error.message}`)
    }
  }
}

function dbCommentToMustardComment(row: DbComment): MustardComment {
  return {
    id: row.id,
    noteId: row.note_id,
    authorId: row.author_id,
    content: row.content,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}
