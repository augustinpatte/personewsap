# PERSONEWS WORK GENERATOR — STRICT PREFLIGHT V2

Cette policy s'applique aux générateurs ChatGPT Work PersoNewsAP en complément du prompt éditorial officiel correspondant et du contrat runtime staging.

Elle ne remplace jamais le schéma canonique ni les règles de sécurité.

RÈGLE ABSOLUE :

AUCUN SUBMIT tant que toute la preflight n'est pas PASS.

Une tentative Supabase est une ressource rare.

Ne jamais envoyer au reviewer un output dont le générateur sait déjà qu'il échoue sur :
- longueur ;
- source ;
- URL ;
- schéma ;
- FR/EN ;
- duplication ;
- difficulté Q2 ;
- qualité Q3 ;
- distracteurs.

Si un contrôle échoue :
corriger localement, refaire la recherche si nécessaire, puis recommencer toute la preflight AVANT submit.

---


# 0. FIRST-TRY CANDIDATE GATE — MINI CASE — BLOQUANT

Avant toute rédaction Mini Case :

générer au moins deux candidats internes.

Le candidat choisi doit passer :

candidate_source_fit = PASS
candidate_mechanism_fit = PASS
candidate_novelty = PASS
candidate_calculability = PASS
candidate_q2_unique_solution = PASS
candidate_q3_tradeoff = PASS

Sinon :

ABANDONNER LE CANDIDAT.

Le Reviewer n’est pas une étape de correction normale.

Objectif :

FIRST SUBMISSION = PUBLISHABLE.

---

# 1. SOURCE FREEZE — BLOQUANT

Avant rédaction, figer les sources réellement utilisées.

Pour chaque source vérifier :

- URL exacte et stable ;
- publisher réel ;
- titre réel ;
- date réelle de publication si disponible ;
- faits/chiffres réellement présents sur cette page.

ÉCHEC AUTOMATIQUE si l'URL est :

- homepage ;
- page d'accueil newsroom ;
- page catégorie ;
- index ;
- page de résultats de recherche ;
- page générique qui ne contient pas les faits cités.

Si seule une page générique est trouvée :

NE PAS SUBMIT.

Chercher l'article/communiqué/rapport exact.

Si la source exacte n'est pas vérifiable, choisir un autre événement.

source_urls et source_records doivent correspondre exactement aux sources réellement ouvertes et utilisées.

SOURCE RELEVANCE — BLOQUANT :

Une source peut être crédible et correctement citée tout en étant hors sujet.

Pour chaque source principale :

1. identifier le claim exact utilisé ;
2. identifier le mécanisme soutenu ;
3. identifier pourquoi ce claim est nécessaire à la décision.

SOURCE_REMOVAL_TEST :

si retirer la source ne retire aucun élément réel spécifique et important du cas :

source_relevance = FAIL.

Une source macro générale ne soutient pas automatiquement un mécanisme de working capital.

Une source générale d’investissement ne soutient pas automatiquement un mécanisme précis d’exécution.

Une source réglementaire doit être précisément pertinente à la règle/procédure utilisée.

Une source santé/engineering doit soutenir précisément le système ou mécanisme utilisé.

Avant rédaction :

claim_source_map = PASS

Chaque claim réel important doit pointer vers un source_record exact.

---


# 1A. NEWSLETTER — FIRST-TRY CANDIDATE GATE

Objectif :

FIRST SUBMISSION = PUBLISHABLE.

Avant submit :

editorial_value = PASS
materiality = PASS
topic_fit = PASS
source_relevance = PASS
claim_source_map = PASS
mechanism_quality = PASS
implication_specificity = PASS
cross_language_scope_parity = PASS
editorial_naturalness = PASS
shadow_reviewer_score_94_plus = PASS

Lorsqu'un topic contient deux ordinals :

distinct_event = PASS

Si topic = sport_business :

sport_business_materiality = PASS

Une actualité vraie mais sans valeur éditoriale suffisante :

FAIL.

Une information de chaîne TV, feed, horaire ou programmation ordinaire :

FAIL pour sport_business sauf modification réelle de l'économie des droits,
de la distribution ou de la monétisation.

Ne jamais soumettre un événement faible simplement parce qu'il est récent.

---

# 2. NEWSLETTER — DISTINCTNESS

Lorsqu'un topic possède deux ordinals, comparer les deux contenus avant submit.

Ils doivent porter sur deux ÉVÉNEMENTS SOUS-JACENTS DISTINCTS.

Une différence de :

- titre ;
- angle ;
- formulation ;
- ville ;
- sous-angle ;

ne suffit pas si les deux articles proviennent de la même annonce ou du même événement.

Test obligatoire :

UNDERLYING_EVENT_1 != UNDERLYING_EVENT_2

et normalement :

PRIMARY_SOURCE_URL_1 != PRIMARY_SOURCE_URL_2

