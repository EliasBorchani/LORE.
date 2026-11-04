L = "level('class.favored_soul')"

N = None
BAB = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15]
GOOD = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
# Table 1-3 (spells per day, read from the page image): spell level s starts at class level 2s with 3 (level 1 at class
# level 1 with 3), grows by 1 per level and caps at 6; the 9th level jumps from 4 to 6 at level 20.
KNOWN = [
    [4, 3], [5, 3], [5, 4], [6, 4, 3], [6, 5, 3], [7, 5, 4, 3], [7, 6, 4, 3], [8, 6, 5, 4, 3], [8, 6, 5, 4, 3],
    [9, 6, 6, 5, 4, 3], [9, 6, 6, 5, 4, 3], [9, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 6, 5, 4, 3],
    [9, 6, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 6, 6, 5, 4, 3],
    [9, 6, 6, 6, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 6, 6, 6, 5, 4, 3], [9, 6, 6, 6, 6, 6, 6, 6, 5, 4],
]


def per_day(lv):
    row = [5 if lv == 1 else 6, min(6, lv + 2)]
    for s in range(2, 10):
        if lv < 2 * s:
            row.append(N)
        else:
            row.append(6 if (s == 9 and lv == 20) else min(6, lv - 2 * s + 3))
    return row


def pad(r):
    return r + [N] * (10 - len(r))


ROWS = [{'level': lv, 'bab': BAB[lv - 1], 'fort': GOOD[lv - 1], 'ref': GOOD[lv - 1], 'will': GOOD[lv - 1],
         'spellsPerDay': per_day(lv), 'spellsKnown': pad(KNOWN[lv - 1])} for lv in range(1, 21)]

