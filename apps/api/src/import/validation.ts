import { importSchema, type ImportDocument } from './format.js'

export interface ImportIssue {
  path: string
  message: string
}

export type ParseResult =
  | { success: true; document: ImportDocument }
  | { success: false; issues: ImportIssue[] }

function pathString(parts: PropertyKey[]): string {
  if (parts.length === 0) return '$'
  return parts.reduce<string>((path, part) => {
    if (typeof part === 'number') return `${path}[${part}]`
    if (typeof part === 'symbol') return path
    return path ? `${path}.${part}` : part
  }, '')
}

export function parseImportText(text: string): ParseResult {
  let input: unknown
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  } catch {
    return { success: false, issues: [{ path: '$', message: 'JSON invalide' }] }
  }
  const result = importSchema.safeParse(input)
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => ({ path: pathString([...issue.path, key]), message: 'Champ inconnu' }))
        : [{ path: pathString(issue.path), message: issue.message }]),
    }
  }
  return { success: true, document: result.data }
}
