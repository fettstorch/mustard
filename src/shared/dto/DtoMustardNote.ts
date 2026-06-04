import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import type { MustardNote } from '@/shared/model/MustardNote'

/**
 * Serializable DTO for MustardNote (for chrome.storage.local and chrome.runtime messaging)
 * Date is stored as Unix timestamp (milliseconds)
 */
export type DtoMustardNote = {
  id: string | null
  authorId: string
  content: string
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
      anchorData: dto.anchorData,
      updatedAt: new Date(dto.updatedAt),
      reposterIds: dto.reposterIds ?? [],
    }
  }
}
