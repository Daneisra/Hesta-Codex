const examples = [
  ['Titres (niveaux 1 à 6)', '# Titre\n## Sous-titre\n### Section'],
  ['Paragraphes et sauts de ligne', 'Deux paragraphes : une ligne vide entre eux.\n\nUn saut forcé : deux espaces en fin de ligne, puis Entrée.'],
  ['Gras, italique et texte barré', '**Gras** · *Italique* · ***Les deux*** · ~~Barré~~'],
  ['Listes et cases à cocher', '- Élément\n  - Sous-élément\n\n1. Premier\n2. Second\n\n- [ ] À faire\n- [x] Terminé'],
  ['Citations', '> Citation\n>\n> Plusieurs paragraphes possibles.'],
  ['Liens', '[Texte du lien](https://exemple.test)\nhttps://exemple.test\n[Contact](mailto:contact@exemple.test)'],
  ['Liens par référence et notes de bas de page', '[Texte][lien]\n\n[lien]: https://exemple.test\n\nUne précision[^note].\n\n[^note]: Texte de la note.'],
  ['Liens entre fiches Obsidian', '[[Nom]]\n[[Nom|Libellé affiché]]\n[[Dossier/Nom]]\n[[Nom#Section]]'],
  ['Lien ciblé vers une fiche Codex', '[[/fiches/slug-de-la-fiche|Texte affiché]]\nLe scan propose ce format pour désigner précisément une fiche existante.'],
  ['Images importées', '![Description accessible](/api/images/identifiant-fourni-par-import)'],
  ['Code dans le texte ou en bloc', '`Texte monospace`\n\n```text\nUn bloc de code conserve les espaces et les exemples de syntaxe.\n```'],
  ['Tableaux', '| Nom | Détail |\n| :--- | ---: |\n| Exemple | Valeur |'],
  ['Séparation', '---'],
  ['Afficher des caractères de syntaxe', '\\*Pas en italique\\*\n\\[Crochets\\]'],
] as const

export function MarkdownHelp() {
  return <details className="markdown-help admin-editor-wide"><summary>Aide Markdown</summary>
    <p>Formats pris en charge dans le contenu et son aperçu (Markdown avec extensions GitHub).</p>
    {examples.map(([title, example]) => <details key={title}><summary>{title}</summary><pre><code>{example}</code></pre></details>)}
    <p>Utilisez « Importer une image » pour insérer une illustration. Sa visibilité suit celle de la fiche ;
      une fiche proposée reste privée. Les images externes sont masquées dans l’administration.</p>
    <p>Les liens Obsidian dépendent des fiches existantes et de leur résolution : un nom absent ou ambigu reste lisible.
      Ils ne créent aucune relation éditoriale.</p>
    <p>Le HTML brut et les scripts sont ignorés. Les formules mathématiques, diagrammes Mermaid et inclusions
      de notes Obsidian ne sont pas interprétés. Les blocs de code ne sont pas exécutés.</p>
  </details>
}
