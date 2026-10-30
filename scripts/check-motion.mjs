// Node-side check of src/engine/motionCheck.ts (2D motion in «Проверка»).
// Smooth moves must pass, the moves a viewer calls choppy must be caught.
// No test runner in the repo: transpile with esbuild, import through a data URL.
// Run: node scripts/check-motion.mjs
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { transformSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src', 'engine', 'motionCheck.ts'), 'utf8')
const js = transformSync(src, { loader: 'ts', format: 'esm' }).code
const { trackIssues } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let fails = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fails++
}

// curves
const clamp = (k) => Math.max(0, Math.min(1, k))
const ioC = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const outC = (k) => 1 - Math.pow(1 - k, 3)
const lin = (k) => k

/** a track sampled at the inspect rate (fps 60): rest, move from a to b over [t0, t1], rest */
function move({ ease, x0 = 0, x1 = 600, t0 = 0.5, t1 = 1.0, dur = 2, fps = 60, o = () => 1, extra = {}, drift = 0 }) {
  const samples = []
  for (let i = 0; i <= dur * fps; i++) {
    const t = i / fps
    const k = ease(clamp((t - t0) / (t1 - t0)))
    samples.push([t, x0 + (x1 - x0) * k + drift * t, 540, 1, o(t)])
  }
  return { name: 'obj', samples, ...extra }
}
const opts = { fps: 30, width: 1920 }
const kinds = (tr) => trackIssues(tr, opts).filter((i) => i.level === 'warn').map((i) => i.reason)
const all = (tr) => trackIssues(tr, opts).map((i) => i.reason)
const has = (tr, r) => all(tr).includes(r)

// smooth: in-out from rest to rest
check('in-out 300 px / 0.6 s: no warnings', kinds(move({ ease: ioC, x1: 300, t1: 1.1 })).length === 0, all(move({ ease: ioC, x1: 300, t1: 1.1 })).join(','))
// the classic choppy entries
check('ease-out from rest: hard start', has(move({ ease: outC }), 'hardStart'))
check('ease-out from rest: stop is fine', !has(move({ ease: outC }), 'hardStop'))
check('linear: hard start and stop', has(move({ ease: lin }), 'hardStart') && has(move({ ease: lin }), 'hardStop'))
// allowed: ease-out when it flies in from beyond the edge
check('ease-out from offscreen: no warnings', kinds(move({ ease: outC, x0: -200, x1: 300, t1: 1.5, extra: { starts: 'offscreen' } })).length === 0,
  all(move({ ease: outC, x0: -200, x1: 300, t1: 1.5, extra: { starts: 'offscreen' } })).join(','))
// a living hold: slow drift is not a move to judge
check('drift 10 px/s: clean', kinds(move({ ease: () => 0, drift: 10 })).length === 0)
// whip: 1000 px in 0.3 s in-out
const whip = move({ ease: ioC, x1: 1000, t0: 0.5, t1: 0.8 })
check('whip 1000 px / 0.3 s: strobes', has(whip, 'strobe'), trackIssues(whip, opts).map((i) => i.message).join(' | '))
check('whip with blur: no strobe', !has({ ...whip, blur: true }, 'strobe'))
// two moves glued at speed: 300 px/s steady, then suddenly 900 px/s — a kink, no stop
const glued = { name: 'obj', samples: Array.from({ length: 121 }, (_, i) => {
  const t = i / 60
  const ramp = ioC(clamp(t / 0.3)) * 300 // eased start
  const x = t < 1 ? 300 * Math.max(0, t - 0.15) : 255 + 900 * (t - 1)
  return [t, Math.max(x, 0) + 0 * ramp, 540, 1, 1]
}) }
check('speed jump 300 → 900 px/s: kink', has(glued, 'speedStep'), all(glued).join(','))
check('whip in-out 0.3 s: no false kink', !has(whip, 'speedStep'), all(whip).join(','))
// a jump inside the shot
const jump = { name: 'obj', samples: Array.from({ length: 60 }, (_, i) => [i / 60, i < 30 ? 100 : 700, 540, 1, 1]) }
check('teleport 600 px: jump', has(jump, 'jump'))
// readable text: 300 px/s steady vs 80 px/s
const pan = (pxs, readable = true) => ({ name: 'text', readable, samples: Array.from({ length: 121 }, (_, i) => {
  const t = i / 60
  const k = ioC(clamp(t / 0.3)) // eased start, then steady
  return [t, 200 + pxs * Math.max(0, t - 0.15) * k, 540, 1, 1]
}) })
check('readable 400 px/s: too fast', has(pan(400), 'readableFast'))
check('readable 80 px/s: fine', !has(pan(80), 'readableFast'))
// fading in while moving with ease-out: opacity hides the first frames only partly
const fadeRise = move({ ease: outC, x1: 40, t0: 0.5, t1: 0.82, o: (t) => clamp((t - 0.5) / 0.32) })
check('fade + 40 px ease-out rise: flagged as hard start', has(fadeRise, 'hardStart'), kinds(fadeRise).join(','))
const fadeRiseIO = move({ ease: ioC, x1: 40, t0: 0.5, t1: 0.82, o: (t) => clamp((t - 0.5) / 0.32) })
check('fade + 40 px in-out rise: clean', kinds(fadeRiseIO).length === 0, kinds(fadeRiseIO).join(','))
// scale: zooming a 1000 px plate 1 → 1.5 with ease-out from rest
const zoom = { name: 'plate', size: [1000, 600], samples: Array.from({ length: 121 }, (_, i) => {
  const t = i / 60
  return [t, 960, 540, 1 + 0.5 * outC(clamp((t - 0.5) / 0.4)), 1]
}) }
check('scale ease-out from rest: hard start', has(zoom, 'hardStart'))

console.log(fails ? `\n${fails} FAIL` : '\nall PASS')
process.exit(fails ? 1 : 0)
