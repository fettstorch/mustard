import {
  createOpenNoteEditorMessage,
  broadcastToAllTabs,
  sendMessage,
  sendTabMessage,
  type Message,
  type ResponseFor,
  type QueryCommentsResponse,
  type QueryNotificationsForNotesResponse,
} from '@/shared/messaging'
import { mustardNotesManager } from '@/background/business/MustardNotesManager'
import { mustardCommentsManager } from '@/background/business/MustardCommentsManager'
import { mustardNotificationsManager } from '@/background/business/MustardNotificationsManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { DtoMustardComment } from '@/shared/dto/DtoMustardComment'
import {
  createNativeNotifications,
  clearNativeNotificationState,
} from '@/background/native-notifications'
import { login, atprotoDid } from '@/background/auth/AtprotoAuth'
import {
  getSession,
  logout,
  storeSession,
  primaryIdentity,
  purgeLegacySessionStorage,
} from '@/background/auth/SessionStore'
import { loginWithGithub } from '@/background/auth/GithubAuth'
import {
  listIdentities,
  disconnectProvider,
  resolveIdentities,
  resolveGithubAccounts,
  getGithubMentionCandidates,
} from '@/background/auth/AuthBridge'
import { clearSupabaseJwt, storeSupabaseJwt, getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { MustardProfileServiceBsky } from '@/background/business/service/MustardProfileServiceBsky'
import type { UserProfile, LinkedIdentity } from '@/shared/model/UserProfile'
import { MustardMutualsServiceBsky } from '@/background/business/service/MustardMutualsServiceBsky'
import { invalidateRemoteIndexCache } from '@/background/business/service/MustardNotesServiceRemote'
import {
  getAppStatus,
  isClientOutdated,
  requestClientUpdate,
} from '@/background/business/service/AppStatusService'
import { CLIENT_OUTDATED_ERROR, isRemoteMutationMessage } from '@/shared/remote-mutation'
import { githubAvatarUrl } from '@/shared/providers'

/** Builds a github UserProfile from an id + login, falling back to the id when the login is unknown. */
function buildGithubProfile(id: string, login: string | undefined): UserProfile {
  return {
    type: 'github',
    id,
    handle: login ?? id,
    displayName: login ?? id,
    avatarUrl: login ? githubAvatarUrl(login) : undefined,
  }
}

export default defineBackground(() => {
  const profileService = new MustardProfileServiceBsky()
  const mutualsService = new MustardMutualsServiceBsky()

  console.log('Mustard background service worker loaded')

  // One-time cleanup of pre-multi-provider session storage (see SessionStore).
  void purgeLegacySessionStorage()

  /** Broadcast session change to all tabs so content scripts can update their state */
  async function broadcastSessionChanged(userId: string | null) {
    await broadcastToAllTabs({ type: 'SESSION_CHANGED', userId })
  }

  /**
   * Pull the authoritative list of linked identities for `userId` from the
   * server and persist it as the canonical session. All display fields are
   * derived from the identity set at read time (see primaryIdentity/atprotoDid),
   * so there is nothing to denormalize here. Returns the new session, or
   * undefined if the identity list is empty (account gone).
   */
  async function syncSessionIdentities(
    jwt: string,
    userId: string,
  ): Promise<Awaited<ReturnType<typeof getSession>>> {
    const identities = await listIdentities(jwt)
    if (identities.length === 0) return undefined

    const session = { userId, identities }
    await storeSession(session)
    return session
  }

  /**
   * Resolve opaque Mustard user UUIDs to display profiles: an atproto identity
   * becomes a rich Bluesky profile, a github-only account a github profile, and
   * anything unresolved stays null. Shared by GET_PROFILES (authors/reposters)
   * and mention-actor enrichment so both paths handle post-UUID-migration ids.
   */
  async function resolveProfilesByUserId(
    jwt: string | null,
    userIds: string[],
  ): Promise<Record<string, UserProfile | null>> {
    const profiles: Record<string, UserProfile | null> = {}
    for (const id of userIds) profiles[id] = null
    if (userIds.length === 0) return profiles

    const idMap = jwt
      ? await resolveIdentities(jwt, userIds).catch((err) => {
          console.warn('resolveProfilesByUserId: resolveIdentities failed:', err)
          return new Map<string, LinkedIdentity[]>()
        })
      : new Map<string, LinkedIdentity[]>()

    // atproto preferred (resolvable Bluesky profile); otherwise build from github login.
    const didByKey = new Map<string, string>()
    for (const id of userIds) {
      const linked = idMap.get(id)
      const atproto = linked?.find((l) => l.provider === 'atproto')
      const github = linked?.find((l) => l.provider === 'github')
      if (atproto) didByKey.set(id, atproto.providerAccountId)
      else if (github) profiles[id] = buildGithubProfile(id, github.handle)
    }

    const dids = [...new Set(didByKey.values())]
    const bskyByDid = dids.length ? await profileService.getProfiles(dids) : {}
    for (const [key, did] of didByKey) {
      const p = bskyByDid[did]
      if (p) profiles[key] = { ...p, id: key }
    }
    return profiles
  }

  /** Broadcast that the unread-notifications state changed. Popup re-queries; content scripts can refresh in-page dots. */
  async function broadcastNotificationsChanged() {
    await broadcastToAllTabs({ type: 'NOTIFICATIONS_CHANGED' })
    // Popup runtime listener is reached via runtime.sendMessage (not tab-scoped).
    sendMessage({ type: 'NOTIFICATIONS_CHANGED' }).catch(() => {})
  }

  /**
   * Shared cleanup after a mutation that can change THIS user's unread
   * notifications (remote note/comment deletion cascades, mark-seen): drop the
   * stale index cache, refresh the toolbar badge, and tell the popup + content
   * scripts. Fire-and-forget — callers don't need to await the fan-out.
   */
  function afterNotificationMutation(): void {
    invalidateRemoteIndexCache()
    void updateActionBadge()
    void broadcastNotificationsChanged()
  }

  /**
   * Acknowledge one notification by id — the single code path that both the
   * popup's mention press (via the MARK_MENTION_SEEN message) and a native-toast
   * click funnel through, so "engage with the notification → it's seen" behaves
   * identically on both surfaces. Deletes the row (any type) and fans out the
   * badge/UI refresh.
   */
  async function acknowledgeNotification(notificationId: string): Promise<void> {
    await mustardNotificationsManager.markNotificationSeen(notificationId)
    afterNotificationMutation()
  }

  // Native OS notifications. The mechanics live in the dedicated module; here we
  // just wire in the data sources. dispatch() rides the existing every-page-load
  // / popup-open trigger (GET_ATPROTO_SESSION below).
  const nativeNotifications = createNativeNotifications({
    async fetchUnread() {
      const session = await getSession()
      if (!session) return null
      const jwt = await getSupabaseJwt()
      return mustardNotificationsManager.getUnreadNotifications((ids) =>
        resolveProfilesByUserId(jwt, ids),
      )
    },
    acknowledge: acknowledgeNotification,
  })

  /**
   * Browser-agnostic accessor for the toolbar action API.
   * Chrome MV3 + Firefox MV3 expose `browser.action`; Firefox MV2 only has
   * `browser.browserAction`. WXT's `browser` is a raw global passthrough so
   * we need to fall back ourselves.
   */
  function getActionApi(): {
    setBadgeText: (args: { text: string }) => Promise<void> | void
    setBadgeBackgroundColor: (args: { color: string }) => Promise<void> | void
    openPopup?: () => Promise<void>
  } | null {
    const b = browser as unknown as Record<string, unknown>
    return (
      (b.action as ReturnType<typeof getActionApi>) ??
      (b.browserAction as ReturnType<typeof getActionApi>) ??
      null
    )
  }

  /** Update the extension-icon badge with the current user's unread total. */
  async function updateActionBadge(): Promise<void> {
    const action = getActionApi()
    if (!action) return
    try {
      const session = await getSession()
      if (!session) {
        await action.setBadgeText({ text: '' })
        return
      }
      const count = await mustardNotificationsManager.getTotalUnreadCount()
      await action.setBadgeText({ text: count > 0 ? String(count) : '' })
      // Mustard accent for visibility; safe in both Chrome and Firefox.
      try {
        await action.setBadgeBackgroundColor({ color: '#d32f2f' })
      } catch {
        // Firefox MV2 historically required a different signature on older
        // versions; ignore failures so we never crash the badge update.
      }
    } catch (err) {
      console.debug('mustard [service-worker] updateActionBadge failed:', err)
    }
  }

  // Register the context-menu entry on every background wake-up, not just on
  // install. Firefox MV3 (bug 1771328, fixed only in Fx128) drops MV3 menu
  // entries on browser restart when they're created solely in onInstalled,
  // and disable→re-enable cycles can wipe them on any version. Top-level
  // registration + onStartup re-registration keeps the entry alive across
  // service-worker terminations on both Chrome and Firefox.
  async function ensureContextMenu() {
    try {
      await browser.contextMenus.removeAll()
      browser.contextMenus.create({
        id: 'mustard-add-note',
        title: 'Add Mustard',
        contexts: ['all'],
      })
    } catch (err) {
      console.debug('mustard [service-worker] ensureContextMenu failed:', err)
    }
  }

  browser.runtime.onInstalled.addListener((details) => {
    ensureContextMenu()

    if (details.reason === 'install') {
      browser.tabs.create({ url: 'https://fettstorch.github.io/mustard/' })
    }
  })

  browser.runtime.onStartup.addListener(() => {
    ensureContextMenu()
    updateActionBadge()
  })

  // Initial sync at SW startup (best-effort): re-registers the menu if the
  // browser dropped it, and seeds the badge.
  ensureContextMenu()
  updateActionBadge()

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'mustard-add-note' || !tab?.id) return
    try {
      await sendTabMessage(tab.id, createOpenNoteEditorMessage())
    } catch {
      // Content script not available (tab predates extension load, or context was invalidated).
    }
  })

  // Keyboard shortcuts (manifest `commands` field). Toggling storage here
  // automatically fans out to content scripts + popup + options via the
  // existing storage.onChanged listeners — no extra messaging needed.
  const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
  browser.commands?.onCommand.addListener(async (command) => {
    if (command === 'toggle-minimize-notes') {
      try {
        const { [NOTES_MINIMIZED_KEY]: current } =
          await browser.storage.local.get(NOTES_MINIMIZED_KEY)
        await browser.storage.local.set({ [NOTES_MINIMIZED_KEY]: !current })
      } catch (err) {
        console.debug('mustard [service-worker] toggle-minimize-notes failed:', err)
      }
    }
  })

  // One async handler per message type the service worker owns. Messages that
  // belong to other contexts (e.g. SESSION_CHANGED → content script) are simply
  // absent and fall through to "no response" in the listener below.
  type MessageHandlers = {
    [K in Message['type']]?: (
      message: Extract<Message, { type: K }>,
    ) => ResponseFor<K> | Promise<ResponseFor<K>>
  }

  const handlers: MessageHandlers = {
    UPSERT_NOTE: async (message) => {
      const session = await getSession()
      const target = message.target
      const pageUrl = message.data.anchorData.pageUrl

      let authorId: string
      if (target === 'local') {
        authorId = 'local'
      } else {
        if (!session) {
          console.error('Cannot publish note - user not logged in')
          return []
        }
        authorId = session.userId
      }

      const note = DtoMustardNote.fromDto({
        id: target === 'local' ? crypto.randomUUID() : null,
        authorId,
        content: message.data.content,
        anchorData: message.data.anchorData,
        updatedAt: message.data.updatedAt,
      })

      await mustardNotesManager.upsertNote(note, target)

      if (target === 'local') {
        const localNotes = await mustardNotesManager.queryLocalNotesFor(pageUrl)
        return localNotes.map(DtoMustardNote.toDto)
      }

      invalidateRemoteIndexCache()
      const allNotes = await mustardNotesManager.queryMustardNotesFor(pageUrl, session!.userId)

      if (message.localNoteIdToDelete) {
        await mustardNotesManager.deleteNote(message.localNoteIdToDelete, pageUrl, 'local')
        const filteredNotes = allNotes.filter((n) => n.id !== message.localNoteIdToDelete)
        return filteredNotes.map(DtoMustardNote.toDto)
      }

      return allNotes.map(DtoMustardNote.toDto)
    },

    QUERY_NOTES: async (message) => {
      const session = await getSession()
      const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, session?.userId)
      return notes.map(DtoMustardNote.toDto)
    },

    DELETE_NOTE: async (message) => {
      await mustardNotesManager.deleteNote(message.noteId, message.pageUrl, message.authorId)

      if (message.authorId === 'local') {
        const localNotes = await mustardNotesManager.queryLocalNotesFor(message.pageUrl)
        return localNotes.map(DtoMustardNote.toDto)
      }

      // Deleting a remote note cascades and may remove comment notifications too.
      afterNotificationMutation()

      const session = await getSession()
      const allNotes = await mustardNotesManager.queryMustardNotesFor(
        message.pageUrl,
        session?.userId,
      )
      return allNotes.map(DtoMustardNote.toDto)
    },

    SET_REPOST: async (message) => {
      const session = await getSession()
      if (!session) {
        console.error('Cannot repost - user not logged in')
        return []
      }

      await mustardNotesManager.setRepost(message.noteId, session.userId, message.reposted)

      // Repost changes visibility → bust the index cache so the next query
      // recomputes reposted note ids / reposter lists.
      invalidateRemoteIndexCache()

      const allNotes = await mustardNotesManager.queryMustardNotesFor(
        message.pageUrl,
        session.userId,
      )
      return allNotes.map(DtoMustardNote.toDto)
    },

    GITHUB_LOGIN: async (message) => {
      try {
        // If a currentJwt is not provided explicitly, try to get the active one
        // so the user's existing Mustard account is linked to GitHub.
        const jwt = message.currentJwt ?? (await getSupabaseJwt()) ?? undefined
        const result = await loginWithGithub(jwt)
        await storeSupabaseJwt(result.jwt, result.expiresAt, result.userId)
        // Enrich the session with the full identity set (github login may have
        // linked into an existing multi-provider account).
        await syncSessionIdentities(result.jwt, result.userId)
        invalidateRemoteIndexCache()
        broadcastSessionChanged(result.userId)
        updateActionBadge()
        return { userId: result.userId }
      } catch (err) {
        console.error('GITHUB_LOGIN failed:', err)
        return null
      }
    },

    ATPROTO_LOGIN: async (message) => {
      try {
        const result = await login(message.handle, message.currentJwt)
        await storeSupabaseJwt(result.jwt, result.expiresAt, result.userId)
        await syncSessionIdentities(result.jwt, result.userId)
        invalidateRemoteIndexCache()
        broadcastSessionChanged(result.userId)
        updateActionBadge()
        return { userId: result.userId, did: result.did }
      } catch (err) {
        console.error('ATPROTO_LOGIN failed:', err)
        return null
      }
    },

    GET_ATPROTO_SESSION: async () => {
      try {
        let session = await getSession()
        updateActionBadge()
        if (!session) return null

        // The single native-toast trigger: the content script (every page load)
        // and the popup (on open) both send this, so a new mention/comment
        // surfaces on any page — not only ones bearing notes. The dispatcher's
        // own throttle + seen-set keep repeat calls cheap and duplicate-free.
        void nativeNotifications.dispatch()

        // Older sessions (stored before multi-provider) may lack the identities
        // array. Lazily backfill it from the server so the options page can
        // render Connected Accounts without a separate round-trip.
        if (session.identities.length === 0) {
          const jwt = await getSupabaseJwt()
          if (jwt) session = (await syncSessionIdentities(jwt, session.userId)) ?? session
        }

        return {
          userId: session.userId,
          did: atprotoDid(session),
          provider: primaryIdentity(session)?.provider,
          identities: session.identities,
        }
      } catch (err) {
        console.error('GET_ATPROTO_SESSION failed:', err)
        return null
      }
    },

    ATPROTO_LOGOUT: async (message) => {
      try {
        await logout(message.userId)
        await clearSupabaseJwt()
        await clearNativeNotificationState()
        invalidateRemoteIndexCache()
        mutualsService.clear()
        broadcastSessionChanged(null)
        updateActionBadge()
        return null
      } catch (err) {
        console.error('ATPROTO_LOGOUT failed:', err)
        return null
      }
    },

    DISCONNECT_PROVIDER: async (message) => {
      try {
        const jwt = await getSupabaseJwt()
        if (!jwt) return null
        const session = await getSession()
        const result = await disconnectProvider(jwt, message.provider)

        if (result.accountDeleted) {
          // Last identity removed → the account (and all its content) is gone.
          // Tear down local state exactly like a logout.
          await logout(session?.userId ?? '')
          await clearSupabaseJwt()
          await clearNativeNotificationState()
          mutualsService.clear()
          broadcastSessionChanged(null)
        } else {
          // A secondary provider was unlinked; the account (userId) lives on.
          // Re-derive the primary display identity from what remains.
          await syncSessionIdentities(jwt, session!.userId)
          broadcastSessionChanged(session!.userId)
        }

        invalidateRemoteIndexCache()
        updateActionBadge()
        return result
      } catch (err) {
        console.error('DISCONNECT_PROVIDER failed:', err)
        return null
      }
    },

    OPEN_POPUP: () => {
      const action = getActionApi()
      action?.openPopup?.()?.catch(() => {})
    },

    GET_APP_STATUS: () => getAppStatus(),

    REQUEST_UPDATE: () => requestClientUpdate(),

    GET_PROFILES: async (message) => {
      try {
        const { userIds, mentions } = message
        const jwt = await getSupabaseJwt()

        // Authors/reposters: opaque UUIDs → linked identities → profiles.
        const profiles = await resolveProfilesByUserId(jwt, userIds)
        for (const m of mentions) profiles[m.accountId] ??= null

        // DIDs to resolve in one Bluesky batch, keyed back under the id the
        // caller asked for (the DID itself for atproto mentions).
        const didByKey = new Map<string, string>()
        // GitHub account ids still needing a login lookup (atproto mentions resolve
        // via Bluesky; github ones via the identities table).
        const githubAccountIds: string[] = []

        // Mentions: provider is explicit, so dispatch directly (no shape sniffing).
        for (const m of mentions) {
          if (m.provider === 'atproto') didByKey.set(m.accountId, m.accountId)
          else if (m.provider === 'github') githubAccountIds.push(m.accountId)
        }

        // GitHub mentions → @login via the identities table. Non-Mustard github
        // accounts stay unresolved (placeholder rendered).
        if (jwt && githubAccountIds.length > 0) {
          const loginByAccountId = await resolveGithubAccounts(jwt, githubAccountIds).catch(
            (err) => {
              console.warn('GET_PROFILES: resolveGithubAccounts failed:', err)
              return new Map<string, string | undefined>()
            },
          )
          for (const [accountId, login] of loginByAccountId) {
            profiles[accountId] = buildGithubProfile(accountId, login)
          }
        }

        // One Bluesky batch for every DID (authors + atproto mentions).
        const dids = [...new Set(didByKey.values())]
        const bskyByDid = dids.length ? await profileService.getProfiles(dids) : {}
        for (const [key, did] of didByKey) {
          const p = bskyByDid[did]
          if (p) profiles[key] = { ...p, id: key }
        }

        return profiles
      } catch (err) {
        console.error('GET_PROFILES failed:', err)
        return {}
      }
    },

    GET_MUTUALS: async () => {
      try {
        const session = await getSession()
        if (!session) return []
        // Mutuals service needs an atproto DID for the Bsky API call. A
        // github-only account has none, so there are no mutuals (expected).
        const did = atprotoDid(session)
        if (!did) return []
        return await mutualsService.getMutuals(did)
      } catch (err) {
        console.error('GET_MUTUALS failed:', err)
        return []
      }
    },

    GET_GITHUB_MENTION_CANDIDATES: async () => {
      try {
        const jwt = await getSupabaseJwt()
        if (!jwt) return []
        return await getGithubMentionCandidates(jwt)
      } catch (err) {
        console.error('GET_GITHUB_MENTION_CANDIDATES failed:', err)
        return []
      }
    },

    QUERY_COMMENTS: async (message) => {
      try {
        const map = await mustardCommentsManager.queryCommentsForNotes(message.noteIds)
        const response: QueryCommentsResponse = {}
        for (const [noteId, comments] of map.entries()) {
          response[noteId] = comments.map(DtoMustardComment.toDto)
        }
        return response
      } catch (err) {
        console.error('QUERY_COMMENTS failed:', err)
        return {}
      }
    },

    UPSERT_COMMENT: async (message) => {
      const session = await getSession()
      if (!session) {
        throw new Error('Cannot create comment - user not logged in')
      }

      await mustardCommentsManager.upsertComment({
        id: '', // not used by the insert path; service ignores empty string
        noteId: message.noteId,
        authorId: session.userId,
        content: message.content,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // A new comment notifies the note's *author* (not the commenter), so this
      // user's own badge/overview is unaffected — only the cached index needs
      // busting so the author picks it up on their next query.
      invalidateRemoteIndexCache()

      const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
      return fresh.map(DtoMustardComment.toDto)
    },

    DELETE_COMMENT: async (message) => {
      await mustardCommentsManager.deleteComment(message.commentId)
      // The cascade may delete an unread notification row for whoever was about
      // to be notified — refresh badge + overview.
      afterNotificationMutation()
      const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
      return fresh.map(DtoMustardComment.toDto)
    },

    QUERY_NOTIFICATIONS_FOR_NOTES: async (message) => {
      try {
        const session = await getSession()
        if (!session) return {}
        const map = await mustardNotificationsManager.queryUnreadCountsForNotes(message.noteIds)
        const response: QueryNotificationsForNotesResponse = {}
        for (const [noteId, count] of map.entries()) {
          if (count > 0) response[noteId] = count
        }
        return response
      } catch (err) {
        console.error('QUERY_NOTIFICATIONS_FOR_NOTES failed:', err)
        return {}
      }
    },

    MARK_NOTIFICATIONS_SEEN_FOR_NOTE: async (message) => {
      try {
        await mustardNotificationsManager.markSeenForNote(message.noteId)
        afterNotificationMutation()
      } catch (err) {
        console.error('MARK_NOTIFICATIONS_SEEN_FOR_NOTE failed:', err)
      }
      return null
    },

    GET_MY_PAGES_OVERVIEW: async () => {
      try {
        const session = await getSession()
        if (!session) return []
        const overview = await mustardNotificationsManager.queryMyPagesOverview(session.userId)
        // Sync the badge whenever the popup pulls the overview — this is a
        // cheap natural-event trigger to keep the badge fresh.
        updateActionBadge()
        return overview
      } catch (err) {
        console.error('GET_MY_PAGES_OVERVIEW failed:', err)
        return []
      }
    },

    GET_MY_MENTIONS: async () => {
      try {
        const session = await getSession()
        if (!session) return []
        const jwt = await getSupabaseJwt()
        const notifications = await mustardNotificationsManager.getUnreadNotifications((ids) =>
          resolveProfilesByUserId(jwt, ids),
        )
        return notifications.filter((n) => n.type === 'mention')
      } catch (err) {
        console.error('GET_MY_MENTIONS failed:', err)
        return []
      }
    },

    MARK_MENTION_SEEN: async (message) => {
      try {
        await acknowledgeNotification(message.notificationId)
      } catch (err) {
        console.error('MARK_MENTION_SEEN failed:', err)
      }
      return null
    },
  }

  // Receiving messages from the content-script and popup. Dispatch to the
  // matching handler; returning its Promise works on both Chrome (99+) and
  // Firefox. Unhandled types return undefined (no response).
  browser.runtime.onMessage.addListener((message: Message) => {
    const handler = handlers[message.type]
    console.debug(
      'mustard [service-worker] onMessage:',
      message,
      handler ? 'has handler' : 'no handler',
    )
    if (!handler) return
    return (async () => {
      if (isRemoteMutationMessage(message) && (await isClientOutdated())) {
        throw new Error(CLIENT_OUTDATED_ERROR)
      }
      // The map guarantees handler matches message.type at runtime; TS can't
      // correlate the indexed union, so we assert the call here.
      return (handler as (m: Message) => Promise<unknown> | void)(message)
    })()
  })
})
