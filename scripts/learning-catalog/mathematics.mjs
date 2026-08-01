// Mathematics concepts.
// Shared base: 9 steps eligible for the three orientations.
// math_foundations: algebra, functions, logic, proofs, problem solving.
// math_probability: reasoning under uncertainty, data, interpretation.
// math_technology: linear algebra, calculus and discrete mathematics for computing.
export const domain = {
  id: "mathematics",
  objectives: ["math_foundations", "math_probability", "math_technology"],
  steps: [
    {
      key: "number_sets",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Les ensembles de nombres et pourquoi ils s'étendent",
        summary: "Comprendre chaque extension des nombres comme la réponse à une opération jusque-là impossible.",
        goals: [
          "Associer chaque ensemble à l'opération qui a exigé sa création.",
          "Dire à quel ensemble appartient un nombre donné."
        ],
        tutor:
          "Fais dire quelle opération devient possible en passant des entiers aux rationnels puis aux réels, avec un exemple à chaque étape.",
        contexts: [
          "un partage de trois gâteaux entre quatre personnes",
          "une température descendue sous zéro",
          "la diagonale d'un carré de côté un"
        ]
      },
      en: {
        title: "Number sets and why they keep extending",
        summary: "Understand each extension of numbers as the answer to a previously impossible operation.",
        goals: [
          "Match each set to the operation that required its creation.",
          "Say which set a given number belongs to."
        ],
        tutor:
          "Have the student say which operation becomes possible moving from integers to rationals then to reals, with an example each time.",
        contexts: [
          "sharing three cakes among four people",
          "a temperature below zero",
          "the diagonal of a unit square"
        ]
      }
    },
    {
      key: "proportions_percentages",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Proportions, pourcentages et variations relatives",
        summary: "Manipuler les pourcentages successifs et distinguer un écart en points d'un écart en pourcentage.",
        goals: [
          "Calculer l'effet d'une hausse suivie d'une baisse du même pourcentage.",
          "Distinguer une variation en points d'une variation relative."
        ],
        tutor:
          "Fais calculer le prix final après une hausse de 20 % puis une baisse de 20 %, puis demande pourquoi on ne revient pas au prix initial.",
        contexts: [
          "un prix augmenté de 20 % puis soldé de 20 %",
          "un taux passé de 4 % à 6 %",
          "une part de marché annoncée en hausse de moitié"
        ]
      },
      en: {
        title: "Proportions, percentages and relative changes",
        summary: "Handle successive percentages and separate a change in points from a relative change.",
        goals: [
          "Compute the effect of a rise followed by an equal-percentage fall.",
          "Tell apart a change in points and a relative change."
        ],
        tutor:
          "Have the student compute the final price after a 20% rise then a 20% discount, then ask why it does not return to the start.",
        contexts: [
          "a price raised 20% then discounted 20%",
          "a rate moving from 4% to 6%",
          "a market share announced as up by half"
        ]
      }
    },
    {
      key: "equation_meaning",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Ce qu'une équation affirme vraiment",
        summary: "Lire une équation comme une contrainte sur une inconnue plutôt que comme un calcul à effectuer.",
        goals: [
          "Traduire un énoncé en équation et nommer l'inconnue.",
          "Vérifier qu'une valeur proposée satisfait l'équation."
        ],
        tutor:
          "Fais traduire un énoncé simple en équation, puis demande de vérifier deux valeurs candidates et d'expliquer ce que « résoudre » signifie.",
        contexts: [
          "un budget partagé entre trois postes de dépense",
          "une distance parcourue à vitesse constante",
          "un ingrédient dont on cherche la quantité dans une recette"
        ]
      },
      en: {
        title: "What an equation actually states",
        summary: "Read an equation as a constraint on an unknown rather than a calculation to perform.",
        goals: [
          "Translate a statement into an equation and name the unknown.",
          "Check whether a proposed value satisfies the equation."
        ],
        tutor:
          "Have the student translate a simple statement into an equation, then check two candidate values and explain what “solving” means.",
        contexts: [
          "a budget split across three spending lines",
          "a distance covered at constant speed",
          "an ingredient quantity to find in a recipe"
        ]
      }
    },
    {
      key: "reading_a_graph",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Lire un graphique sans se faire tromper",
        summary: "Vérifier les axes, l'échelle et l'origine avant d'interpréter une courbe ou un histogramme.",
        goals: [
          "Repérer un axe tronqué et son effet sur l'impression visuelle.",
          "Reformuler ce qu'un graphique montre réellement."
        ],
        tutor:
          "Fais critiquer un graphique dont l'axe vertical commence à 90, puis demande de reformuler l'évolution réelle en une phrase.",
        contexts: [
          "un graphique de ventes dont l'axe commence à 90",
          "une échelle logarithmique dans un article scientifique",
          "un histogramme aux classes de largeurs inégales"
        ]
      },
      en: {
        title: "Reading a chart without being fooled",
        summary: "Check axes, scale and origin before interpreting a curve or a histogram.",
        goals: [
          "Spot a truncated axis and its effect on the visual impression.",
          "Restate what a chart actually shows."
        ],
        tutor:
          "Have the student critique a chart whose vertical axis starts at 90, then restate the real change in one sentence.",
        contexts: [
          "a sales chart whose axis starts at 90",
          "a logarithmic scale in a scientific article",
          "a histogram with unequal class widths"
        ]
      }
    },
    {
      key: "units_and_magnitudes",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Unités, conversions et ordres de grandeur",
        summary: "Contrôler un résultat par ses unités et par une estimation avant de le croire.",
        goals: [
          "Vérifier la cohérence des unités d'un calcul.",
          "Estimer un ordre de grandeur avant de calculer précisément."
        ],
        tutor:
          "Fais estimer un ordre de grandeur avant tout calcul, puis demande d'utiliser les unités pour détecter une erreur de formule.",
        contexts: [
          "une consommation annoncée en kilowattheures",
          "une vitesse convertie de kilomètres par heure en mètres par seconde",
          "un devis dont le total est cent fois trop grand"
        ]
      },
      en: {
        title: "Units, conversions and orders of magnitude",
        summary: "Check a result through its units and through an estimate before believing it.",
        goals: [
          "Check the unit consistency of a computation.",
          "Estimate an order of magnitude before computing precisely."
        ],
        tutor:
          "Have the student estimate an order of magnitude before any computation, then use units to catch a formula error.",
        contexts: [
          "a consumption announced in kilowatt-hours",
          "a speed converted from kilometres per hour to metres per second",
          "a quote whose total is a hundred times too large"
        ]
      }
    },
    {
      key: "function_concept",
      objectives: "*",
      stage: 2,
      fr: {
        title: "La notion de fonction : entrée, sortie, unicité",
        summary: "Distinguer une fonction d'une simple relation grâce à l'unicité de l'image.",
        goals: [
          "Décider si une correspondance donnée est une fonction.",
          "Nommer domaine et image sur un exemple concret."
        ],
        tutor:
          "Fais décider si trois correspondances sont des fonctions, puis demande de justifier le cas qui échoue.",
        contexts: [
          "un tarif postal en fonction du poids",
          "une correspondance entre élèves et notes de plusieurs matières",
          "une machine qui rend toujours la même monnaie pour la même pièce"
        ]
      },
      en: {
        title: "The idea of a function: input, output, uniqueness",
        summary: "Tell a function apart from a mere relation through the uniqueness of the image.",
        goals: [
          "Decide whether a given correspondence is a function.",
          "Name domain and range on a concrete example."
        ],
        tutor:
          "Have the student decide whether three correspondences are functions, then justify the one that fails.",
        contexts: [
          "a postage price as a function of weight",
          "a correspondence between students and grades in several subjects",
          "a machine always returning the same change for the same coin"
        ]
      }
    },
    {
      key: "algebraic_manipulation",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Manipuler une expression sans changer sa valeur",
        summary: "Appliquer les transformations autorisées et repérer celles qui font perdre des solutions.",
        goals: [
          "Justifier chaque étape d'une transformation d'expression.",
          "Repérer une division par une quantité pouvant être nulle."
        ],
        tutor:
          "Fais justifier chaque étape d'une simplification, puis demande où une division cache une perte de solution.",
        contexts: [
          "une simplification qui fait disparaître une solution",
          "une formule de physique isolée pour une variable",
          "une identité remarquable utilisée pour factoriser"
        ]
      },
      en: {
        title: "Transforming an expression without changing its value",
        summary: "Apply the allowed transformations and spot the ones that lose solutions.",
        goals: [
          "Justify each step of an expression transformation.",
          "Spot a division by a quantity that may be zero."
        ],
        tutor:
          "Have the student justify each step of a simplification, then ask where a division hides a lost solution.",
        contexts: [
          "a simplification that makes a solution disappear",
          "a physics formula rearranged for one variable",
          "a standard identity used to factorise"
        ]
      }
    },
    {
      key: "counterexample_power",
      objectives: "*",
      stage: 2,
      fr: {
        title: "La force d'un contre-exemple",
        summary: "Comprendre qu'un seul cas suffit à réfuter un énoncé général alors que mille cas ne le prouvent pas.",
        goals: [
          "Réfuter un énoncé général par un contre-exemple.",
          "Expliquer pourquoi des exemples favorables ne suffisent jamais."
        ],
        tutor:
          "Fais trouver un contre-exemple à un énoncé faux mais crédible, puis demande combien d'exemples suffiraient à le prouver.",
        contexts: [
          "l'affirmation que tout nombre impair est premier",
          "une règle vérifiée sur les dix premiers cas",
          "une formule qui échoue seulement pour zéro"
        ]
      },
      en: {
        title: "The power of a counterexample",
        summary: "Understand that one case refutes a general claim while a thousand cases never prove it.",
        goals: [
          "Refute a general statement with a counterexample.",
          "Explain why favourable examples are never enough."
        ],
        tutor:
          "Have the student find a counterexample to a false but credible claim, then ask how many examples would prove it.",
        contexts: [
          "the claim that every odd number is prime",
          "a rule verified on the first ten cases",
          "a formula failing only at zero"
        ]
      }
    },
    {
      key: "exact_and_approximate",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Valeur exacte et valeur approchée",
        summary: "Choisir entre forme exacte et arrondi, et suivre la propagation d'une erreur dans un calcul.",
        goals: [
          "Dire quand une forme exacte est préférable à un arrondi.",
          "Estimer l'effet d'arrondis successifs sur un résultat final."
        ],
        tutor:
          "Fais comparer un calcul mené en valeurs exactes puis avec des arrondis intermédiaires, et demande l'écart final obtenu.",
        contexts: [
          "un devis calculé avec des arrondis à chaque ligne",
          "une racine carrée laissée sous forme exacte",
          "un taux d'intérêt arrondi au centième"
        ]
      },
      en: {
        title: "Exact value and approximate value",
        summary: "Choose between exact form and rounding, and follow how an error propagates in a computation.",
        goals: [
          "Say when an exact form beats a rounded one.",
          "Estimate the effect of successive roundings on a final result."
        ],
        tutor:
          "Have the student compare a computation in exact values and with intermediate roundings, and ask for the final gap.",
        contexts: [
          "a quote computed with rounding on each line",
          "a square root left in exact form",
          "an interest rate rounded to the hundredth"
        ]
      }
    },

    {
      key: "inequalities_intervals",
      objectives: ["math_foundations"],
      stage: 1,
      fr: {
        title: "Inégalités et intervalles",
        summary: "Résoudre une inégalité en surveillant le sens du signe et exprimer la solution en intervalle.",
        goals: [
          "Résoudre une inégalité comportant une multiplication par un négatif.",
          "Écrire un ensemble de solutions sous forme d'intervalle."
        ],
        tutor:
          "Fais résoudre une inégalité où l'on multiplie par un nombre négatif, puis demande d'expliquer le changement de sens.",
        contexts: [
          "une condition de remise à partir d'un certain montant",
          "une température maintenue dans une plage précise",
          "une inégalité multipliée par un nombre négatif"
        ]
      },
      en: {
        title: "Inequalities and intervals",
        summary: "Solve an inequality while watching the direction of the sign and express the solution as an interval.",
        goals: [
          "Solve an inequality involving multiplication by a negative.",
          "Write a solution set as an interval."
        ],
        tutor:
          "Have the student solve an inequality multiplied by a negative number, then explain the reversal of direction.",
        contexts: [
          "a discount condition above a given amount",
          "a temperature kept inside a precise range",
          "an inequality multiplied by a negative number"
        ]
      }
    },
    {
      key: "linear_systems",
      objectives: ["math_foundations"],
      stage: 2,
      fr: {
        title: "Résoudre un système de deux équations",
        summary: "Interpréter un système comme l'intersection de deux droites et reconnaître les cas sans solution.",
        goals: [
          "Résoudre un système par substitution et par combinaison.",
          "Reconnaître un système sans solution ou à une infinité de solutions."
        ],
        tutor:
          "Fais résoudre un système par deux méthodes, puis demande à quoi ressemble géométriquement un système sans solution.",
        contexts: [
          "deux tarifs d'abonnement égalisés à un certain usage",
          "un mélange de deux produits à concentration donnée",
          "deux droites parallèles tracées dans un repère"
        ]
      },
      en: {
        title: "Solving a system of two equations",
        summary: "Read a system as the intersection of two lines and recognise the cases with no solution.",
        goals: [
          "Solve a system by substitution and by combination.",
          "Recognise a system with no solution or infinitely many."
        ],
        tutor:
          "Have the student solve a system by two methods, then ask what a system with no solution looks like geometrically.",
        contexts: [
          "two subscription plans equal at a certain usage",
          "a mixture of two products at a given concentration",
          "two parallel lines drawn in a coordinate frame"
        ]
      }
    },
    {
      key: "quadratic_roots",
      objectives: ["math_foundations"],
      stage: 2,
      fr: {
        title: "Le discriminant et les racines d'un trinôme",
        summary: "Relier le signe du discriminant au nombre de racines et à la position de la parabole.",
        goals: [
          "Calculer un discriminant et en déduire le nombre de racines.",
          "Relier ce résultat à l'allure de la courbe."
        ],
        tutor:
          "Fais calculer trois discriminants de signes différents, puis demande de dessiner l'allure de chaque parabole correspondante.",
        contexts: [
          "la trajectoire d'un ballon lancé en l'air",
          "une aire maximale pour un périmètre donné",
          "une équation sans solution réelle"
        ]
      },
      en: {
        title: "The discriminant and the roots of a quadratic",
        summary: "Connect the sign of the discriminant to the number of roots and to the parabola's position.",
        goals: [
          "Compute a discriminant and deduce the number of roots.",
          "Relate that result to the shape of the curve."
        ],
        tutor:
          "Have the student compute three discriminants of different signs, then sketch the matching parabolas.",
        contexts: [
          "the path of a ball thrown into the air",
          "a maximum area for a given perimeter",
          "an equation with no real solution"
        ]
      }
    },
    {
      key: "logic_connectives",
      objectives: ["math_foundations"],
      stage: 3,
      fr: {
        title: "Connecteurs logiques et tables de vérité",
        summary: "Formaliser un énoncé composé et déterminer sa valeur de vérité de façon mécanique.",
        goals: [
          "Construire la table de vérité d'un énoncé à deux propositions.",
          "Traduire une condition du langage courant en formule logique."
        ],
        tutor:
          "Fais construire la table de vérité d'une condition d'accès à deux critères, puis demande la formulation exacte de son contraire.",
        contexts: [
          "une condition d'accès combinant âge et abonnement",
          "un filtre de recherche avec deux critères",
          "une consigne ambiguë contenant « ou »"
        ]
      },
      en: {
        title: "Logical connectives and truth tables",
        summary: "Formalise a compound statement and determine its truth value mechanically.",
        goals: [
          "Build the truth table of a statement with two propositions.",
          "Translate an everyday condition into a logical formula."
        ],
        tutor:
          "Have the student build the truth table of a two-criterion access condition, then state its exact negation.",
        contexts: [
          "an access condition combining age and subscription",
          "a search filter with two criteria",
          "an ambiguous instruction containing “or”"
        ]
      }
    },
    {
      key: "implication_contrapositive",
      objectives: ["math_foundations"],
      stage: 3,
      fr: {
        title: "Implication, réciproque et contraposée",
        summary: "Distinguer un énoncé de sa réciproque et utiliser la contraposée comme outil de preuve.",
        goals: [
          "Écrire la réciproque et la contraposée d'une implication.",
          "Dire laquelle est toujours équivalente à l'énoncé initial."
        ],
        tutor:
          "Fais écrire réciproque et contraposée d'un énoncé donné, puis demande laquelle peut être fausse alors que l'énoncé est vrai.",
        contexts: [
          "« s'il pleut, le sol est mouillé » et ses variantes",
          "une condition suffisante confondue avec une condition nécessaire",
          "un test médical dont on inverse la lecture"
        ]
      },
      en: {
        title: "Implication, converse and contrapositive",
        summary: "Tell a statement apart from its converse and use the contrapositive as a proof tool.",
        goals: [
          "Write the converse and the contrapositive of an implication.",
          "Say which one is always equivalent to the original statement."
        ],
        tutor:
          "Have the student write the converse and contrapositive of a given statement, then ask which can be false while the statement is true.",
        contexts: [
          "“if it rains, the ground is wet” and its variants",
          "a sufficient condition mistaken for a necessary one",
          "a medical test whose reading is reversed"
        ]
      }
    },
    {
      key: "proof_by_induction",
      objectives: ["math_foundations"],
      stage: 3,
      fr: {
        title: "La démonstration par récurrence",
        summary: "Établir une propriété pour tous les entiers à partir d'une initialisation et d'une hérédité.",
        goals: [
          "Rédiger les deux étapes d'une preuve par récurrence.",
          "Repérer une récurrence dont l'initialisation est fausse."
        ],
        tutor:
          "Fais rédiger les deux étapes pour la somme des n premiers entiers, puis demande ce qui casse si l'initialisation est omise.",
        contexts: [
          "la somme des n premiers entiers",
          "une rangée de dominos dont l'un est mal placé",
          "une formule vérifiée à partir de n égal 3 seulement"
        ]
      },
      en: {
        title: "Proof by induction",
        summary: "Establish a property for all integers from a base case and an inductive step.",
        goals: [
          "Write the two steps of an induction proof.",
          "Spot an induction whose base case is false."
        ],
        tutor:
          "Have the student write both steps for the sum of the first n integers, then ask what breaks if the base case is skipped.",
        contexts: [
          "the sum of the first n integers",
          "a row of dominoes with one badly placed",
          "a formula true only from n equal to 3"
        ]
      }
    },
    {
      key: "set_operations",
      objectives: ["math_foundations"],
      stage: 3,
      fr: {
        title: "Opérations sur les ensembles et dénombrement",
        summary: "Utiliser union, intersection et complémentaire pour compter sans double comptage.",
        goals: [
          "Appliquer la formule du cardinal d'une union.",
          "Représenter une situation par un diagramme d'ensembles."
        ],
        tutor:
          "Fais compter les personnes parlant au moins une de deux langues à partir de trois chiffres, puis demande d'où vient la soustraction.",
        contexts: [
          "des clients abonnés à une offre, à l'autre ou aux deux",
          "un sondage sur deux pratiques déclarées",
          "un fichier fusionné contenant des doublons"
        ]
      },
      en: {
        title: "Set operations and counting",
        summary: "Use union, intersection and complement to count without double counting.",
        goals: [
          "Apply the formula for the size of a union.",
          "Represent a situation with a set diagram."
        ],
        tutor:
          "Have the student count people speaking at least one of two languages from three figures, then ask where the subtraction comes from.",
        contexts: [
          "customers subscribed to one offer, the other or both",
          "a survey about two declared practices",
          "a merged file containing duplicates"
        ]
      }
    },
    {
      key: "proof_by_contradiction",
      objectives: ["math_foundations"],
      stage: 4,
      fr: {
        title: "Le raisonnement par l'absurde",
        summary: "Supposer le contraire d'un énoncé et en tirer une contradiction pour établir sa vérité.",
        goals: [
          "Structurer une preuve par l'absurde en trois étapes.",
          "Formuler correctement la négation de l'énoncé de départ."
        ],
        tutor:
          "Fais rédiger la preuve de l'irrationalité de la racine de deux, puis demande où se situe exactement la contradiction.",
        contexts: [
          "l'irrationalité de la racine carrée de deux",
          "l'infinité des nombres premiers",
          "une hypothèse d'unicité qui mène à deux objets distincts"
        ]
      },
      en: {
        title: "Proof by contradiction",
        summary: "Assume the opposite of a statement and derive a contradiction to establish its truth.",
        goals: [
          "Structure a proof by contradiction in three steps.",
          "Correctly formulate the negation of the initial statement."
        ],
        tutor:
          "Have the student write the proof that the square root of two is irrational, then locate the exact contradiction.",
        contexts: [
          "the irrationality of the square root of two",
          "the infinitude of prime numbers",
          "a uniqueness assumption leading to two distinct objects"
        ]
      }
    },
    {
      key: "sequences_convergence",
      objectives: ["math_foundations"],
      stage: 4,
      fr: {
        title: "Suites et convergence",
        summary: "Distinguer une suite qui s'approche d'une limite d'une suite qui croît sans borne.",
        goals: [
          "Décider si une suite simple converge ou diverge.",
          "Expliquer ce que signifie s'approcher d'une limite."
        ],
        tutor:
          "Fais calculer les cinq premiers termes de deux suites, puis demande laquelle converge et comment le justifier.",
        contexts: [
          "un capital placé à intérêts composés",
          "une distance divisée par deux à chaque étape",
          "une somme infinie qui reste finie"
        ]
      },
      en: {
        title: "Sequences and convergence",
        summary: "Tell apart a sequence approaching a limit and a sequence growing without bound.",
        goals: [
          "Decide whether a simple sequence converges or diverges.",
          "Explain what approaching a limit means."
        ],
        tutor:
          "Have the student compute the first five terms of two sequences, then say which converges and justify it.",
        contexts: [
          "capital invested with compound interest",
          "a distance halved at every step",
          "an infinite sum that stays finite"
        ]
      }
    },
    {
      key: "exponential_logarithm",
      objectives: ["math_foundations"],
      stage: 4,
      fr: {
        title: "Exponentielle et logarithme",
        summary: "Reconnaître une croissance multiplicative et utiliser le logarithme pour la ramener à une droite.",
        goals: [
          "Distinguer une croissance linéaire d'une croissance exponentielle.",
          "Utiliser le logarithme pour retrouver un temps de doublement."
        ],
        tutor:
          "Fais calculer un temps de doublement à partir d'un taux de croissance, puis demande pourquoi une échelle logarithmique linéarise la courbe.",
        contexts: [
          "une épidémie dont les cas doublent chaque semaine",
          "un capital placé à taux composé sur vingt ans",
          "une courbe tracée en échelle logarithmique"
        ]
      },
      en: {
        title: "Exponential and logarithm",
        summary: "Recognise multiplicative growth and use the logarithm to turn it into a straight line.",
        goals: [
          "Tell apart linear growth and exponential growth.",
          "Use the logarithm to recover a doubling time."
        ],
        tutor:
          "Have the student compute a doubling time from a growth rate, then ask why a logarithmic scale straightens the curve.",
        contexts: [
          "an epidemic whose cases double each week",
          "capital compounded over twenty years",
          "a curve plotted on a logarithmic scale"
        ]
      }
    },
    {
      key: "euclidean_algorithm",
      objectives: ["math_foundations"],
      stage: 4,
      fr: {
        title: "L'algorithme d'Euclide et le PGCD",
        summary: "Calculer un plus grand diviseur commun par divisions successives et comprendre pourquoi cela termine.",
        goals: [
          "Dérouler l'algorithme sur deux nombres à trois chiffres.",
          "Expliquer pourquoi la suite des restes finit par s'annuler."
        ],
        tutor:
          "Fais dérouler l'algorithme sur deux nombres à trois chiffres, puis demande pourquoi il se termine toujours.",
        contexts: [
          "une fraction à réduire à sa forme irréductible",
          "deux engrenages dont on cherche la période commune",
          "un pavage régulier d'une pièce rectangulaire"
        ]
      },
      en: {
        title: "The Euclidean algorithm and the GCD",
        summary: "Compute a greatest common divisor by successive divisions and see why it terminates.",
        goals: [
          "Run the algorithm on two three-digit numbers.",
          "Explain why the sequence of remainders eventually hits zero."
        ],
        tutor:
          "Have the student run the algorithm on two three-digit numbers, then ask why it always terminates.",
        contexts: [
          "a fraction to reduce to lowest terms",
          "two gears whose common period is sought",
          "a regular tiling of a rectangular room"
        ]
      }
    },
    {
      key: "quantifiers_negation",
      objectives: ["math_foundations"],
      stage: 5,
      fr: {
        title: "Quantificateurs et négation d'un énoncé",
        summary: "Manipuler « pour tout » et « il existe » et écrire correctement la négation d'un énoncé quantifié.",
        goals: [
          "Écrire la négation d'un énoncé à deux quantificateurs.",
          "Expliquer pourquoi l'ordre des quantificateurs change le sens."
        ],
        tutor:
          "Fais écrire la négation d'un énoncé à deux quantificateurs, puis demande ce que change l'inversion de leur ordre.",
        contexts: [
          "« tout étudiant a un tuteur » et « un tuteur pour tous »",
          "une garantie de service formulée avec « pour tout »",
          "la négation d'une promesse commerciale"
        ]
      },
      en: {
        title: "Quantifiers and negating a statement",
        summary: "Handle “for all” and “there exists” and correctly write the negation of a quantified statement.",
        goals: [
          "Write the negation of a statement with two quantifiers.",
          "Explain why quantifier order changes the meaning."
        ],
        tutor:
          "Have the student write the negation of a two-quantifier statement, then ask what swapping their order changes.",
        contexts: [
          "“every student has a tutor” versus “one tutor for all”",
          "a service guarantee phrased with “for all”",
          "the negation of a commercial promise"
        ]
      }
    },
    {
      key: "modular_arithmetic",
      objectives: ["math_foundations"],
      stage: 5,
      fr: {
        title: "L'arithmétique modulaire",
        summary: "Calculer avec des restes et utiliser la congruence pour raisonner sur des cycles.",
        goals: [
          "Calculer un reste sans effectuer la division complète.",
          "Résoudre un problème de cycle par congruence."
        ],
        tutor:
          "Fais calculer le jour de la semaine dans mille jours, puis demande quelle opération modulaire a été utilisée.",
        contexts: [
          "le jour de la semaine dans mille jours",
          "une clé de contrôle sur un numéro de compte",
          "une aiguille d'horloge après cent heures"
        ]
      },
      en: {
        title: "Modular arithmetic",
        summary: "Compute with remainders and use congruence to reason about cycles.",
        goals: [
          "Compute a remainder without performing the full division.",
          "Solve a cycle problem using congruence."
        ],
        tutor:
          "Have the student compute the weekday in a thousand days, then ask which modular operation was used.",
        contexts: [
          "the weekday in a thousand days",
          "a check digit on an account number",
          "a clock hand after a hundred hours"
        ]
      }
    },
    {
      key: "group_structure",
      objectives: ["math_foundations"],
      stage: 5,
      fr: {
        title: "La notion de groupe",
        summary: "Reconnaître une structure algébrique commune derrière des objets très différents.",
        goals: [
          "Vérifier les axiomes d'un groupe sur un exemple fini.",
          "Citer deux exemples de groupes issus de contextes différents."
        ],
        tutor:
          "Fais vérifier les axiomes sur les rotations d'un carré, puis demande quel autre exemple partage exactement la même structure.",
        contexts: [
          "les rotations qui laissent un carré inchangé",
          "les entiers munis de l'addition",
          "les permutations d'un jeu de trois cartes"
        ]
      },
      en: {
        title: "The idea of a group",
        summary: "Recognise one algebraic structure shared by very different objects.",
        goals: [
          "Check the group axioms on a finite example.",
          "Give two group examples from different contexts."
        ],
        tutor:
          "Have the student check the axioms on the rotations of a square, then ask which other example shares exactly that structure.",
        contexts: [
          "the rotations leaving a square unchanged",
          "the integers under addition",
          "the permutations of a three-card deck"
        ]
      }
    },
    {
      key: "comparing_infinities",
      objectives: ["math_foundations"],
      stage: 5,
      fr: {
        title: "Comparer deux infinis",
        summary: "Utiliser la mise en correspondance pour comparer des ensembles infinis sans les compter.",
        goals: [
          "Construire une bijection entre deux ensembles infinis.",
          "Expliquer pourquoi les réels ne se mettent pas en liste."
        ],
        tutor:
          "Fais construire une correspondance entre entiers et entiers pairs, puis demande pourquoi la même méthode échoue pour les réels.",
        contexts: [
          "les entiers pairs mis en face des entiers",
          "un hôtel infini qui accueille un client de plus",
          "une liste censée contenir tous les nombres réels"
        ]
      },
      en: {
        title: "Comparing two infinities",
        summary: "Use pairing to compare infinite sets without counting them.",
        goals: [
          "Build a bijection between two infinite sets.",
          "Explain why the reals cannot be put in a list."
        ],
        tutor:
          "Have the student build a pairing between integers and even integers, then ask why the same method fails for the reals.",
        contexts: [
          "even integers paired with all integers",
          "an infinite hotel welcoming one more guest",
          "a list claiming to hold every real number"
        ]
      }
    },

    {
      key: "random_experiment",
      objectives: ["math_probability"],
      stage: 1,
      fr: {
        title: "Expérience aléatoire, issues et événements",
        summary: "Décrire précisément l'univers des issues avant tout calcul de probabilité.",
        goals: [
          "Lister l'univers des issues d'une expérience simple.",
          "Calculer une probabilité en situation d'équiprobabilité."
        ],
        tutor:
          "Fais lister les issues du lancer de deux dés, puis demande pourquoi la somme 7 est plus probable que la somme 2.",
        contexts: [
          "le lancer de deux dés et la somme obtenue",
          "un tirage au sort parmi trente élèves",
          "une carte tirée dans un jeu de 52"
        ]
      },
      en: {
        title: "Random experiment, outcomes and events",
        summary: "Describe the outcome space precisely before computing any probability.",
        goals: [
          "List the outcome space of a simple experiment.",
          "Compute a probability under equal likelihood."
        ],
        tutor:
          "Have the student list the outcomes of rolling two dice, then ask why a sum of 7 is more likely than a sum of 2.",
        contexts: [
          "rolling two dice and reading the sum",
          "a draw among thirty students",
          "a card drawn from a 52-card deck"
        ]
      }
    },
    {
      key: "counting_combinations",
      objectives: ["math_probability"],
      stage: 2,
      fr: {
        title: "Dénombrer : arrangements et combinaisons",
        summary: "Choisir la bonne formule de comptage selon que l'ordre compte ou non.",
        goals: [
          "Décider si l'ordre intervient dans un problème donné.",
          "Calculer un nombre de combinaisons sans énumérer."
        ],
        tutor:
          "Fais comparer le nombre de podiums possibles et le nombre d'équipes de trois, puis demande d'où vient la division.",
        contexts: [
          "un podium à trois places parmi dix concurrents",
          "une équipe de trois personnes choisie parmi dix",
          "un code à quatre chiffres avec répétition autorisée"
        ]
      },
      en: {
        title: "Counting: arrangements and combinations",
        summary: "Pick the right counting formula depending on whether order matters.",
        goals: [
          "Decide whether order matters in a given problem.",
          "Compute a number of combinations without enumerating."
        ],
        tutor:
          "Have the student compare the number of podiums and the number of three-person teams, then ask where the division comes from.",
        contexts: [
          "a three-place podium among ten competitors",
          "a three-person team chosen among ten",
          "a four-digit code with repetition allowed"
        ]
      }
    },
    {
      key: "independence",
      objectives: ["math_probability"],
      stage: 2,
      fr: {
        title: "Événements indépendants",
        summary: "Tester l'indépendance de deux événements plutôt que la supposer par intuition.",
        goals: [
          "Vérifier l'indépendance par le produit des probabilités.",
          "Citer un cas d'indépendance supposée à tort."
        ],
        tutor:
          "Fais vérifier l'indépendance de deux événements par le calcul, puis demande pourquoi une intuition de série est trompeuse.",
        contexts: [
          "une pièce lancée dix fois de suite",
          "deux pannes de serveurs alimentés par la même source",
          "un joueur convaincu qu'une couleur est « due »"
        ]
      },
      en: {
        title: "Independent events",
        summary: "Test the independence of two events rather than assume it by intuition.",
        goals: [
          "Check independence through the product of probabilities.",
          "Give a case where independence is wrongly assumed."
        ],
        tutor:
          "Have the student check independence by computation, then ask why a streak intuition misleads.",
        contexts: [
          "a coin tossed ten times in a row",
          "two server failures sharing one power supply",
          "a gambler convinced a colour is “due”"
        ]
      }
    },
    {
      key: "conditional_probability",
      objectives: ["math_probability"],
      stage: 3,
      fr: {
        title: "Probabilité conditionnelle",
        summary: "Recalculer une probabilité en restreignant l'univers à l'information effectivement connue.",
        goals: [
          "Calculer une probabilité conditionnelle sur un tableau croisé.",
          "Expliquer pourquoi l'information disponible change le résultat."
        ],
        tutor:
          "Fais calculer une probabilité avant puis après une information supplémentaire, et demande d'expliquer l'écart.",
        contexts: [
          "un tableau croisant sexe et pratique sportive",
          "un test positif chez une personne à faible risque",
          "un client déjà connu comme mauvais payeur"
        ]
      },
      en: {
        title: "Conditional probability",
        summary: "Recompute a probability by restricting the universe to the information actually known.",
        goals: [
          "Compute a conditional probability from a cross table.",
          "Explain why available information changes the result."
        ],
        tutor:
          "Have the student compute a probability before and after extra information, and explain the gap.",
        contexts: [
          "a table crossing gender and sport practice",
          "a positive test in a low-risk person",
          "a customer already known as a late payer"
        ]
      }
    },
    {
      key: "bayes_theorem",
      objectives: ["math_probability"],
      stage: 3,
      fr: {
        title: "Le théorème de Bayes",
        summary: "Renverser une probabilité conditionnelle en tenant compte de la fréquence de base.",
        goals: [
          "Calculer une probabilité a posteriori sur un cas de dépistage.",
          "Expliquer l'effet d'une maladie rare sur le résultat."
        ],
        tutor:
          "Fais calculer la probabilité d'être malade après un test positif pour une maladie rare, puis demande pourquoi le résultat surprend.",
        contexts: [
          "un dépistage d'une maladie touchant une personne sur mille",
          "une alarme de sécurité qui se déclenche souvent à tort",
          "un filtre anti-spam appliqué à un message rare"
        ]
      },
      en: {
        title: "Bayes' theorem",
        summary: "Reverse a conditional probability while accounting for the base rate.",
        goals: [
          "Compute a posterior probability on a screening case.",
          "Explain the effect of a rare disease on the result."
        ],
        tutor:
          "Have the student compute the probability of being ill after a positive test for a rare disease, then ask why the result surprises.",
        contexts: [
          "screening for a disease affecting one person in a thousand",
          "a security alarm often triggering wrongly",
          "a spam filter applied to a rare message"
        ]
      }
    },
    {
      key: "expected_value",
      objectives: ["math_probability"],
      stage: 3,
      fr: {
        title: "L'espérance d'un gain aléatoire",
        summary: "Calculer la valeur moyenne d'un gain aléatoire et l'utiliser pour comparer deux décisions.",
        goals: [
          "Calculer l'espérance d'un jeu à trois issues.",
          "Dire pourquoi une espérance positive ne garantit rien à court terme."
        ],
        tutor:
          "Fais calculer l'espérance de deux offres concurrentes, puis demande pourquoi la meilleure espérance peut décevoir sur dix essais.",
        contexts: [
          "une extension de garantie proposée à l'achat",
          "un jeu de loterie à trois lots",
          "un investissement à trois scénarios chiffrés"
        ]
      },
      en: {
        title: "Expected value of a random gain",
        summary: "Compute the average value of a random gain and use it to compare two decisions.",
        goals: [
          "Compute the expected value of a three-outcome game.",
          "Say why a positive expectation guarantees nothing short term."
        ],
        tutor:
          "Have the student compute the expectation of two competing offers, then ask why the better one can disappoint over ten trials.",
        contexts: [
          "an extended warranty offered at purchase",
          "a lottery with three prizes",
          "an investment with three quantified scenarios"
        ]
      }
    },
    {
      key: "variance_spread",
      objectives: ["math_probability"],
      stage: 3,
      fr: {
        title: "Variance et écart-type",
        summary: "Mesurer la dispersion et comprendre pourquoi deux séries de même moyenne ne se valent pas.",
        goals: [
          "Comparer deux séries de même moyenne par leur dispersion.",
          "Interpréter un écart-type dans l'unité des données."
        ],
        tutor:
          "Fais comparer deux séries de même moyenne mais de dispersions différentes, puis demande laquelle est préférable et pourquoi.",
        contexts: [
          "deux fournisseurs au même délai moyen de livraison",
          "deux classes à la même moyenne générale",
          "un temps de réponse serveur très irrégulier"
        ]
      },
      en: {
        title: "Variance and standard deviation",
        summary: "Measure spread and see why two series with the same mean are not equivalent.",
        goals: [
          "Compare two series with the same mean by their spread.",
          "Interpret a standard deviation in the unit of the data."
        ],
        tutor:
          "Have the student compare two series with equal means but different spread, then ask which is preferable and why.",
        contexts: [
          "two suppliers with the same average delivery time",
          "two classes with the same overall average",
          "a very irregular server response time"
        ]
      }
    },
    {
      key: "normal_distribution",
      objectives: ["math_probability"],
      stage: 4,
      fr: {
        title: "La loi normale",
        summary: "Reconnaître les situations où la courbe en cloche s'applique et celles où elle induit en erreur.",
        goals: [
          "Utiliser les repères à un et deux écarts-types.",
          "Citer une grandeur qui ne suit pas une loi normale."
        ],
        tutor:
          "Fais estimer la proportion à moins de deux écarts-types de la moyenne, puis demande une grandeur pour laquelle ce modèle échoue.",
        contexts: [
          "les tailles adultes dans une population",
          "les revenus dans un pays",
          "une note d'examen centrée sur la moyenne"
        ]
      },
      en: {
        title: "The normal distribution",
        summary: "Recognise where the bell curve applies and where it misleads.",
        goals: [
          "Use the one and two standard deviation landmarks.",
          "Name a quantity that does not follow a normal law."
        ],
        tutor:
          "Have the student estimate the share within two standard deviations of the mean, then name a quantity where the model fails.",
        contexts: [
          "adult heights in a population",
          "incomes in a country",
          "an exam grade centred on the average"
        ]
      }
    },
    {
      key: "law_of_large_numbers",
      objectives: ["math_probability"],
      stage: 4,
      fr: {
        title: "La loi des grands nombres",
        summary: "Comprendre pourquoi une fréquence observée se rapproche d'une probabilité sans jamais « rattraper » le passé.",
        goals: [
          "Expliquer ce que la loi garantit et sur quelle échelle.",
          "Réfuter l'idée qu'un écart passé doit être compensé."
        ],
        tutor:
          "Fais expliquer ce qui se passe après une série de sept faces, puis demande ce que la loi garantit vraiment sur dix mille lancers.",
        contexts: [
          "sept faces consécutives au jeu de pile ou face",
          "un taux de conversion mesuré sur cent visiteurs",
          "un sondage réalisé sur mille personnes"
        ]
      },
      en: {
        title: "The law of large numbers",
        summary: "Understand why an observed frequency approaches a probability without ever “making up” for the past.",
        goals: [
          "Explain what the law guarantees and at which scale.",
          "Refute the idea that a past deviation must be compensated."
        ],
        tutor:
          "Have the student explain what happens after seven heads in a row, then ask what the law really guarantees over ten thousand tosses.",
        contexts: [
          "seven consecutive heads in a coin game",
          "a conversion rate measured on a hundred visitors",
          "a survey run on a thousand people"
        ]
      }
    },
    {
      key: "sampling_bias",
      objectives: ["math_probability"],
      stage: 4,
      fr: {
        title: "Échantillonnage et biais de sélection",
        summary: "Repérer comment le mode de recueil détermine la population réellement décrite.",
        goals: [
          "Identifier la population effectivement représentée par un échantillon.",
          "Expliquer pourquoi augmenter la taille ne corrige pas un biais."
        ],
        tutor:
          "Fais identifier qui est réellement représenté par un sondage en ligne, puis demande si dix fois plus de réponses corrigeraient le problème.",
        contexts: [
          "un sondage diffusé sur un réseau social",
          "des avis clients laissés spontanément",
          "une étude menée uniquement en semaine"
        ]
      },
      en: {
        title: "Sampling and selection bias",
        summary: "Spot how the collection method decides which population is actually described.",
        goals: [
          "Identify the population a sample really represents.",
          "Explain why increasing the size does not fix a bias."
        ],
        tutor:
          "Have the student identify who an online poll really represents, then ask whether ten times more answers would fix it.",
        contexts: [
          "a poll shared on a social network",
          "customer reviews left spontaneously",
          "a study run only on weekdays"
        ]
      }
    },
    {
      key: "confidence_interval",
      objectives: ["math_probability"],
      stage: 4,
      fr: {
        title: "L'intervalle de confiance",
        summary: "Interpréter correctement une marge d'erreur et ce qu'elle dit d'une estimation.",
        goals: [
          "Lire une marge d'erreur et en déduire une fourchette.",
          "Réfuter une interprétation fausse d'un intervalle."
        ],
        tutor:
          "Fais interpréter un sondage à 52 % avec trois points de marge, puis demande si l'écart entre deux candidats est significatif.",
        contexts: [
          "un sondage à 52 % avec trois points de marge",
          "deux candidats séparés par un point",
          "un taux de panne estimé sur cinquante machines"
        ]
      },
      en: {
        title: "The confidence interval",
        summary: "Correctly interpret a margin of error and what it says about an estimate.",
        goals: [
          "Read a margin of error and derive a range.",
          "Refute a wrong interpretation of an interval."
        ],
        tutor:
          "Have the student interpret a poll at 52% with three points of margin, then ask whether a gap between two candidates is meaningful.",
        contexts: [
          "a poll at 52% with three points of margin",
          "two candidates one point apart",
          "a failure rate estimated on fifty machines"
        ]
      }
    },
    {
      key: "hypothesis_testing",
      objectives: ["math_probability"],
      stage: 5,
      fr: {
        title: "Le test d'hypothèse et la p-valeur",
        summary: "Comprendre ce qu'une p-valeur mesure et ce qu'elle ne dit pas de l'hypothèse testée.",
        goals: [
          "Énoncer correctement ce que mesure une p-valeur.",
          "Expliquer pourquoi multiplier les tests fabrique des découvertes."
        ],
        tutor:
          "Fais reformuler ce que signifie une p-valeur de 0,03, puis demande ce qui arrive après vingt tests sur les mêmes données.",
        contexts: [
          "un test A/B déclaré gagnant à 0,03",
          "vingt hypothèses testées sur le même jeu de données",
          "un résultat non reproduit par une seconde étude"
        ]
      },
      en: {
        title: "Hypothesis testing and the p-value",
        summary: "Understand what a p-value measures and what it does not say about the tested hypothesis.",
        goals: [
          "State correctly what a p-value measures.",
          "Explain why running many tests manufactures discoveries."
        ],
        tutor:
          "Have the student restate what a p-value of 0.03 means, then ask what happens after twenty tests on the same data.",
        contexts: [
          "an A/B test declared a winner at 0.03",
          "twenty hypotheses tested on the same dataset",
          "a result not reproduced by a second study"
        ]
      }
    },
    {
      key: "correlation_causation",
      objectives: ["math_probability"],
      stage: 5,
      fr: {
        title: "Corrélation et causalité",
        summary: "Distinguer une association statistique d'un lien de cause à effet et repérer une variable cachée.",
        goals: [
          "Proposer une variable de confusion pour une corrélation donnée.",
          "Dire ce qu'une expérience randomisée apporte de plus."
        ],
        tutor:
          "Fais proposer une variable cachée expliquant une corrélation surprenante, puis demande quelle expérience trancherait.",
        contexts: [
          "ventes de glaces et noyades corrélées en été",
          "des utilisateurs d'une fonctionnalité plus fidèles que les autres",
          "un médicament testé sans groupe témoin"
        ]
      },
      en: {
        title: "Correlation and causation",
        summary: "Tell a statistical association apart from a causal link and spot a hidden variable.",
        goals: [
          "Propose a confounding variable for a given correlation.",
          "Say what a randomised experiment adds."
        ],
        tutor:
          "Have the student propose a hidden variable explaining a surprising correlation, then ask which experiment would settle it.",
        contexts: [
          "ice cream sales and drownings correlated in summer",
          "users of a feature more loyal than others",
          "a drug tested without a control group"
        ]
      }
    },
    {
      key: "regression_to_the_mean",
      objectives: ["math_probability"],
      stage: 5,
      fr: {
        title: "La régression vers la moyenne",
        summary: "Expliquer pourquoi une performance extrême est naturellement suivie d'une performance plus ordinaire.",
        goals: [
          "Reconnaître une régression vers la moyenne dans une évaluation.",
          "Expliquer pourquoi elle fait surestimer l'effet d'une intervention."
        ],
        tutor:
          "Fais analyser une formation suivie par les moins performants, puis demande quelle part du progrès aurait eu lieu sans elle.",
        contexts: [
          "une formation réservée aux plus faibles d'une promotion",
          "un traitement commencé au pire moment d'une douleur",
          "une équipe brillante une saison puis moyenne la suivante"
        ]
      },
      en: {
        title: "Regression to the mean",
        summary: "Explain why an extreme performance is naturally followed by a more ordinary one.",
        goals: [
          "Recognise regression to the mean in an evaluation.",
          "Explain why it inflates the apparent effect of an intervention."
        ],
        tutor:
          "Have the student analyse a training given to the weakest performers, then ask how much progress would have happened anyway.",
        contexts: [
          "a training reserved for the weakest of a cohort",
          "a treatment started at the worst moment of a pain",
          "a team brilliant one season and average the next"
        ]
      }
    },
    {
      key: "markov_chains",
      objectives: ["math_probability"],
      stage: 5,
      fr: {
        title: "Les chaînes de Markov",
        summary: "Modéliser un système par des états et des probabilités de transition sans mémoire du passé.",
        goals: [
          "Écrire une matrice de transition à trois états.",
          "Expliquer ce que l'absence de mémoire simplifie et ce qu'elle perd."
        ],
        tutor:
          "Fais écrire une matrice de transition à trois états, puis demande ce que le modèle ignore volontairement du passé.",
        contexts: [
          "un client qui passe d'actif à inactif puis revient",
          "la météo modélisée par trois états quotidiens",
          "un utilisateur naviguant entre trois pages d'un site"
        ]
      },
      en: {
        title: "Markov chains",
        summary: "Model a system with states and transition probabilities that ignore the past.",
        goals: [
          "Write a three-state transition matrix.",
          "Explain what memorylessness simplifies and what it loses."
        ],
        tutor:
          "Have the student write a three-state transition matrix, then ask what the model deliberately ignores about the past.",
        contexts: [
          "a customer moving from active to inactive and back",
          "weather modelled by three daily states",
          "a user navigating between three pages of a site"
        ]
      }
    },

    {
      key: "coordinates_and_vectors",
      objectives: ["math_technology"],
      stage: 1,
      fr: {
        title: "Coordonnées et vecteurs",
        summary: "Représenter un déplacement par un couple de nombres et additionner deux déplacements.",
        goals: [
          "Additionner deux vecteurs et interpréter le résultat.",
          "Distinguer un point d'un vecteur."
        ],
        tutor:
          "Fais additionner deux déplacements successifs, puis demande pourquoi l'ordre de l'addition ne change pas l'arrivée.",
        contexts: [
          "deux déplacements successifs sur une carte",
          "une position d'objet dans une image en pixels",
          "une force appliquée dans deux directions"
        ]
      },
      en: {
        title: "Coordinates and vectors",
        summary: "Represent a displacement by a pair of numbers and add two displacements.",
        goals: [
          "Add two vectors and interpret the result.",
          "Tell a point apart from a vector."
        ],
        tutor:
          "Have the student add two successive displacements, then ask why the order of addition does not change the arrival.",
        contexts: [
          "two successive moves on a map",
          "an object position in an image in pixels",
          "a force applied in two directions"
        ]
      }
    },
    {
      key: "matrix_as_transformation",
      objectives: ["math_technology"],
      stage: 2,
      fr: {
        title: "Une matrice comme transformation",
        summary: "Lire une matrice comme une opération géométrique appliquée à tout l'espace.",
        goals: [
          "Décrire l'effet géométrique d'une matrice simple.",
          "Identifier une matrice qui ne change rien."
        ],
        tutor:
          "Fais appliquer une matrice à trois points d'un carré, puis demande de nommer la transformation obtenue.",
        contexts: [
          "une image redimensionnée dans un éditeur",
          "une rotation appliquée à un objet à l'écran",
          "un aplatissement qui écrase une figure sur une droite"
        ]
      },
      en: {
        title: "A matrix as a transformation",
        summary: "Read a matrix as a geometric operation applied to the whole space.",
        goals: [
          "Describe the geometric effect of a simple matrix.",
          "Identify a matrix that changes nothing."
        ],
        tutor:
          "Have the student apply a matrix to three corners of a square, then name the resulting transformation.",
        contexts: [
          "an image resized in an editor",
          "a rotation applied to an on-screen object",
          "a flattening that collapses a figure onto a line"
        ]
      }
    },
    {
      key: "slope_rate_of_change",
      objectives: ["math_technology"],
      stage: 2,
      fr: {
        title: "La pente comme taux de variation",
        summary: "Interpréter une pente dans les unités du problème plutôt que comme un nombre abstrait.",
        goals: [
          "Calculer une pente entre deux points et l'exprimer en unités métier.",
          "Distinguer une pente moyenne d'une pente instantanée."
        ],
        tutor:
          "Fais calculer une pente entre deux relevés et l'exprimer en euros par unité, puis demande ce qu'elle cache entre les deux points.",
        contexts: [
          "un coût qui augmente avec la quantité produite",
          "une distance parcourue relevée toutes les heures",
          "une consommation mesurée en début et fin de mois"
        ]
      },
      en: {
        title: "Slope as a rate of change",
        summary: "Interpret a slope in the units of the problem rather than as an abstract number.",
        goals: [
          "Compute a slope between two points and express it in business units.",
          "Tell an average slope apart from an instantaneous one."
        ],
        tutor:
          "Have the student compute a slope between two readings and express it in euros per unit, then ask what it hides in between.",
        contexts: [
          "a cost rising with produced quantity",
          "a distance recorded every hour",
          "a consumption measured at the start and end of a month"
        ]
      }
    },
    {
      key: "dot_product",
      objectives: ["math_technology"],
      stage: 3,
      fr: {
        title: "Le produit scalaire et l'angle",
        summary: "Utiliser le produit scalaire pour mesurer l'alignement de deux vecteurs.",
        goals: [
          "Calculer un produit scalaire et en déduire une orientation relative.",
          "Reconnaître deux vecteurs orthogonaux."
        ],
        tutor:
          "Fais calculer le produit scalaire de deux vecteurs, puis demande ce que signale un résultat nul puis un résultat négatif.",
        contexts: [
          "deux textes comparés par leurs vecteurs de mots",
          "un éclairage dont l'intensité dépend de l'angle",
          "deux directions perpendiculaires dans un plan"
        ]
      },
      en: {
        title: "The dot product and angle",
        summary: "Use the dot product to measure how aligned two vectors are.",
        goals: [
          "Compute a dot product and deduce a relative orientation.",
          "Recognise two orthogonal vectors."
        ],
        tutor:
          "Have the student compute the dot product of two vectors, then ask what a zero and then a negative result signals.",
        contexts: [
          "two texts compared through their word vectors",
          "lighting whose intensity depends on the angle",
          "two perpendicular directions in a plane"
        ]
      }
    },
    {
      key: "matrix_multiplication",
      objectives: ["math_technology"],
      stage: 3,
      fr: {
        title: "Le produit matriciel",
        summary: "Comprendre la composition de deux transformations et pourquoi l'ordre compte.",
        goals: [
          "Effectuer un produit de deux matrices deux par deux.",
          "Montrer sur un exemple que le produit n'est pas commutatif."
        ],
        tutor:
          "Fais composer une rotation et une mise à l'échelle dans les deux ordres, puis demande de comparer les résultats.",
        contexts: [
          "une rotation suivie d'un agrandissement",
          "deux transformations enchaînées sur une image",
          "une couche de réseau de neurones appliquée à un lot"
        ]
      },
      en: {
        title: "Matrix multiplication",
        summary: "Understand the composition of two transformations and why order matters.",
        goals: [
          "Multiply two two-by-two matrices.",
          "Show on an example that the product is not commutative."
        ],
        tutor:
          "Have the student compose a rotation and a scaling in both orders, then compare the results.",
        contexts: [
          "a rotation followed by an enlargement",
          "two transformations chained on an image",
          "a neural network layer applied to a batch"
        ]
      }
    },
    {
      key: "derivative_meaning",
      objectives: ["math_technology"],
      stage: 3,
      fr: {
        title: "La dérivée et la variation instantanée",
        summary: "Interpréter la dérivée comme vitesse instantanée et comme outil de recherche d'extremum.",
        goals: [
          "Interpréter le signe de la dérivée sur un intervalle.",
          "Localiser un maximum à partir de la dérivée."
        ],
        tutor:
          "Fais localiser le maximum d'une fonction de profit par sa dérivée, puis demande ce que signale une dérivée négative ensuite.",
        contexts: [
          "un profit maximal pour une quantité produite",
          "une vitesse lue sur un compteur à un instant précis",
          "une courbe de température qui atteint son sommet"
        ]
      },
      en: {
        title: "The derivative and instantaneous change",
        summary: "Read the derivative as an instantaneous rate and as a tool for finding extrema.",
        goals: [
          "Interpret the sign of the derivative on an interval.",
          "Locate a maximum from the derivative."
        ],
        tutor:
          "Have the student locate the maximum of a profit function through its derivative, then ask what a negative derivative signals after it.",
        contexts: [
          "a maximum profit for a produced quantity",
          "a speed read on a dial at a precise instant",
          "a temperature curve reaching its peak"
        ]
      }
    },
    {
      key: "integral_meaning",
      objectives: ["math_technology"],
      stage: 3,
      fr: {
        title: "L'intégrale comme accumulation",
        summary: "Lire une intégrale comme la somme d'un débit sur une durée, avec ses unités.",
        goals: [
          "Interpréter l'aire sous une courbe dans les unités du problème.",
          "Relier une intégrale à la dérivée correspondante."
        ],
        tutor:
          "Fais interpréter l'aire sous une courbe de puissance en fonction du temps, puis demande l'unité du résultat.",
        contexts: [
          "une consommation électrique cumulée sur une journée",
          "une distance obtenue à partir d'une courbe de vitesse",
          "un volume d'eau accumulé dans un réservoir"
        ]
      },
      en: {
        title: "The integral as accumulation",
        summary: "Read an integral as the sum of a rate over a duration, units included.",
        goals: [
          "Interpret the area under a curve in the problem's units.",
          "Relate an integral to the matching derivative."
        ],
        tutor:
          "Have the student interpret the area under a power-versus-time curve, then ask the unit of the result.",
        contexts: [
          "electricity consumption accumulated over a day",
          "a distance obtained from a speed curve",
          "a water volume accumulated in a tank"
        ]
      }
    },
    {
      key: "eigenvectors",
      objectives: ["math_technology"],
      stage: 4,
      fr: {
        title: "Vecteurs propres et directions stables",
        summary: "Identifier les directions qu'une transformation conserve et ce qu'elles révèlent du système.",
        goals: [
          "Vérifier qu'un vecteur donné est vecteur propre d'une matrice.",
          "Interpréter une valeur propre supérieure ou inférieure à un."
        ],
        tutor:
          "Fais vérifier qu'un vecteur est propre pour une matrice donnée, puis demande ce qu'implique une valeur propre supérieure à un après vingt itérations.",
        contexts: [
          "une population répartie entre deux villes après plusieurs années",
          "un axe principal dans un nuage de points",
          "une direction inchangée par une rotation d'axe"
        ]
      },
      en: {
        title: "Eigenvectors and stable directions",
        summary: "Identify the directions a transformation preserves and what they reveal about the system.",
        goals: [
          "Check that a given vector is an eigenvector of a matrix.",
          "Interpret an eigenvalue above or below one."
        ],
        tutor:
          "Have the student check a vector is an eigenvector, then ask what an eigenvalue above one implies after twenty iterations.",
        contexts: [
          "a population split between two cities after several years",
          "a principal axis in a point cloud",
          "a direction left unchanged by an axial rotation"
        ]
      }
    },
    {
      key: "gradient_multivariable",
      objectives: ["math_technology"],
      stage: 4,
      fr: {
        title: "Le gradient d'une fonction à plusieurs variables",
        summary: "Utiliser le gradient comme direction de plus forte pente pour se déplacer dans un paysage.",
        goals: [
          "Interpréter le gradient comme direction de montée la plus rapide.",
          "Dire ce qu'un gradient nul signale."
        ],
        tutor:
          "Fais interpréter le gradient sur une carte de relief, puis demande ce que signale un gradient nul en un point.",
        contexts: [
          "une carte de relief parcourue dans le brouillard",
          "un coût dépendant de deux réglages",
          "un point où la pente s'annule dans toutes les directions"
        ]
      },
      en: {
        title: "The gradient of a multivariable function",
        summary: "Use the gradient as the steepest ascent direction to move through a landscape.",
        goals: [
          "Interpret the gradient as the direction of fastest increase.",
          "Say what a zero gradient signals."
        ],
        tutor:
          "Have the student interpret the gradient on a relief map, then ask what a zero gradient at a point signals.",
        contexts: [
          "a relief map walked in fog",
          "a cost depending on two settings",
          "a point where the slope vanishes in every direction"
        ]
      }
    },
    {
      key: "convexity_optimization",
      objectives: ["math_technology"],
      stage: 4,
      fr: {
        title: "Convexité et minimum global",
        summary: "Comprendre pourquoi la convexité garantit qu'un minimum local est le minimum global.",
        goals: [
          "Reconnaître une fonction convexe sur un graphique.",
          "Expliquer le risque d'un minimum local dans un cas non convexe."
        ],
        tutor:
          "Fais comparer deux paysages d'optimisation, puis demande dans lequel un algorithme de descente peut rester coincé.",
        contexts: [
          "un paysage à une seule cuvette",
          "un paysage à plusieurs creux de profondeurs inégales",
          "un algorithme relancé depuis plusieurs points de départ"
        ]
      },
      en: {
        title: "Convexity and the global minimum",
        summary: "Understand why convexity guarantees that a local minimum is the global one.",
        goals: [
          "Recognise a convex function on a chart.",
          "Explain the risk of a local minimum in a non-convex case."
        ],
        tutor:
          "Have the student compare two optimisation landscapes, then ask in which a descent algorithm can get stuck.",
        contexts: [
          "a landscape with a single basin",
          "a landscape with several dips of unequal depth",
          "an algorithm restarted from several starting points"
        ]
      }
    },
    {
      key: "graph_theory_basics",
      objectives: ["math_technology"],
      stage: 4,
      fr: {
        title: "Graphes : sommets, arêtes et degrés",
        summary: "Modéliser un réseau par un graphe et lire ses propriétés élémentaires.",
        goals: [
          "Modéliser une situation concrète par un graphe.",
          "Relier la somme des degrés au nombre d'arêtes."
        ],
        tutor:
          "Fais modéliser un réseau de correspondances par un graphe, puis demande de vérifier la relation entre degrés et arêtes.",
        contexts: [
          "un réseau de lignes de bus avec correspondances",
          "des relations d'amitié dans un groupe de dix personnes",
          "des dépendances entre tâches d'un projet"
        ]
      },
      en: {
        title: "Graphs: vertices, edges and degrees",
        summary: "Model a network as a graph and read its elementary properties.",
        goals: [
          "Model a concrete situation as a graph.",
          "Relate the sum of degrees to the number of edges."
        ],
        tutor:
          "Have the student model a connection network as a graph, then check the relation between degrees and edges.",
        contexts: [
          "a bus line network with interchanges",
          "friendship links in a group of ten people",
          "dependencies between the tasks of a project"
        ]
      }
    },
    {
      key: "linear_independence_rank",
      objectives: ["math_technology"],
      stage: 5,
      fr: {
        title: "Indépendance linéaire et rang",
        summary: "Détecter l'information redondante dans un ensemble de vecteurs ou de colonnes de données.",
        goals: [
          "Décider si trois vecteurs sont linéairement indépendants.",
          "Relier un rang déficient à une colonne redondante."
        ],
        tutor:
          "Fais repérer la colonne redondante d'un petit tableau de données, puis demande ce que cela implique pour un modèle linéaire.",
        contexts: [
          "un tableau contenant à la fois un prix hors taxe et un prix TTC",
          "trois capteurs dont l'un mesure la somme des deux autres",
          "un système d'équations sans solution unique"
        ]
      },
      en: {
        title: "Linear independence and rank",
        summary: "Detect redundant information in a set of vectors or data columns.",
        goals: [
          "Decide whether three vectors are linearly independent.",
          "Link a deficient rank to a redundant column."
        ],
        tutor:
          "Have the student spot the redundant column of a small data table, then ask what it implies for a linear model.",
        contexts: [
          "a table holding both a pre-tax and an all-tax price",
          "three sensors where one measures the sum of the other two",
          "a system of equations without a unique solution"
        ]
      }
    },
    {
      key: "combinatorial_explosion",
      objectives: ["math_technology"],
      stage: 5,
      fr: {
        title: "L'explosion combinatoire",
        summary: "Estimer le nombre de possibilités d'un problème pour savoir si l'énumération est envisageable.",
        goals: [
          "Estimer le nombre de configurations d'un problème donné.",
          "Décider si une recherche exhaustive est réaliste."
        ],
        tutor:
          "Fais estimer le nombre de tournées possibles pour quinze villes, puis demande si une machine rapide y changerait quelque chose.",
        contexts: [
          "une tournée de livraison passant par quinze villes",
          "un emploi du temps à contraintes multiples",
          "un mot de passe testé par force brute"
        ]
      },
      en: {
        title: "Combinatorial explosion",
        summary: "Estimate the number of possibilities of a problem to know whether enumeration is feasible.",
        goals: [
          "Estimate the number of configurations of a given problem.",
          "Decide whether exhaustive search is realistic."
        ],
        tutor:
          "Have the student estimate the number of routes for fifteen cities, then ask whether a faster machine would change anything.",
        contexts: [
          "a delivery route through fifteen cities",
          "a timetable with multiple constraints",
          "a password tested by brute force"
        ]
      }
    },
    {
      key: "frequency_decomposition",
      objectives: ["math_technology"],
      stage: 5,
      fr: {
        title: "La décomposition en fréquences",
        summary: "Comprendre qu'un signal se décompose en composantes simples et ce que cela permet de faire.",
        goals: [
          "Expliquer ce qu'une décomposition en fréquences révèle d'un signal.",
          "Citer un traitement rendu possible par ce changement de point de vue."
        ],
        tutor:
          "Fais expliquer comment isoler un bourdonnement dans un enregistrement, puis demande ce que la décomposition permet ensuite.",
        contexts: [
          "un bourdonnement de 50 hertz dans un enregistrement",
          "une image compressée en supprimant des détails fins",
          "un accord de musique décomposé en notes"
        ]
      },
      en: {
        title: "Frequency decomposition",
        summary: "Understand that a signal decomposes into simple components and what that enables.",
        goals: [
          "Explain what a frequency decomposition reveals about a signal.",
          "Name a processing step made possible by that change of viewpoint."
        ],
        tutor:
          "Have the student explain how to isolate a hum in a recording, then ask what the decomposition then allows.",
        contexts: [
          "a 50 hertz hum in a recording",
          "an image compressed by dropping fine detail",
          "a musical chord decomposed into notes"
        ]
      }
    },
    {
      key: "numerical_precision",
      objectives: ["math_technology"],
      stage: 5,
      fr: {
        title: "Erreurs d'arrondi en calcul numérique",
        summary: "Comprendre pourquoi un calcul mathématiquement correct peut donner un résultat faux sur machine.",
        goals: [
          "Expliquer pourquoi 0,1 additionné trois fois ne donne pas exactement 0,3.",
          "Citer une opération à éviter pour limiter la perte de précision."
        ],
        tutor:
          "Fais expliquer le résultat surprenant d'une somme de décimaux, puis demande quelle réécriture limiterait l'erreur.",
        contexts: [
          "un total de facture faux d'un centime",
          "une soustraction de deux nombres très proches",
          "une somme de millions de petites valeurs"
        ]
      },
      en: {
        title: "Rounding errors in numerical computation",
        summary: "Understand why a mathematically correct computation can give a wrong result on a machine.",
        goals: [
          "Explain why adding 0.1 three times does not give exactly 0.3.",
          "Name an operation to avoid in order to limit precision loss."
        ],
        tutor:
          "Have the student explain the surprising result of a decimal sum, then ask which rewriting would limit the error.",
        contexts: [
          "an invoice total wrong by one cent",
          "a subtraction of two very close numbers",
          "a sum of millions of small values"
        ]
      }
    }
  ]
};
