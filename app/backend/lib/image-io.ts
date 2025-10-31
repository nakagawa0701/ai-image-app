import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage')
export const DIR_GENERATED = path.join(STORAGE_ROOT, 'generated')
export const DIR_EDITS = path.join(STORAGE_ROOT, 'edits')

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
}
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

export type Img = { mime: string; base64: string }

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

export function parseDataUrl(dataUrl: string): Img {
  const m = dataUrl?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([^]+)$/)
  if (!m) throw new Error('malformed_data_url')
  return { mime: m[1], base64: m[2] }
}

export function isSafeFileName(name: string) {
  return /^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/i.test(name)
}

export async function readImageByName(name: string): Promise<{ buf: Buffer; mime: string, from: 'generated'|'edits' }> {
  if (!isSafeFileName(name)) throw new Error('bad_file_name')
  const tryPaths = [
    { dir: DIR_GENERATED, from: 'generated' as const },
    { dir: DIR_EDITS, from: 'edits' as const }
  ]
  for (const p of tryPaths) {
    const fp = path.join(p.dir, name)
    try {
      const buf = await fs.readFile(fp)
      const ext = path.extname(name).slice(1).toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'image/png'
      return { buf, mime, from: p.from }
    } catch {/* try next */}
  }
  throw new Error('file_not_found')
}

export async function saveToEdits(img: Img) {
  await ensureDir(DIR_EDITS)
  const ext = EXT_BY_MIME[img.mime] ?? 'png'
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const filepath = path.join(DIR_EDITS, filename)
  await fs.writeFile(filepath, Buffer.from(img.base64, 'base64'))
  return { id, filename, url: `/api/files/${filename}`, mime: img.mime }
}

export function bufferToPngDataUrl(buf: Buffer) {
  return `data:image/png;base64,${buf.toString('base64')}`
}
