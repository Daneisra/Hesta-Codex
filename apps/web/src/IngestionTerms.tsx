export function IngestionTerms({ label, values, max, onChange, invalid, errorId }: {
  label: string; values: string[]; max: number; onChange: (values: string[]) => void; invalid: boolean; errorId: string
}) {
  return <fieldset className="ingestion-proposal-terms"><legend>{label}</legend>{values.map((value, index) => <div className="ingestion-association-actions" key={index}>
    <input aria-label={`${label} ${index + 1}`} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} maxLength={max} value={value} onChange={event => onChange(values.map((entry, n) => n === index ? event.target.value : entry))} />
    <button type="button" aria-label={`Retirer ${label} ${index + 1}`} onClick={() => onChange(values.filter((_, n) => n !== index))}>Retirer</button>
  </div>)}<button type="button" disabled={values.length >= 30} onClick={() => onChange([...values, ''])}>Ajouter {label}</button></fieldset>
}
