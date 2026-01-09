import type { MustardNoteAnchorData } from '@/shared/messaging'
import type { MustardNote } from '@/shared/model/MustardNote'

/**
 * Serializable DTO for MustardNote (for chrome.storage.local)
 * Date is stored as Unix timestamp (milliseconds)
 */
export type DtoMustardNote = {
  id: string
  authorId: string
  content: string
  anchorData: MustardNoteAnchorData
  updatedAt: number // Unix timestamp in milliseconds
}

export namespace DtoMustardNote {
  export function toDto(note: MustardNote): DtoMustardNote {
    return {
      id: note.id ?? crypto.randomUUID(),
      authorId: note.authorId,
      content: note.content,
      anchorData: note.anchorData,
      updatedAt: note.updatedAt.getTime(),
    }
  }

  export function fromDto(dto: DtoMustardNote): MustardNote {
    return {
      id: dto.id,
      authorId: dto.authorId,
      content: dto.content,
      anchorData: dto.anchorData,
      updatedAt: new Date(dto.updatedAt),
    }
  }
}
