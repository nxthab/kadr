// «Студия фрагмента» (fork nxthab/kadr, see STUDIO.md): one fragment alone in
// its own window — no project, no compositor, so it never stutters — playing a
// stretch A–B in a loop with the timeline's sound under it, its parameters
// (defineParams) as knobs next to it, and «→ в журнал»: the current values and
// a note appended to a journal the motion skill reads.
//
// The page itself is the fragment kit's studio.tsx, served by the fragments'
// dev server like every preview; this window gives it the editor's preload
// behind context isolation (window.kadr: params write, journal, media URLs).
import { BrowserWindow, ipcMain, app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { ensureServer } from './fragments'

export interface StudioAudio {
  /** kadr:// media URL (window.kadr.fileUrl) */
  url: string
  /** timeline seconds where the clip starts, its source in-point, length, speed, gain */
  start: number
  inPoint: number
  duration: number
  speed: number
  gain: number
}

export interface StudioOpen {
  fragmentId: string
  /** loop, composition seconds of the fragment */
  a: number
  b: number
  /** timeline seconds of composition time 0 (clip.start − inPoint/speed) and the clip's speed */
  clipZero: number
  clipSpeed: number
  audio: StudioAudio[]
  /** the project folder: the journal is written next to the .kadr */
  projectDir: string | null
  label?: string
}

const windows = new Map<string, BrowserWindow>()

/** where «→ в журнал» writes: next to the project, else in Kadr's own folder */
export function journalPath(projectDir: string | null): string {
  return projectDir ? join(projectDir, 'kadr-studio-journal.jsonl') : join(app.getPath('userData'), 'kadr-studio-journal.jsonl')
}

async function openStudio(o: StudioOpen): Promise<{ ok: true }> {
  const { url } = await ensureServer()
  const cfg = Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
  const page = `${url}/?comp=${encodeURIComponent(o.fragmentId)}&studio=1&cfg=${cfg}`
  const open = windows.get(o.fragmentId)
  if (open && !open.isDestroyed()) {
    await open.loadURL(page)
    open.focus()
    return { ok: true }
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#15171c',
    title: `Студия · ${o.label || o.fragmentId}`,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      // a page from the dev server: the bridge only, never node in the page
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setMenuBarVisibility(false)
  windows.set(o.fragmentId, win)
  win.on('closed', () => windows.delete(o.fragmentId))
  await win.loadURL(page)
  return { ok: true }
}

async function appendJournal(entry: Record<string, unknown>): Promise<{ path: string }> {
  const projectDir = typeof entry.projectDir === 'string' ? entry.projectDir : null
  const path = journalPath(projectDir)
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'
  await fs.appendFile(path, line, 'utf8')
  return { path }
}

export function registerStudioIpc() {
  ipcMain.handle('studio:open', (_e, o: StudioOpen) => openStudio(o))
  ipcMain.handle('studio:journal', (_e, entry: Record<string, unknown>) => appendJournal(entry))
}
