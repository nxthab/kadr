// «Студия фрагмента» page (fork nxthab/kadr, see STUDIO.md). Mounted by
// player.tsx for ?studio=1 in a window of its own (electron/studio.ts).
// Managed by Kadr — do not edit in the workspace.
//
// One fragment, a stretch A–B of it in a loop, the timeline's sound under it,
// its defineParams values as knobs (live while dragged, saved to params.json
// once let go — the same file the editor and the render read), and
// «→ в журнал»: the values plus a note, appended to the studio journal.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Player, PlayerRef } from '@remotion/player'
import { setParamValues, paramDeclarations } from './runtime'

interface Cfg {
  fragmentId: string
  a: number
  b: number
  clipZero: number
  clipSpeed: number
  audio: { url: string; start: number; inPoint: number; duration: number; speed: number; gain: number }[]
  projectDir: string | null
  label?: string
}

const K = window as any
const bridge = (): any => K.kadr

function readCfg(): Cfg | null {
  try {
    const raw = new URLSearchParams(location.search).get('cfg') || ''
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(b64))))
  } catch {
    return null
  }
}

async function loadSaved(id: string): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`/src/fragments/${encodeURIComponent(id)}/params.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return {}
    const v = JSON.parse(await r.text())
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

const css = `
  html, body, #root { margin: 0; height: 100%; background: #15171c; color: #d8dbe3; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
  .st { display: flex; height: 100%; }
  .st-view { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .st-stage { flex: 1; display: flex; align-items: center; justify-content: center; background: #0d0f13; min-height: 0; padding: 12px; }
  .st-bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid #262a33; flex-wrap: wrap; }
  .st-side { width: 340px; border-left: 1px solid #262a33; overflow: auto; padding: 12px; box-sizing: border-box; }
  .st-side h3 { margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8a90a0; }
  .st-row { display: grid; grid-template-columns: 1fr 70px; gap: 6px; align-items: center; margin: 6px 0; }
  .st-row label { grid-column: 1 / -1; color: #b7bcc8; }
  .st input[type=range] { width: 100%; }
  .st input[type=number], .st select, .st textarea { background: #1d2028; color: #e6e8ee; border: 1px solid #333846; border-radius: 4px; padding: 3px 5px; font: inherit; }
  .st textarea { width: 100%; box-sizing: border-box; min-height: 70px; resize: vertical; }
  .st button { background: #262a33; color: #e6e8ee; border: 1px solid #3a4050; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .st button.on { background: #3d6bd8; border-color: #3d6bd8; }
  .st button.primary { background: #2f8f6a; border-color: #2f8f6a; }
  .st-time { font-variant-numeric: tabular-nums; color: #9aa1b2; min-width: 150px; }
  .st-note { color: #8a90a0; font-size: 12px; margin-top: 6px; word-break: break-all; }
`

function Studio({ id }: { id: string }) {
  const cfg = useMemo(readCfg, [])
  const ref = useRef<PlayerRef>(null)
  const [entry, setEntry] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [a, setA] = useState(cfg?.a ?? 0)
  const [b, setB] = useState(cfg?.b ?? 2)
  const [rate, setRate] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(0)
  const [decl, setDecl] = useState<Record<string, any>>({})
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [note, setNote] = useState('')
  const [journalMsg, setJournalMsg] = useState('')
  const [muted, setMuted] = useState(false)
  const saveTimers = useRef<Record<string, any>>({})

  // the fragment and its saved values
  useEffect(() => {
    import(/* @vite-ignore */ '/src/fragments/lazy.ts?kadr=' + Date.now())
      .then(({ loaders }) => {
        const load = (loaders as Record<string, () => Promise<any>>)[id]
        if (!load) throw new Error('unknown composition: ' + id)
        return Promise.all([load(), loadSaved(id)])
      })
      .then(([m, saved]) => {
        setParamValues('saved', saved)
        const d = paramDeclarations() as Record<string, any>
        setDecl(d)
        const v: Record<string, unknown> = {}
        for (const [k, x] of Object.entries(d)) v[k] = k in saved ? saved[k] : x.value
        setValues(v)
        setEntry(m.fragment)
      })
      .catch((e) => setError(String(e?.stack || e)))
  }, [id])

  const fps = entry?.meta.fps ?? 30
  const total = entry?.meta.durationInFrames ?? 1
  const inF = Math.max(0, Math.min(total - 2, Math.round(a * fps)))
  const outF = Math.max(inF + 1, Math.min(total - 1, Math.round(b * fps) - 1))

  // the timeline's sound under the loop
  const audio = useMemo(() => (cfg?.audio ?? []).map((c) => {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.src = c.url
    el.volume = Math.max(0, Math.min(1, c.gain))
    return { c, el }
  }), [cfg])
  const syncAudio = (f: number, play: boolean, hard: boolean) => {
    if (!cfg) return
    const tl = cfg.clipZero + f / fps / (cfg.clipSpeed || 1)
    for (const { c, el } of audio) {
      const local = tl - c.start
      if (play && !muted && local >= 0 && local < c.duration) {
        const want = c.inPoint + local * c.speed
        if (hard || el.paused || Math.abs(el.currentTime - want) > 0.08) el.currentTime = want
        el.playbackRate = c.speed * rate
        if (el.paused) el.play().catch(() => {})
      } else if (!el.paused) el.pause()
    }
  }

  useEffect(() => {
    const p = ref.current
    if (!p || !entry) return
    let last = -1
    let n = 0
    const onFrame = (e: any) => {
      const f = e.detail.frame
      setFrame(f)
      const wrapped = f < last - 1
      last = f
      if (p.isPlaying() && (wrapped || ++n % 15 === 0)) syncAudio(f, true, wrapped)
    }
    const onPlay = () => { setPlaying(true); syncAudio(p.getCurrentFrame(), true, true) }
    const onPause = () => { setPlaying(false); syncAudio(p.getCurrentFrame(), false, true) }
    const onSeeked = () => syncAudio(p.getCurrentFrame(), p.isPlaying(), true)
    p.addEventListener('frameupdate', onFrame)
    p.addEventListener('play', onPlay)
    p.addEventListener('pause', onPause)
    p.addEventListener('seeked', onSeeked)
    return () => {
      p.removeEventListener('frameupdate', onFrame)
      p.removeEventListener('play', onPlay)
      p.removeEventListener('pause', onPause)
      p.removeEventListener('seeked', onSeeked)
    }
  }, [entry, audio, rate, muted, inF, outF])

  // keys: space play/pause, [ ] set A/B, ← → a frame
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = ref.current
      if (!p || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'Space') { e.preventDefault(); p.isPlaying() ? p.pause() : p.play() }
      else if (e.key === '[') setA(p.getCurrentFrame() / fps)
      else if (e.key === ']') setB((p.getCurrentFrame() + 1) / fps)
      else if (e.key === 'ArrowLeft') { p.pause(); p.seekTo(Math.max(inF, p.getCurrentFrame() - 1)) }
      else if (e.key === 'ArrowRight') { p.pause(); p.seekTo(Math.min(outF, p.getCurrentFrame() + 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, inF, outF])

  // a knob moved: live at once, saved to params.json when it rests
  const setValue = (k: string, v: unknown) => {
    const next = { ...values, [k]: v }
    setValues(next)
    const live = { ...((globalThis as any).__kadrParams?.live ?? {}), [k]: v }
    setParamValues('live', live)
    clearTimeout(saveTimers.current[k])
    saveTimers.current[k] = setTimeout(() => {
      bridge()?.fragmentParamsWrite?.(id, { [k]: v }).catch((e: any) => setJournalMsg('не сохранилось: ' + e))
    }, 350)
  }

  const toJournal = async () => {
    const d: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(decl)) d[k] = { default: x.value, min: x.min, max: x.max, label: x.label }
    try {
      const r = await bridge().studioJournal({
        projectDir: cfg?.projectDir ?? null, fragmentId: id, label: cfg?.label, a: Number(a.toFixed(3)), b: Number(b.toFixed(3)),
        fps, values, decl: d, note: note.trim()
      })
      setJournalMsg('записано: ' + r.path)
      setNote('')
    } catch (e) {
      setJournalMsg('не записалось: ' + e)
    }
  }

  if (error) return <pre style={{ color: '#f66', padding: 20, whiteSpace: 'pre-wrap' }}>{error}</pre>
  if (!entry) return <div style={{ padding: 20, color: '#8a90a0' }}>загрузка фрагмента…</div>
  const { width, height } = entry.meta
  const tSec = frame / fps

  return (
    <div className="st">
      <style>{css}</style>
      <div className="st-view">
        <div className="st-stage">
          <Player
            ref={ref}
            component={entry.component}
            durationInFrames={total}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            inFrame={inF}
            outFrame={outF}
            loop
            playbackRate={rate}
            style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: `${width} / ${height}`, width: width >= height ? '100%' : 'auto', height: width >= height ? 'auto' : '100%' }}
            controls={false}
            clickToPlay
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
          />
        </div>
        <div className="st-bar">
          <button className={playing ? 'on' : ''} onClick={() => { const p = ref.current; if (p) p.isPlaying() ? p.pause() : p.play() }}>{playing ? '❚❚' : '▶'} цикл</button>
          <span className="st-time">{tSec.toFixed(2)} с · кадр {frame}</span>
          <span>A</span><input type="number" step={0.01} value={Number(a.toFixed(2))} onChange={(e) => setA(Number(e.target.value))} style={{ width: 70 }} />
          <button onClick={() => setA(frame / fps)} title="[">A = сейчас</button>
          <span>B</span><input type="number" step={0.01} value={Number(b.toFixed(2))} onChange={(e) => setB(Number(e.target.value))} style={{ width: 70 }} />
          <button onClick={() => setB((frame + 1) / fps)} title="]">B = сейчас</button>
          <span>скорость</span>
          {[0.25, 0.5, 1].map((r) => <button key={r} className={rate === r ? 'on' : ''} onClick={() => setRate(r)}>{r}×</button>)}
          <button className={muted ? '' : 'on'} onClick={() => { setMuted(!muted); syncAudio(frame, false, true) }}>звук</button>
        </div>
      </div>
      <div className="st-side">
        <div style={{ fontWeight: 600 }}>{cfg?.label || id}</div>
        <div className="st-note">пробел — цикл · [ ] — A/B · ← → — кадр</div>
        <h3>Крутилки</h3>
        {!Object.keys(decl).length && <div className="st-note">У фрагмента нет параметров (defineParams).</div>}
        {Object.entries(decl).map(([k, d]) => {
          const v = values[k]
          if (typeof d.value === 'boolean') {
            return <div className="st-row" key={k}><label><input type="checkbox" checked={v === true} onChange={(e) => setValue(k, e.target.checked)} /> {d.label || k}</label></div>
          }
          if (typeof d.value === 'string') {
            return <div className="st-row" key={k}><label>{d.label || k}</label><input type="text" value={String(v)} onChange={(e) => setValue(k, e.target.value)} style={{ gridColumn: '1 / -1' }} /></div>
          }
          const n = Number(v)
          const min = d.min ?? 0, max = d.max ?? Math.max(1, n * 2)
          const step = d.step ?? (max - min) / 200
          return (
            <div className="st-row" key={k}>
              <label>{d.label || k}</label>
              <input type="range" min={min} max={max} step={step} value={n} onChange={(e) => setValue(k, Number(e.target.value))} />
              <input type="number" min={min} max={max} step={step} value={Number(n.toFixed(4))} onChange={(e) => { const x = Number(e.target.value); if (Number.isFinite(x)) setValue(k, x) }} />
            </div>
          )
        })}
        <h3>В журнал</h3>
        <textarea placeholder="что изменилось и почему: «плита влетает мягче, оттяжка как пружина»" value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ marginTop: 8 }}><button className="primary" onClick={() => void toJournal()}>→ в журнал</button></div>
        {journalMsg && <div className="st-note">{journalMsg}</div>}
      </div>
    </div>
  )
}

export function mountStudio(id: string) {
  createRoot(document.getElementById('root')!).render(<Studio id={id} />)
}
