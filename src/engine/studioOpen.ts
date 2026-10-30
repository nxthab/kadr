// Open «Студия фрагмента» (electron/studio.ts, fork nxthab/kadr — STUDIO.md)
// for a fragment clip: the loop is the timeline range where it overlaps the
// clip (else the clip's first 3 s), the sound is every audible audio clip
// under that stretch.
import { useEditor } from '@/state/store'
import { evalAnim } from './anim'

/** composition seconds of the fragment at timeline second `tl` */
function compAt(clip: { start: number; inPoint: number; speed?: number }, tl: number) {
  return clip.inPoint + (tl - clip.start) * (clip.speed || 1)
}

export async function openStudio(clipId: string, a?: number, b?: number): Promise<{ ok: true; a: number; b: number }> {
  const st = useEditor.getState()
  const project = st.project
  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
  if (!clip || clip.kind !== 'remotion' || !clip.fragmentId) throw new Error(`clip ${clipId} is not a fragment clip`)
  const speed = clip.speed || 1
  const end = clip.start + clip.duration
  const r = st.range
  let tlA: number, tlB: number
  if (a != null && b != null) {
    tlA = clip.start + (a - clip.inPoint) / speed
    tlB = clip.start + (b - clip.inPoint) / speed
  } else if (r && r.end > clip.start && r.start < end) {
    tlA = Math.max(clip.start, r.start)
    tlB = Math.min(end, r.end)
  } else {
    tlA = clip.start
    tlB = Math.min(end, clip.start + 3)
  }
  const audio = project.tracks
    .filter((t) => t.kind === 'audio' && !t.muted)
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'media' && !c.muted && c.start < tlB && c.start + c.duration > tlA)
    .map((c) => {
      const asset = project.assets.find((x) => x.id === c.assetId)
      if (!asset) return null
      return {
        url: window.kadr.fileUrl(asset.path),
        start: c.start,
        inPoint: c.inPoint,
        duration: c.duration,
        speed: c.speed || 1,
        gain: evalAnim(c.gain, 0)
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const projectDir = st.projectPath ? st.projectPath.replace(/[\\/][^\\/]*$/, '') : null
  const ca = compAt(clip, tlA), cb = compAt(clip, tlB)
  await window.kadr.studioOpen({
    fragmentId: clip.fragmentId,
    a: ca,
    b: cb,
    clipZero: clip.start - clip.inPoint / speed,
    clipSpeed: speed,
    audio,
    projectDir,
    label: clip.label || clip.fragmentId
  })
  return { ok: true, a: ca, b: cb }
}
