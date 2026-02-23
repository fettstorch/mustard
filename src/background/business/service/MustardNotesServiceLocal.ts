import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { MustardIndex } from '@/shared/model/MustardIndex'
import { DtoMustardIndex } from '@/shared/dto/DtoMustardIndex'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { LIMITS } from '@/shared/constants'

const LOCAL_AUTHOR_ID = 'local'
const storageKey = `mustard-notes-${chrome.runtime.id}`
const storageIndexKey = `${storageKey}-index`

/** Returns the storage key for notes on a specific page */
function notesKey(pageUrl: string): string {
  return `${storageKey}-notes-${pageUrl}`
}

/**
 * Local storage service for mustard notes.
 * Stores the user's own local/draft notes in chrome.storage.local.
 * All notes here have authorId='local' — no follows filtering needed.
 */
export class MustardNotesServiceLocal implements MustardNotesService {
  async queryIndex(): Promise<MustardIndex> {
    const result = await chrome.storage.local.get(storageIndexKey)
    const dto = (result[storageIndexKey] ?? {}) as DtoMustardIndex
    return DtoMustardIndex.fromDto(dto)
  }

  async queryNotes(pageUrl: string): Promise<MustardNote[]> {
    const key = notesKey(pageUrl)
    const result = await chrome.storage.local.get(key)
    const dtos = (result[key] ?? []) as DtoMustardNote[]
    return dtos.map(DtoMustardNote.fromDto)
  }

  async upsertNote(note: MustardNote): Promise<void> {
    // No validation for local storage - user can manage their own local storage as they see fit
    // Selector length is still validated to prevent issues with very long selectors
    if (
      note.anchorData.elementSelector &&
      note.anchorData.elementSelector.length > LIMITS.SELECTOR_MAX_LENGTH
    ) {
      throw new Error(`Element selector exceeds ${LIMITS.SELECTOR_MAX_LENGTH} character limit`)
    }

    const pageUrl = note.anchorData.pageUrl
    const key = notesKey(pageUrl)

    // Get existing notes for this page
    const result = await chrome.storage.local.get(key)
    const dtos = (result[key] ?? []) as DtoMustardNote[]

    // Find existing note by ID or add new
    const noteDto = DtoMustardNote.toDto(note)
    const existingIndex = dtos.findIndex((n) => n.id === noteDto.id)
    if (existingIndex >= 0) {
      dtos[existingIndex] = noteDto
    } else {
      dtos.push(noteDto)
    }

    // Save notes
    await chrome.storage.local.set({ [key]: dtos })

    // Update index to include this page for local user
    await this.addPageToIndex(pageUrl)
  }

  async deleteNote(noteId: string, pageUrl: string): Promise<void> {
    const key = notesKey(pageUrl)

    // Get existing notes
    const result = await chrome.storage.local.get(key)
    const dtos = (result[key] ?? []) as DtoMustardNote[]

    // Remove the note
    const filtered = dtos.filter((n) => n.id !== noteId)

    if (filtered.length === 0) {
      // No more notes on this page, remove the key and update index
      await chrome.storage.local.remove(key)
      await this.removePageFromIndex(pageUrl)
    } else {
      await chrome.storage.local.set({ [key]: filtered })
    }
  }

  private async addPageToIndex(pageUrl: string): Promise<void> {
    const result = await chrome.storage.local.get(storageIndexKey)
    const dto = (result[storageIndexKey] ?? {}) as DtoMustardIndex

    const pages = dto[LOCAL_AUTHOR_ID] ?? []
    if (!pages.includes(pageUrl)) {
      dto[LOCAL_AUTHOR_ID] = [...pages, pageUrl]
      await chrome.storage.local.set({ [storageIndexKey]: dto })
    }
  }

  private async removePageFromIndex(pageUrl: string): Promise<void> {
    const result = await chrome.storage.local.get(storageIndexKey)
    const dto = (result[storageIndexKey] ?? {}) as DtoMustardIndex

    const pages = dto[LOCAL_AUTHOR_ID] ?? []
    dto[LOCAL_AUTHOR_ID] = pages.filter((p) => p !== pageUrl)

    if (dto[LOCAL_AUTHOR_ID].length === 0) {
      delete dto[LOCAL_AUTHOR_ID]
    }

    await chrome.storage.local.set({ [storageIndexKey]: dto })
  }
}
