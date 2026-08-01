// Quantum physics concepts.
// Shared base: 9 steps eligible for the three orientations.
// quantum_intuition: the big ideas before advanced formalism.
// quantum_mathematics: states, probabilities, operators, measurement.
// quantum_computing: qubits, gates, algorithms, hardware limits.
export const domain = {
  id: "quantum_physics",
  objectives: ["quantum_intuition", "quantum_mathematics", "quantum_computing"],
  steps: [
    {
      key: "quantum_scale",
      objectives: "*",
      stage: 1,
      fr: {
        title: "À quelle échelle les effets quantiques apparaissent",
        summary: "Situer les tailles et les énergies où la description classique cesse de suffire.",
        goals: [
          "Comparer la taille d'un atome et celle d'un grain de poussière.",
          "Dire pourquoi un ballon ne montre pas d'effets quantiques."
        ],
        tutor:
          "Fais comparer trois échelles de taille, puis demande pourquoi une balle de tennis ne traverse jamais un mur alors qu'un électron peut le faire.",
        contexts: [
          "un électron dans un atome de silicium",
          "une balle de tennis lancée contre un mur",
          "une molécule d'eau dans un verre"
        ]
      },
      en: {
        title: "At which scale quantum effects appear",
        summary: "Place the sizes and energies where the classical description stops being enough.",
        goals: [
          "Compare the size of an atom with that of a dust grain.",
          "Say why a ball shows no quantum effects."
        ],
        tutor:
          "Have the student compare three size scales, then ask why a tennis ball never crosses a wall while an electron can.",
        contexts: [
          "an electron inside a silicon atom",
          "a tennis ball thrown at a wall",
          "a water molecule in a glass"
        ]
      }
    },
    {
      key: "wave_particle_duality",
      objectives: "*",
      stage: 1,
      fr: {
        title: "La dualité onde-corpuscule dans l'expérience des fentes",
        summary: "Comprendre pourquoi des particules envoyées une par une dessinent quand même des franges.",
        goals: [
          "Décrire la figure obtenue avec une fente puis avec deux fentes.",
          "Dire ce que devient la figure quand on détecte le passage."
        ],
        tutor:
          "Fais décrire la figure obtenue en envoyant les électrons un par un, puis demande ce qui change dès qu'un détecteur observe les fentes.",
        contexts: [
          "des électrons envoyés un par un vers deux fentes",
          "un faisceau lumineux traversant une fine ouverture",
          "un détecteur placé devant l'une des deux fentes"
        ]
      },
      en: {
        title: "Wave-particle duality in the double-slit experiment",
        summary: "Understand why particles sent one at a time still build an interference pattern.",
        goals: [
          "Describe the pattern obtained with one slit then with two.",
          "Say what the pattern becomes when the passage is detected."
        ],
        tutor:
          "Have the student describe the pattern built by electrons sent one by one, then ask what changes as soon as a detector watches the slits.",
        contexts: [
          "electrons sent one at a time toward two slits",
          "a light beam crossing a narrow opening",
          "a detector placed in front of one of the two slits"
        ]
      }
    },
    {
      key: "energy_quantization",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Pourquoi l'énergie vient par paquets",
        summary: "Comprendre que certains systèmes n'acceptent que des valeurs d'énergie discrètes.",
        goals: [
          "Citer un système dont les niveaux d'énergie sont discrets.",
          "Expliquer pourquoi une lampe à sodium émet une couleur précise."
        ],
        tutor:
          "Fais expliquer pourquoi un atome n'absorbe que certaines couleurs, puis demande ce que cela implique pour la lumière transmise.",
        contexts: [
          "la lumière orange d'un lampadaire au sodium",
          "un atome qui absorbe une couleur précise",
          "une corde de guitare et ses harmoniques"
        ]
      },
      en: {
        title: "Why energy comes in packets",
        summary: "Understand that some systems only accept discrete energy values.",
        goals: [
          "Name a system whose energy levels are discrete.",
          "Explain why a sodium lamp emits one precise colour."
        ],
        tutor:
          "Have the student explain why an atom only absorbs certain colours, then ask what that implies for the transmitted light.",
        contexts: [
          "the orange light of a sodium street lamp",
          "an atom absorbing one precise colour",
          "a guitar string and its harmonics"
        ]
      }
    },
    {
      key: "measurement_disturbance",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Pourquoi mesurer change le système",
        summary: "Distinguer la perturbation ordinaire d'une mesure du rôle particulier de la mesure quantique.",
        goals: [
          "Distinguer une mesure classique perturbante d'une mesure quantique.",
          "Dire ce qui reste vrai d'un système juste après sa mesure."
        ],
        tutor:
          "Fais comparer la mesure d'une pression de pneu et la mesure d'une polarisation de photon, puis demande ce qui diffère fondamentalement.",
        contexts: [
          "un manomètre qui laisse échapper un peu d'air",
          "un photon dont on mesure la polarisation",
          "deux mesures successives sur le même système"
        ]
      },
      en: {
        title: "Why measuring changes the system",
        summary: "Separate the ordinary disturbance of a measurement from the specific role of quantum measurement.",
        goals: [
          "Tell apart a disturbing classical measurement and a quantum one.",
          "Say what remains true of a system right after measurement."
        ],
        tutor:
          "Have the student compare measuring a tyre pressure and measuring a photon polarisation, then ask what differs fundamentally.",
        contexts: [
          "a pressure gauge letting a little air escape",
          "a photon whose polarisation is measured",
          "two successive measurements on the same system"
        ]
      }
    },
    {
      key: "quantum_probability",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Une probabilité qui n'est pas de l'ignorance",
        summary: "Comparer le hasard d'un dé caché et le hasard quantique qui ne cache aucune valeur préexistante.",
        goals: [
          "Distinguer une probabilité d'ignorance d'une probabilité fondamentale.",
          "Expliquer ce qu'une variable cachée devrait garantir."
        ],
        tutor:
          "Fais comparer un dé sous un gobelet et un photon avant mesure, puis demande ce qu'il faudrait pour que les deux situations soient identiques.",
        contexts: [
          "un dé lancé sous un gobelet",
          "un photon avant la mesure de sa polarisation",
          "une pièce en train de tourner sur une table"
        ]
      },
      en: {
        title: "A probability that is not ignorance",
        summary: "Compare the randomness of a hidden die with quantum randomness, which hides no pre-existing value.",
        goals: [
          "Tell apart a probability of ignorance and a fundamental probability.",
          "Explain what a hidden variable would have to guarantee."
        ],
        tutor:
          "Have the student compare a die under a cup and a photon before measurement, then ask what would make the two situations identical.",
        contexts: [
          "a die rolled under a cup",
          "a photon before its polarisation is measured",
          "a coin still spinning on a table"
        ]
      }
    },
    {
      key: "superposition_meaning",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ce que signifie une superposition",
        summary: "Comprendre qu'une superposition n'est pas une hésitation mais un état à part entière.",
        goals: [
          "Expliquer pourquoi « à la fois ici et là » est une formulation trompeuse.",
          "Dire ce qu'une superposition permet d'observer d'inaccessible autrement."
        ],
        tutor:
          "Fais critiquer la formule « la particule est aux deux endroits », puis demande quelle observation distingue une superposition d'un mélange.",
        contexts: [
          "un photon polarisé à 45 degrés",
          "un atome soumis à une impulsion laser calibrée",
          "un mélange statistique de deux états bien définis"
        ]
      },
      en: {
        title: "What a superposition means",
        summary: "Understand that a superposition is not hesitation but a state in its own right.",
        goals: [
          "Explain why “both here and there” is a misleading phrasing.",
          "Say what a superposition lets you observe that is otherwise inaccessible."
        ],
        tutor:
          "Have the student critique the phrase “the particle is in both places”, then ask which observation separates a superposition from a mixture.",
        contexts: [
          "a photon polarised at 45 degrees",
          "an atom driven by a calibrated laser pulse",
          "a statistical mixture of two well-defined states"
        ]
      }
    },
    {
      key: "uncertainty_principle",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Le principe d'indétermination",
        summary: "Comprendre que certaines grandeurs ne peuvent pas être définies simultanément avec précision.",
        goals: [
          "Citer une paire de grandeurs incompatibles.",
          "Expliquer pourquoi ce n'est pas un défaut d'instrument."
        ],
        tutor:
          "Fais expliquer pourquoi resserrer la position élargit l'impulsion, puis demande pourquoi un meilleur appareil ne résoudrait pas le problème.",
        contexts: [
          "un électron confiné dans une région très étroite",
          "une impulsion laser très brève et sa couleur",
          "un microscope de résolution parfaite imaginé en pensée"
        ]
      },
      en: {
        title: "The uncertainty principle",
        summary: "Understand that some quantities cannot be simultaneously defined with precision.",
        goals: [
          "Name a pair of incompatible quantities.",
          "Explain why this is not an instrument defect."
        ],
        tutor:
          "Have the student explain why narrowing position widens momentum, then ask why a better device would not solve it.",
        contexts: [
          "an electron confined in a very narrow region",
          "a very short laser pulse and its colour",
          "a perfectly resolving microscope imagined in thought"
        ]
      }
    },
    {
      key: "decoherence",
      objectives: "*",
      stage: 2,
      fr: {
        title: "La décohérence : pourquoi le monde paraît classique",
        summary: "Relier l'interaction avec l'environnement à la disparition rapide des effets d'interférence.",
        goals: [
          "Expliquer le rôle de l'environnement dans la perte de cohérence.",
          "Dire pourquoi les objets macroscopiques décohèrent quasi instantanément."
        ],
        tutor:
          "Fais estimer ce qui perturbe un état fragile dans une pièce ordinaire, puis demande pourquoi un objet visible ne montre jamais d'interférences.",
        contexts: [
          "un qubit perturbé par une vibration thermique",
          "un objet visible bombardé de photons ambiants",
          "une expérience refroidie près du zéro absolu"
        ]
      },
      en: {
        title: "Decoherence: why the world looks classical",
        summary: "Connect interaction with the environment to the fast disappearance of interference effects.",
        goals: [
          "Explain the role of the environment in the loss of coherence.",
          "Say why macroscopic objects decohere almost instantly."
        ],
        tutor:
          "Have the student estimate what disturbs a fragile state in an ordinary room, then ask why a visible object never shows interference.",
        contexts: [
          "a qubit disturbed by thermal vibration",
          "a visible object bombarded by ambient photons",
          "an experiment cooled near absolute zero"
        ]
      }
    },
    {
      key: "quantum_technology_today",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ce que la physique quantique fait déjà fonctionner",
        summary: "Repérer les technologies courantes qui reposent déjà sur des effets quantiques établis.",
        goals: [
          "Citer trois technologies existantes fondées sur la mécanique quantique.",
          "Distinguer ces technologies d'un ordinateur quantique."
        ],
        tutor:
          "Fais expliquer quel effet quantique rend un transistor possible, puis demande en quoi cela diffère d'un ordinateur quantique.",
        contexts: [
          "un transistor dans un processeur de téléphone",
          "une imagerie par résonance magnétique à l'hôpital",
          "un lecteur optique équipé d'une diode laser"
        ]
      },
      en: {
        title: "What quantum physics already makes work",
        summary: "Identify everyday technologies that already rely on established quantum effects.",
        goals: [
          "Name three existing technologies grounded in quantum mechanics.",
          "Tell these technologies apart from a quantum computer."
        ],
        tutor:
          "Have the student explain which quantum effect makes a transistor possible, then ask how that differs from a quantum computer.",
        contexts: [
          "a transistor inside a phone processor",
          "magnetic resonance imaging in a hospital",
          "an optical reader fitted with a laser diode"
        ]
      }
    },

    {
      key: "photoelectric_effect",
      objectives: ["quantum_intuition"],
      stage: 1,
      fr: {
        title: "Le photon et l'effet photoélectrique",
        summary: "Comprendre pourquoi l'énergie arrachée dépend de la couleur et non de l'intensité lumineuse.",
        goals: [
          "Expliquer le rôle du seuil de fréquence.",
          "Dire ce que change une lumière plus intense au-dessus du seuil."
        ],
        tutor:
          "Fais prédire l'effet d'une lampe rouge très puissante puis d'une lampe bleue faible sur une plaque métallique, et demande d'expliquer l'écart.",
        contexts: [
          "une plaque métallique éclairée en rouge puis en bleu",
          "une cellule photovoltaïque au soleil",
          "un capteur d'appareil photo en faible lumière"
        ]
      },
      en: {
        title: "The photon and the photoelectric effect",
        summary: "Understand why the extracted energy depends on colour rather than on light intensity.",
        goals: [
          "Explain the role of the frequency threshold.",
          "Say what stronger light changes above the threshold."
        ],
        tutor:
          "Have the student predict the effect of a very strong red lamp then a weak blue lamp on a metal plate, and explain the gap.",
        contexts: [
          "a metal plate lit in red then in blue",
          "a photovoltaic cell in sunlight",
          "a camera sensor in low light"
        ]
      }
    },
    {
      key: "atomic_orbitals",
      objectives: ["quantum_intuition"],
      stage: 2,
      fr: {
        title: "Les orbitales : pourquoi l'électron n'est pas une bille en orbite",
        summary: "Remplacer l'image planétaire par une distribution de probabilité de présence.",
        goals: [
          "Décrire ce que représente le nuage d'une orbitale.",
          "Expliquer pourquoi l'électron ne s'écrase pas sur le noyau."
        ],
        tutor:
          "Fais critiquer le schéma planétaire de l'atome, puis demande ce que représente exactement la zone dessinée autour du noyau.",
        contexts: [
          "le schéma planétaire d'un manuel scolaire",
          "la forme allongée d'une orbitale p",
          "une liaison chimique entre deux atomes"
        ]
      },
      en: {
        title: "Orbitals: why the electron is not a ball in orbit",
        summary: "Replace the planetary picture with a probability distribution of presence.",
        goals: [
          "Describe what an orbital cloud represents.",
          "Explain why the electron does not fall onto the nucleus."
        ],
        tutor:
          "Have the student critique the planetary picture of the atom, then ask what the drawn region around the nucleus actually represents.",
        contexts: [
          "the planetary diagram in a school textbook",
          "the elongated shape of a p orbital",
          "a chemical bond between two atoms"
        ]
      }
    },
    {
      key: "spectral_lines",
      objectives: ["quantum_intuition"],
      stage: 2,
      fr: {
        title: "Les raies spectrales",
        summary: "Relier les couleurs émises par un gaz aux écarts entre ses niveaux d'énergie.",
        goals: [
          "Expliquer l'origine d'une raie d'émission.",
          "Dire ce qu'un spectre permet d'identifier à distance."
        ],
        tutor:
          "Fais expliquer pourquoi chaque élément produit une signature de raies, puis demande comment on identifie un gaz dans une étoile.",
        contexts: [
          "la lumière d'une étoile analysée par un télescope",
          "un tube à néon dans une enseigne",
          "une flamme colorée par un sel métallique"
        ]
      },
      en: {
        title: "Spectral lines",
        summary: "Connect the colours emitted by a gas to the gaps between its energy levels.",
        goals: [
          "Explain where an emission line comes from.",
          "Say what a spectrum lets you identify from far away."
        ],
        tutor:
          "Have the student explain why each element produces a line signature, then ask how a gas is identified inside a star.",
        contexts: [
          "starlight analysed through a telescope",
          "a neon tube in a shop sign",
          "a flame coloured by a metallic salt"
        ]
      }
    },
    {
      key: "entanglement_intuition",
      objectives: ["quantum_intuition"],
      stage: 3,
      fr: {
        title: "L'intrication expliquée sans formalisme",
        summary: "Comprendre une corrélation parfaite entre deux systèmes qui ne transmet pourtant aucun message.",
        goals: [
          "Décrire la corrélation observée entre deux mesures distantes.",
          "Expliquer pourquoi cela ne permet pas de communiquer plus vite que la lumière."
        ],
        tutor:
          "Fais décrire les résultats de deux mesures distantes sur une paire intriquée, puis demande pourquoi aucun message n'est transmis.",
        contexts: [
          "deux photons produits ensemble puis séparés",
          "deux expérimentateurs séparés par un continent",
          "une paire de gants séparés dans deux valises"
        ]
      },
      en: {
        title: "Entanglement explained without formalism",
        summary: "Understand a perfect correlation between two systems that still carries no message.",
        goals: [
          "Describe the correlation observed between two distant measurements.",
          "Explain why it does not allow faster-than-light communication."
        ],
        tutor:
          "Have the student describe the outcomes of two distant measurements on an entangled pair, then ask why no message is transmitted.",
        contexts: [
          "two photons produced together then separated",
          "two experimenters a continent apart",
          "a pair of gloves split into two suitcases"
        ]
      }
    },
    {
      key: "bell_experiment",
      objectives: ["quantum_intuition"],
      stage: 3,
      fr: {
        title: "Ce que montre l'expérience de Bell",
        summary: "Comprendre pourquoi les corrélations mesurées excluent une explication par variables cachées locales.",
        goals: [
          "Expliquer ce qu'une inégalité de Bell teste réellement.",
          "Dire ce que la violation observée élimine comme explication."
        ],
        tutor:
          "Fais expliquer ce qu'une explication classique prédit et ce que l'expérience mesure, puis demande quelle hypothèse doit être abandonnée.",
        contexts: [
          "deux détecteurs orientés indépendamment",
          "une explication par instructions cachées à la création",
          "des mesures répétées des milliers de fois"
        ]
      },
      en: {
        title: "What Bell's experiment shows",
        summary: "Understand why the measured correlations rule out a local hidden-variable explanation.",
        goals: [
          "Explain what a Bell inequality actually tests.",
          "Say which explanation the observed violation eliminates."
        ],
        tutor:
          "Have the student state what a classical explanation predicts and what the experiment measures, then ask which assumption must be dropped.",
        contexts: [
          "two detectors oriented independently",
          "an explanation by hidden instructions set at creation",
          "measurements repeated thousands of times"
        ]
      }
    },
    {
      key: "quantum_tunneling",
      objectives: ["quantum_intuition"],
      stage: 3,
      fr: {
        title: "L'effet tunnel",
        summary: "Comprendre le franchissement d'une barrière d'énergie interdite à un objet classique.",
        goals: [
          "Expliquer comment la probabilité de passage dépend de l'épaisseur de la barrière.",
          "Citer une technologie qui exploite directement cet effet."
        ],
        tutor:
          "Fais estimer l'effet d'une barrière deux fois plus épaisse sur la probabilité de passage, puis demande où cet effet est utilisé en pratique.",
        contexts: [
          "un microscope à effet tunnel qui image des atomes",
          "la fusion nucléaire au cœur du Soleil",
          "une mémoire flash dont la charge finit par fuir"
        ]
      },
      en: {
        title: "Quantum tunnelling",
        summary: "Understand the crossing of an energy barrier forbidden to a classical object.",
        goals: [
          "Explain how the crossing probability depends on barrier thickness.",
          "Name a technology that directly exploits this effect."
        ],
        tutor:
          "Have the student estimate the effect of doubling barrier thickness on the crossing probability, then ask where the effect is used in practice.",
        contexts: [
          "a scanning tunnelling microscope imaging atoms",
          "nuclear fusion in the core of the Sun",
          "a flash memory whose charge eventually leaks"
        ]
      }
    },
    {
      key: "quantum_spin",
      objectives: ["quantum_intuition"],
      stage: 3,
      fr: {
        title: "Le spin, une grandeur sans équivalent classique",
        summary: "Comprendre une grandeur sans équivalent classique qui ne prend que deux valeurs à la mesure.",
        goals: [
          "Dire pourquoi l'image d'une toupie est trompeuse.",
          "Décrire le résultat d'une mesure de spin selon un axe."
        ],
        tutor:
          "Fais décrire le résultat d'une mesure de spin selon un axe puis selon un axe perpendiculaire, et demande ce que la seconde mesure détruit.",
        contexts: [
          "un faisceau d'atomes séparé en deux par un aimant",
          "un électron dans un champ magnétique d'IRM",
          "deux mesures successives selon des axes perpendiculaires"
        ]
      },
      en: {
        title: "Spin, a quantity with no classical counterpart",
        summary: "Understand a quantity with no classical counterpart that only takes two values on measurement.",
        goals: [
          "Say why the spinning-top picture misleads.",
          "Describe the result of a spin measurement along one axis."
        ],
        tutor:
          "Have the student describe a spin measurement along one axis then along a perpendicular one, and ask what the second destroys.",
        contexts: [
          "a beam of atoms split in two by a magnet",
          "an electron in an MRI magnetic field",
          "two successive measurements along perpendicular axes"
        ]
      }
    },
    {
      key: "pauli_exclusion",
      objectives: ["quantum_intuition"],
      stage: 4,
      fr: {
        title: "Le principe d'exclusion et la structure de la matière",
        summary: "Relier l'interdiction pour deux électrons d'occuper le même état à la stabilité de la matière.",
        goals: [
          "Expliquer comment le remplissage des couches construit le tableau périodique.",
          "Dire pourquoi la matière ordinaire ne s'effondre pas."
        ],
        tutor:
          "Fais remplir les couches d'un atome léger électron par électron, puis demande ce qui se passerait sans cette interdiction.",
        contexts: [
          "le remplissage des couches d'un atome de carbone",
          "la rigidité d'un morceau de métal",
          "une étoile qui résiste à sa propre gravité"
        ]
      },
      en: {
        title: "The exclusion principle and the structure of matter",
        summary: "Connect the ban on two electrons sharing a state to the stability of matter.",
        goals: [
          "Explain how shell filling builds the periodic table.",
          "Say why ordinary matter does not collapse."
        ],
        tutor:
          "Have the student fill the shells of a light atom electron by electron, then ask what would happen without that ban.",
        contexts: [
          "filling the shells of a carbon atom",
          "the stiffness of a piece of metal",
          "a star resisting its own gravity"
        ]
      }
    },
    {
      key: "quantum_interpretations",
      objectives: ["quantum_intuition"],
      stage: 4,
      fr: {
        title: "Ce que les interprétations changent et ne changent pas",
        summary: "Distinguer le formalisme prédictif, identique pour tous, des récits qui l'accompagnent.",
        goals: [
          "Dire ce que toutes les interprétations partagent obligatoirement.",
          "Expliquer pourquoi le choix d'interprétation ne change aucune prédiction."
        ],
        tutor:
          "Fais comparer deux interprétations sur une même expérience, puis demande quelle prédiction chiffrée diffère entre elles.",
        contexts: [
          "une même expérience racontée de deux façons",
          "un débat entre deux physiciens sur le rôle de la mesure",
          "un calcul de probabilité identique dans les deux récits"
        ]
      },
      en: {
        title: "What interpretations change and do not change",
        summary: "Separate the predictive formalism, shared by all, from the stories told around it.",
        goals: [
          "Say what every interpretation necessarily shares.",
          "Explain why the choice of interpretation changes no prediction."
        ],
        tutor:
          "Have the student compare two interpretations on the same experiment, then ask which numeric prediction differs between them.",
        contexts: [
          "the same experiment told in two ways",
          "a debate between two physicists on the role of measurement",
          "a probability computation identical in both accounts"
        ]
      }
    },
    {
      key: "vacuum_energy",
      objectives: ["quantum_intuition"],
      stage: 4,
      fr: {
        title: "L'énergie du vide",
        summary: "Comprendre que le vide quantique n'est pas rien et produit des effets mesurables.",
        goals: [
          "Expliquer pourquoi un champ ne peut pas être exactement nul partout.",
          "Citer un effet mesuré attribué aux fluctuations du vide."
        ],
        tutor:
          "Fais expliquer pourquoi le vide garde une énergie minimale, puis demande quelle mesure de laboratoire le met en évidence.",
        contexts: [
          "deux plaques très proches qui s'attirent dans le vide",
          "une chambre pompée jusqu'à la pression la plus basse possible",
          "un atome excité qui finit par retomber tout seul"
        ]
      },
      en: {
        title: "Vacuum energy",
        summary: "Understand that the quantum vacuum is not nothing and produces measurable effects.",
        goals: [
          "Explain why a field cannot be exactly zero everywhere.",
          "Name a measured effect attributed to vacuum fluctuations."
        ],
        tutor:
          "Have the student explain why the vacuum keeps a minimum energy, then ask which laboratory measurement reveals it.",
        contexts: [
          "two very close plates attracting each other in vacuum",
          "a chamber pumped to the lowest achievable pressure",
          "an excited atom that eventually decays on its own"
        ]
      }
    },
    {
      key: "laser_stimulated_emission",
      objectives: ["quantum_intuition"],
      stage: 4,
      fr: {
        title: "Comment un laser amplifie la lumière",
        summary: "Relier émission stimulée, inversion de population et cavité optique à un faisceau cohérent.",
        goals: [
          "Expliquer ce qu'apporte l'émission stimulée par rapport à l'émission spontanée.",
          "Dire pourquoi une inversion de population est nécessaire."
        ],
        tutor:
          "Fais expliquer pourquoi un photon en produit un identique, puis demande pourquoi une lampe ordinaire ne produit jamais un faisceau laser.",
        contexts: [
          "un pointeur laser de conférence",
          "une lampe à incandescence qui éclaire dans toutes les directions",
          "un laser de découpe industrielle"
        ]
      },
      en: {
        title: "How a laser amplifies light",
        summary: "Connect stimulated emission, population inversion and an optical cavity to a coherent beam.",
        goals: [
          "Explain what stimulated emission adds over spontaneous emission.",
          "Say why a population inversion is required."
        ],
        tutor:
          "Have the student explain why one photon produces an identical one, then ask why an ordinary lamp never yields a laser beam.",
        contexts: [
          "a conference laser pointer",
          "an incandescent lamp shining in all directions",
          "an industrial cutting laser"
        ]
      }
    },
    {
      key: "superconductivity",
      objectives: ["quantum_intuition"],
      stage: 5,
      fr: {
        title: "La supraconductivité",
        summary: "Comprendre la disparition de la résistance électrique par appariement des électrons sous une température critique.",
        goals: [
          "Expliquer ce que devient la résistance sous la température critique.",
          "Citer un usage industriel qui justifie le refroidissement."
        ],
        tutor:
          "Fais expliquer pourquoi un courant peut circuler sans perte, puis demande ce qui justifie le coût du refroidissement en pratique.",
        contexts: [
          "un aimant d'IRM refroidi à l'hélium liquide",
          "un anneau de courant qui circule sans s'atténuer",
          "une ligne électrique expérimentale sans pertes"
        ]
      },
      en: {
        title: "Superconductivity",
        summary: "Understand the vanishing of electrical resistance through electron pairing below a critical temperature.",
        goals: [
          "Explain what resistance becomes below the critical temperature.",
          "Name an industrial use that justifies the cooling."
        ],
        tutor:
          "Have the student explain why a current can flow without loss, then ask what justifies the cooling cost in practice.",
        contexts: [
          "an MRI magnet cooled with liquid helium",
          "a current loop circulating without decaying",
          "an experimental lossless power line"
        ]
      }
    },
    {
      key: "bose_einstein_condensate",
      objectives: ["quantum_intuition"],
      stage: 5,
      fr: {
        title: "Le condensat de Bose-Einstein",
        summary: "Comprendre l'état où des milliers d'atomes occupent le même état quantique et se comportent comme un seul.",
        goals: [
          "Expliquer ce que le refroidissement extrême rend possible.",
          "Dire ce qu'on observe qui serait impossible à température ambiante."
        ],
        tutor:
          "Fais expliquer pourquoi il faut descendre près du zéro absolu, puis demande ce que l'on observe alors et qui serait impossible autrement.",
        contexts: [
          "un nuage d'atomes refroidi au nanokelvin",
          "des atomes qui interfèrent comme une onde unique",
          "une expérience de laboratoire filmée image par image"
        ]
      },
      en: {
        title: "The Bose-Einstein condensate",
        summary: "Understand the state where thousands of atoms share one quantum state and act as one.",
        goals: [
          "Explain what extreme cooling makes possible.",
          "Say what is observed that would be impossible at room temperature."
        ],
        tutor:
          "Have the student explain why one must go near absolute zero, then ask what is observed there that is otherwise impossible.",
        contexts: [
          "an atom cloud cooled to the nanokelvin range",
          "atoms interfering as a single wave",
          "a laboratory experiment filmed frame by frame"
        ]
      }
    },
    {
      key: "single_photon_experiments",
      objectives: ["quantum_intuition"],
      stage: 5,
      fr: {
        title: "Les expériences à photon unique",
        summary: "Comprendre ce que garantit une source de photons uniques et pourquoi elle change l'interprétation d'un résultat.",
        goals: [
          "Expliquer ce qu'une source atténuée ne garantit pas.",
          "Dire ce que prouve une expérience réalisée photon par photon."
        ],
        tutor:
          "Fais comparer une source atténuée et une vraie source de photons uniques, puis demande ce que la seconde permet de conclure.",
        contexts: [
          "un laser fortement atténué",
          "un détecteur qui compte les clics un par un",
          "une distribution de clé quantique en laboratoire"
        ]
      },
      en: {
        title: "Single-photon experiments",
        summary: "Understand what a single-photon source guarantees and why it changes how a result is read.",
        goals: [
          "Explain what an attenuated source does not guarantee.",
          "Say what an experiment run photon by photon proves."
        ],
        tutor:
          "Have the student compare an attenuated source with a true single-photon source, then ask what the second allows concluding.",
        contexts: [
          "a heavily attenuated laser",
          "a detector counting clicks one by one",
          "a laboratory quantum key distribution setup"
        ]
      }
    },
    {
      key: "quantum_thermodynamics",
      objectives: ["quantum_intuition"],
      stage: 5,
      fr: {
        title: "Chaleur et information à l'échelle quantique",
        summary: "Relier l'effacement d'une information à une dissipation minimale de chaleur.",
        goals: [
          "Expliquer pourquoi effacer un bit coûte de l'énergie.",
          "Dire ce qu'un calcul réversible change à cette dépense."
        ],
        tutor:
          "Fais expliquer pourquoi l'effacement d'un bit dissipe de la chaleur, puis demande ce que change un calcul réversible.",
        contexts: [
          "un processeur qui chauffe en effaçant des données",
          "une mémoire réinitialisée avant chaque calcul",
          "une porte logique réversible imaginée en pensée"
        ]
      },
      en: {
        title: "Heat and information at the quantum scale",
        summary: "Connect erasing information to a minimal dissipation of heat.",
        goals: [
          "Explain why erasing a bit costs energy.",
          "Say what reversible computation changes about that cost."
        ],
        tutor:
          "Have the student explain why erasing a bit dissipates heat, then ask what a reversible computation changes.",
        contexts: [
          "a processor heating as it erases data",
          "a memory reset before each computation",
          "a reversible logic gate imagined in thought"
        ]
      }
    },

    {
      key: "state_as_vector",
      objectives: ["quantum_mathematics"],
      stage: 1,
      fr: {
        title: "Un état représenté par un vecteur",
        summary: "Représenter un système à deux issues par un vecteur de norme un dans un plan.",
        goals: [
          "Écrire un état à deux composantes et vérifier sa normalisation.",
          "Dire ce que représente chaque composante."
        ],
        tutor:
          "Fais écrire l'état d'un système à deux issues avec des composantes égales, puis demande pourquoi la somme des carrés doit valoir un.",
        contexts: [
          "un système à deux issues équiprobables",
          "un vecteur de norme un dessiné dans un plan",
          "un état déséquilibré à 80 % et 20 %"
        ]
      },
      en: {
        title: "A state represented by a vector",
        summary: "Represent a two-outcome system by a unit-norm vector in a plane.",
        goals: [
          "Write a two-component state and check its normalisation.",
          "Say what each component represents."
        ],
        tutor:
          "Have the student write a two-outcome state with equal components, then ask why the squares must sum to one.",
        contexts: [
          "a two-outcome system with equal chances",
          "a unit vector drawn in a plane",
          "an unbalanced state at 80% and 20%"
        ]
      }
    },
    {
      key: "complex_amplitudes",
      objectives: ["quantum_mathematics"],
      stage: 2,
      fr: {
        title: "Amplitudes complexes et probabilités",
        summary: "Comprendre pourquoi la phase d'une amplitude ne se voit pas sur une probabilité mais gouverne les interférences.",
        goals: [
          "Calculer une probabilité à partir d'une amplitude complexe.",
          "Montrer que deux amplitudes peuvent s'annuler."
        ],
        tutor:
          "Fais additionner deux amplitudes de phases opposées, puis demande pourquoi la probabilité obtenue n'est pas la somme des probabilités.",
        contexts: [
          "deux chemins possibles menant au même détecteur",
          "deux amplitudes de signes opposés",
          "une figure d'interférence avec des zones sombres"
        ]
      },
      en: {
        title: "Complex amplitudes and probabilities",
        summary: "Understand why the phase of an amplitude is invisible in a probability yet governs interference.",
        goals: [
          "Compute a probability from a complex amplitude.",
          "Show that two amplitudes can cancel out."
        ],
        tutor:
          "Have the student add two amplitudes with opposite phases, then ask why the resulting probability is not the sum of probabilities.",
        contexts: [
          "two possible paths reaching the same detector",
          "two amplitudes with opposite signs",
          "an interference pattern with dark regions"
        ]
      }
    },
    {
      key: "dirac_notation",
      objectives: ["quantum_mathematics"],
      stage: 2,
      fr: {
        title: "La notation de Dirac",
        summary: "Lire les notations de vecteurs et de produits scalaires utilisées dans toute la littérature quantique.",
        goals: [
          "Traduire une expression en notation de Dirac en langage vectoriel.",
          "Interpréter un produit scalaire entre deux états."
        ],
        tutor:
          "Fais traduire deux expressions en notation de Dirac vers des vecteurs et un produit scalaire, puis demande ce que vaut ce produit pour deux états orthogonaux.",
        contexts: [
          "une formule lue dans un article de recherche",
          "un produit scalaire entre deux états orthogonaux",
          "un état écrit comme somme de deux états de base"
        ]
      },
      en: {
        title: "Dirac notation",
        summary: "Read the vector and inner-product notation used throughout the quantum literature.",
        goals: [
          "Translate a Dirac expression into vector language.",
          "Interpret an inner product between two states."
        ],
        tutor:
          "Have the student translate two Dirac expressions into vectors and an inner product, then ask its value for two orthogonal states.",
        contexts: [
          "a formula read in a research paper",
          "an inner product between two orthogonal states",
          "a state written as a sum of two basis states"
        ]
      }
    },
    {
      key: "basis_change",
      objectives: ["quantum_mathematics"],
      stage: 3,
      fr: {
        title: "Bases et changement de base",
        summary: "Comprendre qu'un même état s'écrit différemment selon la base de mesure choisie.",
        goals: [
          "Réécrire un état dans une seconde base orthonormée.",
          "Expliquer pourquoi un état certain dans une base est incertain dans une autre."
        ],
        tutor:
          "Fais réécrire un état bien défini dans une base tournée de 45 degrés, puis demande ce que donnerait la mesure dans cette nouvelle base.",
        contexts: [
          "un photon polarisé mesuré selon deux orientations de filtre",
          "un état certain dans une base et équiprobable dans l'autre",
          "un même vecteur exprimé dans deux repères"
        ]
      },
      en: {
        title: "Bases and change of basis",
        summary: "Understand that one state is written differently depending on the chosen measurement basis.",
        goals: [
          "Rewrite a state in a second orthonormal basis.",
          "Explain why a state certain in one basis is uncertain in another."
        ],
        tutor:
          "Have the student rewrite a well-defined state in a basis rotated by 45 degrees, then ask what a measurement in that basis would give.",
        contexts: [
          "a polarised photon measured through two filter orientations",
          "a state certain in one basis and even in the other",
          "the same vector expressed in two frames"
        ]
      }
    },
    {
      key: "born_rule",
      objectives: ["quantum_mathematics"],
      stage: 3,
      fr: {
        title: "La règle de Born",
        summary: "Calculer la probabilité d'un résultat comme le carré du module de l'amplitude correspondante.",
        goals: [
          "Appliquer la règle sur un état à trois composantes.",
          "Vérifier que les probabilités obtenues somment à un."
        ],
        tutor:
          "Fais calculer les trois probabilités d'un état donné, puis demande de vérifier leur somme et d'expliquer ce que garantit la normalisation.",
        contexts: [
          "un état à trois issues possibles",
          "un état mal normalisé qui donne des probabilités absurdes",
          "un histogramme de résultats mesurés mille fois"
        ]
      },
      en: {
        title: "The Born rule",
        summary: "Compute the probability of an outcome as the squared modulus of the matching amplitude.",
        goals: [
          "Apply the rule to a three-component state.",
          "Check that the resulting probabilities sum to one."
        ],
        tutor:
          "Have the student compute the three probabilities of a given state, then check their sum and explain what normalisation guarantees.",
        contexts: [
          "a state with three possible outcomes",
          "a badly normalised state giving absurd probabilities",
          "a histogram of a thousand measured results"
        ]
      }
    },
    {
      key: "operators_observables",
      objectives: ["quantum_mathematics"],
      stage: 3,
      fr: {
        title: "Opérateurs et observables",
        summary: "Associer une grandeur mesurable à un opérateur agissant sur les états.",
        goals: [
          "Dire quelle propriété un opérateur doit avoir pour représenter une mesure.",
          "Appliquer un opérateur simple à un état."
        ],
        tutor:
          "Fais appliquer un opérateur donné à deux états de base, puis demande pourquoi les résultats de mesure doivent être réels.",
        contexts: [
          "une matrice deux par deux appliquée à un état",
          "une énergie mesurée en laboratoire",
          "un opérateur qui laisse un état inchangé"
        ]
      },
      en: {
        title: "Operators and observables",
        summary: "Associate a measurable quantity with an operator acting on states.",
        goals: [
          "Say which property an operator must have to represent a measurement.",
          "Apply a simple operator to a state."
        ],
        tutor:
          "Have the student apply a given operator to two basis states, then ask why measurement results must be real.",
        contexts: [
          "a two-by-two matrix applied to a state",
          "an energy measured in the laboratory",
          "an operator leaving a state unchanged"
        ]
      }
    },
    {
      key: "eigenvalues_measurement",
      objectives: ["quantum_mathematics"],
      stage: 3,
      fr: {
        title: "Valeurs propres et résultats de mesure",
        summary: "Identifier les résultats possibles d'une mesure aux valeurs propres de l'opérateur associé.",
        goals: [
          "Calculer les valeurs propres d'un opérateur deux par deux.",
          "Dire dans quel état se trouve le système juste après la mesure."
        ],
        tutor:
          "Fais calculer les valeurs propres d'un opérateur simple, puis demande dans quel état se trouve le système juste après le résultat obtenu.",
        contexts: [
          "une mesure qui ne peut donner que deux valeurs",
          "un état propre qui reste inchangé après mesure",
          "une seconde mesure identique à la première"
        ]
      },
      en: {
        title: "Eigenvalues and measurement outcomes",
        summary: "Identify the possible outcomes of a measurement with the eigenvalues of its operator.",
        goals: [
          "Compute the eigenvalues of a two-by-two operator.",
          "Say which state the system is in right after measurement."
        ],
        tutor:
          "Have the student compute the eigenvalues of a simple operator, then ask which state the system is in right after the obtained result.",
        contexts: [
          "a measurement that can only yield two values",
          "an eigenstate left unchanged by measurement",
          "a second measurement identical to the first"
        ]
      }
    },
    {
      key: "commutators",
      objectives: ["quantum_mathematics"],
      stage: 4,
      fr: {
        title: "Commutateurs et grandeurs incompatibles",
        summary: "Utiliser le commutateur pour savoir si deux mesures peuvent être précises en même temps.",
        goals: [
          "Calculer un commutateur de deux opérateurs simples.",
          "Relier un commutateur non nul à une relation d'indétermination."
        ],
        tutor:
          "Fais calculer le commutateur de deux opérateurs donnés, puis demande ce que le résultat implique sur l'ordre des mesures.",
        contexts: [
          "deux mesures effectuées dans un ordre puis dans l'autre",
          "deux opérateurs qui commutent",
          "position et impulsion d'une particule"
        ]
      },
      en: {
        title: "Commutators and incompatible quantities",
        summary: "Use the commutator to know whether two measurements can both be precise.",
        goals: [
          "Compute the commutator of two simple operators.",
          "Link a non-zero commutator to an uncertainty relation."
        ],
        tutor:
          "Have the student compute the commutator of two given operators, then ask what the result implies about measurement order.",
        contexts: [
          "two measurements performed in one order then the other",
          "two operators that commute",
          "position and momentum of a particle"
        ]
      }
    },
    {
      key: "schrodinger_equation",
      objectives: ["quantum_mathematics"],
      stage: 4,
      fr: {
        title: "L'équation d'évolution des états",
        summary: "Comprendre l'évolution déterministe d'un état entre deux mesures et le rôle de l'énergie.",
        goals: [
          "Dire ce que l'équation prédit exactement.",
          "Opposer l'évolution continue au saut produit par la mesure."
        ],
        tutor:
          "Fais opposer l'évolution entre deux mesures et le changement au moment de la mesure, puis demande laquelle est déterministe.",
        contexts: [
          "un état qui oscille entre deux niveaux",
          "un système isolé laissé à lui-même une seconde",
          "une mesure qui interrompt l'évolution"
        ]
      },
      en: {
        title: "The state evolution equation",
        summary: "Understand the deterministic evolution of a state between measurements and the role of energy.",
        goals: [
          "Say exactly what the equation predicts.",
          "Contrast continuous evolution with the jump caused by measurement."
        ],
        tutor:
          "Have the student contrast evolution between measurements and the change at measurement, then ask which one is deterministic.",
        contexts: [
          "a state oscillating between two levels",
          "an isolated system left alone for a second",
          "a measurement interrupting the evolution"
        ]
      }
    },
    {
      key: "hilbert_space",
      objectives: ["quantum_mathematics"],
      stage: 4,
      fr: {
        title: "L'espace des états",
        summary: "Situer les états dans un espace vectoriel muni d'un produit scalaire et d'une dimension propre au système.",
        goals: [
          "Donner la dimension de l'espace pour un système à deux niveaux.",
          "Expliquer ce que la structure d'espace vectoriel autorise."
        ],
        tutor:
          "Fais donner la dimension de l'espace pour un puis pour trois systèmes à deux niveaux, et demande d'où vient la croissance.",
        contexts: [
          "un système à deux niveaux isolé",
          "trois systèmes à deux niveaux considérés ensemble",
          "un espace de dimension infinie pour une position continue"
        ]
      },
      en: {
        title: "The space of states",
        summary: "Place states inside a vector space with an inner product and a dimension set by the system.",
        goals: [
          "Give the space dimension for a two-level system.",
          "Explain what the vector space structure allows."
        ],
        tutor:
          "Have the student give the dimension for one then three two-level systems, and ask where the growth comes from.",
        contexts: [
          "an isolated two-level system",
          "three two-level systems considered together",
          "an infinite-dimensional space for a continuous position"
        ]
      }
    },
    {
      key: "tensor_product",
      objectives: ["quantum_mathematics"],
      stage: 4,
      fr: {
        title: "Le produit tensoriel et les systèmes composés",
        summary: "Construire l'état de deux systèmes réunis et reconnaître un état qui ne se factorise pas.",
        goals: [
          "Écrire l'état de deux systèmes indépendants.",
          "Montrer qu'un état intriqué ne se factorise pas."
        ],
        tutor:
          "Fais écrire l'état de deux systèmes indépendants, puis demande de prouver qu'un état donné ne peut pas s'écrire ainsi.",
        contexts: [
          "deux particules préparées séparément",
          "un état qui ne s'écrit pas comme un produit",
          "un espace dont la dimension double à chaque ajout"
        ]
      },
      en: {
        title: "The tensor product and composite systems",
        summary: "Build the state of two joined systems and recognise a state that does not factorise.",
        goals: [
          "Write the state of two independent systems.",
          "Show that an entangled state does not factorise."
        ],
        tutor:
          "Have the student write the state of two independent systems, then prove a given state cannot be written that way.",
        contexts: [
          "two particles prepared separately",
          "a state that cannot be written as a product",
          "a space whose dimension doubles with each addition"
        ]
      }
    },
    {
      key: "density_matrix",
      objectives: ["quantum_mathematics"],
      stage: 5,
      fr: {
        title: "La matrice densité",
        summary: "Décrire un système partiellement connu et distinguer une superposition d'un mélange statistique.",
        goals: [
          "Écrire la matrice d'un état pur et celle d'un mélange.",
          "Repérer sur la matrice ce qui distingue les deux cas."
        ],
        tutor:
          "Fais écrire les deux matrices pour une superposition et pour un mélange équiprobable, puis demande quel terme les distingue.",
        contexts: [
          "un mélange équiprobable de deux états",
          "une superposition à composantes égales",
          "un système couplé à un environnement bruyant"
        ]
      },
      en: {
        title: "The density matrix",
        summary: "Describe a partially known system and tell a superposition apart from a statistical mixture.",
        goals: [
          "Write the matrix of a pure state and of a mixture.",
          "Spot in the matrix what separates the two cases."
        ],
        tutor:
          "Have the student write both matrices for a superposition and for an even mixture, then ask which term distinguishes them.",
        contexts: [
          "an even mixture of two states",
          "a superposition with equal components",
          "a system coupled to a noisy environment"
        ]
      }
    },
    {
      key: "entanglement_entropy",
      objectives: ["quantum_mathematics"],
      stage: 5,
      fr: {
        title: "L'entropie d'intrication",
        summary: "Quantifier l'intrication par l'incertitude qui subsiste sur une partie du système.",
        goals: [
          "Calculer l'entropie d'une partie d'un état maximalement intriqué.",
          "Expliquer pourquoi le tout peut être mieux connu que ses parties."
        ],
        tutor:
          "Fais calculer l'entropie d'une moitié d'une paire maximalement intriquée, puis demande pourquoi elle dépasse celle du système entier.",
        contexts: [
          "une paire maximalement intriquée séparée en deux",
          "un état produit dont chaque partie est bien définie",
          "une mesure limitée à une seule des deux particules"
        ]
      },
      en: {
        title: "Entanglement entropy",
        summary: "Quantify entanglement by the uncertainty remaining about one part of the system.",
        goals: [
          "Compute the entropy of one half of a maximally entangled state.",
          "Explain why the whole can be better known than its parts."
        ],
        tutor:
          "Have the student compute the entropy of one half of a maximally entangled pair, then ask why it exceeds that of the whole system.",
        contexts: [
          "a maximally entangled pair split in two",
          "a product state whose parts are well defined",
          "a measurement limited to one of the two particles"
        ]
      }
    },
    {
      key: "perturbation_theory",
      objectives: ["quantum_mathematics"],
      stage: 5,
      fr: {
        title: "La théorie des perturbations",
        summary: "Approcher un système compliqué comme un système simple légèrement modifié.",
        goals: [
          "Expliquer la démarche d'un développement au premier ordre.",
          "Dire quand l'approximation cesse d'être valable."
        ],
        tutor:
          "Fais estimer le décalage d'un niveau d'énergie sous une petite perturbation, puis demande à partir de quand l'approche échoue.",
        contexts: [
          "un atome placé dans un champ électrique faible",
          "un niveau d'énergie légèrement décalé",
          "une perturbation devenue comparable au terme principal"
        ]
      },
      en: {
        title: "Perturbation theory",
        summary: "Approach a complicated system as a simple one that has been slightly modified.",
        goals: [
          "Explain the approach of a first-order expansion.",
          "Say when the approximation stops being valid."
        ],
        tutor:
          "Have the student estimate the shift of an energy level under a small perturbation, then ask when the approach fails.",
        contexts: [
          "an atom placed in a weak electric field",
          "an energy level slightly shifted",
          "a perturbation grown comparable to the main term"
        ]
      }
    },
    {
      key: "path_integral",
      objectives: ["quantum_mathematics"],
      stage: 5,
      fr: {
        title: "La somme sur les chemins",
        summary: "Comprendre une amplitude comme la somme des contributions de tous les trajets possibles.",
        goals: [
          "Expliquer comment les chemins éloignés du trajet classique s'annulent.",
          "Relier cette vision au trajet unique de la mécanique classique."
        ],
        tutor:
          "Fais expliquer comment la somme sur tous les trajets redonne la trajectoire classique, puis demande ce que deviennent les autres contributions.",
        contexts: [
          "tous les trajets possibles entre deux points",
          "une trajectoire classique retrouvée à grande échelle",
          "deux chemins dont les contributions s'annulent"
        ]
      },
      en: {
        title: "The sum over paths",
        summary: "Understand an amplitude as the sum of contributions from every possible trajectory.",
        goals: [
          "Explain how paths far from the classical one cancel out.",
          "Relate this picture to the single path of classical mechanics."
        ],
        tutor:
          "Have the student explain how the sum over all paths recovers the classical trajectory, then ask what happens to the other contributions.",
        contexts: [
          "every possible path between two points",
          "a classical trajectory recovered at large scale",
          "two paths whose contributions cancel"
        ]
      }
    },

    {
      key: "qubit_vs_bit",
      objectives: ["quantum_computing"],
      stage: 1,
      fr: {
        title: "Ce qu'un qubit ajoute à un bit",
        summary: "Comparer un bit classique et un qubit sur ce qu'on peut préparer et sur ce qu'on peut lire.",
        goals: [
          "Dire combien d'information une mesure de qubit fournit.",
          "Expliquer pourquoi « un qubit vaut deux valeurs » est trompeur."
        ],
        tutor:
          "Fais comparer ce qu'un bit et un qubit permettent de préparer puis de lire, et demande pourquoi la lecture ne donne qu'un seul résultat.",
        contexts: [
          "un bit classique valant zéro ou un",
          "une mesure de qubit qui renvoie un seul bit",
          "un registre de dix qubits préparé en superposition"
        ]
      },
      en: {
        title: "What a qubit adds to a bit",
        summary: "Compare a classical bit and a qubit on what can be prepared and on what can be read.",
        goals: [
          "Say how much information a qubit measurement yields.",
          "Explain why “a qubit holds two values” is misleading."
        ],
        tutor:
          "Have the student compare what a bit and a qubit allow preparing then reading, and ask why the readout gives a single result.",
        contexts: [
          "a classical bit holding zero or one",
          "a qubit measurement returning a single bit",
          "a ten-qubit register prepared in superposition"
        ]
      }
    },
    {
      key: "bloch_sphere",
      objectives: ["quantum_computing"],
      stage: 2,
      fr: {
        title: "La sphère de Bloch",
        summary: "Représenter l'état d'un qubit comme un point sur une sphère et lire l'effet d'une opération.",
        goals: [
          "Placer trois états de base sur la sphère.",
          "Décrire l'effet d'une porte comme une rotation."
        ],
        tutor:
          "Fais placer trois états sur la sphère, puis demande quelle rotation transforme le premier en le deuxième.",
        contexts: [
          "un état placé au pôle nord de la sphère",
          "une rotation d'un quart de tour autour d'un axe",
          "deux états diamétralement opposés"
        ]
      },
      en: {
        title: "The Bloch sphere",
        summary: "Represent a qubit state as a point on a sphere and read the effect of an operation.",
        goals: [
          "Place three basis states on the sphere.",
          "Describe a gate's effect as a rotation."
        ],
        tutor:
          "Have the student place three states on the sphere, then ask which rotation turns the first into the second.",
        contexts: [
          "a state at the north pole of the sphere",
          "a quarter-turn rotation about one axis",
          "two diametrically opposite states"
        ]
      }
    },
    {
      key: "quantum_gates",
      objectives: ["quantum_computing"],
      stage: 2,
      fr: {
        title: "Les portes quantiques élémentaires",
        summary: "Appliquer les portes de base et vérifier qu'une opération quantique est réversible.",
        goals: [
          "Décrire l'effet des portes X et H sur un état de base.",
          "Expliquer pourquoi une porte quantique est toujours réversible."
        ],
        tutor:
          "Fais appliquer deux portes successives à un état de base, puis demande quelle porte annule la transformation obtenue.",
        contexts: [
          "une porte qui échange zéro et un",
          "une porte qui crée une superposition égale",
          "deux portes identiques appliquées à la suite"
        ]
      },
      en: {
        title: "Elementary quantum gates",
        summary: "Apply the basic gates and check that a quantum operation is reversible.",
        goals: [
          "Describe the effect of the X and H gates on a basis state.",
          "Explain why a quantum gate is always reversible."
        ],
        tutor:
          "Have the student apply two gates in a row to a basis state, then ask which gate undoes the resulting transformation.",
        contexts: [
          "a gate swapping zero and one",
          "a gate creating an equal superposition",
          "two identical gates applied in a row"
        ]
      }
    },
    {
      key: "quantum_circuit_reading",
      objectives: ["quantum_computing"],
      stage: 3,
      fr: {
        title: "Lire un circuit quantique",
        summary: "Suivre un circuit de gauche à droite et prédire la distribution des résultats de mesure.",
        goals: [
          "Suivre l'état à travers trois portes successives.",
          "Prédire la distribution des résultats à la mesure finale."
        ],
        tutor:
          "Fais suivre l'état à travers un circuit à trois portes, puis demande la distribution attendue sur mille exécutions.",
        contexts: [
          "un circuit à deux qubits et trois portes",
          "une mesure répétée mille fois",
          "un circuit dont la dernière porte est retirée"
        ]
      },
      en: {
        title: "Reading a quantum circuit",
        summary: "Follow a circuit left to right and predict the distribution of measurement results.",
        goals: [
          "Follow the state through three successive gates.",
          "Predict the outcome distribution at the final measurement."
        ],
        tutor:
          "Have the student follow the state through a three-gate circuit, then ask the expected distribution over a thousand runs.",
        contexts: [
          "a two-qubit circuit with three gates",
          "a measurement repeated a thousand times",
          "a circuit with its last gate removed"
        ]
      }
    },
    {
      key: "entangling_gate",
      objectives: ["quantum_computing"],
      stage: 3,
      fr: {
        title: "La porte contrôlée et la création d'intrication",
        summary: "Construire une paire intriquée avec deux portes et vérifier la corrélation obtenue.",
        goals: [
          "Décrire l'effet d'une porte contrôlée sur un état superposé.",
          "Prédire les résultats corrélés des deux mesures."
        ],
        tutor:
          "Fais construire une paire intriquée avec deux portes, puis demande quels résultats de mesure sont possibles et lesquels ne le sont jamais.",
        contexts: [
          "deux qubits mesurés toujours identiques",
          "un circuit à une porte H suivie d'une porte contrôlée",
          "une combinaison de résultats jamais observée"
        ]
      },
      en: {
        title: "The controlled gate and creating entanglement",
        summary: "Build an entangled pair with two gates and check the resulting correlation.",
        goals: [
          "Describe the effect of a controlled gate on a superposed state.",
          "Predict the correlated outcomes of both measurements."
        ],
        tutor:
          "Have the student build an entangled pair with two gates, then ask which measurement results are possible and which never occur.",
        contexts: [
          "two qubits always measured identical",
          "a circuit with an H gate followed by a controlled gate",
          "a result combination never observed"
        ]
      }
    },
    {
      key: "interference_as_engine",
      objectives: ["quantum_computing"],
      stage: 3,
      fr: {
        title: "L'interférence comme moteur des algorithmes",
        summary: "Comprendre qu'un algorithme quantique organise l'annulation des mauvaises réponses.",
        goals: [
          "Expliquer pourquoi tester toutes les possibilités ne suffit pas.",
          "Dire ce qu'un algorithme doit organiser pour être utile."
        ],
        tutor:
          "Fais expliquer pourquoi une superposition de toutes les réponses ne donne rien à la mesure, puis demande ce que l'algorithme doit ajouter.",
        contexts: [
          "une superposition de toutes les réponses possibles",
          "une mesure qui renvoie une réponse au hasard",
          "des amplitudes concentrées sur la bonne réponse"
        ]
      },
      en: {
        title: "Interference as the engine of algorithms",
        summary: "Understand that a quantum algorithm organises the cancellation of wrong answers.",
        goals: [
          "Explain why testing all possibilities is not enough.",
          "Say what an algorithm must organise to be useful."
        ],
        tutor:
          "Have the student explain why a superposition of every answer yields nothing at measurement, then ask what the algorithm must add.",
        contexts: [
          "a superposition of every possible answer",
          "a measurement returning a random answer",
          "amplitudes concentrated on the right answer"
        ]
      }
    },
    {
      key: "measurement_readout",
      objectives: ["quantum_computing"],
      stage: 3,
      fr: {
        title: "Lire le résultat d'un calcul quantique",
        summary: "Comprendre qu'un résultat s'obtient par répétitions et statistiques plutôt qu'en une lecture.",
        goals: [
          "Expliquer pourquoi une exécution unique ne suffit pas.",
          "Estimer le nombre de répétitions nécessaires à une précision donnée."
        ],
        tutor:
          "Fais estimer combien d'exécutions sont nécessaires pour distinguer deux distributions proches, puis demande ce que coûte cette répétition.",
        contexts: [
          "un algorithme exécuté dix mille fois",
          "deux distributions de résultats très proches",
          "un résultat vérifiable classiquement en une seconde"
        ]
      },
      en: {
        title: "Reading the result of a quantum computation",
        summary: "Understand that a result comes from repetitions and statistics rather than a single readout.",
        goals: [
          "Explain why one run is not enough.",
          "Estimate how many repetitions a given precision needs."
        ],
        tutor:
          "Have the student estimate how many runs separate two close distributions, then ask what that repetition costs.",
        contexts: [
          "an algorithm executed ten thousand times",
          "two very close result distributions",
          "a result verifiable classically in one second"
        ]
      }
    },
    {
      key: "grover_search",
      objectives: ["quantum_computing"],
      stage: 4,
      fr: {
        title: "L'algorithme de recherche de Grover",
        summary: "Comprendre le gain quadratique d'une recherche non structurée et ses conditions d'application.",
        goals: [
          "Comparer le nombre d'essais classique et quantique.",
          "Dire ce que l'algorithme exige pour être applicable."
        ],
        tutor:
          "Fais comparer le nombre d'essais pour un million d'éléments, puis demande ce qu'il faut pouvoir écrire pour appliquer l'algorithme.",
        contexts: [
          "une recherche parmi un million d'éléments non triés",
          "une fonction qui reconnaît la bonne réponse",
          "une base de données classique déjà indexée"
        ]
      },
      en: {
        title: "Grover's search algorithm",
        summary: "Understand the quadratic gain of unstructured search and its conditions of use.",
        goals: [
          "Compare the classical and quantum number of trials.",
          "Say what the algorithm requires to be applicable."
        ],
        tutor:
          "Have the student compare the number of trials for a million items, then ask what must be writable to apply the algorithm.",
        contexts: [
          "a search among a million unsorted items",
          "a function recognising the right answer",
          "a classical database that is already indexed"
        ]
      }
    },
    {
      key: "shor_factoring",
      objectives: ["quantum_computing"],
      stage: 4,
      fr: {
        title: "L'algorithme de factorisation de Shor",
        summary: "Comprendre pourquoi la factorisation devient traitable et ce que cela menace en cryptographie.",
        goals: [
          "Dire quelle structure mathématique l'algorithme exploite.",
          "Expliquer quelles cryptographies sont concernées."
        ],
        tutor:
          "Fais expliquer quelle propriété périodique l'algorithme exploite, puis demande quels systèmes cryptographiques sont réellement menacés.",
        contexts: [
          "une clé publique fondée sur un produit de deux grands nombres",
          "un message chiffré aujourd'hui et stocké pour plus tard",
          "un algorithme de signature fondé sur les courbes elliptiques"
        ]
      },
      en: {
        title: "Shor's factoring algorithm",
        summary: "Understand why factoring becomes tractable and what that threatens in cryptography.",
        goals: [
          "Say which mathematical structure the algorithm exploits.",
          "Explain which cryptographic systems are affected."
        ],
        tutor:
          "Have the student explain which periodic property the algorithm exploits, then ask which cryptographic systems are really threatened.",
        contexts: [
          "a public key based on a product of two large numbers",
          "a message encrypted today and stored for later",
          "a signature algorithm based on elliptic curves"
        ]
      }
    },
    {
      key: "quantum_noise",
      objectives: ["quantum_computing"],
      stage: 4,
      fr: {
        title: "Le bruit et la fidélité des portes",
        summary: "Comprendre l'accumulation des erreurs le long d'un circuit et la profondeur utile qui en résulte.",
        goals: [
          "Estimer la fidélité d'un circuit à partir de celle de ses portes.",
          "Dire ce qui limite la profondeur d'un circuit exécutable."
        ],
        tutor:
          "Fais estimer la fidélité d'un circuit de cent portes à 99,9 % chacune, puis demande ce que cela impose sur la taille des algorithmes.",
        contexts: [
          "un circuit de cent portes successives",
          "une porte fidèle à 99,9 %",
          "un temps de cohérence de cent microsecondes"
        ]
      },
      en: {
        title: "Noise and gate fidelity",
        summary: "Understand how errors accumulate along a circuit and the usable depth that results.",
        goals: [
          "Estimate a circuit's fidelity from its gate fidelity.",
          "Say what limits the depth of an executable circuit."
        ],
        tutor:
          "Have the student estimate the fidelity of a hundred-gate circuit at 99.9% each, then ask what that imposes on algorithm size.",
        contexts: [
          "a circuit of a hundred successive gates",
          "a gate with 99.9% fidelity",
          "a coherence time of a hundred microseconds"
        ]
      }
    },
    {
      key: "quantum_error_correction",
      objectives: ["quantum_computing"],
      stage: 4,
      fr: {
        title: "La correction d'erreur quantique",
        summary: "Comprendre l'encodage d'un qubit logique sur de nombreux qubits physiques et son coût.",
        goals: [
          "Expliquer pourquoi on ne peut pas simplement copier un qubit.",
          "Estimer le coût en qubits physiques d'un qubit logique."
        ],
        tutor:
          "Fais expliquer pourquoi la copie d'un qubit est impossible, puis demande comment on détecte une erreur sans lire l'information.",
        contexts: [
          "un qubit logique porté par mille qubits physiques",
          "une erreur détectée sans lire la valeur encodée",
          "une machine annoncée avec un million de qubits physiques"
        ]
      },
      en: {
        title: "Quantum error correction",
        summary: "Understand encoding a logical qubit across many physical qubits and its cost.",
        goals: [
          "Explain why a qubit cannot simply be copied.",
          "Estimate the physical qubit cost of one logical qubit."
        ],
        tutor:
          "Have the student explain why copying a qubit is impossible, then ask how an error is detected without reading the information.",
        contexts: [
          "a logical qubit carried by a thousand physical qubits",
          "an error detected without reading the encoded value",
          "a machine announced with a million physical qubits"
        ]
      }
    },
    {
      key: "hardware_platforms",
      objectives: ["quantum_computing"],
      stage: 5,
      fr: {
        title: "Les plateformes matérielles comparées",
        summary: "Comparer supraconducteurs, ions piégés et photons sur la vitesse, la fidélité et la connectivité.",
        goals: [
          "Comparer deux plateformes sur trois critères techniques.",
          "Dire pourquoi aucune ne domine sur tous les critères."
        ],
        tutor:
          "Fais comparer deux plateformes sur vitesse, fidélité et connectivité, puis demande laquelle conviendrait à un algorithme profond.",
        contexts: [
          "des qubits supraconducteurs refroidis au millikelvin",
          "des ions piégés manipulés par laser",
          "un processeur photonique fonctionnant à température ambiante"
        ]
      },
      en: {
        title: "Hardware platforms compared",
        summary: "Compare superconductors, trapped ions and photons on speed, fidelity and connectivity.",
        goals: [
          "Compare two platforms on three technical criteria.",
          "Say why none dominates on every criterion."
        ],
        tutor:
          "Have the student compare two platforms on speed, fidelity and connectivity, then ask which suits a deep algorithm.",
        contexts: [
          "superconducting qubits cooled to millikelvin",
          "trapped ions manipulated by laser",
          "a photonic processor working at room temperature"
        ]
      }
    },
    {
      key: "quantum_advantage",
      objectives: ["quantum_computing"],
      stage: 5,
      fr: {
        title: "Ce que signifie un avantage quantique",
        summary: "Distinguer une démonstration sur une tâche artificielle d'un gain sur un problème utile.",
        goals: [
          "Dire ce qu'une démonstration d'avantage établit exactement.",
          "Citer ce qu'il faudrait pour parler d'utilité industrielle."
        ],
        tutor:
          "Fais critiquer une annonce d'avantage quantique, puis demande quelles conditions manquent pour parler d'utilité réelle.",
        contexts: [
          "un échantillonnage sans application connue",
          "un algorithme classique amélioré après l'annonce",
          "un problème industriel de planification"
        ]
      },
      en: {
        title: "What quantum advantage means",
        summary: "Tell apart a demonstration on an artificial task and a gain on a useful problem.",
        goals: [
          "Say what an advantage demonstration actually establishes.",
          "Name what would be needed to claim industrial usefulness."
        ],
        tutor:
          "Have the student critique a quantum advantage announcement, then ask which conditions are missing to claim real usefulness.",
        contexts: [
          "a sampling task with no known application",
          "a classical algorithm improved after the announcement",
          "an industrial scheduling problem"
        ]
      }
    },
    {
      key: "variational_algorithms",
      objectives: ["quantum_computing"],
      stage: 5,
      fr: {
        title: "Les algorithmes hybrides variationnels",
        summary: "Comprendre la boucle entre un circuit court paramétré et un optimiseur classique.",
        goals: [
          "Décrire un tour complet de la boucle hybride.",
          "Dire pourquoi cette approche convient aux machines bruitées."
        ],
        tutor:
          "Fais décrire un tour complet de la boucle hybride, puis demande pourquoi des circuits courts sont préférés sur les machines actuelles.",
        contexts: [
          "un calcul d'énergie d'une petite molécule",
          "un optimiseur classique qui ajuste des paramètres",
          "un circuit volontairement court pour limiter le bruit"
        ]
      },
      en: {
        title: "Hybrid variational algorithms",
        summary: "Understand the loop between a short parameterised circuit and a classical optimiser.",
        goals: [
          "Describe one full turn of the hybrid loop.",
          "Say why this approach suits noisy machines."
        ],
        tutor:
          "Have the student describe one full turn of the hybrid loop, then ask why short circuits are preferred on today's machines.",
        contexts: [
          "an energy computation for a small molecule",
          "a classical optimiser adjusting parameters",
          "a deliberately short circuit to limit noise"
        ]
      }
    },
    {
      key: "post_quantum_migration",
      objectives: ["quantum_computing"],
      stage: 5,
      fr: {
        title: "Ce que la cryptographie doit changer",
        summary: "Planifier une migration cryptographique en tenant compte des données déjà interceptées.",
        goals: [
          "Expliquer la menace « récolter maintenant, déchiffrer plus tard ».",
          "Ordonner les systèmes à migrer par urgence."
        ],
        tutor:
          "Fais classer trois systèmes par urgence de migration, puis demande pourquoi la durée de confidentialité des données est le critère décisif.",
        contexts: [
          "un dossier médical à protéger trente ans",
          "un jeton de session valable dix minutes",
          "un trafic chiffré enregistré aujourd'hui pour plus tard"
        ]
      },
      en: {
        title: "What cryptography must change",
        summary: "Plan a cryptographic migration accounting for data already intercepted.",
        goals: [
          "Explain the “harvest now, decrypt later” threat.",
          "Rank systems to migrate by urgency."
        ],
        tutor:
          "Have the student rank three systems by migration urgency, then ask why the data's confidentiality lifetime is the decisive criterion.",
        contexts: [
          "a medical record to protect for thirty years",
          "a session token valid for ten minutes",
          "encrypted traffic recorded today for later"
        ]
      }
    }
  ]
};
