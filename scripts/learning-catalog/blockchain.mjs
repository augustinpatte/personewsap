// Blockchain concepts.
// Shared base: 9 steps eligible for the three orientations.
// blockchain_foundations: cryptography, peer-to-peer networks, consensus, Bitcoin.
// blockchain_ecosystem: Ethereum, tokens, stablecoins, decentralized finance, risk.
// blockchain_building: smart contracts, tooling, testing, security.
export const domain = {
  id: "blockchain",
  objectives: ["blockchain_foundations", "blockchain_ecosystem", "blockchain_building"],
  steps: [
    {
      key: "double_spend_problem",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Le problème de la double dépense",
        summary: "Comprendre pourquoi un fichier monétaire copiable exige un ordre commun accepté par tous.",
        goals: [
          "Expliquer pourquoi une monnaie numérique se copie trivialement.",
          "Dire ce qu'un registre partagé résout que la copie ne résout pas."
        ],
        tutor:
          "Fais raconter ce qui se passe si le même euro numérique est envoyé à deux marchands en même temps, puis demande ce qui doit être partagé pour l'empêcher.",
        contexts: [
          "le même paiement envoyé à deux marchands",
          "un fichier de monnaie dupliqué par copier-coller",
          "un chèque encaissé deux fois dans deux agences"
        ]
      },
      en: {
        title: "The double-spending problem",
        summary: "Understand why copyable digital money requires one shared order everyone accepts.",
        goals: [
          "Explain why digital money is trivially copied.",
          "Say what a shared ledger solves that copying does not."
        ],
        tutor:
          "Have the student narrate the same digital euro sent to two merchants at once, then ask what must be shared to prevent it.",
        contexts: [
          "the same payment sent to two merchants",
          "a money file duplicated by copy and paste",
          "a cheque cashed twice in two branches"
        ]
      }
    },
    {
      key: "hash_function_basics",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Ce que fait une fonction de hachage",
        summary: "Comprendre l'empreinte de taille fixe, sa sensibilité au moindre changement et son irréversibilité.",
        goals: [
          "Citer trois propriétés attendues d'une fonction de hachage.",
          "Expliquer pourquoi on ne retrouve pas le document à partir de son empreinte."
        ],
        tutor:
          "Fais prédire l'effet d'une virgule ajoutée dans un contrat sur son empreinte, puis demande pourquoi l'inverse est impossible.",
        contexts: [
          "un contrat dont on veut prouver qu'il n'a pas bougé",
          "un mot de passe stocké sous forme d'empreinte",
          "une somme de contrôle affichée à côté d'un téléchargement"
        ]
      },
      en: {
        title: "What a hash function does",
        summary: "Understand the fixed-size fingerprint, its sensitivity to any change and its irreversibility.",
        goals: [
          "State three expected properties of a hash function.",
          "Explain why the document cannot be recovered from its fingerprint."
        ],
        tutor:
          "Have the student predict the effect of one added comma in a contract on its fingerprint, then ask why the inverse is impossible.",
        contexts: [
          "a contract you want to prove unchanged",
          "a password stored as a fingerprint",
          "a checksum shown next to a download"
        ]
      }
    },
    {
      key: "blocks_and_chain",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Comment des blocs forment une chaîne",
        summary: "Voir que chaque bloc contient l'empreinte du précédent et que modifier le passé casse toute la suite.",
        goals: [
          "Décrire ce qu'un bloc contient en plus des transactions.",
          "Expliquer pourquoi modifier un bloc ancien invalide les suivants."
        ],
        tutor:
          "Fais modifier une transaction dans un bloc ancien de la chaîne dessinée, puis demande quels blocs deviennent invalides et pourquoi.",
        contexts: [
          "une transaction modifiée dix blocs en arrière",
          "un registre comptable dont chaque page référence la précédente",
          "un historique consulté par un nouvel arrivant sur le réseau"
        ]
      },
      en: {
        title: "How blocks form a chain",
        summary: "See that each block carries the previous block's hash, so changing the past breaks everything after.",
        goals: [
          "Describe what a block holds besides transactions.",
          "Explain why editing an old block invalidates the later ones."
        ],
        tutor:
          "Have the student edit a transaction ten blocks back in the drawn chain, then ask which blocks become invalid and why.",
        contexts: [
          "a transaction edited ten blocks back",
          "an accounting ledger where each page references the previous one",
          "a history checked by a newcomer joining the network"
        ]
      }
    },
    {
      key: "keys_and_signatures",
      objectives: "*",
      stage: 1,
      fr: {
        title: "Clé publique, clé privée et signature",
        summary: "Comprendre qu'une signature prouve la possession d'une clé sans jamais la révéler.",
        goals: [
          "Dire ce qui se partage et ce qui ne se partage jamais.",
          "Expliquer ce qu'une signature valide prouve exactement."
        ],
        tutor:
          "Fais expliquer ce qu'une signature prouve et ce qu'elle ne prouve pas, puis demande ce qui se passe si la clé privée est copiée.",
        contexts: [
          "une transaction signée depuis un téléphone",
          "une adresse publiée pour recevoir un paiement",
          "une clé privée photographiée par erreur"
        ]
      },
      en: {
        title: "Public key, private key and signature",
        summary: "Understand that a signature proves possession of a key without ever revealing it.",
        goals: [
          "Say what is shared and what is never shared.",
          "Explain exactly what a valid signature proves."
        ],
        tutor:
          "Have the student explain what a signature proves and does not prove, then ask what happens if the private key is copied.",
        contexts: [
          "a transaction signed from a phone",
          "an address published to receive a payment",
          "a private key photographed by mistake"
        ]
      }
    },
    {
      key: "wallet_contents",
      objectives: "*",
      stage: 1,
      safety: "financial_educational",
      fr: {
        title: "Ce qu'un portefeuille contient vraiment",
        summary: "Comprendre qu'un portefeuille stocke des clés et non des jetons, qui restent inscrits sur la chaîne.",
        goals: [
          "Dire où sont réellement les avoirs quand un portefeuille est réinstallé.",
          "Expliquer le rôle d'une phrase de récupération."
        ],
        tutor:
          "Fais expliquer ce qu'un utilisateur récupère en réinstallant son portefeuille avec sa phrase, puis demande ce qu'il perd définitivement sans elle.",
        contexts: [
          "un téléphone perdu avec le portefeuille installé",
          "une phrase de récupération notée sur papier",
          "un portefeuille réinstallé sur un nouvel appareil"
        ]
      },
      en: {
        title: "What a wallet actually holds",
        summary: "Understand that a wallet stores keys, not coins, which stay recorded on the chain.",
        goals: [
          "Say where the holdings really are when a wallet is reinstalled.",
          "Explain the role of a recovery phrase."
        ],
        tutor:
          "Have the student explain what a user recovers by reinstalling a wallet with the phrase, then ask what is lost forever without it.",
        contexts: [
          "a lost phone with the wallet installed",
          "a recovery phrase written on paper",
          "a wallet reinstalled on a new device"
        ]
      }
    },
    {
      key: "transaction_lifecycle",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Le cycle de vie d'une transaction",
        summary: "Suivre une transaction de la signature à la confirmation en passant par la file d'attente du réseau.",
        goals: [
          "Ordonner signature, diffusion, sélection, inclusion, confirmation.",
          "Expliquer pourquoi une transaction peut rester en attente."
        ],
        tutor:
          "Fais suivre une transaction jusqu'à sa confirmation, puis demande pourquoi une transaction sous-payée peut rester bloquée des heures.",
        contexts: [
          "un paiement en attente depuis vingt minutes",
          "un pic d'activité qui allonge la file",
          "un transfert confirmé après quelques blocs"
        ]
      },
      en: {
        title: "The life cycle of a transaction",
        summary: "Follow a transaction from signature to confirmation through the network's waiting pool.",
        goals: [
          "Order signing, broadcast, selection, inclusion and confirmation.",
          "Explain why a transaction can stay pending."
        ],
        tutor:
          "Have the student follow a transaction to confirmation, then ask why an underpriced transaction can stay stuck for hours.",
        contexts: [
          "a payment pending for twenty minutes",
          "an activity spike lengthening the queue",
          "a transfer confirmed after a few blocks"
        ]
      }
    },
    {
      key: "decentralization_tradeoffs",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Ce que la décentralisation coûte",
        summary: "Comparer une base de données classique et une chaîne publique sur le débit, le coût et la confiance requise.",
        goals: [
          "Comparer débit et coût entre les deux architectures.",
          "Nommer le problème qui justifie de payer ce surcoût."
        ],
        tutor:
          "Fais comparer le nombre de transactions par seconde d'une carte bancaire et d'une chaîne publique, puis demande quel problème justifie l'écart.",
        contexts: [
          "un réseau de cartes bancaires à des milliers d'opérations par seconde",
          "un registre foncier tenu par une administration",
          "un transfert international entre deux inconnus"
        ]
      },
      en: {
        title: "What decentralisation costs",
        summary: "Compare a classic database and a public chain on throughput, cost and required trust.",
        goals: [
          "Compare throughput and cost across the two architectures.",
          "Name the problem that justifies paying that overhead."
        ],
        tutor:
          "Have the student compare transactions per second of a card network and of a public chain, then ask which problem justifies the gap.",
        contexts: [
          "a card network at thousands of operations per second",
          "a land registry kept by a public administration",
          "an international transfer between two strangers"
        ]
      }
    },
    {
      key: "immutability_finality",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Immutabilité et finalité : quand une transaction est-elle définitive",
        summary: "Distinguer une transaction incluse dans un bloc d'une transaction que le réseau ne peut plus annuler.",
        goals: [
          "Expliquer pourquoi on attend plusieurs confirmations.",
          "Dire ce que change une finalité garantie par le protocole."
        ],
        tutor:
          "Fais choisir le nombre de confirmations à attendre pour livrer une marchandise, puis demande ce qui justifie ce choix.",
        contexts: [
          "un marchand qui livre après une seule confirmation",
          "un échange qui exige trente confirmations pour un retrait",
          "un bloc abandonné après une réorganisation"
        ]
      },
      en: {
        title: "Immutability and finality: when is a transaction definitive",
        summary: "Tell apart a transaction included in a block and a transaction the network can no longer undo.",
        goals: [
          "Explain why several confirmations are awaited.",
          "Say what protocol-guaranteed finality changes."
        ],
        tutor:
          "Have the student choose how many confirmations to wait before shipping goods, then ask what justifies that choice.",
        contexts: [
          "a merchant shipping after a single confirmation",
          "an exchange requiring thirty confirmations for a withdrawal",
          "a block dropped after a reorganisation"
        ]
      }
    },
    {
      key: "public_private_chains",
      objectives: "*",
      stage: 2,
      fr: {
        title: "Chaîne publique, chaîne privée, chaîne de consortium",
        summary: "Choisir le modèle d'accès selon qui doit pouvoir lire, écrire et valider.",
        goals: [
          "Comparer les trois modèles sur les droits de lecture et de validation.",
          "Dire quand une base classique reste préférable."
        ],
        tutor:
          "Fais choisir le modèle adapté à une traçabilité alimentaire entre cinq entreprises, puis demande pourquoi une base partagée ne suffisait pas.",
        contexts: [
          "une traçabilité alimentaire entre cinq industriels",
          "un registre interne à une seule banque",
          "un réseau ouvert à n'importe quel participant"
        ]
      },
      en: {
        title: "Public, private and consortium chains",
        summary: "Choose the access model based on who must be able to read, write and validate.",
        goals: [
          "Compare the three models on read and validation rights.",
          "Say when a classic database is still preferable."
        ],
        tutor:
          "Have the student choose the model for food traceability across five companies, then ask why a shared database was not enough.",
        contexts: [
          "food traceability across five manufacturers",
          "a ledger internal to a single bank",
          "a network open to any participant"
        ]
      }
    },

    {
      key: "peer_to_peer_propagation",
      objectives: ["blockchain_foundations"],
      stage: 1,
      fr: {
        title: "Comment les nœuds propagent l'information",
        summary: "Comprendre la diffusion de proche en proche et l'absence de serveur central de référence.",
        goals: [
          "Décrire le trajet d'une transaction diffusée sur le réseau.",
          "Expliquer comment un nouveau nœud rattrape l'historique."
        ],
        tutor:
          "Fais décrire la diffusion d'une transaction depuis un seul nœud, puis demande comment un nœud éteint depuis un mois se remet à jour.",
        contexts: [
          "un nœud rallumé après un mois d'arrêt",
          "une transaction émise depuis un pays isolé",
          "deux régions du réseau temporairement coupées"
        ]
      },
      en: {
        title: "How nodes propagate information",
        summary: "Understand neighbour-to-neighbour broadcast and the absence of a central reference server.",
        goals: [
          "Describe the path of a transaction broadcast on the network.",
          "Explain how a new node catches up with history."
        ],
        tutor:
          "Have the student describe broadcast from a single node, then ask how a node offline for a month gets back up to date.",
        contexts: [
          "a node restarted after a month offline",
          "a transaction sent from an isolated country",
          "two network regions temporarily cut off"
        ]
      }
    },
    {
      key: "proof_of_work",
      objectives: ["blockchain_foundations"],
      stage: 2,
      fr: {
        title: "La preuve de travail",
        summary: "Comprendre pourquoi un calcul coûteux et facilement vérifiable protège l'ordre des blocs.",
        goals: [
          "Expliquer l'asymétrie entre produire et vérifier une preuve.",
          "Dire ce qu'un attaquant devrait dépenser pour réécrire l'histoire."
        ],
        tutor:
          "Fais expliquer pourquoi trouver un nonce est long et le vérifier est immédiat, puis demande le coût d'une réécriture de dix blocs.",
        contexts: [
          "un mineur qui teste des milliards de nonces",
          "un nœud qui vérifie un bloc reçu en une milliseconde",
          "une tentative de réécrire les dix derniers blocs"
        ]
      },
      en: {
        title: "Proof of work",
        summary: "Understand why an expensive but easily verified computation protects the order of blocks.",
        goals: [
          "Explain the asymmetry between producing and verifying a proof.",
          "Say what an attacker would have to spend to rewrite history."
        ],
        tutor:
          "Have the student explain why finding a nonce is slow while checking it is instant, then ask the cost of rewriting ten blocks.",
        contexts: [
          "a miner testing billions of nonces",
          "a node verifying a received block in a millisecond",
          "an attempt to rewrite the last ten blocks"
        ]
      }
    },
    {
      key: "mining_difficulty",
      objectives: ["blockchain_foundations"],
      stage: 2,
      fr: {
        title: "L'ajustement de difficulté",
        summary: "Comprendre la boucle de rétroaction qui maintient un intervalle de blocs stable malgré la puissance ajoutée.",
        goals: [
          "Expliquer ce qui déclenche une hausse de difficulté.",
          "Prévoir l'effet du départ soudain de la moitié des mineurs."
        ],
        tutor:
          "Fais prévoir l'intervalle entre blocs si la puissance double sans ajustement, puis demande ce que corrige le prochain recalcul.",
        contexts: [
          "une vague de nouvelles machines mises en service",
          "la moitié des mineurs déconnectés en une semaine",
          "un intervalle moyen visé de dix minutes"
        ]
      },
      en: {
        title: "Difficulty adjustment",
        summary: "Understand the feedback loop keeping block intervals stable despite added computing power.",
        goals: [
          "Explain what triggers a difficulty increase.",
          "Predict the effect of half the miners suddenly leaving."
        ],
        tutor:
          "Have the student predict the block interval if power doubles with no adjustment, then ask what the next recalculation fixes.",
        contexts: [
          "a wave of new machines brought online",
          "half the miners disconnected within a week",
          "a target average interval of ten minutes"
        ]
      }
    },
    {
      key: "merkle_tree",
      objectives: ["blockchain_foundations"],
      stage: 3,
      fr: {
        title: "L'arbre de Merkle et la preuve d'inclusion",
        summary: "Prouver qu'une transaction est dans un bloc sans télécharger toutes les transactions du bloc.",
        goals: [
          "Décrire la construction de la racine à partir des transactions.",
          "Compter les empreintes nécessaires à une preuve d'inclusion."
        ],
        tutor:
          "Fais construire la racine d'un arbre à quatre transactions, puis demande combien d'empreintes suffisent pour prouver l'une d'elles.",
        contexts: [
          "un portefeuille mobile qui vérifie un paiement reçu",
          "un bloc contenant trois mille transactions",
          "une preuve envoyée à un client léger"
        ]
      },
      en: {
        title: "The Merkle tree and inclusion proofs",
        summary: "Prove a transaction is in a block without downloading every transaction of that block.",
        goals: [
          "Describe how the root is built from the transactions.",
          "Count the hashes needed for an inclusion proof."
        ],
        tutor:
          "Have the student build the root of a four-transaction tree, then ask how many hashes suffice to prove one of them.",
        contexts: [
          "a mobile wallet verifying a received payment",
          "a block containing three thousand transactions",
          "a proof sent to a light client"
        ]
      }
    },
    {
      key: "utxo_model",
      objectives: ["blockchain_foundations"],
      stage: 3,
      fr: {
        title: "Le modèle UTXO de Bitcoin",
        summary: "Comprendre qu'un paiement consomme des sorties entières et produit une sortie de monnaie rendue.",
        goals: [
          "Décomposer un paiement en entrées, sortie de paiement et sortie de rendu.",
          "Expliquer pourquoi un solde est une somme de sorties disponibles."
        ],
        tutor:
          "Fais construire un paiement de 0,3 à partir de deux sorties de 0,2, puis demande où va la différence.",
        contexts: [
          "un paiement de 0,3 financé par deux sorties de 0,2",
          "un solde composé de quarante petites sorties",
          "des frais qui augmentent avec le nombre d'entrées"
        ]
      },
      en: {
        title: "Bitcoin's UTXO model",
        summary: "Understand that a payment consumes whole outputs and produces a change output.",
        goals: [
          "Break a payment into inputs, payment output and change output.",
          "Explain why a balance is a sum of available outputs."
        ],
        tutor:
          "Have the student build a 0.3 payment from two 0.2 outputs, then ask where the difference goes.",
        contexts: [
          "a 0.3 payment funded by two 0.2 outputs",
          "a balance made of forty small outputs",
          "fees growing with the number of inputs"
        ]
      }
    },
    {
      key: "forks_and_reorgs",
      objectives: ["blockchain_foundations"],
      stage: 3,
      fr: {
        title: "Fourches et réorganisations de chaîne",
        summary: "Distinguer une fourche temporaire due à la latence d'une fourche durable due à une règle changée.",
        goals: [
          "Expliquer ce qui arrive aux transactions d'un bloc abandonné.",
          "Distinguer fourche logicielle et fourche matérielle."
        ],
        tutor:
          "Fais raconter ce qui arrive à une transaction incluse dans un bloc finalement abandonné, puis demande quand la fourche devient permanente.",
        contexts: [
          "deux blocs trouvés à quelques secondes d'écart",
          "un changement de règles refusé par une partie des nœuds",
          "un paiement accepté sur la branche perdante"
        ]
      },
      en: {
        title: "Forks and chain reorganisations",
        summary: "Tell apart a temporary fork caused by latency and a lasting fork caused by a rule change.",
        goals: [
          "Explain what happens to the transactions of an abandoned block.",
          "Tell apart a soft fork and a hard fork."
        ],
        tutor:
          "Have the student narrate what happens to a transaction in a block eventually abandoned, then ask when the fork becomes permanent.",
        contexts: [
          "two blocks found seconds apart",
          "a rule change rejected by part of the nodes",
          "a payment accepted on the losing branch"
        ]
      }
    },
    {
      key: "chain_selection_rule",
      objectives: ["blockchain_foundations"],
      stage: 3,
      fr: {
        title: "Pourquoi la chaîne la plus lourde l'emporte",
        summary: "Comprendre la règle de sélection qui permet à des nœuds sans coordination de converger.",
        goals: [
          "Énoncer la règle appliquée par un nœud face à deux branches.",
          "Expliquer pourquoi cette règle rend la triche coûteuse."
        ],
        tutor:
          "Fais appliquer la règle de sélection à deux branches de longueurs différentes, puis demande ce que devrait produire un attaquant pour l'emporter.",
        contexts: [
          "un nœud qui reçoit deux branches concurrentes",
          "un attaquant qui mine une branche parallèle en secret",
          "une convergence observée quelques minutes après une fourche"
        ]
      },
      en: {
        title: "Why the heaviest chain wins",
        summary: "Understand the selection rule that lets uncoordinated nodes converge.",
        goals: [
          "State the rule a node applies when facing two branches.",
          "Explain why that rule makes cheating expensive."
        ],
        tutor:
          "Have the student apply the selection rule to two branches of different length, then ask what an attacker would need to produce to win.",
        contexts: [
          "a node receiving two competing branches",
          "an attacker mining a parallel branch in secret",
          "convergence observed minutes after a fork"
        ]
      }
    },
    {
      key: "proof_of_stake",
      objectives: ["blockchain_foundations"],
      stage: 4,
      fr: {
        title: "La preuve d'enjeu et la sanction des validateurs",
        summary: "Remplacer le coût énergétique par un capital immobilisé qui peut être détruit en cas de faute.",
        goals: [
          "Expliquer ce qu'un validateur risque en signant deux blocs concurrents.",
          "Comparer les coûts d'attaque des deux mécanismes."
        ],
        tutor:
          "Fais expliquer ce que perd un validateur qui signe deux blocs contradictoires, puis demande comment le protocole le détecte.",
        contexts: [
          "un validateur qui signe deux blocs contradictoires",
          "un opérateur hors ligne pendant une journée",
          "un capital immobilisé pendant plusieurs semaines"
        ]
      },
      en: {
        title: "Proof of stake and validator penalties",
        summary: "Replace energy cost with locked capital that can be destroyed when a validator misbehaves.",
        goals: [
          "Explain what a validator risks by signing two competing blocks.",
          "Compare the attack cost of the two mechanisms."
        ],
        tutor:
          "Have the student explain what a validator loses by signing two contradictory blocks, then ask how the protocol detects it.",
        contexts: [
          "a validator signing two contradictory blocks",
          "an operator offline for a full day",
          "capital locked for several weeks"
        ]
      }
    },
    {
      key: "byzantine_faults",
      objectives: ["blockchain_foundations"],
      stage: 4,
      fr: {
        title: "Le problème des généraux byzantins",
        summary: "Formuler l'accord entre participants dont une partie peut mentir, et la limite du tiers de fautifs.",
        goals: [
          "Distinguer une panne franche d'un comportement malveillant.",
          "Citer la proportion maximale de participants fautifs tolérée."
        ],
        tutor:
          "Fais distinguer un nœud éteint d'un nœud qui envoie deux messages contradictoires, puis demande pourquoi le second est plus difficile à gérer.",
        contexts: [
          "un nœud qui envoie deux messages contradictoires",
          "un serveur simplement éteint",
          "un consortium de dix participants dont trois trichent"
        ]
      },
      en: {
        title: "The Byzantine generals problem",
        summary: "State agreement among participants where some may lie, and the one-third faulty bound.",
        goals: [
          "Tell apart a crash failure and malicious behaviour.",
          "State the maximum share of faulty participants tolerated."
        ],
        tutor:
          "Have the student distinguish a node that is off from a node sending two contradictory messages, then ask why the second is harder.",
        contexts: [
          "a node sending two contradictory messages",
          "a server that is simply switched off",
          "a ten-member consortium where three cheat"
        ]
      }
    },
    {
      key: "block_size_propagation",
      objectives: ["blockchain_foundations"],
      stage: 4,
      fr: {
        title: "Taille des blocs et propagation",
        summary: "Relier la taille d'un bloc au temps de diffusion et au risque de blocs orphelins.",
        goals: [
          "Expliquer pourquoi un bloc plus gros augmente le risque d'orphelin.",
          "Dire ce que la taille de bloc impose aux nœuds domestiques."
        ],
        tutor:
          "Fais expliquer pourquoi doubler la taille des blocs n'améliore pas proportionnellement le débit utile, puis demande qui ne peut plus suivre.",
        contexts: [
          "un bloc trop gros diffusé lentement sur le réseau",
          "un nœud domestique avec une connexion limitée",
          "un débat communautaire sur l'augmentation de la limite"
        ]
      },
      en: {
        title: "Block size and propagation",
        summary: "Connect block size to broadcast time and to the risk of orphaned blocks.",
        goals: [
          "Explain why a larger block raises the orphan risk.",
          "Say what block size imposes on home nodes."
        ],
        tutor:
          "Have the student explain why doubling block size does not proportionally improve useful throughput, then ask who can no longer keep up.",
        contexts: [
          "an oversized block spreading slowly across the network",
          "a home node on a limited connection",
          "a community debate on raising the limit"
        ]
      }
    },
    {
      key: "fee_market",
      objectives: ["blockchain_foundations"],
      stage: 4,
      safety: "financial_educational",
      fr: {
        title: "Le marché des frais de transaction",
        summary: "Comprendre l'enchère implicite pour un espace de bloc limité et l'effet d'un pic de demande.",
        goals: [
          "Expliquer comment les frais sont fixés en période de congestion.",
          "Dire ce qui remplacera la récompense de bloc à long terme."
        ],
        tutor:
          "Fais expliquer pourquoi les frais montent lors d'un pic d'activité, puis demande ce qui rémunérera les validateurs quand l'émission s'arrêtera.",
        contexts: [
          "une journée de forte congestion du réseau",
          "une transaction non urgente envoyée avec des frais bas",
          "une émission de nouvelles unités qui diminue avec le temps"
        ]
      },
      en: {
        title: "The transaction fee market",
        summary: "Understand the implicit auction for limited block space and the effect of a demand spike.",
        goals: [
          "Explain how fees are set during congestion.",
          "Say what will replace the block reward in the long run."
        ],
        tutor:
          "Have the student explain why fees rise during an activity spike, then ask what will pay validators once issuance stops.",
        contexts: [
          "a day of heavy network congestion",
          "a non-urgent transaction sent with low fees",
          "an issuance of new units decreasing over time"
        ]
      }
    },
    {
      key: "light_clients",
      objectives: ["blockchain_foundations"],
      stage: 5,
      fr: {
        title: "Clients légers et preuves de vérification",
        summary: "Comprendre ce qu'un client léger vérifie réellement et la confiance résiduelle qu'il accorde.",
        goals: [
          "Comparer ce que vérifie un nœud complet et un client léger.",
          "Citer une hypothèse de confiance propre au client léger."
        ],
        tutor:
          "Fais comparer les vérifications d'un nœud complet et d'un portefeuille mobile, puis demande ce que le second croit sans le vérifier.",
        contexts: [
          "un portefeuille mobile de 30 mégaoctets",
          "un nœud complet stockant l'historique entier",
          "une preuve d'inclusion reçue d'un serveur tiers"
        ]
      },
      en: {
        title: "Light clients and verification proofs",
        summary: "Understand what a light client really verifies and the residual trust it grants.",
        goals: [
          "Compare what a full node and a light client verify.",
          "Name a trust assumption specific to light clients."
        ],
        tutor:
          "Have the student compare the checks of a full node and a mobile wallet, then ask what the latter believes without verifying.",
        contexts: [
          "a 30-megabyte mobile wallet",
          "a full node storing the entire history",
          "an inclusion proof received from a third-party server"
        ]
      }
    },
    {
      key: "transaction_ordering_value",
      objectives: ["blockchain_foundations"],
      stage: 5,
      safety: "financial_educational",
      fr: {
        title: "L'ordonnancement des transactions et la valeur extractible",
        summary: "Comprendre pourquoi le pouvoir d'ordonner les transactions d'un bloc a une valeur économique.",
        goals: [
          "Expliquer pourquoi l'ordre dans un bloc n'est pas neutre.",
          "Citer une protection utilisateur contre un mauvais prix d'exécution."
        ],
        tutor:
          "Fais expliquer ce que rapporte le choix de l'ordre des transactions dans un bloc, puis demande quel réglage protège un utilisateur ordinaire.",
        contexts: [
          "un ordre d'échange visible dans la file d'attente",
          "un prix d'exécution moins bon que prévu",
          "une tolérance de glissement réglée par l'utilisateur"
        ]
      },
      en: {
        title: "Transaction ordering and extractable value",
        summary: "Understand why the power to order transactions inside a block carries economic value.",
        goals: [
          "Explain why order inside a block is not neutral.",
          "Name a user protection against a poor execution price."
        ],
        tutor:
          "Have the student explain what choosing the order of transactions in a block earns, then ask which setting protects an ordinary user.",
        contexts: [
          "a trade order visible in the waiting pool",
          "an execution price worse than expected",
          "a slippage tolerance set by the user"
        ]
      }
    },
    {
      key: "post_quantum_signatures",
      objectives: ["blockchain_foundations"],
      stage: 5,
      fr: {
        title: "Ce qu'un ordinateur quantique menacerait",
        summary: "Distinguer la menace sur les signatures de la menace bien plus faible sur les fonctions de hachage.",
        goals: [
          "Dire quelle brique cryptographique serait la plus exposée.",
          "Expliquer pourquoi une adresse jamais dépensée est moins exposée."
        ],
        tutor:
          "Fais comparer l'exposition des signatures et du hachage, puis demande pourquoi une adresse dont la clé publique n'a jamais été révélée est plus sûre.",
        contexts: [
          "une adresse dont la clé publique est apparue lors d'une dépense",
          "un projet qui prépare une migration cryptographique",
          "un fonds inactif depuis dix ans"
        ]
      },
      en: {
        title: "What a quantum computer would threaten",
        summary: "Separate the threat to signatures from the much weaker threat to hash functions.",
        goals: [
          "Say which cryptographic building block would be most exposed.",
          "Explain why a never-spent address is less exposed."
        ],
        tutor:
          "Have the student compare the exposure of signatures and hashing, then ask why an address whose public key was never revealed is safer.",
        contexts: [
          "an address whose public key appeared when spending",
          "a project preparing a cryptographic migration",
          "a fund untouched for ten years"
        ]
      }
    },
    {
      key: "pseudonymity_analysis",
      objectives: ["blockchain_foundations"],
      stage: 5,
      fr: {
        title: "Pseudonymat et analyse de chaîne",
        summary: "Comprendre pourquoi un registre public permet de relier des adresses à une même personne.",
        goals: [
          "Expliquer la différence entre anonymat et pseudonymat.",
          "Citer deux comportements qui relient des adresses entre elles."
        ],
        tutor:
          "Fais expliquer comment deux adresses se retrouvent liées par une même transaction, puis demande ce qu'un point d'entrée réglementé ajoute à l'analyse.",
        contexts: [
          "deux adresses dépensées ensemble dans une transaction",
          "un retrait vers une plateforme qui vérifie l'identité",
          "une adresse publiée sur un profil public"
        ]
      },
      en: {
        title: "Pseudonymity and chain analysis",
        summary: "Understand why a public ledger allows linking addresses to the same person.",
        goals: [
          "Explain the difference between anonymity and pseudonymity.",
          "Name two behaviours that link addresses together."
        ],
        tutor:
          "Have the student explain how two addresses become linked by one transaction, then ask what a regulated entry point adds to the analysis.",
        contexts: [
          "two addresses spent together in one transaction",
          "a withdrawal to a platform verifying identity",
          "an address published on a public profile"
        ]
      }
    },

    {
      key: "ethereum_vs_bitcoin",
      objectives: ["blockchain_ecosystem"],
      stage: 1,
      fr: {
        title: "Ce qu'Ethereum ajoute à Bitcoin",
        summary: "Passer d'un registre de paiements à une machine qui exécute du code partagé par tous les nœuds.",
        goals: [
          "Comparer les deux réseaux sur ce qu'un utilisateur peut y publier.",
          "Citer une application impossible sur un registre de paiements seul."
        ],
        tutor:
          "Fais comparer ce que chaque réseau permet de publier, puis demande une application qui exige un programme sur la chaîne.",
        contexts: [
          "un paiement simple entre deux adresses",
          "une vente aux enchères automatisée sans intermédiaire",
          "un jeton créé par une équipe en quelques lignes de code"
        ]
      },
      en: {
        title: "What Ethereum adds to Bitcoin",
        summary: "Move from a payment ledger to a machine that executes code shared by every node.",
        goals: [
          "Compare the two networks on what a user can publish.",
          "Name an application impossible on a payment-only ledger."
        ],
        tutor:
          "Have the student compare what each network lets you publish, then ask for an application requiring an on-chain program.",
        contexts: [
          "a simple payment between two addresses",
          "an automated auction with no intermediary",
          "a token created by a team in a few lines of code"
        ]
      }
    },
    {
      key: "gas_and_fees",
      objectives: ["blockchain_ecosystem"],
      stage: 2,
      safety: "financial_educational",
      fr: {
        title: "Le gas : payer le calcul",
        summary: "Comprendre qu'une exécution est facturée à l'opération et qu'une limite protège le réseau.",
        goals: [
          "Distinguer quantité de gas et prix du gas.",
          "Expliquer ce qui se passe quand la limite est atteinte en cours d'exécution."
        ],
        tutor:
          "Fais comparer le coût d'un transfert simple et d'une opération complexe, puis demande ce que paie l'utilisateur si l'exécution échoue.",
        contexts: [
          "un transfert simple comparé à un échange automatisé",
          "une transaction qui échoue après avoir consommé du gas",
          "une limite fixée trop basse par un portefeuille"
        ]
      },
      en: {
        title: "Gas: paying for computation",
        summary: "Understand that execution is billed per operation and that a limit protects the network.",
        goals: [
          "Tell apart gas amount and gas price.",
          "Explain what happens when the limit is hit mid-execution."
        ],
        tutor:
          "Have the student compare the cost of a simple transfer and a complex operation, then ask what the user pays when execution fails.",
        contexts: [
          "a simple transfer compared with an automated swap",
          "a transaction failing after consuming gas",
          "a limit set too low by a wallet"
        ]
      }
    },
    {
      key: "token_standards",
      objectives: ["blockchain_ecosystem"],
      stage: 2,
      fr: {
        title: "Ce qu'est un standard de jeton",
        summary: "Comprendre qu'un standard est une interface commune qui rend un jeton compatible avec tout l'écosystème.",
        goals: [
          "Citer les fonctions attendues d'un jeton fongible.",
          "Distinguer un jeton fongible d'un jeton non fongible."
        ],
        tutor:
          "Fais lister les fonctions qu'un portefeuille attend d'un jeton, puis demande ce qui casse si l'une d'elles est renommée.",
        contexts: [
          "un jeton affiché automatiquement par un portefeuille",
          "un billet de concert unique et nominatif",
          "un jeton dont une fonction ne respecte pas le standard"
        ]
      },
      en: {
        title: "What a token standard is",
        summary: "Understand that a standard is a shared interface making a token compatible with the ecosystem.",
        goals: [
          "List the functions expected from a fungible token.",
          "Tell apart a fungible and a non-fungible token."
        ],
        tutor:
          "Have the student list the functions a wallet expects from a token, then ask what breaks if one of them is renamed.",
        contexts: [
          "a token displayed automatically by a wallet",
          "a unique named concert ticket",
          "a token whose function departs from the standard"
        ]
      }
    },
    {
      key: "stablecoins",
      objectives: ["blockchain_ecosystem"],
      stage: 3,
      safety: "financial_educational",
      fr: {
        title: "Comment un stablecoin tient sa parité",
        summary: "Comparer réserve centralisée, surcollatéralisation et mécanisme algorithmique sur la solidité de la parité.",
        goals: [
          "Comparer trois mécanismes de stabilisation sur leur point de rupture.",
          "Dire ce qu'un utilisateur doit vérifier avant d'y placer de la valeur."
        ],
        tutor:
          "Fais comparer trois mécanismes de parité, puis demande lequel casse en premier lors d'une chute brutale des marchés.",
        contexts: [
          "une réserve bancaire auditée trimestriellement",
          "une position surcollatéralisée liquidée pendant une chute",
          "une parité perdue pendant plusieurs jours"
        ]
      },
      en: {
        title: "How a stablecoin holds its peg",
        summary: "Compare centralised reserves, over-collateralisation and algorithmic designs on peg robustness.",
        goals: [
          "Compare three stabilisation mechanisms on their breaking point.",
          "Say what a user should check before storing value there."
        ],
        tutor:
          "Have the student compare three peg mechanisms, then ask which breaks first during a sharp market drop.",
        contexts: [
          "a bank reserve audited quarterly",
          "an over-collateralised position liquidated during a crash",
          "a peg lost for several days"
        ]
      }
    },
    {
      key: "automated_market_makers",
      objectives: ["blockchain_ecosystem"],
      stage: 3,
      safety: "financial_educational",
      fr: {
        title: "Les teneurs de marché automatisés",
        summary: "Comprendre comment une réserve de deux actifs fixe un prix sans carnet d'ordres.",
        goals: [
          "Expliquer comment le prix évolue quand un échange vide une réserve.",
          "Dire pourquoi un gros ordre subit un prix dégradé."
        ],
        tutor:
          "Fais calculer l'effet d'un échange important sur une réserve de deux actifs, puis demande pourquoi le prix obtenu s'écarte du prix affiché.",
        contexts: [
          "un échange de deux jetons dans une réserve commune",
          "un ordre important passé sur une petite réserve",
          "un prix affiché différent du prix finalement obtenu"
        ]
      },
      en: {
        title: "Automated market makers",
        summary: "Understand how a two-asset pool sets a price without an order book.",
        goals: [
          "Explain how the price moves when a swap drains one side of the pool.",
          "Say why a large order gets a degraded price."
        ],
        tutor:
          "Have the student compute the effect of a large swap on a two-asset pool, then ask why the obtained price departs from the quoted one.",
        contexts: [
          "a swap of two tokens in a shared pool",
          "a large order placed against a small pool",
          "a quoted price differing from the executed price"
        ]
      }
    },
    {
      key: "lending_and_liquidation",
      objectives: ["blockchain_ecosystem"],
      stage: 3,
      safety: "financial_educational",
      fr: {
        title: "Prêt collatéralisé et liquidation",
        summary: "Comprendre le seuil de liquidation et pourquoi un emprunt automatisé se dénoue sans négociation.",
        goals: [
          "Calculer un ratio de collatéral et le comparer au seuil.",
          "Expliquer ce que déclenche mécaniquement le franchissement du seuil."
        ],
        tutor:
          "Fais calculer le ratio d'une position puis simuler une baisse de 30 % du collatéral, en demandant ce qui se déclenche.",
        contexts: [
          "un emprunt garanti par un actif volatil",
          "une chute de 30 % du prix du collatéral",
          "une position liquidée pendant la nuit"
        ]
      },
      en: {
        title: "Collateralised lending and liquidation",
        summary: "Understand the liquidation threshold and why an automated loan unwinds without negotiation.",
        goals: [
          "Compute a collateral ratio and compare it to the threshold.",
          "Explain what crossing the threshold mechanically triggers."
        ],
        tutor:
          "Have the student compute a position's ratio then simulate a 30% collateral drop, asking what gets triggered.",
        contexts: [
          "a loan backed by a volatile asset",
          "a 30% drop in collateral price",
          "a position liquidated overnight"
        ]
      }
    },
    {
      key: "oracles",
      objectives: ["blockchain_ecosystem"],
      stage: 3,
      fr: {
        title: "Les oracles : faire entrer une donnée externe",
        summary: "Comprendre que la chaîne ne voit pas le monde extérieur et que l'oracle devient un point de confiance.",
        goals: [
          "Expliquer pourquoi un contrat ne peut pas lire une donnée externe seul.",
          "Citer deux protections contre une donnée d'oracle manipulée."
        ],
        tutor:
          "Fais expliquer pourquoi un contrat ne peut pas connaître un prix seul, puis demande ce qui se passe si l'oracle publie une valeur fausse.",
        contexts: [
          "un contrat d'assurance déclenché par une donnée météo",
          "un prix de marché publié toutes les minutes",
          "un oracle unique qui publie une valeur aberrante"
        ]
      },
      en: {
        title: "Oracles: bringing external data in",
        summary: "Understand that the chain cannot see the outside world, making the oracle a trust point.",
        goals: [
          "Explain why a contract cannot read external data on its own.",
          "Name two protections against manipulated oracle data."
        ],
        tutor:
          "Have the student explain why a contract cannot know a price by itself, then ask what happens if the oracle publishes a wrong value.",
        contexts: [
          "an insurance contract triggered by weather data",
          "a market price published every minute",
          "a single oracle publishing an aberrant value"
        ]
      }
    },
    {
      key: "cross_chain_bridges",
      objectives: ["blockchain_ecosystem"],
      stage: 4,
      fr: {
        title: "Les ponts entre chaînes et leur risque",
        summary: "Comprendre le mécanisme de blocage et d'émission d'un actif représenté sur une autre chaîne.",
        goals: [
          "Décrire ce que représente un jeton reçu à l'arrivée d'un pont.",
          "Expliquer pourquoi les ponts concentrent le risque."
        ],
        tutor:
          "Fais décrire ce que devient l'actif d'origine pendant un transfert par pont, puis demande ce que vaut le jeton reçu si le pont est compromis.",
        contexts: [
          "un actif bloqué d'un côté et représenté de l'autre",
          "un pont détenant les avoirs de milliers d'utilisateurs",
          "un jeton représenté dont la garantie disparaît"
        ]
      },
      en: {
        title: "Cross-chain bridges and their risk",
        summary: "Understand the lock-and-mint mechanism of an asset represented on another chain.",
        goals: [
          "Describe what a token received at a bridge's destination represents.",
          "Explain why bridges concentrate risk."
        ],
        tutor:
          "Have the student describe what happens to the original asset during a bridge transfer, then ask what the received token is worth if the bridge is compromised.",
        contexts: [
          "an asset locked on one side and represented on the other",
          "a bridge holding the funds of thousands of users",
          "a wrapped token whose backing disappears"
        ]
      }
    },
    {
      key: "layer_two_rollups",
      objectives: ["blockchain_ecosystem"],
      stage: 4,
      fr: {
        title: "Les rollups de couche 2",
        summary: "Comprendre l'exécution hors chaîne dont le résultat est publié et vérifiable sur la chaîne principale.",
        goals: [
          "Expliquer d'où vient la baisse de coût d'un rollup.",
          "Comparer preuve de fraude et preuve de validité sur le délai de retrait."
        ],
        tutor:
          "Fais expliquer ce qui est réellement publié sur la chaîne principale par un rollup, puis demande pourquoi un retrait peut prendre une semaine.",
        contexts: [
          "un paiement à quelques centimes de frais",
          "un retrait vers la chaîne principale différé d'une semaine",
          "un opérateur de rollup temporairement indisponible"
        ]
      },
      en: {
        title: "Layer 2 rollups",
        summary: "Understand off-chain execution whose result is published and verifiable on the main chain.",
        goals: [
          "Explain where a rollup's cost reduction comes from.",
          "Compare fraud proofs and validity proofs on withdrawal delay."
        ],
        tutor:
          "Have the student explain what a rollup actually publishes on the main chain, then ask why a withdrawal can take a week.",
        contexts: [
          "a payment costing a few cents in fees",
          "a withdrawal to the main chain delayed by a week",
          "a rollup operator temporarily unavailable"
        ]
      }
    },
    {
      key: "token_governance",
      objectives: ["blockchain_ecosystem"],
      stage: 4,
      fr: {
        title: "La gouvernance par jeton",
        summary: "Analyser un vote pondéré par les avoirs et les effets de concentration qu'il produit.",
        goals: [
          "Expliquer ce qu'un vote pondéré par les avoirs favorise.",
          "Citer un mécanisme qui limite la capture d'une décision."
        ],
        tutor:
          "Fais analyser un vote où trois détenteurs pèsent 60 %, puis demande quel mécanisme réduirait ce déséquilibre.",
        contexts: [
          "une proposition adoptée par trois grands détenteurs",
          "un quorum jamais atteint sur les petits votes",
          "un délai obligatoire avant application d'une décision"
        ]
      },
      en: {
        title: "Token-based governance",
        summary: "Analyse holdings-weighted voting and the concentration effects it produces.",
        goals: [
          "Explain what holdings-weighted voting favours.",
          "Name a mechanism limiting capture of a decision."
        ],
        tutor:
          "Have the student analyse a vote where three holders carry 60%, then ask which mechanism would reduce that imbalance.",
        contexts: [
          "a proposal passed by three large holders",
          "a quorum never reached on small votes",
          "a mandatory delay before a decision takes effect"
        ]
      }
    },
    {
      key: "custody_models",
      objectives: ["blockchain_ecosystem"],
      stage: 4,
      safety: "financial_educational",
      fr: {
        title: "Garde des clés : autogarde ou dépositaire",
        summary: "Comparer les modèles de garde sur le risque de perte, le risque de faillite et le recours possible.",
        goals: [
          "Comparer les deux modèles sur ce qui se passe en cas d'erreur.",
          "Dire ce qu'une signature multiple change au risque."
        ],
        tutor:
          "Fais comparer ce qui se passe en cas de perte de clé et en cas de faillite du dépositaire, puis demande ce qu'apporte une signature multiple.",
        contexts: [
          "une clé perdue sans phrase de récupération",
          "une plateforme dépositaire en défaut",
          "un portefeuille exigeant deux signatures sur trois"
        ]
      },
      en: {
        title: "Key custody: self-custody or custodian",
        summary: "Compare custody models on loss risk, insolvency risk and available recourse.",
        goals: [
          "Compare both models on what happens when something goes wrong.",
          "Say what multi-signature changes about the risk."
        ],
        tutor:
          "Have the student compare a lost key and an insolvent custodian, then ask what multi-signature adds.",
        contexts: [
          "a key lost with no recovery phrase",
          "a custodial platform in default",
          "a wallet requiring two signatures out of three"
        ]
      }
    },
    {
      key: "impermanent_loss",
      objectives: ["blockchain_ecosystem"],
      stage: 5,
      safety: "financial_educational",
      fr: {
        title: "La perte impermanente d'un fournisseur de liquidité",
        summary: "Comparer la valeur d'une position en réserve et celle des mêmes actifs simplement conservés.",
        goals: [
          "Expliquer d'où vient l'écart entre les deux stratégies.",
          "Dire dans quel scénario de prix l'écart se réduit."
        ],
        tutor:
          "Fais comparer la valeur finale d'une position fournie en liquidité et des mêmes actifs conservés après un doublement de prix.",
        contexts: [
          "un actif dont le prix double pendant la période",
          "une paire de deux actifs stables entre eux",
          "des frais perçus qui compensent partiellement l'écart"
        ]
      },
      en: {
        title: "Impermanent loss for a liquidity provider",
        summary: "Compare the value of a pooled position with the same assets simply held.",
        goals: [
          "Explain where the gap between the two strategies comes from.",
          "Say in which price scenario the gap narrows."
        ],
        tutor:
          "Have the student compare the final value of a pooled position and of the same assets held after a price doubling.",
        contexts: [
          "an asset whose price doubles over the period",
          "a pair of two assets stable against each other",
          "collected fees partially offsetting the gap"
        ]
      }
    },
    {
      key: "token_supply_schedule",
      objectives: ["blockchain_ecosystem"],
      stage: 5,
      safety: "financial_educational",
      fr: {
        title: "Émission, dilution et calendrier de distribution",
        summary: "Lire un calendrier d'émission pour anticiper la dilution des détenteurs existants.",
        goals: [
          "Lire un calendrier de déblocage et repérer les échéances sensibles.",
          "Distinguer offre en circulation et offre totale."
        ],
        tutor:
          "Fais lire un calendrier où 20 % de l'offre se débloque en un mois, puis demande ce que cela implique pour les détenteurs existants.",
        contexts: [
          "un déblocage de 20 % de l'offre en un mois",
          "une offre en circulation très inférieure à l'offre totale",
          "une émission continue destinée à rémunérer des validateurs"
        ]
      },
      en: {
        title: "Issuance, dilution and distribution schedule",
        summary: "Read an issuance schedule to anticipate dilution for existing holders.",
        goals: [
          "Read an unlock schedule and spot the sensitive dates.",
          "Tell apart circulating supply and total supply."
        ],
        tutor:
          "Have the student read a schedule unlocking 20% of supply in one month, then ask what it implies for existing holders.",
        contexts: [
          "an unlock of 20% of supply within a month",
          "a circulating supply far below total supply",
          "continuous issuance paying validators"
        ]
      }
    },
    {
      key: "regulatory_frameworks",
      objectives: ["blockchain_ecosystem"],
      stage: 5,
      fr: {
        title: "Ce que la régulation encadre",
        summary: "Repérer les points de contact entre un protocole ouvert et les obligations qui pèsent sur les intermédiaires.",
        goals: [
          "Distinguer ce qui vise le protocole et ce qui vise les intermédiaires.",
          "Citer une obligation typique d'une plateforme d'échange."
        ],
        tutor:
          "Fais distinguer les obligations d'un protocole ouvert et celles d'une plateforme d'échange, puis demande où se situe le point de contrôle réel.",
        contexts: [
          "une plateforme qui vérifie l'identité de ses clients",
          "un protocole publié en logiciel libre",
          "un émetteur de jeton adossé à une monnaie"
        ]
      },
      en: {
        title: "What regulation actually covers",
        summary: "Identify the contact points between an open protocol and the duties placed on intermediaries.",
        goals: [
          "Tell apart what targets the protocol and what targets intermediaries.",
          "Name a typical obligation of an exchange platform."
        ],
        tutor:
          "Have the student separate the duties of an open protocol from those of an exchange, then ask where the real control point sits.",
        contexts: [
          "a platform verifying its customers' identity",
          "a protocol published as free software",
          "an issuer of a currency-backed token"
        ]
      }
    },
    {
      key: "onchain_analytics",
      objectives: ["blockchain_ecosystem"],
      stage: 5,
      fr: {
        title: "Lire l'activité d'un protocole dans les données de chaîne",
        summary: "Distinguer des indicateurs d'usage réel des chiffres facilement gonflés par un même acteur.",
        goals: [
          "Choisir deux indicateurs difficiles à manipuler.",
          "Expliquer pourquoi le nombre d'adresses actives trompe souvent."
        ],
        tutor:
          "Fais critiquer une communication fondée sur le nombre d'adresses actives, puis demande quels indicateurs seraient plus solides.",
        contexts: [
          "un protocole affichant cent mille adresses actives",
          "un volume gonflé par des échanges entre deux comptes",
          "des frais payés par des utilisateurs réels"
        ]
      },
      en: {
        title: "Reading a protocol's activity in chain data",
        summary: "Tell real usage indicators apart from figures one actor can easily inflate.",
        goals: [
          "Choose two indicators that are hard to manipulate.",
          "Explain why the count of active addresses often misleads."
        ],
        tutor:
          "Have the student critique a claim based on active address count, then ask which indicators would be sturdier.",
        contexts: [
          "a protocol advertising a hundred thousand active addresses",
          "volume inflated by trades between two accounts",
          "fees paid by real users"
        ]
      }
    },

    {
      key: "smart_contract_basics",
      objectives: ["blockchain_building"],
      stage: 1,
      fr: {
        title: "Ce qu'un smart contract peut et ne peut pas faire",
        summary: "Comprendre un programme déterministe déclenché par une transaction et incapable d'agir seul.",
        goals: [
          "Dire ce qui déclenche l'exécution d'un contrat.",
          "Citer trois choses qu'un contrat ne peut pas faire seul."
        ],
        tutor:
          "Fais expliquer pourquoi un contrat ne peut pas s'exécuter tout seul chaque lundi, puis demande comment un projet contourne cette limite.",
        contexts: [
          "un versement mensuel que personne ne déclenche",
          "un contrat qui doit connaître un cours de bourse",
          "une vente déclenchée par un acheteur"
        ]
      },
      en: {
        title: "What a smart contract can and cannot do",
        summary: "Understand a deterministic program triggered by a transaction and unable to act on its own.",
        goals: [
          "Say what triggers a contract's execution.",
          "Name three things a contract cannot do by itself."
        ],
        tutor:
          "Have the student explain why a contract cannot run itself every Monday, then ask how a project works around that limit.",
        contexts: [
          "a monthly payout nobody triggers",
          "a contract needing a stock price",
          "a sale triggered by a buyer"
        ]
      }
    },
    {
      key: "evm_execution",
      objectives: ["blockchain_building"],
      stage: 2,
      fr: {
        title: "Comment la machine virtuelle exécute un contrat",
        summary: "Comprendre l'exécution identique sur tous les nœuds et l'obligation de déterminisme.",
        goals: [
          "Expliquer pourquoi tous les nœuds doivent obtenir le même résultat.",
          "Citer une source d'aléa interdite dans un contrat."
        ],
        tutor:
          "Fais expliquer ce qui se passerait si un contrat utilisait un nombre aléatoire local, puis demande comment obtenir un aléa acceptable.",
        contexts: [
          "un tirage au sort dans un contrat de loterie",
          "un contrat qui voudrait lire l'heure locale d'un nœud",
          "une exécution rejouée par mille nœuds"
        ]
      },
      en: {
        title: "How the virtual machine executes a contract",
        summary: "Understand identical execution on every node and the resulting determinism requirement.",
        goals: [
          "Explain why every node must reach the same result.",
          "Name a source of randomness forbidden inside a contract."
        ],
        tutor:
          "Have the student explain what would happen if a contract used a local random number, then ask how to obtain acceptable randomness.",
        contexts: [
          "a draw inside a lottery contract",
          "a contract wanting to read a node's local clock",
          "an execution replayed by a thousand nodes"
        ]
      }
    },
    {
      key: "contract_storage_cost",
      objectives: ["blockchain_building"],
      stage: 2,
      fr: {
        title: "Le coût du stockage sur la chaîne",
        summary: "Comparer le coût d'écrire une donnée sur la chaîne et celui de la garder hors chaîne.",
        goals: [
          "Comparer le coût d'un stockage sur chaîne et d'une empreinte seule.",
          "Choisir ce qui doit vraiment être écrit sur la chaîne."
        ],
        tutor:
          "Fais choisir ce qui va sur la chaîne pour un certificat de diplôme, puis demande ce que prouve encore une empreinte seule.",
        contexts: [
          "un certificat de diplôme à rendre vérifiable",
          "une image de plusieurs mégaoctets",
          "un journal d'événements écrit à chaque appel"
        ]
      },
      en: {
        title: "The cost of on-chain storage",
        summary: "Compare the cost of writing data on chain with keeping it off chain.",
        goals: [
          "Compare the cost of on-chain storage and of a hash alone.",
          "Choose what genuinely needs to be written on chain."
        ],
        tutor:
          "Have the student choose what goes on chain for a diploma certificate, then ask what a hash alone still proves.",
        contexts: [
          "a diploma certificate to be made verifiable",
          "an image of several megabytes",
          "an event log written on every call"
        ]
      }
    },
    {
      key: "contract_functions_visibility",
      objectives: ["blockchain_building"],
      stage: 3,
      fr: {
        title: "Fonctions, visibilité et modificateurs",
        summary: "Contrôler qui peut appeler quoi et factoriser les vérifications d'accès dans un contrat.",
        goals: [
          "Choisir la visibilité adaptée à trois fonctions d'un contrat.",
          "Écrire une condition d'accès réutilisable."
        ],
        tutor:
          "Fais choisir la visibilité de trois fonctions d'un contrat de vente, puis demande ce qui arrive si une fonction interne devient publique.",
        contexts: [
          "une fonction de retrait réservée au propriétaire",
          "une consultation de solde ouverte à tous",
          "une fonction interne exposée par erreur"
        ]
      },
      en: {
        title: "Functions, visibility and modifiers",
        summary: "Control who can call what and factor access checks inside a contract.",
        goals: [
          "Choose the right visibility for three contract functions.",
          "Write a reusable access condition."
        ],
        tutor:
          "Have the student choose visibility for three functions of a sale contract, then ask what happens if an internal function becomes public.",
        contexts: [
          "a withdrawal function reserved to the owner",
          "a balance lookup open to everyone",
          "an internal function exposed by mistake"
        ]
      }
    },
    {
      key: "events_and_logs",
      objectives: ["blockchain_building"],
      stage: 3,
      fr: {
        title: "Événements et journaux",
        summary: "Émettre des événements lisibles hors chaîne pour reconstituer l'état sans tout relire.",
        goals: [
          "Dire pourquoi une interface écoute des événements plutôt que le stockage.",
          "Choisir les champs à indexer dans un événement."
        ],
        tutor:
          "Fais concevoir l'événement émis à chaque vente, puis demande quels champs doivent être indexés pour filtrer par acheteur.",
        contexts: [
          "une interface qui affiche l'historique des ventes",
          "un tableau de bord alimenté par les journaux",
          "une recherche filtrée par adresse d'acheteur"
        ]
      },
      en: {
        title: "Events and logs",
        summary: "Emit events readable off chain to rebuild state without re-reading everything.",
        goals: [
          "Say why an interface listens to events rather than storage.",
          "Choose which fields to index in an event."
        ],
        tutor:
          "Have the student design the event emitted on each sale, then ask which fields must be indexed to filter by buyer.",
        contexts: [
          "an interface showing the sales history",
          "a dashboard fed by the logs",
          "a search filtered by buyer address"
        ]
      }
    },
    {
      key: "testing_contracts",
      objectives: ["blockchain_building"],
      stage: 3,
      fr: {
        title: "Tester un contrat avant déploiement",
        summary: "Écrire des tests qui couvrent les chemins d'échec, sachant qu'un contrat déployé ne se corrige pas.",
        goals: [
          "Lister les cas d'échec à tester avant tout déploiement.",
          "Expliquer pourquoi la couverture compte plus qu'ailleurs."
        ],
        tutor:
          "Fais lister les cas d'échec d'un contrat de vente aux enchères, puis demande lequel serait catastrophique en production.",
        contexts: [
          "une enchère clôturée sans gagnant",
          "un appel émis par une adresse non autorisée",
          "un contrat déployé avec un paramètre erroné"
        ]
      },
      en: {
        title: "Testing a contract before deployment",
        summary: "Write tests covering failure paths, knowing a deployed contract cannot simply be patched.",
        goals: [
          "List the failure cases to test before any deployment.",
          "Explain why coverage matters more here than elsewhere."
        ],
        tutor:
          "Have the student list the failure cases of an auction contract, then ask which one would be catastrophic in production.",
        contexts: [
          "an auction closing with no winner",
          "a call issued by an unauthorised address",
          "a contract deployed with a wrong parameter"
        ]
      }
    },
    {
      key: "local_devnet",
      objectives: ["blockchain_building"],
      stage: 3,
      fr: {
        title: "Développer sur un réseau local",
        summary: "Utiliser un réseau local puis un réseau de test avant d'engager des frais réels.",
        goals: [
          "Comparer réseau local, réseau de test et réseau principal.",
          "Citer un comportement qui diffère entre réseau local et réseau réel."
        ],
        tutor:
          "Fais comparer les trois environnements, puis demande quel problème n'apparaît jamais sur un réseau local instantané.",
        contexts: [
          "un déploiement instantané sur une chaîne locale",
          "un test avec des jetons sans valeur",
          "un problème de congestion invisible en local"
        ]
      },
      en: {
        title: "Developing on a local network",
        summary: "Use a local network then a test network before spending real fees.",
        goals: [
          "Compare local network, test network and main network.",
          "Name a behaviour that differs between a local and a real network."
        ],
        tutor:
          "Have the student compare the three environments, then ask which problem never shows on an instant local chain.",
        contexts: [
          "an instant deployment on a local chain",
          "a test using valueless tokens",
          "a congestion problem invisible locally"
        ]
      }
    },
    {
      key: "reentrancy",
      objectives: ["blockchain_building"],
      stage: 4,
      fr: {
        title: "La faille de réentrance",
        summary: "Comprendre comment un appel externe rappelle le contrat avant la mise à jour de son état.",
        goals: [
          "Décrire l'ordre fautif entre envoi de fonds et mise à jour du solde.",
          "Appliquer le schéma vérifications, effets, interactions."
        ],
        tutor:
          "Fais décrire l'ordre des opérations d'un retrait vulnérable, puis demande la réécriture qui supprime la faille.",
        contexts: [
          "un retrait qui envoie les fonds avant de mettre à jour le solde",
          "un contrat appelant un contrat inconnu",
          "un solde décrémenté trop tard"
        ]
      },
      en: {
        title: "The reentrancy flaw",
        summary: "Understand how an external call re-enters the contract before its state is updated.",
        goals: [
          "Describe the faulty order between sending funds and updating the balance.",
          "Apply the checks-effects-interactions pattern."
        ],
        tutor:
          "Have the student describe the operation order of a vulnerable withdrawal, then ask for the rewrite that removes the flaw.",
        contexts: [
          "a withdrawal sending funds before updating the balance",
          "a contract calling an unknown contract",
          "a balance decremented too late"
        ]
      }
    },
    {
      key: "contract_access_control",
      objectives: ["blockchain_building"],
      stage: 4,
      fr: {
        title: "Contrôle d'accès et rôles",
        summary: "Concevoir des rôles limités plutôt qu'un propriétaire unique tout-puissant.",
        goals: [
          "Découper des permissions en rôles distincts.",
          "Expliquer le risque d'une clé unique de propriétaire."
        ],
        tutor:
          "Fais découper les permissions d'un contrat en trois rôles, puis demande ce qui se passe si la clé du propriétaire est perdue.",
        contexts: [
          "une clé de propriétaire compromise",
          "une mise en pause d'urgence réservée à deux adresses",
          "un rôle de trésorier distinct du rôle d'administrateur"
        ]
      },
      en: {
        title: "Access control and roles",
        summary: "Design limited roles rather than one all-powerful owner.",
        goals: [
          "Split permissions into distinct roles.",
          "Explain the risk of a single owner key."
        ],
        tutor:
          "Have the student split a contract's permissions into three roles, then ask what happens if the owner key is lost.",
        contexts: [
          "a compromised owner key",
          "an emergency pause reserved to two addresses",
          "a treasurer role separate from the admin role"
        ]
      }
    },
    {
      key: "upgradeable_contracts",
      objectives: ["blockchain_building"],
      stage: 4,
      fr: {
        title: "Contrats évolutifs et proxy",
        summary: "Comprendre le motif proxy et le compromis entre correction possible et confiance demandée.",
        goals: [
          "Expliquer la séparation entre stockage et logique dans un proxy.",
          "Dire ce que l'évolutivité retire comme garantie aux utilisateurs."
        ],
        tutor:
          "Fais expliquer où vit l'état dans un montage proxy, puis demande ce qu'un utilisateur accepte en utilisant un contrat évolutif.",
        contexts: [
          "une correction de bug après déploiement",
          "un stockage conservé pendant un changement de logique",
          "une mise à jour décidée par une seule équipe"
        ]
      },
      en: {
        title: "Upgradeable contracts and proxies",
        summary: "Understand the proxy pattern and the trade-off between fixability and required trust.",
        goals: [
          "Explain the split between storage and logic in a proxy.",
          "Say what upgradeability removes as a guarantee for users."
        ],
        tutor:
          "Have the student explain where state lives in a proxy setup, then ask what a user accepts by using an upgradeable contract.",
        contexts: [
          "a bug fixed after deployment",
          "storage preserved through a logic change",
          "an upgrade decided by a single team"
        ]
      }
    },
    {
      key: "gas_optimization",
      objectives: ["blockchain_building"],
      stage: 4,
      fr: {
        title: "Optimiser le gas sans casser la lisibilité",
        summary: "Identifier les opérations réellement coûteuses avant d'écrire du code difficile à relire.",
        goals: [
          "Classer trois opérations par coût réel.",
          "Décider quand une optimisation ne vaut pas sa complexité."
        ],
        tutor:
          "Fais classer une écriture en stockage, une lecture et un calcul par coût, puis demande quelle optimisation apporte le plus pour un contrat donné.",
        contexts: [
          "une boucle qui écrit en stockage à chaque tour",
          "un tableau parcouru pour trouver un élément",
          "un contrat illisible après optimisation"
        ]
      },
      en: {
        title: "Optimising gas without destroying readability",
        summary: "Identify the genuinely expensive operations before writing hard-to-read code.",
        goals: [
          "Rank three operations by real cost.",
          "Decide when an optimisation is not worth its complexity."
        ],
        tutor:
          "Have the student rank a storage write, a read and a computation by cost, then ask which optimisation pays most for a given contract.",
        contexts: [
          "a loop writing to storage on every turn",
          "an array scanned to find one element",
          "a contract made unreadable by optimisation"
        ]
      }
    },
    {
      key: "contract_audit",
      objectives: ["blockchain_building"],
      stage: 5,
      fr: {
        title: "Ce qu'un audit de contrat cherche",
        summary: "Comprendre la démarche d'un audit et ce que son rapport ne garantit pas.",
        goals: [
          "Citer trois familles de vulnérabilités recherchées.",
          "Dire ce qu'un rapport d'audit ne prouve pas."
        ],
        tutor:
          "Fais lister ce qu'un auditeur examine en priorité, puis demande ce qu'un rapport favorable ne garantit toujours pas.",
        contexts: [
          "un contrat audité qui subit tout de même un incident",
          "une hypothèse d'oracle non vérifiée par l'audit",
          "un périmètre d'audit limité à deux fichiers"
        ]
      },
      en: {
        title: "What a contract audit looks for",
        summary: "Understand the audit process and what its report does not guarantee.",
        goals: [
          "Name three families of vulnerabilities searched for.",
          "Say what an audit report does not prove."
        ],
        tutor:
          "Have the student list what an auditor examines first, then ask what a favourable report still does not guarantee.",
        contexts: [
          "an audited contract that still suffers an incident",
          "an oracle assumption not covered by the audit",
          "an audit scope limited to two files"
        ]
      }
    },
    {
      key: "formal_verification",
      objectives: ["blockchain_building"],
      stage: 5,
      fr: {
        title: "Vérifier formellement une invariante",
        summary: "Exprimer une propriété qui doit rester vraie et la prouver sur toutes les exécutions possibles.",
        goals: [
          "Formuler une invariante vérifiable pour un contrat donné.",
          "Comparer la portée d'une preuve et celle d'un test."
        ],
        tutor:
          "Fais formuler l'invariante d'un contrat de dépôt, puis demande ce qu'une preuve apporte de plus que mille tests.",
        contexts: [
          "la somme des dépôts égale au solde du contrat",
          "un contrat testé par mille cas aléatoires",
          "une propriété fausse sur un cas jamais testé"
        ]
      },
      en: {
        title: "Formally verifying an invariant",
        summary: "State a property that must always hold and prove it over every possible execution.",
        goals: [
          "State a verifiable invariant for a given contract.",
          "Compare the reach of a proof and of a test."
        ],
        tutor:
          "Have the student state the invariant of a deposit contract, then ask what a proof adds over a thousand tests.",
        contexts: [
          "the sum of deposits equal to the contract balance",
          "a contract tested with a thousand random cases",
          "a property false on a case never tested"
        ]
      }
    },
    {
      key: "frontend_integration",
      objectives: ["blockchain_building"],
      stage: 5,
      fr: {
        title: "Relier une interface web à un contrat",
        summary: "Gérer côté interface la signature, l'attente de confirmation et l'échec d'une transaction.",
        goals: [
          "Décrire les états à afficher entre l'envoi et la confirmation.",
          "Choisir ce que voit l'utilisateur en cas d'échec."
        ],
        tutor:
          "Fais lister les états d'interface entre le clic et la confirmation, puis demande ce qu'il faut afficher si la transaction échoue.",
        contexts: [
          "un bouton d'achat cliqué deux fois par impatience",
          "une transaction rejetée par l'utilisateur dans son portefeuille",
          "une confirmation qui arrive après trente secondes"
        ]
      },
      en: {
        title: "Connecting a web interface to a contract",
        summary: "Handle signing, confirmation waiting and transaction failure on the interface side.",
        goals: [
          "Describe the states to display between sending and confirmation.",
          "Choose what the user sees on failure."
        ],
        tutor:
          "Have the student list the interface states between the click and the confirmation, then ask what to show if the transaction fails.",
        contexts: [
          "a buy button clicked twice out of impatience",
          "a transaction rejected by the user in their wallet",
          "a confirmation arriving after thirty seconds"
        ]
      }
    },
    {
      key: "onchain_incident_response",
      objectives: ["blockchain_building"],
      stage: 5,
      fr: {
        title: "Réagir à un incident sur un contrat déployé",
        summary: "Préparer à l'avance les leviers disponibles quand un contrat déployé se comporte mal.",
        goals: [
          "Lister les leviers d'urgence prévus à la conception.",
          "Ordonner les actions des premières minutes d'un incident."
        ],
        tutor:
          "Fais ordonner les actions des dix premières minutes d'un incident, puis demande quel levier doit exister dès la conception.",
        contexts: [
          "des fonds qui sortent anormalement d'un contrat",
          "une fonction de pause prévue dès la conception",
          "une communication publique pendant un incident"
        ]
      },
      en: {
        title: "Responding to an incident on a deployed contract",
        summary: "Prepare in advance the levers available when a deployed contract misbehaves.",
        goals: [
          "List the emergency levers designed in from the start.",
          "Order the actions of the first minutes of an incident."
        ],
        tutor:
          "Have the student order the actions of the first ten minutes of an incident, then ask which lever must exist from the design stage.",
        contexts: [
          "funds flowing abnormally out of a contract",
          "a pause function designed in from the start",
          "public communication during an incident"
        ]
      }
    }
  ]
};
