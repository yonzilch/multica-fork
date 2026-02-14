/**
 * System tray (menu bar) for the desktop app.
 *
 * Shows agent/hub status and allows window show/hide even
 * when the main window is closed.
 */
import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import path from 'node:path'
import { getCurrentHub, getDefaultAgent } from './ipc/hub.js'

let tray: Tray | null = null
let mainWindowRef: BrowserWindow | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null
let checkForUpdatesFn: (() => void) | null = null

export interface TrayOptions {
  onCheckForUpdates?: () => void
}

/**
 * Create the system tray and start status polling.
 */
export function createTray(window: BrowserWindow, options?: TrayOptions): void {
  mainWindowRef = window
  checkForUpdatesFn = options?.onCheckForUpdates ?? null

  // Use dedicated tray icon (asterisk shape matching MulticaIcon).
  // On macOS, Electron auto-picks trayTemplate.png / trayTemplate@2x.png
  // and treats "Template" suffix as a template image (adapts to dark/light menu bar).
  const iconPath = path.join(process.env.APP_ROOT!, 'build', 'trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon)
  tray.setToolTip('Multica')

  // Initial menu
  updateTrayMenu()

  // Poll status every 2 seconds
  statusInterval = setInterval(updateTrayMenu, 2000)
}

/**
 * Destroy tray and stop polling.
 */
export function destroyTray(): void {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
  mainWindowRef = null
  checkForUpdatesFn = null
}

function showMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return
  mainWindowRef.show()
  mainWindowRef.focus()
}

function updateTrayMenu(): void {
  if (!tray) return

  const hub = getCurrentHub()
  const agent = getDefaultAgent()

  let agentStatus = 'Initializing'
  let hubStatus = 'Disconnected'
  let gatewayUrl = ''

  if (hub) {
    hubStatus = hub.connectionState === 'connected' ? 'Connected' : 'Disconnected'
    gatewayUrl = hub.url
  }

  if (agent && !agent.closed) {
    if (agent.isStreaming) {
      agentStatus = 'Streaming'
    } else if (agent.isRunning) {
      agentStatus = 'Running'
    } else {
      agentStatus = 'Idle'
    }
  }

  tray.setToolTip(`Multica - Agent: ${agentStatus}`)

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `Agent: ${agentStatus}`, enabled: false },
    { label: `Hub: ${hubStatus}`, enabled: false },
  ]

  if (gatewayUrl) {
    template.push({ label: `Gateway: ${gatewayUrl}`, enabled: false })
  }

  template.push(
    { type: 'separator' },
    { label: 'Show Main Window', click: showMainWindow },
    { type: 'separator' },
    { label: `Version ${app.getVersion()}`, enabled: false },
  )

  if (checkForUpdatesFn) {
    const fn = checkForUpdatesFn
    template.push({ label: 'Check for Updates', click: () => fn() })
  }

  template.push(
    { type: 'separator' },
    { label: 'Quit Multica', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
}
