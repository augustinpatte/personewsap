# PERSONEWS MINI CASE REVIEWER — STRICT RUBRIC V2

Cette rubric est obligatoire pour tout review de `content_type = mini_case`.

Le Reviewer est indépendant du Generator.

Un deterministic preflight `valid=true` ne garantit jamais l'approbation.

---

## APPROVAL BAR

Approve uniquement si :

score >= 90

ET :

source_grounding = true
source_relevance = true
factual_accuracy = true
safety = true
schema = true
fr_en_parity = true
cross_language_scope_parity = true
novelty_anti_repetition = true
constraint_sufficiency = true
numerical_consistency = true
q2_unique_solution = true
q3_tradeoff = true
editorial_naturalness = true

Un seul false :

revision_required.

---

## SOURCE GROUNDING

Chaque claim réel doit être soutenu par un source_record exact.

Les données fictives internes doivent rester clairement internes au scénario.

---

## SOURCE RELEVANCE

Une source peut être exacte mais non pertinente.

Test obligatoire :

SOURCE_REMOVAL_TEST.

Question :

« Si cette source est retirée, quel élément réel, spécifique et décisionnel
disparaît du cas ? »

Si rien d’important ne disparaît :

source_relevance = false.

Une source générale de dépenses publiques ne soutient pas un mécanisme privé de
working capital simplement parce que le thème est finance.

---

## CLAIM–SOURCE MAP

Vérifier les claims réels dans :

body_md
context
questions
options
feedback
expected_reasoning
sample_answer
conclusion
final_takeaway

Chaque claim réel doit avoir une source correspondante.

---

## FR / EN MASTER SPEC

Comparer :

facts
numbers
units
constraints
fictional parameters
reserve usage
assumptions
formulas
results
correct answers
uncertainty

Toute différence substantielle :

cross_language_scope_parity = false.

---

## Q2 — RE-SOLVE FROM ZERO

Ne pas faire confiance aux calculs du Generator.

Recalculer depuis zéro.

Identifier :

variables
units
objective
constraints
formula
calculation
result

Puis calculer LES QUATRE OPTIONS.

q2_unique_solution = true seulement si une option est réellement optimale.

---

## OPTION DOMINANCE

Une mauvaise option ne peut pas :

- satisfaire toutes les contraintes ;
- obtenir un résultat égal ou supérieur ;
- sans coût supplémentaire pertinent ;

tout en restant marquée incorrecte.

Si c'est le cas :

q2_unique_solution = false.

---

## STOCK MARKET EXECUTION

Pour une contrainte de prix moyen :

average execution price =
total proceeds / total shares

sur toutes les tranches exécutées.

Ne pas utiliser seulement le prix marginal.

---

## CASH / WORKING CAPITAL

Utiliser :

opening cash
+ inflows
- outflows
+ financing drawn
= closing cash

Vérifier séparément :

available reserve
drawn reserve
remaining reserve
minimum cash buffer

Même convention partout et dans les deux langues.

---

## CAPACITY

Une capacité maximale seule ne prouve rien sur la charge attendue.

Vérifier que toutes les variables de charge/fréquence nécessaires existent.

Sinon :

constraint_sufficiency = false.

---

## Q3

Au moins deux options doivent être professionnellement défendables.

Pour chacune :

benefit
cost
risk
when it would win

Si une seule option est sérieuse :

q3_tradeoff = false.

---

## Q3 DEPENDENCY

Si Q3 dépend de Q2 :

Q2 doit d’abord être correcte.

Q2 fausse = Q3 dépendante invalide.

---

## NOVELTY

Comparer le problème sous-jacent, pas uniquement l’entreprise ou le titre.

Un cas est répétitif si son :

scenario_type
decision_type
concept_tested
mechanism
question_pattern
correct_answer_pattern
decision structure
core takeaway

répète substantiellement un cas récent.

---

## EDITORIAL QUALITY

Le cas doit ressembler à une vraie décision de travail.

Rejeter ou pénaliser fortement :

- métadiscours scolaire ;
- bonne réponse pré-résolue ;
- distracteurs absurdes ;
- prose IA répétitive ;
- structure artificielle.

---

## REVISION FEEDBACK

En cas de revision_required, écrire précisément :

WHAT FAILED
WHERE
WHY
HOW TO VERIFY THE FIX

Le Generator doit pouvoir corriger sans intervention humaine.

---

## FINAL REVIEW

Avant approved :

source_grounding = true
source_relevance = true
factual_accuracy = true
safety = true
schema = true
fr_en_parity = true
cross_language_scope_parity = true
novelty_anti_repetition = true
constraint_sufficiency = true
numerical_consistency = true
q2_unique_solution = true
q3_tradeoff = true
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
- le cas reste affiché pendant les trois questions — c'est le seul format où
  c'est vrai — donc l'énoncé peut s'appuyer sur le cas, mais une question dont
  la réponse se retrouve en recopiant une ligne du cas reste un FAIL ;
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
