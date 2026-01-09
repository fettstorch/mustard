import type { MustardNote } from '@/shared/model/MustardNote'
import { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNotesService } from './service/MustardNotesService'
import { MustardNotesServiceLocal } from './service/MustardNotesServiceLocal'

const services: MustardNotesService[] = [new MustardNotesServiceLocal()]

const myself = 'local' // TODO login via google/bluesky

export const mustardNotesManager = {
  async queryMustardNotesFor(pageUrl: string): Promise<MustardNote[]> {
    // Query all services and merge results
    const results = await Promise.all(services.map((s) => s.queryNotes(pageUrl, myself)))
    return results.flat()
  },

  async queryMustardIndex(): Promise<MustardIndex> {
    return (await Promise.all(services.map((s) => s.queryIndex(myself)))).reduce(
      (acc, index) => acc.merge(index),
      new MustardIndex(new Map()),
    )
  },

  upsertNote(note: MustardNote): Promise<void[]> {
    return Promise.all(services.map((s) => s.upsertNote(note)))
  },

  async deleteNote(noteId: string, pageUrl: string): Promise<void> {
    await Promise.all(services.map((s) => s.deleteNote(noteId, pageUrl)))
  },
}
