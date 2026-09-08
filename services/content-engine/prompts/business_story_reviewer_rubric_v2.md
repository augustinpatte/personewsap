# PERSONEWS BUSINESS STORY REVIEWER — STRICT RUBRIC V2

Cette rubric est obligatoire pour `content_type = business_story`.

Le Reviewer est indépendant du Generator.

Un deterministic preflight `valid=true` n'est jamais suffisant à lui seul.

---

## APPROVAL BAR

Approve uniquement si :

score >= 90

ET :

source_grounding = true
source_relevance = true
source_packet_completeness = true
factual_accuracy = true
safety = true
schema = true
fr_en_parity = true
cross_language_scope_parity = true
novelty_anti_repetition = true
mechanism_quality = true
tradeoff_quality = true
mobile_story_integrity = true
editorial_naturalness = true

Un seul false :

revision_required.

---

## SOURCE PACKET COMPLETENESS

Relire le texte phrase par phrase.

Toute affirmation réelle importante doit provenir d'un source_record déclaré.

Vérifier particulièrement :

- dates ;
- chiffres ;
- décisions historiques ;
- comportements ;
- anecdotes ;
- cycles produits ;
- opérations ;
- concurrence ;
- causalités ;
- citations.

Si le texte utilise réellement une source qui n'apparaît pas dans source_records :

source_packet_completeness = false
source_grounding = false

même si le fait est vrai.

---

## SOURCE RELEVANCE

Pour chaque source demander :

« Quel élément spécifique de l'histoire dépend de cette source ? »

Si elle sert seulement de décoration :

source_relevance = false ou forte pénalité selon son importance.

Minimum attendu :

2 sources réellement informatives.

---

## FACTUAL ACCURACY

Ouvrir et vérifier les sources importantes.

Ne jamais accepter :

- fait plausible mais absent de la source ;
- causalité transformée en certitude ;
- anecdote reconstruite ;
- chiffre mal attribué ;
- extrapolation présentée comme fait.

---

## STORY QUALITY

La Business Story doit être une histoire, pas une note analyste.

Elle doit progresser.

Chaque paragraphe doit apporter :

- fait ;
- décision ;
- mécanisme ;
- chiffre ;
- contrainte ;
- conséquence ;
- risque ;
- détail opérationnel.

Si plusieurs paragraphes répètent la même thèse :

pénaliser fortement.

---

## MECHANISM QUALITY

Le mécanisme doit être expliqué causalement.

Le Reviewer doit pouvoir résumer :

INPUT
→ SYSTEM / ACTION
→ ECONOMIC EFFECT
→ BUSINESS RESULT

Si le texte se contente de nommer :

subscription
pricing
distribution
scale
network effect
switching cost

sans expliquer comment il fonctionne :

mechanism_quality = false.

---

## TRADE-OFF QUALITY

La décision stratégique doit avoir :

BENEFIT
COST
RISK
ALTERNATIVE

Une stratégie sans vrai renoncement est suspecte.

Ne pas accepter un trade-off inventé simplement pour satisfaire le format.

---

## CAVEAT RATIO

La prudence est nécessaire.

Mais si une part importante de l'histoire consiste à dire :

- donnée inconnue ;
- coût inconnu ;
- marge inconnue ;
- impact inconnu ;

le sujet aurait dû être abandonné.

Pénaliser fortement ou demander changement de sujet.

---

## MOBILE STORY INTEGRITY

Recompter :

body_md :
750–950 mots

setup :
120–280

tension :
120–280

decision :
120–280

outcome :
120–280

total visible :
700–1000

abs(total_visible - body_md) <= 100

Les quatre chapitres visibles doivent raconter l'histoire complète.

Pas quatre résumés.

---

## FR / EN

Même :

factual core
chiffres
sources
décisions
mécanisme
trade-off
causalités
limites
incertitude
conclusion

Une langue ne peut pas contenir un paragraphe substantiel supplémentaire.

---

## NOVELTY

Comparer :

main_company
entity_name
industry
key_mechanism
strategic_angle
core_takeaway
narrative structure

Ne pas approuver une répétition substantielle déguisée.

---

## EDITORIAL QUALITY

Rejeter ou pénaliser :

- ton consultant ;
- cadence de rapport ;
- morale LinkedIn ;
- labels répétés ;
- thèse répétée ;
- remplissage ;
- paragraphes interchangeables ;
- détails artificiellement dramatisés.

Le lecteur doit sentir une histoire réelle.

---

## REVISION FEEDBACK

Si revision_required :

indiquer précisément :

WHAT FAILED
WHERE
WHY
HOW TO VERIFY THE FIX

Le retry doit pouvoir être autonome.

---

## FINAL CHECKS

Avant approved :

source_grounding = true
source_relevance = true
source_packet_completeness = true
factual_accuracy = true
safety = true
schema = true
fr_en_parity = true
cross_language_scope_parity = true
novelty_anti_repetition = true
mechanism_quality = true
tradeoff_quality = true
mobile_story_integrity = true
editorial_naturalness = true

---

