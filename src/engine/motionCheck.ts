// «Проверка» of 2D motion: the objects a fragment DECLARES as moving
// (fragment.inspect.tracks — position, scale, opacity over time; see
// electron/fragment-kit/runtime.ts KadrTrack), sampled by the inspect page.
//
// It catches what a viewer calls «рубленая анимация» and a still contact sheet
// never shows: a move that starts at full speed from rest, a move that stops
// dead, a speed step inside a move, a fast move that strobes without blur,
// readable text moving too fast to read, a jump inside what should be one
// shot. The numbers come from the research behind the motion skill
// (design-system easing profiles, RED panning, ITU-R BT.1359, eye-tracking).
//
// Pure: no app imports, so scripts/check-motion.mjs runs it in node.
// Times are COMPOSITION seconds; checks.ts maps them onto the timeline.

/** [t, x, y, scale, opacity] — composition seconds, px, factor, 0..1 */
export type TrackSample = [number, number, number, number, number]

export interface InspectTrack {
  name: string
  /** the object's size [w, h] in px at scale 1: a scale change is measured as the travel of its corner */
  size?: [number, number]
  /** how its moves may begin / end: 'offscreen' (comes from / leaves beyond the frame edge),
      'impact' (a deliberate hit — still no instant stop, but a shorter brake is fine) */
  starts?: 'offscreen' | 'impact'
  ends?: 'offscreen' | 'impact'
  /** text the viewer reads while it is fully visible */
  readable?: boolean
  /** the fragment draws motion blur for it: fast moves are allowed */
  blur?: boolean
  samples: TrackSample[]
}

/** The limits, named; each with where it came from. */
export const MOTION_LIMITS = {
  /** slower than this the object is at rest (a living hold drifts 5–20 px/s) */
  restPxPerSec: 4,
  /** moves whose peak is below this are too slow for a start/stop to read as a jerk */
  floorPxPerSec: 30,
  /** a move that within its first 1/30 s already runs at this share of its own peak
      started at full speed (an in-out curve is at ~1–5 % there, an out-curve at 60–100 %) */
  startShare: 0.3,
  /** the same at the end: still this fast 1/30 s before it is at rest = stopped dead */
  stopShare: 0.3,
  /** with ends/starts 'impact' the brake may be shorter */
  impactShare: 0.6,
  /** inside a move: the speed jumping on ONE step by more than this share of the local
      peak (±0.5 s) while the steps around it change at least 3× less — a discontinuity,
      not the steady change of an eased curve */
  stepShare: 0.2,
  /** RED: no faster than one frame width per 7 s at 24 fps / 180° shutter ≈ 11 px per
      frame on a 1920 frame — for detailed picture. Flat graphics stand more, so above
      this it is only a note; above strobeWarnPxPerFrame without blur it is a warning.
      Per TIMELINE frame, at the move's PEAK (an eased move peaks at 1.5–7.7× its average). */
  strobePxPerFrame: 11,
  strobeWarnPxPerFrame: 60,
  /** readable text: eye-tracking puts loss of acuity at ~2°/s ≈ 115 px/s on a 16:9
      TV, ≈ 170 px/s on a 9:16 phone; we take the phone value per 1080 px of width */
  readablePxPerSecPer1080: 170,
  /** one step moving the object by more than this share of the frame width = a jump */
  jumpShare: 0.15
} as const

export type MotionReason = 'hardStart' | 'hardStop' | 'speedStep' | 'strobe' | 'readableFast' | 'jump'

export interface MotionIssue {
  track: string
  reason: MotionReason
  level: 'warn' | 'info'
  /** composition seconds */
  t: number
  end: number
  /** share of the peak, px per frame, px/s or share of width — see the message */
  amount: number
  message: string
}

