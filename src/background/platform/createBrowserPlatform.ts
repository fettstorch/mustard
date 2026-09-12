import { IdentityOAuthLoginFlow } from './IdentityOAuthLoginFlow'
import type { OAuthLoginFlow } from './OAuthLoginFlow'
import type { NativeNotificationDelivery } from './NativeNotificationDelivery'
import { WebExtensionNotificationDelivery } from './WebExtensionNotificationDelivery'
import { ChromeExtensionUpdateProvider } from '../business/service/extension-update/ChromeExtensionUpdateProvider'
import { FirefoxExtensionUpdateProvider } from '../business/service/extension-update/FirefoxExtensionUpdateProvider'
import type { ExtensionUpdateProvider } from '../business/service/extension-update/ExtensionUpdateProvider'
import { SafariExtensionUpdateProvider } from '../business/service/extension-update/SafariExtensionUpdateProvider'
import { TabOAuthLoginFlow } from './TabOAuthLoginFlow'
import { usesTabLogin } from '@/shared/browser-capabilities'
import { UnavailableNotificationDelivery } from './UnavailableNotificationDelivery'

// Factories must be safe to import without touching browser-specific APIs.
export function createOAuthLoginFlow(): OAuthLoginFlow {
  if (usesTabLogin()) return new TabOAuthLoginFlow()
  return new IdentityOAuthLoginFlow()
}

export function createNativeNotificationDelivery(): NativeNotificationDelivery {
  if (import.meta.env.BROWSER === 'safari') return new UnavailableNotificationDelivery()
  return new WebExtensionNotificationDelivery()
}

export function createExtensionUpdateProvider(): ExtensionUpdateProvider {
  if (import.meta.env.BROWSER === 'safari') return new SafariExtensionUpdateProvider()
  return import.meta.env.FIREFOX
    ? new FirefoxExtensionUpdateProvider()
    : new ChromeExtensionUpdateProvider()
}
