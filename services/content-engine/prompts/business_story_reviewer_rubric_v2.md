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