const fmtT = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`

/** visible speed per step, px/s: travel of position + corner travel of the scale, weighted by opacity */
function speeds(tr: InspectTrack): { t: number; v: number; o: number; dx: number }[] {
  const s = tr.samples
  const r = tr.size ? Math.hypot(tr.size[0], tr.size[1]) / 2 : 100
  const out: { t: number; v: number; o: number; dx: number }[] = []
  for (let i = 0; i + 1 < s.length; i++) {
    const [t0, x0, y0, k0, o0] = s[i], [t1, x1, y1, k1, o1] = s[i + 1]
    const dt = t1 - t0
    if (dt <= 0) continue
    const d = Math.hypot(x1 - x0, y1 - y0) + Math.abs(k1 - k0) * r
    const o = Math.min(o0, o1)
    out.push({ t: (t0 + t1) / 2, v: (d / dt) * o, o, dx: Math.hypot(x1 - x0, y1 - y0) })
  }
  return out
}

/**
 * The motion issues of one track. `fps` is the TIMELINE frame rate (strobing is per
 * output frame), `width` the composition width (jumps, readable speed).
 */
export function trackIssues(tr: InspectTrack, opts: { fps: number; width: number }): MotionIssue[] {
  const L = MOTION_LIMITS
  const v = speeds(tr)
  const out: MotionIssue[] = []
  if (v.length < 3) return out
  const dt = (v[v.length - 1].t - v[0].t) / (v.length - 1)
  const look = Math.max(1, Math.round(1 / 30 / dt)) // how many steps make 1/30 s
  const name = tr.name

  // moving runs
  const runs: [number, number][] = []
  for (let i = 0; i < v.length; ) {
    if (v[i].v <= L.restPxPerSec) { i++; continue }
    let j = i
    while (j + 1 < v.length && v[j + 1].v > L.restPxPerSec) j++
    runs.push([i, j])
    i = j + 1
  }

  for (const [a, b] of runs) {
    let peak = 0, at = a
    for (let i = a; i <= b; i++) if (v[i].v > peak) { peak = v[i].v; at = i }
    if (peak < L.floorPxPerSec) continue

    // a start from rest inside the shot (the first sample of the track is a cut-in: no rest before it)
    if (a > 0) {
      const share = v[Math.min(b, a + look - 1)].v / peak
      const lim = tr.starts === 'impact' ? L.impactShare : L.startShare
      if (tr.starts !== 'offscreen' && share > lim) {
        out.push({ track: name, reason: 'hardStart', level: 'warn', t: v[a].t, end: v[Math.min(b, a + look)].t, amount: share,
          message: `«${name}» трогается сразу на ${Math.round(share * 100)}% своей пиковой скорости (${fmtT(v[a].t)}) — старт без разгона; из покоя нужна in-out кривая (y1 = 0, x1 ≥ 0.25)` })
      }
    }
    // a stop inside the shot
    if (b < v.length - 1) {
      const share = v[Math.max(a, b - look + 1)].v / peak
      const lim = tr.ends === 'impact' ? L.impactShare : L.stopShare
      if (tr.ends !== 'offscreen' && share > lim) {
        out.push({ track: name, reason: 'hardStop', level: 'warn', t: v[Math.max(a, b - look)].t, end: v[b].t, amount: share,
          message: `«${name}» останавливается намертво: за 1/30 с до остановки ещё ${Math.round(share * 100)}% пиковой скорости (${fmtT(v[b].t)}) — нужно торможение` })
      }
    }
    // a speed step inside the move (its first and last 1/30 s belong to start/stop)
    let stepFrom = -1, stepAmount = 0
    const flush = (i: number) => {
      if (stepFrom < 0) return
      out.push({ track: name, reason: 'speedStep', level: 'warn', t: v[stepFrom].t, end: v[i].t, amount: stepAmount,
        message: `«${name}»: скорость скачком меняется внутри движения на ${Math.round(stepAmount * 100)}% пика за один шаг (${fmtT(v[stepFrom].t)}) — склейка двух движений без общей траектории` })
      stepFrom = -1; stepAmount = 0
    }
    // a speed jump: |Δv| on ONE step far larger than on the steps around it. A smooth
    // curve changes its speed gradually (even easeInOutCubic, whose acceleration flips
    // at the peak: the speed itself stays continuous there); a jump in the speed is two
    // moves glued together, or a move switched on/off at speed.
    const half = Math.max(1, Math.round(0.5 / dt))
    for (let i = a + look; i + look <= b - look; i++) {
      let lp = 0
      for (let k = Math.max(a, i - half); k <= Math.min(b, i + half); k++) lp = Math.max(lp, v[k].v)
      const dv = Math.abs(v[i + 1].v - v[i].v)
      let around = 0
      for (let k = 1; k <= look; k++) {
        around = Math.max(around, Math.abs(v[i - k + 1].v - v[i - k].v), Math.abs(v[i + k + 1]?.v - v[i + k]?.v) || 0)
      }
      const d = dv / Math.max(lp, 1e-9)
      if (lp >= L.floorPxPerSec && d > L.stepShare && dv > 3 * around) {
        if (stepFrom < 0) stepFrom = i
        stepAmount = Math.max(stepAmount, d)
      } else flush(i)
    }
    flush(b)

    // strobing: the peak per OUTPUT frame
    const perFrame = peak / opts.fps
    if (!tr.blur && perFrame > L.strobePxPerFrame) {
      out.push({ track: name, reason: 'strobe', level: perFrame > L.strobeWarnPxPerFrame ? 'warn' : 'info', t: v[at].t, end: v[at].t, amount: perFrame,
        message: `«${name}» на пике проходит ${Math.round(perFrame)} px за кадр (${fmtT(v[at].t)}; без смаза ориентир ≤ ${L.strobePxPerFrame}) — будет стробить: медленнее, смаз 180° или 60 fps` })
    }
    // readable text moving too fast while fully visible
    if (tr.readable) {
      const lim = L.readablePxPerSecPer1080 * (opts.width / 1080)
      let worst = 0, wt = 0
      for (let i = a; i <= b; i++) if (v[i].o > 0.9 && v[i].v > worst) { worst = v[i].v; wt = v[i].t }
      if (worst > lim) {
        out.push({ track: name, reason: 'readableFast', level: 'warn', t: wt, end: wt, amount: worst,
          message: `читаемый «${name}» едет ${Math.round(worst)} px/с (${fmtT(wt)}; читать можно до ~${Math.round(lim)} px/с)` })
      }
    }
  }

  // jumps: a visible object moved a large share of the frame in one step
  for (const s of v) {
    if (s.o > 0.5 && s.dx > L.jumpShare * opts.width) {
      out.push({ track: name, reason: 'jump', level: 'warn', t: s.t, end: s.t, amount: s.dx / opts.width,
        message: `«${name}» скачком сместился на ${Math.round((s.dx / opts.width) * 100)}% ширины кадра за один шаг (${fmtT(s.t)}) — склейка внутри одного плана` })
    }
  }
  return out
}

/** All tracks of one fragment. */
export function motionIssues(tracks: InspectTrack[] | undefined, opts: { fps: number; width: number }): MotionIssue[] {
  return (tracks ?? []).flatMap((tr) => trackIssues(tr, opts))
}