CLASS = dict(
    id='favored_soul', fr='Élu divin', en='Favored Soul', hitDie=8, skillPoints=2, epicBonusFeatEvery=3,
    source='Complete Divine', labels=['divine', 'spontaneous'],
    spellcasting={'ability': 'cha', 'kind': 'divine', 'mode': 'spontaneous'},
    rows=ROWS,
    text="""L’élu divin n’a pas appris la magie divine : il est né avec. Il lance les sorts des prêtres, sans étude ni préparation, comme on respire, et devient peu à peu un petit morceau de sa divinité : armes bénies, résistance au feu et au froid, ailes, puis une peau que l’acier ordinaire n’entame plus.""",
    rules=[
        'Dé de vie : d8. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : au choix, mais proche de celui de son dieu (neutre seulement si son dieu l’est).',
        'Formé à toutes les armes courantes et à l’arme de prédilection de sa divinité ; aux armures légères et intermédiaires et aux boucliers (sauf le pavois). Une armure lourde ne gêne pas ses sorts, mais il n’y est pas formé.',
        'Sorts divins spontanés de la liste du prêtre (sans domaines), basés sur le Charisme (le DD utilise la Sagesse), du niveau 0 au niveau 9 ; pas besoin de les préparer, répertoire limité. À partir du niveau 4, puis tous les 2 niveaux, il peut oublier un sort connu pour en apprendre un autre du même niveau (au plus 2 niveaux sous son meilleur niveau de sort).',
        'Aptitudes : arme de prédilection de la divinité (3) ; résistance aux énergies destructives, 10 points, un type au niveau 5, un autre au niveau 10, un troisième au niveau 15 ; spécialisation martiale de la divinité (12) ; ailes (17) ; réduction des dégâts (20).',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…).',
    ],
    note='Le livre ne donne pas de règle épique propre à l’élu divin : un don supplémentaire tous les 3 niveaux au-delà du 20 (maison). Compétences de classe lues sur l’image (Connaissances (mystères)). La liste du prêtre est copiée plus tard.',
    skills=['skill.spellcraft', 'skill.craft', 'skill.concentration', 'skill.knowledge_arcana', 'skill.diplomacy',
            'skill.heal', 'skill.profession', 'skill.sense_motive', 'skill.jump'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.light_armor', 'proficiency.medium_armor',
                   'proficiency.shields'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts d’élu divin', en='Favored soul spells',
         text="""L’élu divin lance ses sorts par un lien inné avec le divin : il n’a rien à préparer et choisit parmi ceux qu’il connaît, dans la liste des prêtres.""",
         rules=[
             'Sorts divins de la liste du prêtre, du niveau 0 au niveau 9, sans domaine. Caractéristique : Charisme (10 + niveau du sort minimum). DD : 10 + niveau du sort + modificateur de Sagesse.',
             'Sorts par jour selon le niveau (Table 1-3), plus des sorts en bonus grâce à un Charisme élevé.',
             'Répertoire limité : 4 sorts de niveau 0 et 3 sorts de niveau 1 au départ (Table 1-4), puis de nouveaux à chaque niveau ; ce nombre n’est pas modifié par le Charisme.',
             'Il lance librement n’importe quel sort connu, tant qu’il lui reste un emplacement du niveau voulu.',
             'À partir du niveau 4, puis tous les 2 niveaux, il peut échanger un sort connu contre un autre de même niveau (au plus 2 niveaux sous son meilleur niveau de sort), un seul échange à la fois.',
         ]),
    dict(id='deitys_weapon_focus', feat='feat.weapon_focus', level=3, fr='Arme de prédilection de la divinité',
         en='Deity’s weapon focus',
         text="""À force de servir son dieu, l’élu divin en prend l’arme de prédilection et la manie avec un naturel de plus en plus sûr.""",
         rules=['Don Arme de prédilection pour l’arme de sa divinité. S’il l’a déjà, il choisit une autre arme.',
                'Maniement de l’arme de la divinité (même si elle est de guerre ou exotique) dès le niveau 1.'],
         note='L’arme choisie n’est pas modélisée : le don est donné, le bonus de +1 aux attaques passe par l’arme maniée.'),
    dict(id='energy_resistance', level=5, fr='Résistance aux énergies destructives', en='Energy resistance',
         text="""La peau de l’élu divin s’habitue aux flammes, au gel ou à l’éclair, comme celle d’un petit dieu qui en a vu d’autres.""",
         rules=['Résistance 10 contre un type d’énergie choisi (acide, électricité, feu, froid ou son) au niveau 5.',
                'Un deuxième type au niveau 10, un troisième au niveau 15, avec la même résistance de 10.'],
         note='Le type est un choix : il se note sur la fiche. Les cibles energy_resistance.<type> existent dans le moteur, mais le choix par type n’est pas modélisé.'),
    dict(id='deitys_weapon_specialization', feat='feat.weapon_specialization', level=12,
         fr='Spécialisation martiale de la divinité', en='Deity’s weapon specialization',
         text="""L’arme sacrée de son dieu frappe plus fort dans ses mains, comme si le fidèle y avait mis tout ce que le dieu y a mis.""",
         rules=['Don Spécialisation martiale pour l’arme de sa divinité. S’il l’a déjà, il choisit une autre arme.'],
         note='Spécialisation martiale demande normalement guerrier 4 : ici donnée sans condition, par le livre.'),
    dict(id='wings', level=17, fr='Ailes', en='Wings',
         text="""Des ailes poussent dans son dos, de plumes si l’élu divin est bon, de chauve-souris s’il est mauvais.""",
         rules=['Vitesse de vol 18 m, bonne manœuvrabilité.',
                'Ailes de plumes (bon) ou de chauve-souris (mauvais) ; au choix s’il n’est ni l’un ni l’autre.'],
         effects=[{'target': 'speed.fly', 'op': 'set', 'value': 18}]),
    dict(id='damage_reduction', level=20, fr='Réduction des dégâts', en='Damage reduction',
         text="""Les armes ordinaires ne laissent presque plus de marque : l’élu divin porte en lui la protection de son dieu.""",
         rules=['Réduction des dégâts 10/argent s’il est loyal, 10/fer froid s’il est chaotique ; au choix s’il n’est ni l’un ni l’autre, une fois pour toutes.'],
         note='Réduction des dégâts /argent ou /fer froid : le modèle ne tient que la réduction sans type (damage_reduction.none), texte seul. Valeur vérifiée sur la page 14 : 10, pas 5.'),
]
