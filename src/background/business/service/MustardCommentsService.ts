import type { MustardComment } from '@/shared/model/MustardComment'

export interface MustardCommentsService {
  /**
   * Returns all comments for the given note ids, grouped by note id.
   * Comments inside each group are sorted oldest → newest.
   *
   * Public read: works without a JWT (RLS allows anonymous SELECT).
   */
  queryComments(noteIds: string[]): Promise<Map<string, MustardComment[]>>

  /**
   * Insert a new comment. Requires a valid Supabase JWT (the comment's
   * `authorId` MUST equal the JWT's `sub`). After success the trigger
   * creates a notification row for the note's author (unless it's a
   * self-comment).
   */
  upsertComment(comment: MustardComment): Promise<void>

  /**
   * Delete a comment. Only the comment author can delete (enforced by RLS).
   */
  deleteComment(commentId: string): Promise<void>
}
