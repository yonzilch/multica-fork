// Patch console methods to handle EPIPE errors in Electron main process
// This MUST be done before any other imports that might use console
// EPIPE happens when stdout/stderr pipes are closed unexpectedly
const originalConsoleLog = console.log.bind(console)
const originalConsoleError = console.error.bind(console)
const originalConsoleWarn = console.warn.bind(console)

const safeLog = (...args: unknown[]) => {
  try {
    originalConsoleLog(...args)
  } catch {
    // Ignore EPIPE errors silently
  }
}

const safeError = (...args: unknown[]) => {
  try {
    originalConsoleError(...args)
  } catch {
    // Ignore EPIPE errors silently
  }
}

const safeWarn = (...args: unknown[]) => {
  try {
    originalConsoleWarn(...args)
  } catch {
    // Ignore EPIPE errors silently
  }
}

// Override global console
console.log = safeLog
console.error = safeError
console.warn = safeWarn

// Also handle process stdout/stderr EPIPE errors
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return // Ignore
  throw err
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return // Ignore
  throw err
})

// Bridge Vite build-time env to process.env for externalized @multica/core
// In dev mode, electron-vite already loads .env into process.env;
// In packaged builds, only import.meta.env has the value (injected at build time).
if (import.meta.env.MAIN_VITE_API_URL) {
  process.env.MULTICA_API_URL ??= import.meta.env.MAIN_VITE_API_URL
}

import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerAllIpcHandlers, initializeApp, cleanupAll, setupDeviceConfirmation, setAuthMainWindow, handleAuthDeepLink } from './ipc/index.js'
import { appStateManager } from '@multica/core'
import { createUpdater, AutoUpdater } from './updater/index.js'
import { createTray, destroyTray } from './tray.js'

// CJS output will have __dirname natively, but TypeScript source needs this for type checking
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// APP_ROOT points to apps/desktop (two levels up from out/main/)
process.env.APP_ROOT = path.join(__dirname, '../..')

// electron-vite uses ELECTRON_RENDERER_URL for dev server
export const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
// electron-vite outputs to out/ directory
export const MAIN_DIST = path.join(__dirname)
export const RENDERER_DIST = path.join(__dirname, '../renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// CLI flags
const forceOnboarding = process.argv.includes('--force-onboarding')

let win: BrowserWindow | null
let updater: AutoUpdater
let isQuitting = false

// ============================================================================
// Custom Protocol for Auth (multica://)
// ============================================================================

// Register custom protocol - must be called before app.whenReady()
if (process.defaultApp) {
  // Development: need to pass the script path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('multica', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  // Production
  app.setAsDefaultProtocolClient('multica')
}

// Handle protocol URL on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('[Auth] Received open-url:', url)
  if (url.startsWith('multica://')) {
    handleAuthDeepLink(url)
  }
})

// Handle second instance (Windows/Linux - when app is already running)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Show and focus window
    if (win) {
      if (!win.isVisible()) win.show()
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    // Handle protocol URL from command line (Windows)
    const url = commandLine.find(arg => arg.startsWith('multica://'))
    if (url) {
      console.log('[Auth] Received second-instance URL:', url)
      handleAuthDeepLink(url)
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 500,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 17 },  // Vertically centered in 48px header
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      // Enable node integration for IPC
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open external links in system browser instead of inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide window on close instead of quitting (tray keeps running)
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win?.hide()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  // Keep app running with tray on all platforms
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else if (win && !win.isVisible()) {
    win.show()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  destroyTray()
  cleanupAll()
})

app.whenReady().then(async () => {
  // Reset onboarding if --force-onboarding flag is passed (for development testing)
  if (forceOnboarding) {
    console.log('[dev] Resetting onboarding state...')
    appStateManager.resetOnboarding()
    console.log('[dev] Onboarding state reset')
  }

  // App-level IPC handlers
  ipcMain.handle('app:getFlags', () => ({ forceOnboarding }))

  // Register all IPC handlers before creating window
  registerAllIpcHandlers()

  // Initialize Hub and create default agent
  await initializeApp()

  createWindow()

  // Initialize auto-updater
  const forceDevUpdate = process.env.FORCE_DEV_UPDATE === 'true'
  updater = createUpdater(forceDevUpdate)
  updater.setMainWindow(() => win)

  // Set up device confirmation flow, auth, and tray (requires window)
  if (win) {
    setupDeviceConfirmation(win)
    setAuthMainWindow(win)
    createTray(win, {
      onCheckForUpdates: () => updater.checkForUpdates(),
    })
  }

  // Auto-check for updates in production (or when forced in dev)
  const isDev = !!VITE_DEV_SERVER_URL
  if (!isDev || forceDevUpdate) {
    win?.once('ready-to-show', () => {
      updater.checkForUpdates()
    })
  }

  // Update IPC handlers
  ipcMain.handle('update:check', async () => {
    await updater.checkForUpdates()
  })

  ipcMain.handle('update:download', async () => {
    await updater.downloadUpdate()
  })

  ipcMain.handle('update:install', () => {
    updater.quitAndInstall()
  })
})
