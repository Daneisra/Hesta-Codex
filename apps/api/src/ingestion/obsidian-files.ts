import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MAX_CONTENT_BYTES } from './format.js'

export class ObsidianError extends Error {
  constructor(public readonly code: string) { super(code) }
}
export const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

// Inspect each ancestor too: lstat alone would miss a junction in a parent path.
export async function localDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || /^[/\\]{2}/.test(path)) throw new ObsidianError('LOCAL_ABSOLUTE_PATH_REQUIRED')
  const absolute = resolve(path)
  let current = absolute
  for (;;) {
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ObsidianError('UNSAFE_DIRECTORY')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return realpath(absolute)
}

export async function outputDestination(path: string, vault: string): Promise<string> {
  if (!isAbsolute(path) || /^[/\\]{2}/.test(path)) throw new ObsidianError('LOCAL_ABSOLUTE_PATH_REQUIRED')
  const absolute = resolve(path), parent = await localDirectory(dirname(absolute))
  const destination = join(parent, relative(dirname(absolute), absolute))
  if (inside(vault, destination)) throw new ObsidianError('OUTPUT_INSIDE_VAULT')
  let current = parent
  for (;;) {
    try { await lstat(join(current, '.git')); throw new ObsidianError('OUTPUT_INSIDE_GIT') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const ancestor = dirname(current)
    if (ancestor === current) break
    current = ancestor
  }
  try { await lstat(destination); throw new ObsidianError('OUTPUT_ALREADY_EXISTS') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return destination
}

export interface VaultFile { path: string; absolute: string }
export async function scanVault(vault: string, subdir?: string) {
  if (subdir && (isAbsolute(subdir) || subdir.split(/[/\\]/).some(part => !part || part === '..' || part.startsWith('.') || part.includes(':')))) {
    throw new ObsidianError('INVALID_SUBDIRECTORY')
  }
  const start = await localDirectory(subdir ? join(vault, ...subdir.split(/[/\\]/)) : vault)
  if (!inside(vault, start)) throw new ObsidianError('PATH_OUTSIDE_VAULT')
  const files: VaultFile[] = [], pending = [{ path: start, depth: 0 }]
  let ignored = 0, entries = 0
  while (pending.length) {
    const directory = pending.pop()!
    if (directory.depth > 64) throw new ObsidianError('SCAN_DEPTH_LIMIT')
    const safe = await localDirectory(directory.path)
    if (!inside(vault, safe)) throw new ObsidianError('PATH_OUTSIDE_VAULT')
    // Stream entries so the exploration limit also bounds a single enormous directory.
    for await (const entry of await opendir(safe)) {
      if (++entries > 100_000) throw new ObsidianError('SCAN_ENTRY_LIMIT')
      if (entry.name.startsWith('.')) { ignored++; continue }
      const path = join(safe, entry.name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) { ignored++; continue }
      if (stat.isDirectory()) pending.push({ path, depth: directory.depth + 1 })
      else if (stat.isFile() && /\.md$/i.test(entry.name)) files.push({ absolute: path, path: relative(vault, path).split(sep).join('/') })
      else ignored++
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { files, ignored }
}

export async function readNote(vault: string, file: VaultFile) {
  const parent = await localDirectory(dirname(file.absolute))
  if (!inside(vault, parent) || !inside(vault, file.absolute)) throw new ObsidianError('PATH_OUTSIDE_VAULT')
  const before = await lstat(file.absolute)
  if (!before.isFile() || before.isSymbolicLink()) throw new ObsidianError('UNSAFE_FILE')
  const handle = await open(file.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new ObsidianError('FILE_CHANGED')
    if (opened.size > MAX_CONTENT_BYTES) throw new ObsidianError('CONTENT_TOO_LARGE')
    // A bounded read also handles a file growing after stat, without loading it all.
    const bytes = Buffer.alloc(MAX_CONTENT_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > MAX_CONTENT_BYTES) throw new ObsidianError('CONTENT_TOO_LARGE')
    const after = await handle.stat()
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new ObsidianError('FILE_CHANGED')
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)) }
    catch { throw new ObsidianError('INVALID_UTF8') }
    return { content, observedAt: opened.mtime.toISOString() }
  } finally { await handle.close() }
}
