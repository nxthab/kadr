// Where the export puts each audio clip, checked with the real ffmpeg on
// synthetic media through the real ExportMuxer (electron/ffmpeg.ts).
//
//   node scripts/check-audio-placement.mjs [runs=10] [path/to/ffmpeg.ts]
//
// Every clip is a short tone burst; the mux is a VIDEO export (that is where
// ffmpeg 8.1 used to drop adelay at random and put a clip at 0:00), run several
// times since the fault was not deterministic. Each burst must start on its
// timeline sample in every run.
import { mkdtempSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runs = Number(process.argv[2] || 10)
const src = resolve(process.argv[3] || join(root, 'electron', 'ffmpeg.ts'))
const dir = mkdtempSync(join(tmpdir(), 'kadr-place-'))
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a])
let fails = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fails++
}
try {
  const mod = join(dir, 'ffmpeg.mjs')
  buildSync({
    entryPoints: [src], bundle: true, platform: 'node', format: 'esm', outfile: mod,
    alias: { '@shared': join(root, 'shared') }, logLevel: 'warning'
  })
  const { ExportMuxer } = await import(pathToFileURL(mod).href)

  const D = 12
  ff('-f', 'lavfi', '-i', `testsrc2=s=640x360:r=25:d=${D}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'v.mp4'))
  // a fragment-like render: video + a silent opus track, as long as the film
  ff('-f', 'lavfi', '-i', `testsrc2=s=320x180:r=25:d=${D}`, '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${D}`,
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus', '-shortest', join(dir, 'frag.webm'))
  // bursts at 1 kHz: [start, length, source in-point]
  const clips = [[1, 0.2, 0], [2, 0.2, 0], [2.9, 0.2, 0], [3.4, 0.1, 0], [4.4, 0.05, 0], [5.8, 3.5, 0], [9.876, 2.124, 4.134]]
  const segs = [{ path: join(dir, 'frag.webm'), start: 0, inPoint: 0, duration: D, gain: 1, speed: 1, fadeIn: 0, fadeOut: 0 }]
  clips.forEach(([start, len, inPoint], i) => {
    const p = join(dir, `b${i}.wav`)
    // silence before the in-point, so a wrong in-point shows as a late onset
    ff('-f', 'lavfi', '-i', `aevalsrc='if(gte(t,${inPoint}),0.3*sin(2*PI*1000*t),0)':s=44100:d=${inPoint + len}`, p)
    segs.push({ path: p, start, inPoint, duration: len, gain: 1, speed: 1, fadeIn: 0, fadeOut: 0 })
  })
  const onsets = (file) => {
    const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
    const a = new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2)
    const out = []
    let quiet = 480 // 10 ms of silence separates two bursts
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]) > 0.05) { if (quiet >= 480) out.push(i / 48000); quiet = 0 } else quiet++
    }
    return out
  }
  const preset = { id: 't', audioOnly: false, ffmpegVideo: 'copy', audioCodec: 'pcm_s16le', audioBitrate: '1536k' }
  let wrong = 0
  for (let r = 0; r < runs; r++) {
    const out = join(dir, `o${r}.mov`)
    await new ExportMuxer().run({ projectName: 't', preset, outputPath: out, width: 640, height: 360, fps: 25, duration: D, audioSegments: segs }, join(dir, 'v.mp4'), () => {})
    const got = onsets(out)
    const ok = got.length === clips.length && clips.every(([s], i) => Math.abs(got[i] - s) < 0.002)
    if (!ok) wrong++
    if (!ok && wrong === 1) console.log('  first wrong run, onsets:', got.map((x) => x.toFixed(3)).join(' '))
  }
  check(`every clip on its sample in ${runs} video muxes`, wrong === 0, wrong ? `${wrong} of ${runs} runs misplaced a clip` : '')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
