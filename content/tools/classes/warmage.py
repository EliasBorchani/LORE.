BAB = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10]
SAVE = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
WILL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
# Spells per day (columns 0 to 9, Table 1-1 of the Codex): 6 per level once unlocked, with the top levels still growing.
DAY = [
    [5, 3], [6, 4], [6, 5], [6, 6, 3], [6, 6, 4], [6, 6, 5, 3], [6, 6, 6, 4], [6, 6, 6, 5, 3], [6, 6, 6, 6, 4],
    [6, 6, 6, 6, 5, 3], [6, 6, 6, 6, 6, 4], [6, 6, 6, 6, 6, 5, 3], [6, 6, 6, 6, 6, 6, 4], [6, 6, 6, 6, 6, 6, 5, 3],
    [6, 6, 6, 6, 6, 6, 6, 4], [6, 6, 6, 6, 6, 6, 6, 5, 3], [6, 6, 6, 6, 6, 6, 6, 6, 4],
    [6, 6, 6, 6, 6, 6, 6, 6, 5, 3], [6, 6, 6, 6, 6, 6, 6, 6, 6, 4], [6, 6, 6, 6, 6, 6, 6, 6, 6, 5],
]
ROWS = [{'level': i + 1, 'bab': BAB[i], 'fort': SAVE[i], 'ref': SAVE[i], 'will': WILL[i],
         'spellsPerDay': DAY[i] + [None] * (10 - len(DAY[i]))} for i in range(20)]