Si ce test échoue :
remplacer l'un des sujets avant submit.

---

# 3. NEWSLETTER — LONGUEUR ET QUALITÉ

Pour CHAQUE langue compter réellement les mots de body_md.

Hard contract :

120 à 220 mots PAR LANGUE.

Zone cible recommandée :

135 à 190 mots PAR LANGUE.

Ne jamais soumettre 117, 118 ou 119 mots.

Avant submit vérifier :

- body_md FR = 120–220 ;
- body_md EN = 120–220 ;
- FR naturel ;
- EN naturel ;
- mêmes faits ;
- mêmes chiffres ;
- mêmes sources ;
- même angle ;
- même incertitude ;
- URL exacte ;
- pas de homepage/index ;
- aucun chiffre non vérifié ;
- implication spécifique ;
- événement distinct de l'autre ordinal du topic.

Un seul FAIL = PAS DE SUBMIT.

---

# 4. BUSINESS STORY — FIRST-TRY GATE

Le premier submit doit être publiable.

Avant rédaction finale :

comparer plusieurs candidats lorsque le sujet n'est pas imposé.

Le candidat retenu doit avoir :

- une vraie contradiction ou tension ;
- une décision ;
- un mécanisme business causal ;
- un coût / renoncement ;
- un résultat observable ;
- un packet de sources suffisamment riche.

Minimum source packet :

2 sources réellement informatives.

Au moins une source primaire lorsque raisonnablement disponible.

Une seule press release est normalement insuffisante.

Tests obligatoires :

candidate_quality = PASS
source_packet_depth = PASS
source_packet_closure = PASS

SOURCE PACKET CLOSURE :

après freeze des sources, aucun fait ne peut être ajouté depuis une page absente
de source_records.

Si une nouvelle source devient nécessaire :

l'ajouter AVANT rédaction finale et refaire le source audit.

CLAIM–SOURCE MAP :

tout claim factuel important doit pointer vers une URL exacte du packet.

Tests :

claim_source_map = PASS
source_relevance = PASS
facts_verified = PASS

MECHANISM PROOF :

le générateur doit être capable d'expliquer causalement :

input
→ action/system
→ effet économique
→ effet revenu/coût/client
→ résultat

mechanism_proof = PASS

TRADE-OFF PROOF :

identifier :

decision
benefit
cost
risk
alternative

tradeoff_proof = PASS

LONGUEUR :

body_md FR :
750–950 mots

body_md EN :
750–950 mots

cible :
800–900 mots par langue.

APP READER :

setup :
120–280 mots

tension :
120–280 mots

decision :
120–280 mots

outcome :
120–280 mots

total visible :
700–1000 mots

abs(total_visible - body_md) <= 100 mots.

Tests :

mobile_story_integrity = PASS
body_visible_alignment = PASS

FR / EN :

même factual core,
mêmes chiffres,
mêmes sources,
même mécanisme,
même trade-off,
même degré d'incertitude.

cross_language_scope_parity = PASS

PARAGRAPH TEST :

chaque paragraphe ajoute une information nouvelle.

paragraph_novelty = PASS

CAVEAT TEST :

si une part significative du texte explique surtout ce que les sources ne disent
pas, changer de sujet.

caveat_ratio = PASS

ANTI-REPETITION :

novelty_distance = PASS

SHADOW REVIEW :

shadow_reviewer_score_94_plus = PASS

Un seul FAIL :

PAS DE SUBMIT.

---

# 5. MINI CASE — LONGUEUR

Pour CHAQUE langue compter réellement body_md.

Hard contract actuel :

200 à 320 mots PAR LANGUE.

Zone cible obligatoire :

230 à 280 mots PAR LANGUE.

Ne pas estimer visuellement.

Un Mini Case à :

90,
115,
129,
137,
141,
160,
177,
195,
199 mots

est un FAIL.

Il ne doit jamais être soumis.

---

# 6. MINI CASE — Q1

Q1 doit tester une méthode, un framework, une métrique ou une logique.

Les quatre options doivent être professionnellement plausibles.

La bonne réponse ne doit pas être identifiable uniquement parce qu'elle est plus longue, plus prudente ou plus technique.

---

# 7. MINI CASE — Q2 TECHNICAL APPLICATION

Q2 ne doit PAS être :

- une définition ;
- un rappel textuel ;
- une reconnaissance de mot-clé ;
- une question dont la réponse répète une phrase du contexte ;
- une question avec trois distracteurs manifestement absurdes.

Q2 doit utiliser AU MOINS DEUX contraintes ou données propres au cas.

Exemples acceptés :

- calcul réel ;
- comparaison de scénarios ;
- identification d'un bottleneck ;
- causalité ;
- effet de second ordre ;
- application d'un cadre ;
- choix d'une métrique à partir d'un objectif + contrainte.

