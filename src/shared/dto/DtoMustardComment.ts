import type { MustardComment } from '@/shared/model/MustardComment'

/**
 * Serializable DTO for MustardComment (for chrome.runtime messaging).
 * Dates are stored as Unix timestamps (milliseconds).
 */
export type DtoMustardComment = {
  id: string
  noteId: string
  authorId: string
  content: string
  createdAt: number
  updatedAt: number
}

export namespace DtoMustardComment {
  export function toDto(comment: MustardComment): DtoMustardComment {
    return {
      id: comment.id,
      noteId: comment.noteId,
      authorId: comment.authorId,
      content: comment.content,
      createdAt: comment.createdAt.getTime(),
      updatedAt: comment.updatedAt.getTime(),
    }
  }

  export function fromDto(dto: DtoMustardComment): MustardComment {
    return {
      id: dto.id,
      noteId: dto.noteId,
      authorId: dto.authorId,
      content: dto.content,
      createdAt: new Date(dto.createdAt),
      updatedAt: new Date(dto.updatedAt),
    }
  }
}
