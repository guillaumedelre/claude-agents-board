# Agents

Tableau de bord web des sessions [Claude Code][claude-code] et de leurs sous-agents, auto-hébergé derrière [Traefik][traefik]. Chaque session, sur n'importe quelle machine du réseau local, envoie ses [hooks][hooks] à l'application, qui les affiche en temps réel, regroupées par machine puis par dossier de projet.

- `web/` : interface React avec [Vite][vite], [Tailwind CSS][tailwind] v4 et [shadcn/ui][shadcn]. Compilée dans l'image Docker.
- `server/server.js` : serveur Node sans dépendance. Il sert l'interface et une API JSON :
  - `GET /api/health`
  - `POST /api/hooks` : reçoit le JSON d'un hook Claude Code tel quel (en-têtes optionnels `X-Agent-Host`, `X-Hook-Token`)
  - `GET /api/sessions` : résumé de toutes les sessions (sans les chronologies)
  - `GET /api/sessions/:id` : session complète, avec la chronologie de chaque agent, les tours de conversation, les tâches et les estimations de durée
  - `PATCH /api/sessions/:id` : `{ "name": "..." }` renomme une session (80 caractères au maximum ; vide pour revenir au nom automatique)
  - `DELETE /api/sessions` : retire les sessions fermées et celles sans nouvelles depuis 10 minutes
  - `GET /api/settings`, `PUT /api/settings` : `{ "autoCleanupMs": 86400000 }` (délai du nettoyage automatique : `0`, 1 h, 24 h ou 7 jours)
  - `GET /api/galaxy` : sessions ouvertes avec leurs 60 derniers événements par fil (sans les sorties d'outils, entrées tronquées à 400 caractères), pour animer la galaxie de l'accueil
  - `GET /api/usage?cwd=<projet>` : appels d'outils du projet sur les 7 derniers jours, toutes sessions, par clé (outil, premiers mots de chaque commande shell, marqueur `:mem` pour la mémoire) ; sert à l'usure « projet 7 j » de la carte
  - `GET /api/stream` : flux [SSE][sse] qui signale chaque changement (l'interface recharge alors les données)
- Stockage : volume nommé `agents_data` (`/data/state.json`), écrit au plus une fois par seconde : sessions, réglages et historique des durées. Les sessions sans activité depuis `RETENTION_DAYS` jours (7 par défaut) sont supprimées, avec 300 sessions au maximum et 500 événements par fil. L'historique des durées (agents et tâches terminés) est gardé à part, 30 jours et 5 000 entrées au maximum. Les compteurs d'activité par heure (heatmap de l'accueil) sont gardés 8 jours, indépendamment des sessions retirées.

## Ce qui est affiché

La page d'accueil (titre « Agents » de la barre du haut) donne une vue d'ensemble de toutes les machines, sur toute la largeur et la hauteur disponibles. En haut, un bandeau liste les sessions qui attendent une réponse ou une permission (un clic ouvre la session). Dessous, trois onglets (choix retenu par navigateur) :

- « Galaxie » (par défaut) : la galaxie des sessions ouvertes sur toute la hauteur (voir plus bas) ;
- « Activité » (avec le nombre d'agents en cours) : quatre chiffres clés (actions sur 7 jours, aujourd'hui, heure et jour les plus actifs), la heatmap des 7 derniers jours heure par heure (appels d'outils et prompts, toutes machines confondues), puis les agents en cours (avec leur dernier outil) et les derniers terminés, chaque ligne ouvrant l'agent concerné. La heatmap utilise une seule teinte (bleu, avec ses propres paliers en thème sombre) sur une échelle en racine carrée, pour que les petites heures restent visibles à côté des pics ; au-dessus, le profil de la journée type (somme des 7 jours par heure), à droite le total de chaque jour ; le survol d'une case met en évidence sa ligne et sa colonne et affiche le détail (appels d'outils et prompts), l'heure en cours est entourée et les heures à venir sont en pointillés ;
- « Open space » : toutes les sessions ouvertes en pixel art (voir plus bas).

La liste est organisée par machine (nom envoyé par le hook, voir plus bas), puis par dossier de projet. Machines et dossiers se replient d'un clic (état retenu par navigateur) ; repliés, ils gardent leur nombre de sessions ouvertes et leur état le plus urgent (en attente de toi, en cours, au repos). Le dossier de projet est celui du fil principal de la session ; un agent qui travaille dans un worktree (`<dépôt>/.claude/worktrees/<nom>`) est rattaché au dépôt.

Noms affichés :

- Session : « Session N », numérotée à son arrivée par machine et par projet, sans jamais réutiliser un numéro, ou le nom donné à la main (crayon à côté du titre dans le détail). Le sujet en cours (titre que donne Claude Code, sinon dernier prompt) s'affiche en dessous et peut changer.
- Dans l'arbre d'une session : « Agent principal » (le fil principal et son dernier outil), puis ses sous-agents.
- Sous-agent : « #N », son numéro d'ordre dans la session, son type et le nom de sa tâche (la description passée à l'outil `Agent`). Un agent lancé avant l'installation des hooks n'a pas de tâche connue : « Tâche inconnue · <début de son identifiant> ».

- Par session : dossier de projet, machine, modèle, mode de permission, état (en cours, au repos, en attente de toi, fermée, sans nouvelles depuis 10 minutes ; « en attente de toi » vient d'une `Notification` de Claude Code, comme une demande de permission, sauf `idle_prompt` : envoyée 60 secondes après tout tour terminé, elle n'est notée que dans le journal), prompts, appels d'outils (entrée et sortie, tronquées à 4 000 caractères), réponse finale de chaque tour.
- Par agent : type, description, consigne complète, arborescence parent / sous-agents, dernier outil utilisé, chronologie de ses outils, rapport final, tokens et durée (agents au premier plan uniquement).

Les hooks ne transmettent pas les messages intermédiaires du modèle, seulement le dernier message de chaque tour (`Stop`, `SubagentStop`).

Le détail d'une session ou d'un agent a trois vues : « Journal » (la chronologie ci-dessus), « Timeline », « Bureau » et « Carte ». Le bouton ✕ ou la touche Échap ferment le détail ; retirer une session du tableau passe par le menu « Nettoyage ».

La barre du haut ne garde que le bouton qui replie la barre latérale, le titre (retour à l'accueil) et le nombre de sessions en attente de toi. Repliée (écran large seulement, choix retenu par navigateur), la barre latérale devient une colonne de raccourcis, un par session de la liste, regroupés par machine : initiales du projet (avec le numéro de session si le projet en a plusieurs), point d'état, nombre d'agents en cours ; le survol affiche la session, sa machine, son état et son sujet (ou sa demande en attente), un clic l'ouvre ; les machines actives, sessions ouvertes et agents en cours restent dans la barre de statut. La barre de statut en bas affiche :

- à gauche : l'état du flux temps réel (« En direct », ou « Hors ligne » sur fond rouge), les machines actives, les sessions ouvertes, les agents en cours et l'heure du dernier événement reçu d'un hook ;
- à droite : l'interrupteur « Fermées (N) », le menu « Nettoyage » (son libellé indique le mode : « manuel » ou « auto 1 h / 24 h / 7 j »), le bouton « Sons » et le thème (clair, sombre ou automatique, qui suit le système et est le choix par défaut, retenu par navigateur).

Le bouton « Sons » (désactivé par défaut, retenu par navigateur) joue un court carillon, généré par le navigateur, quand une session termine son tour et un autre quand une session demande une permission. Il vaut pour toutes les sessions du tableau, quelle que soit la page ouverte, et ne réagit qu'aux changements reçus après le chargement de la page. Après un rechargement, le navigateur n'autorise le son qu'après un premier clic ou une touche dans la page.

### Sessions fermées et nettoyage

Une session est fermée quand elle a envoyé `SessionEnd`, ou quand elle est « en cours » sans événement depuis 10 minutes (plantage, terminal tué). Une session fermée est masquée par défaut (interrupteur « Fermées »). Affichée, elle a une carte en pointillés, un titre barré, l'heure de fermeture et, si le nettoyage automatique est actif, le temps avant son retrait.

Le menu « Nettoyage » de la barre de statut propose :

- « Retirer les sessions fermées » : retrait immédiat, après confirmation ;
- le nettoyage automatique (24 h par défaut, ou 1 h, 7 jours, désactivé) : le serveur vérifie chaque minute et retire toute session sans événement depuis ce délai, fermée ou non. Une session retirée revient au prochain événement qu'elle envoie.

Le nettoyage n'efface pas l'historique des durées qui sert aux estimations de la timeline.

### Timeline

Vue de type Gantt, rafraîchie chaque seconde, sur 5 minutes, 30 minutes, 2 heures ou toute l'activité (par défaut) :

- une ligne pour la session principale, avec une barre par tour de conversation (du prompt à la fin de la réponse) ;
- une ligne par agent, dans l'ordre de l'arborescence, de son lancement à sa fin ;
- une ligne par tâche de la liste de tâches de Claude (outils `TaskCreate` / `TaskUpdate` et événements `TaskCreated` / `TaskCompleted`, ou l'ancien outil `TodoWrite`) : un cercle tant qu'elle attend, une barre une fois commencée ;
- sous chaque barre, les appels d'outils (rouges en cas d'échec).

Pour un agent ou une tâche en cours, la fin estimée apparaît en pointillés, et le dépassement en orange. L'estimation est la durée médiane des agents du même type (ou des tâches) déjà terminés : sur le même projet s'il y en a au moins 3, sinon sur tous les projets, sinon aucune estimation. Elle est calculée par l'application, sans rien demander à Claude Code.

### Bureau

Une vue en pixel art de la session : l'agent principal derrière le comptoir d'accueil (veste orange), chaque sous-agent en cours à sa propre table, et un coin salon à droite (meuble avec machine à café, grande TV au mur, table basse sur un tapis, canapé, lampadaire, plante ; la bibliothèque est contre le mur du bureau).

- Un sous-agent reçoit une table à son démarrage (au plus près de son parent s'il en a un, sinon la première libre), entre par la porte et marche jusqu'à elle. À sa fin, il affiche une coche, se lève et ressort par la porte ; sa table est libérée. Une rangée de trois tables s'ajoute quand toutes sont prises. À l'ouverture de la vue, les agents déjà là sont directement à leur place.
- Un type d'agent a toujours la même apparence : `Explore`, `general-purpose` et `Plan` ont un look fixe, les autres types en reçoivent un parmi huit, sans doublon dans une même session tant qu'il en reste. La veste orange est réservée à l'agent principal.
- Au bureau, l'animation suit le dernier outil : lecture (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `ToolSearch`) avec une feuille posée sur le bureau, que l'agent regarde régulièrement, et un voyant vert sous l'écran ; frappe pour tous les autres outils (bras en alternance, voyant bleu clignotant) ; immobile au repos. Un agent qui travaille est éclairé par la lueur bleutée de son écran, qui vacille pendant la frappe.
- Au repos depuis 30 secondes, un agent part en pause (quelques secondes après l'ouverture de la vue s'il l'était déjà) : café (la machine fume), canapé devant la TV (l'écran s'anime), bibliothèque ou plante, 15 à 40 secondes par activité, puis le plus souvent une autre, sinon un court passage à son bureau. Dès qu'il reprend le travail ou qu'une permission est demandée, il retourne à son bureau et ne tape qu'une fois assis. Une session sans nouvelles depuis 10 minutes fait la sieste sur le canapé.
- Bulles, à droite de la tête : « … » ambre quand la session attend une permission (sur le sous-agent qui la demande si le hook `Notification` indique son `agent_id`, sur l'agent principal sinon), coche verte en fin de tour ou à la fin d'un sous-agent, « ! » rouge pour un sous-agent interrompu ou une session en erreur, « z » pour une session ou un agent sans nouvelles.
- Au-dessus de chaque personnage : son nom (« Agent principal », « #3 Explore ») et l'outil en cours, ou ce qu'il fait (« Au repos », « Pause café… », « Devant la TV », « Permission demandée », « Repart »). Le choix « Étiquettes : toujours / au survol » sous la pièce (retenu par navigateur) les affiche en permanence, ou seulement au survol ou au focus du personnage ; en mode survol, celles de l'agent sélectionné et des personnages qui attendent une permission ou sont en erreur restent visibles. Ce choix vaut aussi pour l'open space de l'accueil.
- Sous la porte, « N sous-agents terminés » rappelle les sous-agents déjà repartis : la liste de gauche les affiche encore, le bureau non.
- Le survol affiche la tâche, l'état, l'outil et la durée, et entoure le personnage d'un contour blanc d'un pixel qui suit sa silhouette, comme pour l'agent sélectionné ; un clic ouvre le détail de l'agent.
- À la fermeture de la session, tout le monde sort par la porte et le bureau s'assombrit. Avec la réduction des animations activée sur le système, personne ne se déplace : chacun reste à son bureau.

Le code est dans `web/src/components/office/` : plan de la pièce et trajets sur une grille de 16 px (`layout.ts`), comportement des personnages (`engine.ts`), dessin trié par profondeur (`draw.ts`), sprites et apparences (`assets.ts`), composant et étiquettes (`index.tsx`), préférence d'affichage des étiquettes partagée avec l'open space (`labels.tsx`).

### Open space

La page d'accueil montre une seule pièce pour toutes les sessions ouvertes, avec la porte et le coin salon du Bureau (partagés par tout le monde).

- Une zone par machine, empilées par ordre alphabétique, avec le nom de la machine au sol et un marquage entre deux zones. Une zone compte des rangées de trois tables ; la pièce s'allonge quand les sessions et sous-agents augmentent.
- Chaque session a son îlot, délimité par un fond de couleur : l'agent principal, puis ses sous-agents en cours aux tables voisines. Un îlot qui tient dans la rangée en cours la complète, sinon il commence une rangée. Quand un îlot grandit ou rétrécit, les personnes déplacées rejoignent leur nouvelle table à pied.
- Les agents principaux gardent la veste orange ; peau et coiffure dépendent de la session, sans doublon tant qu'il en reste. Leur étiquette indique la session et le projet (« Session 11 · agents »).
- Comportement identique au Bureau : entrée et sortie par la porte, pauses dans le coin salon (une activité n'accueille qu'une personne à la fois), bulles, réduction des animations. Un clic sur un agent principal ouvre sa session, un clic sur un sous-agent ouvre son détail. Comme dans le Bureau, le personnage survolé a un contour blanc, et les étiquettes suivent le choix « toujours / au survol » commun aux deux vues.

Le code est dans `web/src/components/openspace/` : plan des zones et îlots (`layout.ts`), dessin (`draw.ts`) et composant (`index.tsx`). Il réutilise le moteur, les sprites et les fonctions de dessin du Bureau.

Les sprites viennent des packs [MetroCity][metrocity] et [MetroCity Interior][metrocity-interior] de JIK-A-4 (aucune licence indiquée sur les pages). `scripts/office-assets.py` les extrait vers `web/public/office/` depuis le dossier des packs téléchargés (`python3 scripts/office-assets.py <dossier MetroCity>`, Pillow requis) : calques des personnages, comptoir sans la croix médicale, écran isolé, table, sol, mur, décor et coin salon (la machine à café est dessinée en code).

### Carte

Une carte du travail adaptée de [lot-map][lot-map] (Aleksei Volodin, licence MIT) : au centre, la session (« CLAUDE ») ou l'agent ouvert (« #N ») avec son modèle ; autour, dix stations. Chaque appel envoie une impulsion du centre vers sa station, puis une autre au retour ; les appels des sous-agents partent de la station Agents.

| Station | Ce qui l'allume |
|---------|-----------------|
| Toi | prompts, demandes de permission (`PermissionRequest`), réponse finale, `AskUserQuestion` |
| Modèle | chaque étape du modèle (« opus 5.5 · étape 3 », déduite des appels d'outils, voir plus bas), compactage du contexte (`PreCompact` / `PostCompact`), changement de modèle (`PostModelSwitch`), erreurs `StopFailure` |
| Mémoire | lecture ou écriture dans le dossier mémoire de Claude Code, `.claude/rules/` ou un `CLAUDE.md` ; fichiers d'instructions chargés sans demande (`InstructionsLoaded`, impulsion creuse, compteur `↓`) |
| Fichiers | `Read`, `Write`, `Edit`, `Grep`, `Glob`, et les commandes shell qui ne font que lire ou manipuler des fichiers (`cat`, `grep`, `sed`, `mv`…) |
| Terminal | les autres commandes shell |
| Réseau | `WebFetch`, `WebSearch`, serveurs MCP, commandes réseau (`curl`, `gh`, `ssh`, `git push`, `npm install`, `docker pull`…) |
| Navigateur | outils de navigateur (Claude in Chrome, navigateur intégré) |
| Agents | lancement de sous-agents et de workflows ; un point tourne autour de la station par sous-agent en cours |
| Skills | `Skill`, `ToolSearch` |
| Hooks | appel refusé (`PermissionDenied` du mode auto), ou resté sans réponse à la fin du fil (refusé par un hook ou une permission, ou interrompu) |

Comme dans lot-map : les rayons s'épaississent avec l'usage, une ligne relie les dernières stations visitées par le fil principal, deux aiguilles tournent autour d'une station pendant un appel long (une minute, dix minutes), `×N` compte les appels simultanés, une pastille rouge compte les erreurs et refus depuis le dernier prompt, le centre et la station Modèle sonnent à un changement de modèle, et un large anneau quitte le centre quand la réponse est prête. La carte occupe tout le panneau, aux couleurs de lot-map (fond sombre ou crème selon le thème, orange pour ce qui est en cours, rouge pour les échecs). Les réglages (2D ou 3D, halo, usure, relecture) sont en surimpression en haut à gauche, l'action en cours en haut à droite ; les informations passent par des fenêtres au survol :

- le centre (ou le soleil en 3D) : la session, son modèle, l'action en cours et les dernières lignes d'activité (`●` en cours, `·` terminé, `✕` échec ou refus, `◆` changement de modèle ; `+N` pour des appels terminés qui se suivent sur une station) ;
- une station (ou une planète) : voir plus bas ;
- une lune (sous-agent, en 3D) : son numéro et son type, son état et sa durée, ses appels en cours ou son dernier outil, son nombre d'appels, ses tokens et ses échecs.

Étapes du modèle : les hooks ne signalent pas les requêtes au modèle, elles sont donc déduites. Le modèle travaille entre la fin d'un lot d'appels d'outils (ou le prompt, ou le lancement d'un sous-agent) et le lot suivant (ou la fin du tour) ; des appels lancés à moins de 300 ms d'intervalle, ou avant la fin des précédents, forment un seul lot. La durée affichée inclut donc la latence des hooks. Les étapes sont numérotées par tour pour la session, et sur toute sa vie pour un sous-agent.

Différences avec lot-map : les hooks ne transmettent pas le remplissage du contexte, donc l'anneau de contexte autour du centre n'existe pas. Les impulsions partent à la réception de l'événement par le navigateur (pas à l'heure du serveur), pour rester visibles malgré un décalage d'horloge. Avec la réduction des animations activée sur le système, rien ne bouge.

#### Carte en 3D

Le bouton « 3D » au-dessus du fil (choix retenu par navigateur) remplace le dessin par une scène [three.js][three] ([React Three Fiber][r3f]) chargée seulement à la demande : la session en système solaire.

- Claude est le soleil, dans un shader inspiré de « Matrix Galaxy » ([andrewray sur ShaderFrog][matrix-galaxy], code réécrit pour ce projet) : fond indigo et violet traversé de larges traînées magenta, rouges et vertes qui tourbillonnent, pluie de caractères façon Matrix, en petits glyphes 3×5 qui mêlent chiffres et katakana retournés en miroir comme dans le film (une tête claire par colonne, suivie d'une traîne qui s'efface), surface bosselée qui ondule et liseré lumineux ; tout s'accélère et s'avive quand Claude travaille, et vire à l'ambre quand la session t'attend. Il est plus gros dans la vue de session que dans la galaxie, pour que ses chiffres se lisent. Une couronne violette à jets l'entoure ; un anneau part à la réponse, un autre sonne à un changement de modèle.
- Les stations sont des planètes sur des orbites en pointillés, dans un ordre fixe du soleil vers l'extérieur : Modèle, Mémoire, Fichiers, Terminal, Réseau, Navigateur, Skills, Hooks, Agents. Elles tournent lentement, les lointaines moins vite. Chaque liaison soleil-planète est un faisceau de grains lumineux qui avancent du soleil vers la planète en spirale (à la manière d'un nœud torique dessiné en particules) : l'usure règle sa densité et son épaisseur, l'activité sa vitesse et son éclat (orange vif pendant un appel, pointillés gris pour une station jamais utilisée). Comme en 2D : une planète usée garde une braise, une planète active s'allume (sarcelle pour Mémoire, rouge après une erreur ou un refus), un appel en cours la fait battre et remplit ses deux jauges circulaires comme en 2D (l'intérieure en une minute, recommencée à chaque tour, l'extérieure une fois en dix minutes ; arcs tracés par un shader, nets à toutes les distances), et son étiquette porte son compte, `×N` et les erreurs. Un trajet relie les dernières planètes visitées par le fil principal.
- Chaque appel envoie une impulsion du soleil vers sa planète, puis une autre au retour (grise, ou rouge en cas d'échec) ; un signal reçu (instructions chargées) est une impulsion creuse.
- Toi est posé devant le système en petit trou noir (disque d'accrétion qui tourne, plus vif et ambre quand la session t'attend), relié au soleil : prompts, demandes de permission et réponses y passent, et le lien bat en ambre quand la session t'attend.
- Les sous-agents sont des lunes de la planète Agents, qui porte un anneau à bandes où elles gravitent. Chaque lune a la couleur de son type (même rang que les looks du Bureau, donc deux agents du même type ont la même couleur), son numéro et une courte traînée sur son orbite ; elle grandit à son lancement et s'éteint à sa fin, et ses appels partent d'elle. Quand Claude Code fournit les tokens d'un agent (agents au premier plan, à leur fin), elle grossit avec.

Chaque planète a une surface procédurale (shader) qui dit ce qu'elle est, même sans icône : Modèle en cœur aux veines incandescentes qui battent avec l'activité, Mémoire glacée sarcelle, Fichiers rocheuse à cratères, Terminal sombre striée de lignes qui défilent, Réseau géante gazeuse à bandes, Navigateur océan et continents, Skills cristalline à éclats, Hooks en métal brossé, Agents géante pâle à anneau. Toutes tournent sur elles-mêmes, avec l'icône de leur station gravée sur une face, une atmosphère à leur couleur qui s'avive et respire pendant un appel, et des fissures rouges qui vacillent après une erreur ou un refus. Un badge d'icône flotte au-dessus de chaque planète ; dans la galaxie, il n'apparaît qu'en s'approchant. La légende sous la scène (icône et nom de chaque planète) met en évidence, au survol, les planètes de la station. Le fond de l'espace est un shader : nuages de nébuleuse bleu, violet et sarcelle qui dérivent très lentement, bande galactique inclinée et champ d'étoiles denses qui scintillent doucement, avec quelques étoiles plus vives par-dessus. Les grains des liaisons s'allègent quand le faisceau est dense, pour que leur somme ne déclenche pas le halo. Ses couleurs restent sous le seuil du halo. Le bouton « halo » (thème sombre seulement, choix retenu par navigateur, commun avec la galaxie) ajoute un bloom léger en post-traitement : seuls le soleil, les veines, les éclats, les fissures et le disque de Toi brillent (pas les grains des liaisons) ; il coûte plus cher à la carte graphique.

Le survol d'une planète ouvre une fenêtre (la même qu'au survol d'une station 2D) : icône, nom et nombre d'appels, appels en cours avec leur durée (ou le dernier appel), les trois cibles les plus servies (fichiers, commandes, hôtes) et les échecs. Le clic l'épingle, comme en 2D (voir plus bas). La souris tourne (glisser), zoome (molette) et déplace (clic droit) la vue ; tant qu'on n'y a pas touché, la caméra se cadre selon la taille du panneau. Sans WebGL, un message renvoie vers la 2D ; avec la réduction des animations, la scène ne s'anime pas.

#### Relecture, stations et usure

- « ▶ Relecture » rejoue la session (ou l'agent) depuis son début : lecture, pause, retour au début, vitesse ×1 à ×60, et un curseur pour aller à un instant précis. La carte (2D ou 3D) et les fenêtres montrent l'état de ce moment ; « Direct » revient au temps réel.
- Le survol d'une station ouvre sa fenêtre : icône, nom et nombre d'appels, appels en cours avec leur durée (ou le dernier appel), les trois cibles les plus servies (fichiers, commandes, hôtes) et les échecs. Un clic l'épingle en haut à droite (cercle en pointillés autour de la station) ; un second clic ou « détacher » la retire.
- « usure » choisit ce qu'épaississent les rayons et ce que comptent les stations : la session (ou l'agent) ouverte, ou « projet 7 j », tous les appels d'outils du projet sur 7 jours, toutes sessions confondues (sans les étapes du modèle ni les prompts, que le serveur ne compte pas). Le serveur garde ces comptes 8 jours, indépendamment des sessions retirées, et les reconstitue au premier démarrage depuis les journaux encore en mémoire.

Le code est dans `web/src/components/lotmap/` : classement des appels, dessin SVG, relecture et usure (`map.ts`, porté de lot-map), système solaire partagé avec la galaxie (`solar.tsx`, géométrie des orbites dans `orbits.ts`), astres et ciel (`bodies.tsx`, shaders GLSL dans `shaders.ts`), jauges circulaires (`gauge.tsx`), fenêtre de station (`card.tsx`), légende (`legend.tsx`), halo (`glow.tsx`, [postprocessing][postprocessing]), scène 3D de la session (`map3d.tsx`), couleurs des types (`colors.ts`), cadrage de la caméra (`fit.tsx`), horloge et calque des étiquettes (`clock.ts`, `label.tsx`), réglages partagés (`hooks.ts`), composant et fil (`index.tsx`). Les étiquettes 3D sont rendues dans un calque HTML posé sur la toile plutôt que dans le conteneur de React Three Fiber : avec ce dernier, la première étiquette montée restait vide et le démontage levait une erreur `removeChild` (drei 10.7.9, React 19.2).

### Galaxie

L'autre vue de la carte « Open space » de l'accueil : une galaxie où chaque session ouverte est un système solaire (le même que la carte 3D de la session, réduit, avec soleil et planètes grossis pour rester visibles de loin). Toi est au centre de l'univers, en trou noir dont le disque d'accrétion s'allume en ambre si au moins une session t'attend ; les systèmes tournent lentement autour de toi, un bras de spirale par machine (de la session la plus ancienne, près du centre, à la plus récente ; nom de la machine au bout du bras), vus en plongée à 35° au-dessus du plan de la galaxie, sur le même fond d'espace que la carte 3D. Vu de loin, l'éclat des soleils et des liaisons est réduit pour que le halo ne les transforme pas en taches. Chaque système est relié à Toi : le lien bat en ambre quand la session attend une permission. Vu de loin, un système ne montre que le nom de sa session et son projet ; les badges d'icône de ses planètes apparaissent en s'approchant. La légende et le bouton « halo » fonctionnent comme dans la carte 3D de la session.

Un clic sur un soleil ou sur le nom d'une session arrête la rotation et zoome sur ce système, qui affiche alors le détail de ses planètes et leur fenêtre au survol ; « Ouvrir la session » ouvre la session sur sa carte en 3D, « Vue d'ensemble », Échap ou un clic dans le vide reviennent en arrière. Les données viennent de `GET /api/galaxy`, rechargé au plus une fois par seconde quand le tableau change. Le code est dans `web/src/components/galaxy/`.

## Démarrage

```bash
cp .env.example .env
docker compose up -d --build
```

L'application est disponible sur l'hôte `agents.${IP}.${DOMAIN}`, en HTTP (la stack n'a pas de HTTPS).

## Brancher une machine

Une machine envoie ses sessions dès que ses hooks Claude Code pointent vers l'application. L'application sert elle-même les scripts d'installation : pas besoin d'accès au dépôt.

### 1. Prérequis

- Être sur le réseau local, avec un DNS qui résout `agents.10.0.0.10.sslip.io` vers `10.0.0.10`. Certains DNS bloquent les noms publics qui pointent vers une adresse privée (protection anti-rebinding[^rebinding] de Pi-hole ou de certaines box) : tester avec `nslookup agents.10.0.0.10.sslip.io`.
- Linux et macOS : `curl` et `python3` (pour modifier `settings.json` sans l'écraser).
- Windows : Windows PowerShell 5.1 ou PowerShell 7. [Git for Windows][git-for-windows] est recommandé (voir plus bas).

### 2. Installer les hooks

Linux, macOS :

```bash
curl -fsSL http://agents.10.0.0.10.sslip.io/install-hooks.sh | sh -s -- --host <nom>
```

Windows (PowerShell) :

```powershell
& ([scriptblock]::Create((irm http://agents.10.0.0.10.sslip.io/install-hooks.ps1))) -HostName <nom>
```

`<nom>` est le nom de la machine affiché dans le tableau (lettres, chiffres, `.`, `_`, `-`) ; par défaut, le nom d'hôte. Le script :

- ajoute les hooks dans `~/.claude/settings.json` (ou `$CLAUDE_CONFIG_DIR/settings.json`), au niveau utilisateur pour couvrir tous les dossiers ;
- garde les hooks déjà présents, ne crée pas de doublon s'il est relancé, et laisse une copie de l'ancien fichier dans `settings.json.bak-agents` ;
- teste la connexion à l'application et affiche le résultat.

Options : `--url` / `-Url` pour une autre adresse, `--token` / `-Token` si `HOOK_TOKEN` est défini dans le `.env` de la stack, `--uninstall` / `-Uninstall` pour retirer les hooks.

### 3. Relancer les sessions

Une session déjà ouverte n'est pas garantie de prendre en compte les nouveaux hooks : la relancer. Elle apparaît sur le tableau à son premier événement, sans l'historique antérieur.

Quand une version de l'application écoute de nouveaux événements, relancer le script d'installation sur chaque machine : il remplace les hooks existants sans créer de doublon.

### Fonctionnement des hooks

- Ce sont des hooks `command` qui envoient le JSON reçu sur l'entrée standard à `POST /api/hooks`, pour 19 événements (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Notification`, `TaskCreated`, `TaskCompleted`, `PermissionRequest`, `PermissionDenied`, `PreCompact`, `PostCompact`, `PostModelSwitch`, `InstructionsLoaded`). `PostModelSwitch` demande Claude Code 2.1.251 ou plus récent.
- La réponse de l'application est jetée (`curl -o /dev/null`, `Out-Null` en PowerShell) : pour `PreCompact`, `PostModelSwitch` et `PermissionRequest`, Claude Code lit la sortie standard du hook (consignes de résumé, contexte ajouté, décision de permission), et un message d'erreur de l'application s'y retrouverait.
- Ce ne sont pas des hooks `"type": "http"` : Claude Code refuse un hook HTTP vers une adresse privée (`10.0.0.10`) et n'autorise que le loopback.
- Ils sont synchrones pour que les événements arrivent dans l'ordre : chaque appel d'outil attend la réponse de l'application. Si l'application ne répond pas, l'envoi abandonne au bout de 2 secondes et Claude Code continue : un hook en échec ne bloque pas l'agent.
- Sous Windows, Claude Code exécute les hooks [avec Git Bash s'il est installé, sinon avec PowerShell][hooks]. Le script détecte Git Bash : avec lui, le hook est une commande `curl.exe` ; sans lui, une commande `Invoke-RestMethod`, plus lente car PowerShell met plusieurs centaines de millisecondes à démarrer, deux fois par appel d'outil. La commande PowerShell a été testée avec PowerShell 7 sous Linux, pas sous Windows.

### Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| Le test de connexion échoue (code `000`) | Machine hors du réseau local, ou DNS qui ne résout pas `*.sslip.io` vers une adresse privée |
| Le test répond « token refusé » | `--token` différent de `HOOK_TOKEN` dans le `.env` de la stack |
| Le test passe, mais aucune session n'apparaît | Session ouverte avant l'installation (la relancer), `"disableAllHooks": true` dans un fichier de réglages, ou `allowManagedHooksOnly` imposé par une configuration d'organisation |
| `python3` introuvable (macOS) | Installer les Command Line Tools : `xcode-select --install` |

## Mise à jour

L'image est construite localement : Watchtower ne la met pas à jour. Pour reprendre aussi l'image de base Node :

```bash
docker compose build --pull && docker compose up -d
```

## Développement du front

```bash
cd web
npm install
npm run dev   # proxy /api vers http://localhost:3000
```

Pour le serveur en local, depuis ce dossier : `PORT=3000 DATA_DIR=./data node server/server.js`. Il sert le dossier `public/`, qui contient le front compilé dans l'image (`web/dist`).

## Limites connues

- Pas d'authentification sur l'interface : les prompts, les commandes et le contenu des fichiers lus par les agents sont lisibles par tout appareil du réseau local. Sans `HOOK_TOKEN`, n'importe quel appareil du réseau peut aussi envoyer de faux événements.
- Les agents lancés par un workflow n'ont pas d'appel Agent : leur consigne et leur description sont inconnues.
- L'association d'un sous-agent à l'appel qui l'a lancé est provisoire jusqu'au `PostToolUse` de cet appel (le plus ancien appel en attente du même type est retenu au démarrage).
- Claude Code lance des agents internes (par exemple les résumés périodiques de la progression d'un agent en arrière-plan) qui n'envoient qu'un `SubagentStop`, sans type : ils sont ignorés.
- Une session restée « au repos » quand son terminal est fermé sans `SessionEnd` n'est pas reconnue comme fermée : seul le nettoyage automatique la retire.
- Une machine branchée avant l'ajout des événements `TaskCreated` / `TaskCompleted` voit ses tâches via les outils `TaskCreate` / `TaskUpdate` ; relancer le script d'installation ajoute ces deux événements.
- Une session fermée sans `SessionEnd` (plantage, terminal tué) reste « en cours », puis passe à « sans nouvelles » après 10 minutes sans événement.

[^rebinding]: Protection DNS qui refuse les réponses pointant vers une adresse privée, pour empêcher un site web d'atteindre le réseau local.

[claude-code]: https://code.claude.com/docs
[lot-map]: https://github.com/alexeyw/lot-map
[r3f]: https://r3f.docs.pmnd.rs/
[postprocessing]: https://github.com/pmndrs/react-postprocessing
[matrix-galaxy]: https://shaderfrog.com/editor/clqnb0c6w000apaz2sdvtij5m
[three]: https://threejs.org/
[metrocity]: https://jik-a-4.itch.io/metrocity-free-topdown-character-pack
[metrocity-interior]: https://jik-a-4.itch.io/metrocity
[git-for-windows]: https://gitforwindows.org/
[hooks]: https://code.claude.com/docs/en/hooks
[traefik]: https://traefik.io/traefik/
[vite]: https://vite.dev/
[tailwind]: https://tailwindcss.com/
[shadcn]: https://ui.shadcn.com/
[sse]: https://html.spec.whatwg.org/multipage/server-sent-events.html
