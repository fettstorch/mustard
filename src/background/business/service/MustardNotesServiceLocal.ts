import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardNotesService } from './MustardNotesService'
import { MustardIndex } from '@/shared/model/MustardIndex'
import { DtoMustardIndex } from './DtoMustardIndex'
import { DtoMustardNote } from './DtoMustardNote'

const LOCAL_USER_ID = 'local'
const storageKey = `mustard-notes-${chrome.runtime.id}`
const storageIndexKey = `${storageKey}-index`

/** Returns the storage key for notes on a specific page */
function notesKey(pageUrl: string): string {
  return `${storageKey}-notes-${pageUrl}`
}

export class MustardNotesServiceLocal implements MustardNotesService {
  /** Returns the user's follows (including self). For local, user only follows themselves. */
  private getFollows(userId: string): string[] {
    // Local user follows only themselves
    // A remote service would fetch this from the database
    return [userId]
  }

  async queryIndex(userId: string): Promise<MustardIndex> {
    const follows = this.getFollows(userId)

    const result = await chrome.storage.local.get(storageIndexKey)
    const dto = (result[storageIndexKey] ?? {}) as DtoMustardIndex

    // Filter to only include follows (same as remote would do)
    const filtered: DtoMustardIndex = {}
    for (const followId of follows) {
      if (dto[followId]) {
        filtered[followId] = dto[followId]
      }
    }

    return DtoMustardIndex.fromDto(filtered)
  }

  async queryNotes(pageUrl: string, userId: string): Promise<MustardNote[]> {
    const follows = this.getFollows(userId)

    const key = notesKey(pageUrl)
    const result = await chrome.storage.local.get(key)
    const dtos = (result[key] ?? []) as DtoMustardNote[]

    // Filter by authorId matching follows (same as remote would do)
    return dtos.filter((dto) => follows.includes(dto.authorId)).map(DtoMustardNote.fromDto)
  }

  async upsertNote(note: MustardNote): Promise<void> {
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

    const pages = dto[LOCAL_USER_ID] ?? []
    if (!pages.includes(pageUrl)) {
      dto[LOCAL_USER_ID] = [...pages, pageUrl]
      await chrome.storage.local.set({ [storageIndexKey]: dto })
    }
  }

  private async removePageFromIndex(pageUrl: string): Promise<void> {
    const result = await chrome.storage.local.get(storageIndexKey)
    const dto = (result[storageIndexKey] ?? {}) as DtoMustardIndex

    const pages = dto[LOCAL_USER_ID] ?? []
    dto[LOCAL_USER_ID] = pages.filter((p) => p !== pageUrl)

    if (dto[LOCAL_USER_ID].length === 0) {
      delete dto[LOCAL_USER_ID]
    }

    await chrome.storage.local.set({ [storageIndexKey]: dto })
  }
}
