/**
 * A single unread @-mention for the popup's "Mentions" section.
 *
 * Represents one `notifications` row of type `mention`, joined with the note
 * (for the page URL) and the source content (note or comment) for a snippet.
 * The actor (the person who mentioned you) is resolved to a profile in the
 * background so the popup can render it without an extra round-trip.
 */
export type DtoMustardMention = {
  /** notifications.id — used to mark this specific mention seen. */
  id: string
  /** The note the mention lives on (or whose comment contains it). */
  noteId: string
  /** Page URL to open when the user clicks the mention. */
  pageUrl: string
  /** DID of the person who mentioned you. */
  actorId: string
  actorHandle: string | null
  actorDisplayName: string | null
  actorAvatarUrl: string | null
  /** Where the mention came from. */
  source: 'note' | 'comment'
  /** Short preview of the note/comment content (already stripped of markup). */
  snippet: string
  /** Unix ms timestamp. */
  createdAt: number
}
