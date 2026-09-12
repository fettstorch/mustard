export type PendingLogin = { pending: true }
export type OAuthLoginStatus =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'failed'; message: string }

export const TAB_CALLBACK_URI = 'https://fettstorch.github.io/mustard/callback.html'
