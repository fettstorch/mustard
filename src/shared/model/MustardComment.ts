/**
 * A comment on a (remote) MustardNote.
 *
 * Comments are public: anyone who can see the note can read all its comments
 * regardless of follow relationship. Comments are flat (no replies).
 */
export type MustardComment = {
  id: string
  noteId: string
  authorId: string // AT Protocol DID
  content: string
  createdAt: Date
  updatedAt: Date
}
