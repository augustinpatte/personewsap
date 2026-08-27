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