Test obligatoire :

« Peut-on répondre correctement à Q2 sans utiliser au moins deux éléments spécifiques du cas ? »

Si OUI :

Q2 FAIL.

La reconstruire.

---


# 7A. MINI CASE — Q2 PROOF SHEET — BLOQUANT

Avant submit, résoudre Q2 depuis zéro.

Pour chaque variable :

name
value
unit
origin

Puis :

objective
constraints
formula
calculation
result
rounding

Calculer ensuite chacune des quatre options.

Tests obligatoires :

q2_unique_solution = PASS
option_dominance_check = PASS

Si un distracteur satisfait toutes les contraintes et obtient un objectif égal ou
meilleur que la bonne réponse :

FAIL.

Pour les carnets d’ordres avec prix moyen minimal :

average_execution_price =
total_proceeds / total_shares_executed

sur toutes les tranches consommées.

---

# 7B. MASTER CASE SPEC FR / EN — BLOQUANT

FR et EN doivent dériver d’une seule fiche canonique contenant :

facts
fictional parameters
numbers
units
constraints
assumptions
formulas
results
correct answers
uncertainty

Aucune différence substantielle autorisée.

Test :

master_case_spec_consistency = PASS

---

# 8. MINI CASE — Q3 GENUINE TRADE-OFF

Q3 est une décision sous contrainte.

Ce n'est PAS une question de bonne pratique évidente.

Avant submit, le générateur doit pouvoir écrire mentalement :

Option X est défendable parce que :
[bénéfice réel]

mais coûte/risque :
[coût réel]

Option Y est défendable parce que :
[bénéfice réel]

mais coûte/risque :
[coût réel]

L'option correcte gagne DANS CE CAS parce que :
[contraintes précises du scénario]

Si le générateur ne peut pas défendre honnêtement au moins DEUX options :

Q3 FAIL.

La reconstruire.

ÉCHEC AUTOMATIQUE si la bonne réponse est opposée à trois strawmen tels que :

- tout déployer immédiatement sans contrôle ;
- ne rien mesurer ;
- attendre indéfiniment ;
- ignorer le risque ;
- ouvrir tous les accès sans formation ;
- abandonner tout pilote ;
- choisir une vanity metric manifestement hors sujet.

Au moins deux options doivent sembler raisonnables AVANT d'appliquer les contraintes du scénario.

La bonne réponse doit gagner par arbitrage.

---

# 9. MINI CASE — DISTRACTEURS

Chaque question :

- exactement 4 options ;
- exactement 1 bonne réponse ;
- 3 mauvaises réponses plausibles ;
- même espace de décision ;
- niveau de précision comparable ;
- longueur raisonnablement comparable.

Chaque mauvaise réponse doit représenter une vraie erreur de raisonnement qu'un junior compétent pourrait défendre.

Test aveugle :

si quelqu'un qui n'a pas lu le cas peut repérer la bonne réponse parce que les trois autres semblent ridicules :

FAIL.

---

# 10. FR / EN

Comparer systématiquement FR et EN avant submit.

Ils doivent partager :

- événements ;
- chiffres ;
- dates factuelles ;
- acteurs ;
- sources ;
- mécanisme ;
- bonne réponse ;
- degré d'incertitude.

La formulation doit être naturelle dans chaque langue.

Une langue ne doit pas ajouter un fait ou une conclusion absente de l'autre.

---

# 10A. SUFFISANCE DES CONTRAINTES ET COHÉRENCE NUMÉRIQUE — BLOQUANT

Toute conclusion quantitative doit être calculable à partir des données réellement
présentes dans le scénario.

INTERDIT :

- déduire une capacité sûre à partir d'un plafond sans connaître la charge ;
- déduire qu'un volume dépasse une capacité sans taux d'incident ou fréquence ;
- transformer une corrélation en relation quantitative ;
- utiliser un chiffre dans la bonne réponse qui ne découle pas des données du cas.

Avant submit, identifier chaque calcul ou conclusion quantitative et vérifier que
TOUTES ses variables sont présentes.

Si une variable manque :

1. ajouter une hypothèse fictive interne explicitement présentée comme paramètre
   du scénario, si le format l'autorise ;
OU
2. supprimer la conclusion quantitative.

Ne jamais attribuer une hypothèse fictive à la source réelle.

Recalculer manuellement chaque calcul.

Le résultat doit être cohérent dans :

- body_md ;
- context ;
- constraints ;
- Q2 ;
- Q3 ;
- option correcte ;
- feedback ;
- explanation ;
- sample_answer ;
- expected_reasoning ;
- final_takeaway.

Test obligatoire :

constraint_sufficiency = PASS
numerical_consistency = PASS

---

# 10B. QUALITÉ ÉDITORIALE ET PARITÉ DE PORTÉE — BLOQUANT

