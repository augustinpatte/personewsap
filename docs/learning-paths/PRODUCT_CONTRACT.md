# PersoNewsAP Learning Paths Product Contract

## Cadence

Chaque utilisateur suit un seul parcours actif a la fois. Le produit propose quatre sessions par semaine, pas un flux infini de lecons.

Une session doit tenir en cinq minutes maximum. Elle couvre une seule idee principale, avec une analogie ou une situation concrete, une explication courte, deux ou trois questions au maximum, puis un rappel final.

Les jours sans edition pedagogique, le produit ne doit pas inventer de contenu nouveau pour combler le calendrier. Il peut reutiliser une consolidation, proposer une reprise, ou rester silencieux selon la logique produit.

## Experience

PersoNewsAP ne fournit pas de chat pedagogique interne. L'utilisateur recoit une session structuree, puis peut continuer avec une IA externe s'il veut approfondir.

Apres chaque session, l'utilisateur donne quatre notes fermees, sans texte libre :

- clarte
- interet
- difficulte
- utilite

Ces notes servent a adapter la suite du parcours sans transformer l'application en assistant conversationnel.

## Adaptation

L'adaptation selectionne la prochaine session a partir du catalogue, du parcours actif, du niveau atteint et des notes precedentes.

Si une session semble trop difficile, le backend peut utiliser `fallback_step_id` pour proposer une consolidation. Si une session a des prerequis, ils doivent etre respectes avant de la selectionner.

Les exemples peuvent varier grace a `example_contexts`, mais le concept, le niveau et l'objectif pedagogique restent stables.

## Limites

Le catalogue ne contient pas de texte final de cours. Il fournit les intentions pedagogiques structurees que le backend pourra utiliser pour generer une session de cinq minutes.

Les domaines cybersecurite et medecine gardent un cadre strictement educatif. La cybersecurite reste defensive. La medecine ne fournit jamais de diagnostic ou de traitement personnalise.
