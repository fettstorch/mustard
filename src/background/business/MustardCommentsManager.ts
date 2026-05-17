import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardCommentsService } from './service/MustardCommentsService'
import { MustardCommentsServiceRemote } from './service/MustardCommentsServiceRemote'

const commentsService: MustardCommentsService = new MustardCommentsServiceRemote()

/**
 * Facade for comment operations. Currently delegates everything to the remote
 * service — there is no "local comments" mode because local notes aren't
 * commentable (they only live on the user's machine).
 */
export const mustardCommentsManager = {
  /** Map of noteId → comments sorted oldest → newest. Missing noteIds return empty lists. */
  async queryCommentsForNotes(noteIds: string[]): Promise<Map<string, MustardComment[]>> {
    return commentsService.queryComments(noteIds)
  },

  /** Insert or update a comment. Caller must set authorId from the active session. */
  async upsertComment(comment: MustardComment): Promise<void> {
    await commentsService.upsertComment(comment)
  },

  /** Delete a comment. RLS enforces "only author can delete their own". */
  async deleteComment(commentId: string): Promise<void> {
    await commentsService.deleteComment(commentId)
  },

  /** Fetch fresh sorted comments for a single note (used as response after mutations). */
  async queryCommentsForNote(noteId: string): Promise<MustardComment[]> {
    const map = await commentsService.queryComments([noteId])
    return map.get(noteId) ?? []
  },
}