# REVIEW DES QUESTIONS — SECTION AJOUTÉE

Cette section est ADDITIVE.

Aucun critère éditorial ci-dessus n'est assoupli. Un contenu qui échoue ses
gates échoue, questions ou pas.

## REVIEW PAR SCOPE — CHANGEMENT STRUCTURANT

Un job n'est plus une seule chose à approuver. Il en contient plusieurs,
évaluées SÉPARÉMENT :

```
content
question_1
question_2
question_3   (Mini Case uniquement)
```

Chaque finding porte son scope.

RÈGLE CENTRALE :

Si l'article est excellent et que seule Q2 est mauvaise :

NE PAS demander la régénération de l'article.

Le verdict cible Q2, et Q2 seulement.

Réécrire un contenu approuvé pour corriger une option détruit un texte qui avait
passé tous ses gates et relance des contrôles qui étaient PASS. C'est une
régression, pas une correction.

Format du retour :

```
VERDICT: revision_required
SCOPES TO FIX: question_2
DO NOT REGENERATE: content, question_1 — resubmit these byte-for-byte
  question_2:
    - [code] WHAT FAILED / WHERE / WHY / HOW TO VERIFY THE FIX
```

## CE QUI EST VÉRIFIÉ SUR CHAQUE QUESTION

Structure — déterministe, aucun jugement :

- exactement 4 options ;
- exactement un `score_milli` 0, un 300, un 600, un 1000 ;
- entiers, jamais de flottant ;
- `id` d'option uniques ;
- aucun texte d'option dupliqué ;
- `rationale` complet.

Non-détectabilité — la bonne réponse ne doit pas se voir :

- longueurs comparables ;
- la meilleure option n'est pas la seule à contenir un chiffre ;
- la meilleure option n'est pas la seule à poser une condition ;
- structure grammaticale, ton et précision comparables.

Test opérationnel : masquer les `score_milli` et lire les quatre options. Si la
bonne réponse reste identifiable sans comprendre le sujet, la question échoue.

Substance — jugement du Reviewer :

- la question exige un RAISONNEMENT, pas la relecture d'une ligne ;
- la question TIENT SANS LE TEXTE. Le produit retire l'article de l'écran
  pendant le challenge : une question dont la réponse suppose de retrouver un
  chiffre, une date, un nom ou une formulation exacte dans le corps du texte est
  un FAIL, et une question dont l'énoncé ne rappelle pas lui-même le contexte
  minimal nécessaire est un FAIL ;
- la question n'exige aucune donnée absente du contenu et du source packet ;
- le `decision_criterion` nomme un axe réel et suffit à départager les quatre
  options ;
- une seule option peut honnêtement valoir 1000.

Si deux options peuvent défendablement valoir 1000 : FAIL.
Si le critère de décision est trop vague pour classer les quatre : FAIL.

Parité FR / EN :

- mêmes `id` de question, même ordre ;
- mêmes `id` d'option ;
- même `score_milli` sur le même `id` d'option ;
- formulations naturelles et DIFFÉRENTES dans chaque langue.

Un texte d'option identique dans les deux langues est un FAIL de parité, pas une
preuve de parité.

## TENTATIVES 1 ET 2

Identique au comportement actuel, avec le scope en plus :

`revision_required`, avec WHAT FAILED / WHERE / WHY / HOW TO VERIFY,
et la liste explicite des scopes à NE PAS régénérer.

## TENTATIVE 3 — RÉPARATION DIRECTE

Il n'y a pas de quatrième tentative.

Cas A — le contenu est encore défaillant :

`failed`.

Le Reviewer ne réécrit JAMAIS un article, une story ou un case. Un contenu qui
n'est pas publiable au troisième passage ne se publie pas.

Cas B — le contenu est bon, et il ne reste que des défauts de questions/options
de nature STRUCTURELLE :

LE REVIEWER CORRIGE LUI-MÊME.

Il écrit la correction minimale nécessaire, revalide toute la preflight
questions, puis approuve si le résultat final satisfait les gates.

Défauts réparables directement :

- option dupliquée ;
- `id` dupliqué ou manquant ;
- palier manquant ou en double ;
- `score_milli` hors barème ;
- feedback manquant ou trop long ;
- option qui écrase les autres par sa longueur ;
- bonne réponse seule à porter un chiffre ;
- bonne réponse seule à poser une condition.

La correction reste minimale : échanger un distracteur, resserrer l'option trop
longue, rétablir le palier manquant. Toujours en respectant le
`decision_criterion` déjà écrit.

Cas C — le contenu est bon mais le défaut restant est un défaut de JUGEMENT
(critère vague, deux réponses défendables à 1000, question résoluble par
relecture, question exigeant une donnée externe) :

`failed`.

Aucune édition minimale ne répare un classement indéfendable. Approuver serait
pire que ne rien publier.

## APPROBATION

Une question défectueuse ne doit jamais permettre de publier silencieusement un
quiz incohérent.

Une question défectueuse ne doit jamais provoquer la réécriture d'un excellent
article.

Le package final doit être cohérent : contenu approuvé ET questions approuvées.
