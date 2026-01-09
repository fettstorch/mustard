import { MustardIndex } from '@/shared/model/MustardIndex'

type PageUrl = string
type UserId = string

/**
 * Serializable DTO for MustardIndex (for chrome.storage.local)
 * Map is stored as a plain object (Record)
 */
export type DtoMustardIndex = Record<UserId, PageUrl[]>

export namespace DtoMustardIndex {
  export function toDto(index: MustardIndex): DtoMustardIndex {
    return Object.fromEntries(index.entries())
  }

  export function fromDto(dto: DtoMustardIndex): MustardIndex {
    return new MustardIndex(new Map(Object.entries(dto)))
  }
}
