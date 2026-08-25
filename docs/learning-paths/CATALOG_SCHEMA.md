# Learning Paths Catalog Schema

Le catalogue v1 vit dans `content/learning-paths/v1`. Il contient un index et un fichier JSON par domaine.

## Domain File

Chaque fichier de domaine suit cette structure :

- `schema_version`: version du schema JSON. Valeur actuelle : `1.0`.
- `catalog_version`: version editoriale du catalogue. Valeur actuelle : `v1`.
- `domain_id`: identifiant exact du domaine.
- `objectives`: liste des orientations autorisees pour ce domaine.
- `steps`: sessions pedagogiques disponibles.

## Step Fields

- `id`: identifiant global unique de l'etape.
- `objective_ids`: orientations auxquelles l'etape peut servir.
- `stage`: niveau de progression, de 1 a 5.
- `order`: ordre positif dans le domaine.
- `required`: indique si l'etape est centrale pour le parcours.
- `prerequisite_ids`: etapes a connaitre avant celle-ci.
- `fallback_step_id`: etape plus simple a proposer en consolidation, ou `null`.
- `title`: titre visible en francais et en anglais.
- `summary`: intention de session en francais et en anglais.
- `learning_goals`: au moins deux objectifs en francais et deux en anglais.
- `tutor_focus`: consigne precise pour guider la generation.
- `example_contexts`: au moins trois contextes alternatifs par langue.
- `safety_category`: categorie de securite.

## Allowed Values

Stages autorises :

- `1`
- `2`
- `3`
- `4`
- `5`

Categories de securite autorisees :

- `standard`
- `cyber_defensive`
- `medical_educational`
- `financial_educational`

## Complete Example

```json
{
  "id": "cs-stage-2-03",
  "objective_ids": ["cs_systems", "cs_programming", "cs_software_data"],
  "stage": 2,
  "order": 80,
  "required": true,
  "prerequisite_ids": ["cs-stage-1-01"],
  "fallback_step_id": "cs-stage-1-01",
  "title": {
    "fr": "Memoire et references",
    "en": "Memory and references"
  },
  "summary": {
    "fr": "Cette session explique comment un programme manipule des valeurs sans confondre l'objet et son adresse.",
    "en": "This session explains how a program handles values without confusing an object with its address."
  },
  "learning_goals": {
    "fr": [
      "Distinguer une valeur, une reference et une copie.",
      "Expliquer pourquoi deux variables peuvent pointer vers le meme objet."
    ],
    "en": [
      "Distinguish a value, a reference, and a copy.",
      "Explain why two variables can point to the same object."
    ]
  },
  "tutor_focus": {
    "fr": "Utilise une analogie de casiers et evite les details bas niveau inutiles.",
    "en": "Use a locker analogy and avoid unnecessary low-level details."
  },
  "example_contexts": {
    "fr": [
      "une application de messagerie",
      "un jeu video avec inventaire",
      "un outil de gestion bancaire"
    ],
    "en": [
      "a messaging app",
      "a video game inventory",
      "a banking management tool"
    ]
  },
  "safety_category": "standard"
}
```
