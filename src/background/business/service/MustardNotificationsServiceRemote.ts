import type { MustardNotificationsService } from './MustardNotificationsService'
import { supabase } from '@/background/supabase-client'

const QUERY_BATCH_SIZE = 200

interface DbNotificationRow {
  note_id: string
}

export class MustardNotificationsServiceRemote implements MustardNotificationsService {
  async queryUnreadCountsForNotes(noteIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (noteIds.length === 0) return result

    for (let i = 0; i < noteIds.length; i += QUERY_BATCH_SIZE) {
      const batch = noteIds.slice(i, i + QUERY_BATCH_SIZE)
      // RLS filters to recipient_id = auth.jwt().sub automatically; no need to add it here.
      const { data, error } = await supabase
        .from('notifications')
        .select('note_id')
        .in('note_id', batch)

      if (error) {
        throw new Error(`Failed to query notification counts: ${error.message}`)
      }

      for (const row of (data as DbNotificationRow[] | null) ?? []) {
        result.set(row.note_id, (result.get(row.note_id) ?? 0) + 1)
      }
    }

    return result
  }

  async markSeenForNote(noteId: string): Promise<void> {
    // RLS limits deletes to recipient_id = auth.jwt().sub.
    const { error } = await supabase.from('notifications').delete().eq('note_id', noteId)
    if (error) {
      throw new Error(`Failed to mark notifications seen: ${error.message}`)
    }
  }

  async getTotalUnreadCount(): Promise<number> {
    // `head: true` makes Supabase return only the count, no rows.
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
    if (error) {
      throw new Error(`Failed to count notifications: ${error.message}`)
    }
    return count ?? 0
  }
}
