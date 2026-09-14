export type NativeNotificationPayload = { title: string; message: string }

export interface NativeNotificationDelivery {
  readonly supported: boolean
  /** Delay between attempts within one dispatch batch (including failed attempts). */
  readonly createSpacingMs: number
  create(id: string, payload: NativeNotificationPayload): Promise<void>
  clear(id: string): Promise<void>
  onClicked(listener: (id: string) => void): () => void
}
