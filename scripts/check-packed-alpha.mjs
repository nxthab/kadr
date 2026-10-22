// The packed alpha intermediate (makeDecoded with packed: true, electron/ffmpeg.ts),
// checked with the real ffmpeg on a synthetic VP9+alpha source.
//
//   node scripts/check-packed-alpha.mjs [path/to/ffmpeg.ts]
//
// The pack is colour on top, matte below, one H.264 frame of twice the height.
// The compositor reads the top half as BT.709 limited and the matte as the
// luma of the bottom half (limited range, expanded back by the decoder). So:
//   - the top half, decoded as BT.709, must give the RGB the source gives as
//     BT.601 — computed here from the raw planes, not by an ffmpeg filter;
//   - the matte must be 16 + alpha·219/255 (235 opaque, 16 clear);
//   - a BT.709 source must pass through untouched.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { buildSync } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(process.argv[2] || join(root, 'electron', 'ffmpeg.ts'))
const dir = mkdtempSync(join(tmpdir(), 'kadr-packed-'))
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
  const { makeDecoded } = await import(pathToFileURL(mod).href)

  // six 64×64 patches; the top row opaque, the bottom row opaque / clear / half
  const W = 384, H = 128
  const cols = [[40, 40, 40], [128, 128, 128], [220, 220, 220], [200, 60, 40], [60, 180, 90], [40, 70, 200]]
  const alphas = [255, 255, 255, 255, 0, 128]
  const rgba = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = x >> 6, o = (y * W + x) * 4
    rgba.set([...cols[i], y < 64 ? 255 : alphas[i]], o)
  }
  writeFileSync(join(dir, 'src.rgba'), rgba)
  // lossless VP9+alpha, untagged — what an RGB render encoded by ffmpeg looks like (BT.601)
  ff('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', '25', '-i', join(dir, 'src.rgba'),
    '-frames:v', '5', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuva420p', join(dir, 'src.webm'))

  const dump = (input, out, fmt, vp9) => {
    ff(...(vp9 ? ['-c:v', 'libvpx-vp9'] : []), '-i', join(dir, input), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', fmt, join(dir, out))
    return readFileSync(join(dir, out))
  }
  const s = dump('src.webm', 'src.yuva', 'yuva420p', true)
  const at = (buf, w, h, x, y) => [buf[y * w + x], buf[w * h + (y >> 1) * (w >> 1) + (x >> 1)], buf[w * h * 5 / 4 + (y >> 1) * (w >> 1) + (x >> 1)]]
  const toRgb = ([Y, U, V], kr, kb) => {
    const y = (Y - 16) * 255 / 219, u = (U - 128) * 255 / 224, v = (V - 128) * 255 / 224
    const r = y + 2 * (1 - kr) * v, b = y + 2 * (1 - kb) * u
    return [r, (y - kr * r - kb * b) / (1 - kr - kb), b]
  }

  // a BT.601 source: converted to BT.709 by the pack
  await makeDecoded(join(dir, 'src.webm'), join(dir, 'p601.mp4'), 0.2, undefined, { packed: true, codec: 'vp9', matrix: 'bt601' })
  const p = dump('p601.mp4', 'p601.yuv', 'yuv420p', false)
  let worst = 0, worstGrey = 0, where = ''
  cols.forEach((c, i) => {
    const want = toRgb(at(s, W, H, i * 64 + 32, 32), 0.299, 0.114)
    const got = toRgb(at(p, W, 2 * H, i * 64 + 32, 32), 0.2126, 0.0722)
    const d = Math.max(...want.map((v, k) => Math.abs(got[k] - v)))
    if (d > worst) { worst = d; where = `rgb(${c}) → ${got.map((v) => v.toFixed(1))} instead of ${want.map((v) => v.toFixed(1))}` }
    if (c[0] === c[1] && c[1] === c[2]) worstGrey = Math.max(worstGrey, d)
  })
  check('greys keep their level through the BT.601 → BT.709 pack', worstGrey <= 0.5, `worst ${worstGrey.toFixed(2)} levels`)
  check('colours stay within 1.5 levels of a direct BT.601 decode', worst <= 1.5, `worst ${worst.toFixed(2)}${worst > 1.5 ? ': ' + where : ''}`)

  const A = s.subarray(W * H * 3 / 2)
  const matte = [0, 4, 5].map((i) => {
    const x = i * 64 + 32, y = 96, a = A[y * W + x]
    return { a, got: p[(H + y) * W + x], want: Math.round(16 + a * 219 / 255) }
  })
  check('the matte lands on 16 + alpha·219/255', matte.every((m) => Math.abs(m.got - m.want) <= 1),
    matte.map((m) => `alpha ${m.a} → ${m.got} (want ${m.want})`).join(', '))

  // a BT.709 source: the colour half is copied, not converted
  await makeDecoded(join(dir, 'src.webm'), join(dir, 'p709.mp4'), 0.2, undefined, { packed: true, codec: 'vp9', matrix: 'bt709' })
  const q = dump('p709.mp4', 'p709.yuv', 'yuv420p', false)
  // the top half of each plane of the pack against the whole plane of the source
  const planes = [[0, 0, W * H], [W * H, W * 2 * H, W * H / 4], [W * H * 5 / 4, W * 2 * H * 5 / 4, W * H / 4]]
  check('a BT.709 source passes through bit-exactly',
    planes.every(([so, qo, n]) => Buffer.compare(s.subarray(so, so + n), q.subarray(qo, qo + n)) === 0))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
