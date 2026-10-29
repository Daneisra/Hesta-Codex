import type { EditorialStatus, Visibility } from './index.js'

export interface SuggestionEntity { id: string; slug: string; title: string; status: EditorialStatus; visibility: Visibility }
export interface EditorialVocabulary {
  tags: Array<{ value: string; count: number }>
  aliases: Array<{ value: string; owners: Array<{ id: string; slug: string; title: string }> }>
}
export interface EditorialSuggestionDraft { entityId: string | null; title: string; bodyMarkdown: string; aliases: string[]; tags: string[] }
export interface EditorialTermSuggestion { value: string; reason: string; conflicts: string[] }
export interface EditorialTermSuggestions { aliases: EditorialTermSuggestion[]; tags: EditorialTermSuggestion[] }
export interface LinkSuggestionOccurrence { start: number; end: number; text: string; before: string; after: string; wikilink: string }
export interface LinkSuggestion {
  id: string; fingerprint: string; from: SuggestionEntity; to: SuggestionEntity
  occurrences: LinkSuggestionOccurrence[]
}
export interface LinkSuggestionScan {
  scannedAt: string; entities: number; connections: number; occurrences: number; ambiguous: number; existing: number
  page: number; pageSize: number; items: LinkSuggestion[]
  ambiguities: Array<{ from: SuggestionEntity; text: string; candidates: string[] }>
}
export interface LinkSuggestionApply { id: string; fingerprint: string; confirm: true }
