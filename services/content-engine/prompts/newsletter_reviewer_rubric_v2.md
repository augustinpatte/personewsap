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
