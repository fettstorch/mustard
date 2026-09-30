import type { Message } from './messaging'

/** Thrown by the background when a remote write is attempted on an outdated client. */
export const CLIENT_OUTDATED_ERROR = 'CLIENT_OUTDATED'

/**
 * True when a message mutates remote backend state. Used by the content-script
 * relay and the background dispatcher to block writes from outdated clients.
 * Local note upserts/deletes are excluded.
 */
export function isRemoteMutationMessage(message: Message): boolean {
  switch (message.type) {
    case 'UPSERT_NOTE':
      return message.target === 'remote'
    case 'DELETE_NOTE':
      return message.authorId !== 'local'
    case 'SET_REPOST':
    case 'UPSERT_COMMENT':
    case 'DELETE_COMMENT':
    case 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE':
    case 'MARK_NOTIFICATION_SEEN':
    case 'SET_PAGE_SUBSCRIPTION':
    case 'SET_USER_SUBSCRIPTION':
    case 'SET_IDENTITY_SUBSCRIPTION':
      return true
    default:
      return false
  }
}
