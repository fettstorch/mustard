import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BrowserContext } from '@playwright/test'
import { expect, test } from './extension.fixture'

const fixtureUrl = 'http://127.0.0.1:4173/page.html'
const windowTitle = 'Mustard Windows shortcut E2E'
const execFileAsync = promisify(execFile)

async function serviceWorker(context: BrowserContext) {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker')
}

async function readMinimizedState(context: BrowserContext): Promise<boolean> {
  const worker = await serviceWorker(context)
  return worker.evaluate(async () => {
    const { ['mustard-notes-minimized']: minimized } =
      await chrome.storage.local.get('mustard-notes-minimized')
    return Boolean(minimized)
  })
}

/**
 * Sends a key combination through Windows rather than Playwright's renderer
 * keyboard API. Extension commands are browser-level shortcuts, so only the
 * native path proves that Chromium receives and dispatches the binding.
 */
async function sendWindowsShortcut(key: number): Promise<void> {
  const script = `
    Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class MustardKeyboard {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

  public static INPUT Key(ushort virtualKey, bool keyUp) {
    return new INPUT {
      type = 1,
      u = new INPUTUNION {
        ki = new KEYBDINPUT { wVk = virtualKey, dwFlags = keyUp ? 0x0002u : 0u }
      }
    };
  }
}
'@
    $target = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } |
      Select-Object -First 1
    if ($null -eq $target) { throw 'Could not find the headed Chromium test window.' }

    $shell = New-Object -ComObject WScript.Shell
    if (-not $shell.AppActivate($target.Id)) { throw 'Could not activate the Chromium test window.' }
    Start-Sleep -Milliseconds 250
    $inputs = [MustardKeyboard+INPUT[]]@(
      [MustardKeyboard]::Key(0x12, $false),
      [MustardKeyboard]::Key(${key}, $false),
      [MustardKeyboard]::Key(${key}, $true),
      [MustardKeyboard]::Key(0x12, $true)
    )
    $sent = [MustardKeyboard]::SendInput(
      $inputs.Length,
      $inputs,
      [Runtime.InteropServices.Marshal]::SizeOf([type][MustardKeyboard+INPUT])
    )
    if ($sent -ne $inputs.Length) { throw "SendInput inserted $sent of $($inputs.Length) events." }
    Start-Sleep -Milliseconds 250
  `
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ])
}

test.describe('Windows keyboard shortcuts', () => {
  test.skip(
    process.platform !== 'win32' || process.env.MUSTARD_NATIVE_SHORTCUT_TEST !== '1',
    'Requires the headed native-input Windows CI job.',
  )

  test('registers and dispatches the Windows defaults', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    await expect(page.locator('#mustard-host')).toBeAttached({ timeout: 8_000 })
    await page.evaluate((title) => {
      document.title = title
    }, windowTitle)
    await page.bringToFront()

    const worker = await serviceWorker(context)
    const shortcuts = await worker.evaluate(async () => {
      const commands = await chrome.commands.getAll()
      return Object.fromEntries(commands.map(({ name, shortcut }) => [name, shortcut]))
    })

    // `_execute_action` opens Chromium's extension popup, whose UI is owned by
    // the browser. The explicit command values ensure all three native combos
    // are available; the two app commands below are additionally dispatched.
    expect(shortcuts).toMatchObject({
      _execute_action: 'Alt+M',
      'toggle-minimize-notes': 'Alt+H',
      'show-all-notes': 'Alt+G',
    })

    await worker.evaluate(() => chrome.storage.local.set({ 'mustard-notes-minimized': false }))
    await sendWindowsShortcut(0x48) // H
    await expect.poll(() => readMinimizedState(context), { timeout: 8_000 }).toBe(true)

    await sendWindowsShortcut(0x48) // H
    await expect.poll(() => readMinimizedState(context), { timeout: 8_000 }).toBe(false)

    await sendWindowsShortcut(0x47) // G
    await expect(page.locator('#mustard-load-all-toast')).toHaveText(
      'Log in to Mustard to see all notes on this page',
      { timeout: 8_000 },
    )
  })
})