CLASS = dict(
    id='warmage', fr='Mage de bataille', en='Warmage', hitDie=6, skillPoints=2, epicBonusFeatEvery=3,
    source='Complete Arcane', labels=['arcane', 'free_slots'],
    spellcasting={'ability': 'cha', 'kind': 'arcane', 'mode': 'free_slots'},
    rows=ROWS,
    text="""Le mage de bataille a fait ses classes dans un collège de guerre, pas dans une bibliothèque. Il a appris à lancer des sorts en cotte de mailles, entre deux exercices de formation, jusqu’à ce que quelques formules d’attaque soient gravées au fond de lui. Il en connaît peu, mais il les lance sans préparation, et chacune frappe plus fort que celle d’un magicien.""",
    rules=[
        'Dé de vie : d6. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : tous.',
        'Formé aux armes courantes, aux rondaches (buckler), aux armures légères et, dès le niveau 8, aux armures intermédiaires ; pas aux autres boucliers.',
        'Sorts profanes du mage de bataille, basés sur le Charisme, du niveau 0 au niveau 9 : il connaît tous les sorts de sa liste et les lance sans les préparer.',
        'Aptitudes : armure de guerre (1 et 8), magie affilée (1), apprentissage avancé (3, 6, 11, 16) ; dons supplémentaires de métamagie soudaine (7, 10, 15, 20).',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…) ; un sort d’Évocation de plus dans sa liste aux niveaux 21, 25, 29…',
    ],
    note='Épique (Codex Profane, chap. 7) : pas de sorts par jour en plus après le niveau 20 ; apprentissage avancé tous les 4 niveaux à partir de 21 (25, 29…) ; un don supplémentaire tous les 3 niveaux (23, 26, 29…) parmi la liste du Codex, sans en remplir les conditions (choisi au niveau de la fiche). Nom anglais de la classe : Warmage.',
    skills=['skill.concentration', 'skill.craft', 'skill.intimidate', 'skill.knowledge_arcana',
            'skill.knowledge_history', 'skill.profession', 'skill.spellcraft'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.light_armor'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts de mage de bataille', en='Warmage spells',
         text="""Pas de grimoire ni de préparation : le mage de bataille a tout son répertoire en tête, et il y puise à la demande tant qu’il lui reste des emplacements du bon niveau.""",
         rules=[
             'Sorts profanes de sa propre liste, lancés sans préparation.',
             'Caractéristique : Charisme. Il faut au moins 10 + niveau du sort en Charisme pour le lancer. DD : 10 + niveau du sort + modificateur de Charisme.',
             'Sorts par jour selon le niveau de mage de bataille ; sorts en bonus grâce à un Charisme élevé.',
             'Dès qu’il accède à un niveau de sort, il connaît tous les sorts de ce niveau de sa liste : il peut en lancer n’importe lequel avec un emplacement libre de ce niveau.',
             'Les parchemins qu’il écrit et les objets qu’il active (baguettes, potions) ne profitent pas de la magie affilée ; les bâtons, si.',
         ]),
    dict(id='armored_mage', level=1, fr='Armure de guerre', en='Armored Mage',
         text="""Le collège de guerre lui a fait porter des tenues lourdes dès les premiers jours : à force, le geste du sort passe à travers le cuir et la maille.""",
         rules=[
             'Au niveau 1, il lance sans risque d’échec des sorts profanes en armure légère et avec une rondache (sorts du mage de bataille seulement).',
             'Au niveau 8, la même chose en armure intermédiaire.',
             'Une armure plus lourde ou un écu entraîne le risque d’échec habituel.',
         ],
         note='Le risque d’échec des sorts profanes n’est pas encore dans le modèle.'),
    dict(id='warmage_edge', level=1, fr='Magie affilée', en='Warmage Edge',
         text="""Son métier, c’est de faire mal. Chaque sort qui inflige des dégâts frappe plus dur, guidé par son intelligence.""",
         rules=[
             'Quand il lance un sort de mage de bataille qui inflige des dégâts, il ajoute son bonus d’Intelligence à ces dégâts (pas aux sorts d’une autre classe).',
             'Une fois par incantation et par sort : une boule de feu en bénéficie pour toutes les créatures de la zone ; avec projectile magique, un seul projectile.',
             'Si le sort inflige des dégâts sur plusieurs rounds, le bonus s’ajoute chaque round.',
         ],
         note='Le bonus dépend du sort lancé (dégâts propres à chaque sort, une fois par incantation) : pas dans le modèle, à ajouter à la main.'),
    dict(id='advanced_learning', level=3, fr='Apprentissage avancé', en='Advanced Learning',
         text="""Entre deux campagnes, le mage de bataille ajoute à son répertoire une formule qu’il a étudiée ou mise au point lui-même.""",
         rules=[
             'Aux niveaux 3, 6, 11 et 16, il ajoute définitivement un sort de la liste des ensorceleurs et magiciens à sa liste.',
             'Le sort doit être de l’école d’Évocation et d’un niveau au plus égal au plus haut niveau de sort qu’il connaît déjà.',
             'Épique : à partir du niveau 21, un sort d’Évocation de plus tous les 4 niveaux (25, 29…).',
         ],
         note='Les sorts ajoutés se choisissent dans la feuille (relations de liste) ; au niveau 21 et au-delà, la règle épique : 1 sort d’Évocation aux niveaux 21, 25, 29…'),
    dict(id='sudden_empower', feat='feat.sudden_empower', level=7, fr='Extension d’effet soudaine', en='Sudden Empower',
         text="""Une fois par jour, un sort de plus frappe de toute sa force, sans préparation.""",
         rules=['Don supplémentaire : Extension d’effet soudaine, sans en remplir les conditions.',
                'S’il le possède déjà, il choisit un autre don de métamagie.']),
    dict(id='sudden_extend', feat='feat.sudden_extend', level=10, fr='Extension de portée soudaine', en='Sudden Extend',
         text="""Un sort peut durer plus longtemps ou porter plus loin, sur un simple geste de volonté, une fois par jour.""",
         rules=['Don supplémentaire : Extension de portée soudaine (Sudden Extend dans le livre anglais), sans en remplir les conditions.',
                'S’il le possède déjà, il choisit un autre don de métamagie.'],
         note='Le Codex imprime « Extension de portée soudaine » ; pas de don de ce nom dans Complete Arcane : relié à Sudden Extend (Extension de durée soudaine). À confirmer.'),
    dict(id='sudden_widen', feat='feat.sudden_widen', level=15, fr='Extension de zone d’effet soudaine', en='Sudden Widen',
         text="""Quand l’ennemi s’étale sur le champ de bataille, le mage de bataille élargit la zone d’un seul geste.""",
         rules=['Don supplémentaire : Extension de zone d’effet soudaine, sans en remplir les conditions.',
                'S’il le possède déjà, il choisit un autre don de métamagie.']),
    dict(id='sudden_maximize', feat='feat.sudden_maximize', level=20, fr='Quintessence des sorts soudaine', en='Sudden Maximize',
         text="""Une fois par jour, un sort porte ses dégâts au maximum, sans préparation.""",
         rules=['Don supplémentaire : Quintessence des sorts soudaine, sans en remplir les conditions.',
                'S’il le possède déjà, il choisit un autre don de métamagie.']),
]
