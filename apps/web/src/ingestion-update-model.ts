import type { IngestionUpdateFields } from '@hesta-codex/shared'

export const updateFieldLabels: Record<keyof IngestionUpdateFields, string> = {
  title: 'Titre', kind: 'Type de fiche', placeKind: 'Sous-type de lieu', summary: 'Résumé', bodyMarkdown: 'Contenu Markdown',
  aliases: 'Alias', tags: 'Tags', visibility: 'Visibilité',
}
export const updateFields = Object.keys(updateFieldLabels) as Array<keyof IngestionUpdateFields>
export function editableUpdateFields(value: IngestionUpdateFields): IngestionUpdateFields {
  return { title: value.title.trim(), kind: value.kind, placeKind: value.kind === 'PLACE' ? value.placeKind : null,
    summary: value.summary?.trim() || null, bodyMarkdown: value.bodyMarkdown,
    aliases: value.aliases.map(entry => entry.trim()), tags: value.tags.map(entry => entry.trim()), visibility: value.visibility }
}
export function changedUpdateFields(before: IngestionUpdateFields, after: IngestionUpdateFields) {
  return updateFields.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}
