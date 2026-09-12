import type { NativeNotificationDelivery } from './NativeNotificationDelivery'

export class UnavailableNotificationDelivery implements NativeNotificationDelivery {
  readonly supported = false
  readonly createSpacingMs = 0

  async create(): Promise<void> {
    throw new Error('Native notifications are not supported in Safari.')
  }

  async clear(): Promise<void> {
    throw new Error('Native notifications are not supported in Safari.')
  }

  onClicked(): () => void {
    return () => {}
  }
}
