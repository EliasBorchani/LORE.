BAB = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10]
SAVE = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
WILL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
# Spells per day (columns 0 to 9, Table 1-3 of the Codex, read from the page image: the 1st-level column is 4 at levels 3 and 5).
DAY = [
    [3, 1], [4, 2], [4, 4, 1], [4, 3, 2], [4, 4, 2, 1], [4, 3, 3, 2], [4, 4, 3, 2, 1], [4, 4, 3, 3, 2],
    [4, 4, 4, 3, 2, 1], [4, 4, 4, 3, 3, 2], [4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 3, 3, 2],
    [4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 3, 3, 2], [4, 4, 4, 4, 4, 4, 3, 2, 1],
    [4, 4, 4, 4, 4, 4, 3, 3, 2], [4, 4, 4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 4, 4, 3, 3, 2],
    [4, 4, 4, 4, 4, 4, 4, 4, 3, 3], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
]
ROWS = [{'level': i + 1, 'bab': BAB[i], 'fort': SAVE[i], 'ref': SAVE[i], 'will': WILL[i],
         'spellsPerDay': DAY[i] + [None] * (10 - len(DAY[i]))} for i in range(20)]

CLASS = dict(
    id='wu_jen', fr='Wu jen', en='Wu Jen', hitDie=4, skillPoints=2, epicBonusFeatEvery=3,
    source='Complete Arcane', labels=['arcane', 'prepared'],
    spellcasting={'ability': 'int', 'kind': 'arcane', 'mode': 'prepared'},
    rows=ROWS,
    text="""Le wu jen vit loin des villes, dans une cabane de montagne ou une grotte, et converse avec les éléments, les esprits et les pierres. Ce qu’il apprend, il l’écrit dans un grimoire comme un magicien, mais il paie sa puissance en interdits étranges qu’il ne doit jamais briser. Qui dérange ses règles lui ôte la magie pour la journée.""",
    rules=[
        'Dé de vie : d4. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : tout sauf loyal.',
        'Formé aux armes courantes ; ni armure ni bouclier (ils font échouer les sorts à composante gestuelle).',
        'Sorts profanes préparés depuis son grimoire, basés sur l’Intelligence, du niveau 0 au niveau 9 ; liste propre au wu jen.',
        'Aptitudes : don de métamagie supplémentaire et esprit veilleur (1), tabou (1) ; secret magique (3, 9, 12, 15, 18) ; maîtrise des éléments (6).',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…) ; 2 sorts de plus dans le grimoire par niveau ; un secret magique et un tabou tous les 3 niveaux (21, 24, 27…).',
    ],
    note='Épique (Codex Profane, chap. 7) : pas de sorts par jour en plus après le niveau 20, mais 2 sorts de plus dans le grimoire par niveau ; un secret magique tous les 3 niveaux à partir de 21 (Extension de durée, Extension de portée, Incantation silencieuse ou statique) avec un tabou de plus ; un don supplémentaire tous les 3 niveaux (23, 26, 29…).',
    skills=['skill.concentration', 'skill.craft', 'skill.knowledge', 'skill.profession', 'skill.spellcraft'],
    proficiencies=['proficiency.simple_weapons'],
    alignments=['neutral_good', 'chaotic_good', 'neutral', 'chaotic_neutral',
                'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts de wu jen', en='Wu Jen spells',
         text="""Chaque matin, le wu jen relit son grimoire et y choisit les sorts du jour, qui s’éteignent une fois lancés. Sa liste est la sienne : beaucoup de ses sorts appartiennent à l’un des cinq éléments.""",
         rules=[
             'Sorts profanes de la liste des wu jen, préparés chaque jour depuis son grimoire (seul lecture de la magie se prépare de mémoire).',
             'Caractéristique : Intelligence. Il faut au moins 10 + niveau du sort en Intelligence pour le préparer ou le lancer. DD : 10 + niveau du sort + modificateur d’Intelligence.',
             'Sorts par jour selon le niveau de wu jen ; sorts en bonus grâce à une Intelligence élevée.',
             'Grimoire : au niveau 1, tous les sorts de niveau 0 et 3 sorts du 1er niveau, plus un par point de modificateur d’Intelligence ; 2 sorts de n’importe quel niveau qu’il peut lancer à chaque niveau gagné ; il peut en recopier d’autres.',
             'Au-delà du niveau 20 : toujours 2 nouveaux sorts par niveau dans le grimoire, sans emplacement de plus.',
         ]),
    dict(id='bonus_metamagic', level=1, fr='Don supplémentaire', en='Bonus feat',
         text="""Le wu jen commence sa vie d’aventurier avec un tour de main de plus pour plier ses sorts.""",
         rules=['Un don de métamagie supplémentaire au niveau 1, au choix.',
                'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…), choisi dans la liste épique du wu jen, sans en remplir les conditions.'],
         note='Le don de métamagie du niveau 1 se choisit sur la feuille.'),
    dict(id='spirit_watch', level=1, fr='Esprit veilleur', en='Watchful spirit',
         text="""Un esprit surveille le wu jen : s’il lui arrive un mauvais lancer, il peut demander une seconde chance.""",
         rules=['Une fois par jour, il relance son initiative avant de connaître sa place dans l’ordre et garde le meilleur des deux jets.'],
         usesPerDay=1),
    dict(id='taboos', level=1, fr='Tabous', en='Taboos',
         text="""Pour garder sa magie, le wu jen suit des interdits qui paraissent absurdes aux autres. Il les respecte, sinon plus aucun sort de la journée.""",
         rules=[
             'Il choisit un tabou au niveau 1, puis un nouveau à chaque secret magique appris (au-delà du niveau 20 aussi).',
             'S’il viole l’un d’eux, il ne peut plus lancer de sorts de la journée.',
             'Exemples : ne pas manger de viande, ne pas posséder plus que ce qu’il peut porter, faire une offrande quotidienne, ne pas se baigner, ne pas se couper les cheveux, ne pas toucher un cadavre, ne pas boire d’alcool, ne pas porter une couleur, ne pas allumer de feu, ne pas s’asseoir face à une direction.',
         ],
         note='Les tabous choisis restent à noter dans les notes de la fiche (aucune mécanique sur la feuille).'),
    dict(id='magic_secret', level=3, fr='Secret magique', en='Spell secret',
         text="""Le wu jen finit par modifier un de ses sorts pour toujours, comme s’il l’avait toujours lancé avec un don de métamagie.""",
         rules=[
             'Aux niveaux 3, 9, 12, 15 et 18 (au niveau 6, la maîtrise des éléments le remplace), il choisit un sort qu’il connaît et lui applique de façon permanente Extension de portée, Extension de durée, Incantation statique ou Incantation silencieuse.',
             'Le niveau du sort ne change pas. Le choix est définitif ; il peut cibler le même sort avec un autre don au niveau suivant. Il n’a pas besoin de connaître le don.',
             'Épique : à partir du niveau 21, un secret magique tous les 3 niveaux (21, 24, 27…), avec un tabou de plus.',
         ],
         note='Le secret se note dans le grimoire ou les notes de la fiche (pas de modèle pour un sort précis modifié).'),
    dict(id='elemental_mastery', level=6, fr='Maîtrise des éléments', en='Elemental mastery',
         text="""Au lieu d’un secret, il devient un maître d’un élément : bois, eau, feu, métal ou terre. Ses sorts de cet élément gagnent en puissance et le protègent des sorts du même élément.""",
         rules=[
             'Il choisit un élément parmi bois, eau, feu, métal et terre.',
             'Niveau de lanceur de sorts effectif +2 pour ses sorts de cet élément (variables numériques et tests de niveau de lanceur).',
             'Bonus d’aptitude de +2 aux jets de sauvegarde contre les sorts de cet élément.',
             'Les sorts d’élément « Tous » comptent pour chacun des cinq éléments.',
         ],
         note='L’élément choisi se note sur la feuille ; le bonus dépend de l’élément de chaque sort lancé : pas dans le modèle.'),
]
