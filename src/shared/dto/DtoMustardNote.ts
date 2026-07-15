import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { LinkPreview } from '@/shared/model/LinkPreview'

/**
 * Serializable DTO for MustardNote (for chrome.storage.local and chrome.runtime messaging)
 * Date is stored as Unix timestamp (milliseconds)
 */
export type DtoMustardNote = {
  id: string | null
  authorId: string
  content: string
  linkPreview?: LinkPreview
  /** Persisted for local notes so publishing them later does not recreate a dismissed preview. */
  linkPreviewDismissed?: boolean
  anchorData: MustardNoteAnchorData
  updatedAt: number // Unix timestamp in milliseconds
  /** Optional: omitted by older stored local notes and by upsert payloads (server-derived). */
  reposterIds?: string[]
}

export namespace DtoMustardNote {
  export function toDto(note: MustardNote): DtoMustardNote {
    return {
      id: note.id,
      authorId: note.authorId,
      content: note.content,
      ...(note.linkPreview ? { linkPreview: note.linkPreview } : {}),
      ...(note.linkPreviewDismissed ? { linkPreviewDismissed: true } : {}),
      anchorData: note.anchorData,
      updatedAt: note.updatedAt.getTime(),
      reposterIds: note.reposterIds,
    }
  }

  export function fromDto(dto: DtoMustardNote): MustardNote {
    return {
      id: dto.id,
      authorId: dto.authorId,
      content: dto.content,
      linkPreview: dto.linkPreview,
      ...(dto.linkPreviewDismissed ? { linkPreviewDismissed: true } : {}),
      anchorData: dto.anchorData,
      updatedAt: new Date(dto.updatedAt),
      reposterIds: dto.reposterIds ?? [],
    }
  }
}
