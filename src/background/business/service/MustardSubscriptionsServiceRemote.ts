import { supabase } from '@/background/supabase-client'
import { isPageSubscriptionSupported, type Subscription } from '@/shared/model/Subscription'

type DbSubscription = {
  id: string
  kind: 'page' | 'user'
  page_key: string | null
  target_user_id: string | null
  created_at: string
}

function fromDb(row: DbSubscription): Subscription | null {
  const createdAt = new Date(row.created_at).getTime()
  if (row.kind === 'page' && row.page_key) {
    return { id: row.id, kind: 'page', pageKey: row.page_key, createdAt }
  }
  if (row.kind === 'user' && row.target_user_id) {
    return { id: row.id, kind: 'user', targetUserId: row.target_user_id, createdAt }
  }
  return null
}

export class MustardSubscriptionsServiceRemote {
  async getSubscriptions(): Promise<Subscription[]> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, kind, page_key, target_user_id, created_at')
      .order('created_at', { ascending: false })
      .overrideTypes<DbSubscription[], { merge: false }>()
    if (error) throw new Error(`Failed to query subscriptions: ${error.message}`)
    return (data ?? []).map(fromDb).filter((row): row is Subscription => row !== null)
  }

  async setPageSubscription(
    subscriberId: string,
    pageKey: string,
    subscribed: boolean,
  ): Promise<void> {
    if (!isPageSubscriptionSupported(pageKey)) {
      throw new Error('Page subscriptions are not supported for this page')
    }
    if (!subscribed) {
      const { error } = await supabase
        .from('subscriptions')
        .delete()
        .eq('kind', 'page')
        .eq('page_key', pageKey)
      if (error) throw new Error(`Failed to remove page subscription: ${error.message}`)
      return
    }

    const { error } = await supabase.from('subscriptions').insert({
      subscriber_id: subscriberId,
      kind: 'page',
      page_key: pageKey,
    })
    if (error && error.code !== '23505') {
      throw new Error(`Failed to create page subscription: ${error.message}`)
    }
  }

  async setUserSubscription(
    subscriberId: string,
    targetUserId: string,
    subscribed: boolean,
  ): Promise<void> {
    if (subscriberId === targetUserId) throw new Error('Users cannot subscribe to themselves')
    if (!subscribed) {
      const { error } = await supabase
        .from('subscriptions')
        .delete()
        .eq('kind', 'user')
        .eq('target_user_id', targetUserId)
      if (error) throw new Error(`Failed to remove user subscription: ${error.message}`)
      return
    }

    const { error } = await supabase.from('subscriptions').insert({
      subscriber_id: subscriberId,
      kind: 'user',
      target_user_id: targetUserId,
    })
    if (error && error.code !== '23505') {
      throw new Error(`Failed to create user subscription: ${error.message}`)
    }
  }
}

export const mustardSubscriptionsServiceRemote = new MustardSubscriptionsServiceRemote()