Le texte ne doit pas simplement être valide.

Il doit être publiable.

NEWSLETTER :

- ne pas rendre visible la checklist mécanisme / implication / signal ;
- éviter les mêmes transitions et conclusions que les autres articles ;
- ne pas forcer une profondeur absente des sources ;
- préférer une formulation concrète à un label abstrait.

BUSINESS STORY :

- chaque paragraphe apporte une nouvelle idée ;
- ne pas répéter la thèse pour remplir ;
- progression narrative visible ;
- pas de cadence de rapport ou de consultant.

MINI CASE :

- immersion immédiate ;
- pas de commentaire sur la fabrication du cas ;
- ne pas pré-résoudre les questions dans le corps ;
- Q3 conserve au moins deux voies professionnellement défendables.

FR / EN :

La parité n'est pas seulement l'absence de contradiction.

Les deux langues doivent avoir la même PORTÉE éditoriale.

Interdit :

- un paragraphe supplémentaire important dans une seule langue ;
- une nouvelle explication causale dans une seule langue ;
- une implication ou un risque important présent dans une seule langue ;
- un chiffre ou une réserve substantielle absent de l'autre version.

Les formulations peuvent être naturelles et différentes.

Les idées substantielles doivent être les mêmes.

Tests obligatoires :

editorial_naturalness = PASS
cross_language_scope_parity = PASS

---

# 11. SCHEMA / JSON

Avant submit vérifier :

- JSON valide ;
- tous les champs runtime obligatoires ;
- FR présent ;
- EN présent ;
- source_urls présent ;
- source_records présent ;
- aucun placeholder ;
- aucun TODO ;
- aucun champ de démonstration.

Mini Case :

- exactement 3 questions ;
- roles exacts attendus ;
- exactement 4 options/question ;
- exactement 1 is_correct/question.

---

# 12. REVISION_REQUIRED

Pour une nouvelle tentative :

1. lire le feedback exact du reviewer ;
2. lister TOUS les problèmes ;
3. corriger TOUS les problèmes ;
4. refaire TOUTE la preflight ;
5. seulement ensuite submit.

Ne jamais corriger uniquement la longueur en laissant Q3 cassée.

Ne jamais corriger uniquement l'URL en laissant la longueur hors contrat.

Ne jamais patcher superficiellement une dernière tentative.

Si nécessaire :
reconstruire complètement le contenu.

---

# 13. FINAL PREFLIGHT

Juste avant submit :

TRONC COMMUN — TOUS CONTENT TYPES

schema = PASS
sources_exact = PASS
facts_verified = PASS
fr_en_parity = PASS
cross_language_scope_parity = PASS
word_count_fr = PASS
word_count_en = PASS
no_placeholder = PASS
editorial_naturalness = PASS

Ensuite appliquer UNIQUEMENT les checks correspondant au content_type courant.

--------------------------------------------------
NEWSLETTER
--------------------------------------------------

editorial_value = PASS
materiality = PASS
topic_fit = PASS
source_relevance = PASS
claim_source_map = PASS
mechanism_quality = PASS
implication_specificity = PASS
shadow_reviewer_score_94_plus = PASS

Si deux ordinals existent :

distinct_event = PASS

Si topic = sport_business :

sport_business_materiality = PASS

--------------------------------------------------
BUSINESS STORY
--------------------------------------------------

candidate_quality = PASS
source_packet_depth = PASS
source_packet_closure = PASS
claim_source_map = PASS
source_relevance = PASS
mechanism_proof = PASS
tradeoff_proof = PASS
mobile_story_integrity = PASS
body_visible_alignment = PASS
paragraph_novelty = PASS
caveat_ratio = PASS
novelty_distance = PASS
shadow_reviewer_score_94_plus = PASS

--------------------------------------------------
MINI CASE
--------------------------------------------------

source_relevance = PASS
claim_source_map = PASS
master_case_spec_consistency = PASS
constraint_sufficiency = PASS
numerical_consistency = PASS
q1_method = PASS
q2_application = PASS
q2_unique_solution = PASS
option_dominance_check = PASS
q3_dependency_on_valid_q2 = PASS
q3_tradeoff = PASS
distractors_plausible = PASS
immersion = PASS
novelty_distance = PASS
shadow_reviewer_score_94_plus = PASS

--------------------------------------------------

RÈGLE ABSOLUE :

Ne jamais demander à un content_type un check appartenant uniquement à un autre.

Une Newsletter n'a pas de Q2 ou Q3.

Une Business Story n'a pas de distracteurs.

Un Mini Case n'a pas de mobile_story_integrity Business Story.

Un seul FAIL applicable au content_type courant :

INTERDICTION DE SUBMIT.

Corriger localement ou changer de candidat.

Le Reviewer reste indépendant.

La preflight sert à empêcher les erreurs évitables d'atteindre le Reviewer.
