# PERSONEWS NEWSLETTER REVIEWER — STRICT RUBRIC V2

Cette rubric est obligatoire pour `newsletter_article`.

Le Reviewer doit évaluer deux choses séparément :

1. Est-ce vrai et correctement sourcé ?
2. Est-ce assez intéressant pour mériter un slot du feed ?

Un article peut être factuellement parfait et néanmoins être rejeté pour faible
valeur éditoriale.

---

## APPROVAL

Approve uniquement si :

score >= 90

ET :

source_grounding = true
factual_accuracy = true
safety = true
schema = true
fr_en_parity = true
novelty_anti_repetition = true

ET :

editorial_value = PASS
materiality = PASS
topic_fit = PASS
source_relevance = PASS
claim_source_map = PASS
mechanism_quality = PASS
implication_specificity = PASS
cross_language_scope_parity = PASS
editorial_naturalness = PASS

Pour sport_business :

sport_business_materiality = PASS.

---

## EDITORIAL VALUE

Question :

« Est-ce que le lecteur apprend quelque chose qu'il ne savait pas simplement en
lisant le titre ? »

L'article doit apporter :

DEVELOPMENT
MECHANISM
CONSEQUENCE
SIGNAL

Un article trivial peut être revision_required même s'il est vrai.

---

## MATERIALITY

Demander :

« Qu'est-ce qui change réellement ? »

Un effet matériel doit exister sur au moins une dimension :

revenue
cost
price
margin
financing
valuation
capacity
risk
regulation
demand
supply
competition
production
distribution economics
technology
science
medicine
infrastructure
commercial governance

Une information purement administrative ou de programmation est insuffisante.

---

## SPORT BUSINESS

Rejeter normalement un article centré sur :

- chaîne TV ;
- feed ;
- horaire ;
- commentateur ;
- production TV ordinaire ;
- viewing feature mineure ;

si aucune modification économique importante n'est démontrée.

Pour mériter le slot sport_business, le sujet doit porter réellement sur :

media rights
rights value
ownership
valuation
sponsorship
athlete equity
labor economics
salary cap
ticketing
venue financing
private equity
league expansion
revenue sharing
distribution economics
monetization
market power

---

## SOURCE GROUNDING

Chaque claim réel important doit être présent dans le packet.

Une URL valide mais qui ne soutient pas le claim :

FAIL.

---

## SOURCE RELEVANCE

Question :

« Quel élément spécifique disparaît si je retire cette source ? »

Une source purement décorative n'est pas suffisante.

---

## CLAIM SOURCE MAP

Vérifier :

dates
numbers
decisions
quotes
causal claims
product facts
regulatory facts
technical facts
scientific facts

Chaque claim matériel doit être traçable.

---

## TOPIC FIT

L'événement lui-même doit appartenir au topic.

Le fait que le publisher soit associé à un flux thématique ne suffit pas.

---

## MECHANISM

Le Reviewer doit pouvoir résumer :

EVENT
→ MECHANISM
→ ACTOR EFFECT
→ CONSEQUENCE

Si le mécanisme est seulement nommé mais pas expliqué :

FAIL.

---

## IMPLICATION

La conclusion doit être spécifique.

Rejeter les fins interchangeables telles que :

« la concurrence va augmenter »
« le secteur devra s'adapter »
« il faudra suivre la suite »
« cela pourrait changer la donne »

sans mécanisme concret.

---

## TWO ORDINALS

Lorsque deux articles existent pour un même topic :

UNDERLYING_EVENT_1 != UNDERLYING_EVENT_2

Comparer aussi :

primary source
main actor
mechanism
implication

Deux angles d'une même annonce :

FAIL.

---

## FR / EN

Même :

event
facts
numbers
sources
mechanism
implication
signal
uncertainty

Une langue ne doit pas contenir une analyse substantiellement plus profonde.

---

## LENGTH

Hard :

120–220 mots.

Zone recommandée :

145–190 mots.

Ne jamais récompenser le remplissage artificiel.

---

## ANTI TEMPLATE

Comparer les articles du batch.

Pénaliser l'utilisation répétée de formulations telles que :

Le point stratégique
Le signal à suivre
Le vrai test
L'arbitrage est clair
Ce qui compte maintenant

La voix peut être cohérente.

La structure ne doit pas être mécanique.

---

## REVISION FEEDBACK

Si revision_required :

indiquer :

WHAT FAILED
WHERE
WHY
HOW TO VERIFY THE FIX

Le Generator doit pouvoir effectuer seul le retry.

---

## FINAL

Avant approved :

editorial_value = PASS
materiality = PASS
topic_fit = PASS
source_relevance = PASS
claim_source_map = PASS
mechanism_quality = PASS
implication_specificity = PASS
cross_language_scope_parity = PASS
editorial_naturalness = PASS

Pour sport_business :

sport_business_materiality = PASS.
