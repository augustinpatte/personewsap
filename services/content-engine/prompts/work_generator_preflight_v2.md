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

# 4. BUSINESS STORY

Compter réellement le corps final dans chaque langue.

Hard contract :

650 à 950 mots PAR LANGUE.

Zone cible :

720 à 850 mots PAR LANGUE.

Vérifier :

- vraie narration ;
- mécanisme économique/stratégique ;
- détails opérationnels ;
- vraie tension ;
- vrai arbitrage ;
- sources exactes ;
- parité FR/EN ;
- aucun fait important non sourcé ;
- longueur conforme.

Un seul FAIL = PAS DE SUBMIT.

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

Juste avant submit, tous ces contrôles doivent être PASS :

schema = PASS
sources_exact = PASS
facts_verified = PASS
fr_en_parity = PASS
word_count_fr = PASS
word_count_en = PASS
no_placeholder = PASS

Newsletter :

distinct_event = PASS

Mini Case :

q1_method = PASS
q2_application = PASS
q3_tradeoff = PASS
distractors_plausible = PASS

SI UN SEUL EST FAIL :

INTERDICTION DE SUBMIT.

Corriger puis recommencer.

Le reviewer reste indépendant et strict.
Cette preflight ne garantit jamais l'approbation.
Elle sert uniquement à éliminer les erreurs évitables avant review.
