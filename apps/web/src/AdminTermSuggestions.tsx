import { useEffect, useRef, useState } from 'react'
import { wikiKey, type EditorialVocabulary, type EditorialTermSuggestions } from '@hesta-codex/shared'
import { errorStatus, getAdminJson, postAdminJson } from './admin-http'

export function AdminTermSuggestions({ entityId = null, title, bodyMarkdown, aliases, tags, disabled, onChange, onAccessError }: {
  entityId?: string | null; title: string; bodyMarkdown: string; aliases: string; tags: string; disabled: boolean
  onChange: (kind: 'aliases' | 'tags', value: string) => void; onAccessError?: (status: number) => void
}) {
  const [open, setOpen] = useState(false), [vocabulary, setVocabulary] = useState<EditorialVocabulary | null>(null)
  const [analysis, setAnalysis] = useState<{ key: string; result: EditorialTermSuggestions } | null>(null)
  const [loading, setLoading] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState('')
  const analysisController = useRef<AbortController | null>(null), callbacks = useRef(onAccessError)
  callbacks.current = onAccessError
  const key = JSON.stringify([entityId, title, bodyMarkdown]), currentKey = useRef(key)
  currentKey.current = key
  const values = (kind: 'aliases' | 'tags') => (kind === 'aliases' ? aliases : tags).split(',').map(value => value.trim()).filter(Boolean)
  const selected = (kind: 'aliases' | 'tags', value: string) => values(kind).some(item => wikiKey(item) === wikiKey(value))
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(); setLoading(true); setError('')
    getAdminJson<EditorialVocabulary>('/api/admin/editorial-suggestions/vocabulary', controller.signal).then(data => {
      if (!controller.signal.aborted) setVocabulary(data)
    }).catch(error => { if (!controller.signal.aborted) {
      const status = errorStatus(error); if (status === 401 || status === 403) callbacks.current?.(status)
      setError('Suggestions indisponibles. Fermez puis rouvrez ce panneau pour réessayer.')
    } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open])
  useEffect(() => () => analysisController.current?.abort(), [])
  function add(kind: 'aliases' | 'tags', value: string, complete = false) {
    if (disabled || selected(kind, value)) return
    const next = values(kind)
    if (complete && next.length && !(kind === 'tags' ? tags : aliases).trimEnd().endsWith(',')) next.pop()
    next.push(value)
    if (next.length > 30) { setError('30 valeurs maximum. Retirez une valeur avant d’en ajouter.'); return }
    setError(''); onChange(kind, next.join(', '))
  }
  async function analyze() {
    if (disabled || analyzing) return
    const controller = new AbortController(); analysisController.current = controller
    const requestedKey = key; setAnalyzing(true); setError('')
    try {
      const result = await postAdminJson<EditorialTermSuggestions>('/api/admin/editorial-suggestions/terms',
        { entityId, title, bodyMarkdown, aliases: values('aliases'), tags: values('tags') }, controller.signal)
      if (!controller.signal.aborted && currentKey.current === requestedKey) setAnalysis({ key: requestedKey, result })
    } catch (error) { if (!controller.signal.aborted) {
      const status = errorStatus(error); if (status === 401 || status === 403) callbacks.current?.(status)
      setError('Analyse impossible. Votre texte est conservé ; vous pouvez réessayer.')
    } } finally { if (!controller.signal.aborted) setAnalyzing(false) }
  }
  const tagFragment = wikiKey(tags.split(',').at(-1) ?? ''), aliasFragment = wikiKey(aliases.split(',').at(-1) ?? '')
  const tagChoices = vocabulary?.tags.filter(item => !selected('tags', item.value) && (!tagFragment || wikiKey(item.value).includes(tagFragment))).slice(0, 8) ?? []
  const aliasChoices = aliasFragment ? vocabulary?.aliases.filter(item => !selected('aliases', item.value) && wikiKey(item.value).includes(aliasFragment)).slice(0, 8) ?? [] : []
  return <details className="admin-term-suggestions admin-editor-wide" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Suggestions d’alias et de tags</summary>
    <p className="admin-muted">Propositions locales à vérifier. Un clic remplit le formulaire ; seul son enregistrement les conserve.</p>
    {loading && <p role="status">Chargement du vocabulaire…</p>}
    {error && <p role="alert">{error}</p>}
    <h3>Tags existants</h3><p className="admin-muted">Saisissez dans le champ Tags pour filtrer ; utilisez une virgule pour commencer une nouvelle valeur.</p>
    <div className="admin-suggestion-chips">{tagChoices.map(item => <button type="button" key={item.value} disabled={disabled}
      onClick={() => add('tags', item.value, true)} aria-label={`Compléter le tag ${item.value}`}>{item.value} <small>({item.count})</small></button>)}</div>
    {!loading && vocabulary && !tagChoices.length && <p>Aucun tag correspondant à compléter.</p>}
    <h3>Alias existants</h3><p className="admin-muted">Saisissez un début d’alias dans le champ Alias. Réutiliser l’alias d’une autre fiche peut rendre les liens ambigus.</p>
    <ul>{aliasChoices.map(item => <li key={item.value}><button type="button" disabled={disabled} onClick={() => add('aliases', item.value, true)}>{item.value}</button>
      <span> — utilisé par {item.owners.map(owner => owner.title).join(', ')}</span></li>)}</ul>
    <button type="button" disabled={disabled || analyzing} onClick={() => void analyze()}>{analyzing ? 'Analyse…' : 'Analyser le contenu pour des alias et tags'}</button>
    {analysis?.key === key && <div aria-live="polite">{(['aliases', 'tags'] as const).map(kind => <section key={kind}>
      <h3>{kind === 'aliases' ? 'Alias proposés' : 'Tags proposés'}</h3>
      {!analysis.result[kind].length && <p>Aucune proposition explicite détectée.</p>}
      <ul>{analysis.result[kind].map(item => <li key={item.value}><button type="button" disabled={disabled || selected(kind, item.value)}
        onClick={() => add(kind, item.value)} aria-label={`Ajouter ${kind === 'aliases' ? 'l’alias' : 'le tag'} ${item.value}`}>{item.value}</button>
        <span> — {item.reason}</span>{!!item.conflicts.length && <strong> Attention : déjà utilisé par {item.conflicts.join(', ')}.</strong>}</li>)}</ul>
    </section>)}</div>}
  </details>
}
