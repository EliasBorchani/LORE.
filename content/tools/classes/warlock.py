L = "level('class.warlock')"
BAB = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15]
SAVE = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
WILL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
KNOWN = [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 7, 8, 8, 9, 10, 10, 11, 11, 12]
GRADE = {1: 'least', 6: 'lesser', 11: 'greater', 16: 'dark'}
ROWS = []
for i in range(20):
    row = {'level': i + 1, 'bab': BAB[i], 'fort': SAVE[i], 'ref': SAVE[i], 'will': WILL[i], 'invocationsKnown': KNOWN[i]}
    if i + 1 in GRADE:
        row['invocationGrade'] = GRADE[i + 1]
    ROWS.append(row)

# Eldritch blast dice: 1d6 at 1, +1d6 at 3, 5, 7, 9, 11, 14, 17, 20 (table), then +1d6 on each even level (10d6 at 22).
BLAST = (f"(if({L} >= 21, 9 + floor(({L} - 20) / 2), if({L} >= 20, 9, if({L} >= 17, 8, if({L} >= 14, 7, "
         f"if({L} >= 11, 6, if({L} >= 9, 5, if({L} >= 7, 4, if({L} >= 5, 3, if({L} >= 3, 2, 1))))))))))d6")

CLASS = dict(
    id='warlock', fr='Sorcier', en='Warlock', hitDie=6, skillPoints=2, epicBonusFeatEvery=3,
    source='Complete Arcane', labels=['arcane', 'invoker'],
    invoking={'ability': 'cha'},
    rows=ROWS,
    text="""Le sorcier n’a ni grimoire ni leçons : un pacte, une lignée ou un lieu maudit a laissé en lui une énergie sombre, et il la cogne au visage de ses ennemis. Il n’apprend pas de sorts, il se constitue un petit répertoire d’invocations, toujours disponibles, qui grandit avec lui. Sa décharge fantastique est son arme de tous les jours.""",
    rules=[
        'Dé de vie : d6. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : chaotique et/ou mauvais.',
        'Formé aux armes courantes et aux armures légères ; pas aux boucliers. Les invocations n’ont que des gestes simples : en armure légère, pas de risque d’échec des sorts profanes ; en armure intermédiaire ou lourde, ou avec un bouclier, le risque habituel s’applique.',
        'Pas de sorts : des invocations, connues à volonté (action simple, qui provoque une attaque d’opportunité), basées sur le Charisme. DD : 10 + niveau de sort équivalent + modificateur de Charisme. Niveau de lanceur : niveau de sorcier.',
        'Aptitudes : décharge fantastique (1, puis 3, 5, 7, 9, 11, 14, 17, 20), détection de la magie (2), réduction des dégâts (3, 7, 11, 15, 19), objet leurré (4), résistance du fiélon (8, 13, 18), résistance aux énergies destructives (10, 20), objet enchanté (12).',
        'Rangs d’invocation : inférieur au niveau 1, mineur au niveau 6, majeur au niveau 11, suprême au niveau 16.',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…) ; décharge fantastique +1d6 tous les niveaux pairs ; réduction des dégâts +1 tous les 4 niveaux (23, 27, 31…) ; pas d’invocation de plus.',
    ],
    note='Épique (Codex Profane, chap. 7) : pas d’invocation supplémentaire ; décharge fantastique +1d6 à chaque niveau pair (10d6 au niveau 22) ; réduction des dégâts +1 au niveau 23 puis tous les 4 niveaux ; un don supplémentaire tous les 3 niveaux (23, 26, 29…) parmi une liste que l’exemplaire français ne donne pas (elle manque, seule la liste du mage de bataille est imprimée) : à choisir dans la fiche. Doute sur le livre : le texte épique cite « 12d6 au niveau 22, 13d6 au niveau 24 », ce qui ne colle pas avec la table (9d6 au niveau 20) ; on suit la table et la règle « +1d6 par niveau pair » (10d6 au 22, 11d6 au 24). Nom anglais de la classe : Warlock (Complete Arcane).',
    skills=['skill.spellcraft', 'skill.craft', 'skill.bluff', 'skill.concentration', 'skill.knowledge_arcana',
            'skill.knowledge_planes', 'skill.knowledge_religion', 'skill.disguise', 'skill.intimidate',
            'skill.profession', 'skill.sense_motive', 'skill.jump', 'skill.use_magic_device'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.light_armor'],
    alignments=['chaotic_good', 'chaotic_neutral', 'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='invocations', level=1, fr='Invocations', en='Invocations',
         text="""Pas de préparation, pas d’emplacements : le sorcier puise dans un petit répertoire de pouvoirs qu’il peut employer autant qu’il veut. Plus il progresse, plus il en connaît et plus ils sont puissants.""",
         rules=[
             'Commence avec 1 invocation de rang inférieur ; le nombre connu suit la table (12 au niveau 20).',
             'Rangs : inférieur (sort de niveau 1–2), mineur (3–4), majeur (5–6), suprême (6 ou plus, 9 au plus). Rang maximal : inférieur au niveau 1, mineur au 6, majeur au 11, suprême au 16.',
             'À volonté, au prix d’une action simple (attaque d’opportunité ; test de Concentration si on est frappé ou en défensive). Résistance à la magie, sauf indication contraire.',
             'DD : 10 + niveau de sort équivalent + modificateur de Charisme. Niveau de lanceur de sorts : niveau de sorcier.',
             'À chaque nouvelle invocation apprise, il peut en oublier une d’un rang au plus égal pour en prendre une autre. Aux niveaux 6, 11 et 16, il peut aussi remplacer une invocation d’un rang plus bas (inférieure au 6 ; inférieure ou mineure au 11 ; inférieure, mineure ou majeure au 16) par une de rang inférieur ou égal.',
             'Pas de don École renforcée ; Attaque spéciale renforcée et les dons qui imitent la métamagie pour les pouvoirs magiques s’appliquent.',
             'Il peut viser les classes de prestige réservées aux lanceurs de sorts.',
         ],
         note='Les invocations apprises se choisissent dans la fiche (statistiques invoker_level.warlock et invocations.known.warlock). Le risque d’échec des sorts profanes n’est pas encore dans le modèle.'),
    dict(id='eldritch_blast', level=1, fr='Décharge fantastique', en='Eldritch blast',
         text="""Le premier pouvoir du sorcier : un rayon d’énergie sombre qui jaillit de sa main et brûle ce qu’il touche. Avec le temps, il y accroche des effets qui handicapent la cible.""",
         rules=[
             'Rayon de 18 m, attaque de contact à distance, une seule cible, pas de jet de sauvegarde.',
             'Dégâts : 1d6 au niveau 1, 2d6 au 3, 3d6 au 5, 4d6 au 7, 5d6 au 9, 6d6 au 11, 7d6 au 14, 8d6 au 17, 9d6 au 20.',
             'Épique : +1d6 à chaque niveau pair après le 20 (10d6 au 22, 11d6 au 24…).',
             'Niveau de sort équivalent : la moitié du niveau de sorcier (arrondi en dessous), de 1 à 9 (9 dès le niveau 18).',
             'Résistance à la magie : oui (Efficacité des sorts accrue s’applique). Dégâts divisés par deux contre les objets.',
             'Les dons de métamagie ne l’améliorent pas ; Attaque spéciale renforcée oui (+2 au DD des jets de sauvegarde).',
             'Une invocation fantastique et une invocation façonnée peuvent s’y ajouter : le niveau de sort équivalent est le plus haut des niveaux en jeu.',
         ],
         effects=[{'target': 'damage.warlock_eldritch_blast', 'op': 'dice', 'value': BLAST}],
         note='Essences et formes de la décharge : texte seulement, dans les invocations. Épique : la formule suit la table et « +1d6 par niveau pair » ; l’exemple du livre (12d6 au 22) est incohérent avec la table. La cible damage.warlock_eldritch_blast est calculée par le moteur mais pas encore lue par la fiche.'),
    dict(id='detect_magic', level=2, fr='Détection de la magie', en='Detect magic',
         text="""Le sorcier sent la magie comme d’autres sentent la fumée : il lui suffit de s’y concentrer.""",
         rules=['À volonté, comme le sort détection de la magie.', 'Niveau de lanceur de sorts : son niveau de sorcier.']),
    dict(id='damage_reduction', level=3, fr='Réduction des dégâts', en='Damage reduction',
         text="""L’énergie surnaturelle qui coule dans son corps durcit sa peau : les coups ordinaires glissent. Seul le fer froid y laisse sa marque.""",
         rules=[
             '1/fer froid au niveau 3, 2 au 7, 3 au 11, 4 au 15, 5 au 19.',
             'Épique : +1 au niveau 23, puis tous les 4 niveaux (6 au 23, 7 au 27, 8 au 31…).',
         ],
         effects=[{'target': 'damage_reduction.cold_iron', 'op': 'add', 'value': f"1 + floor(({L} - 3) / 4)"}],
         note='Capacité surnaturelle. La cible damage_reduction.cold_iron est calculée par le moteur mais pas encore lue par la fiche (qui n’affiche que damage_reduction.none).'),
    dict(id='deceive_item', level=4, fr='Objet leurré', en='Deceive item',
         text="""Les objets réservés aux autres ne lui résistent pas longtemps : il bluffe les bâtons, les parchemins et les baguettes avec un naturel déconcertant.""",
         rules=['Dès le niveau 4, il peut faire 10 à un test d’Utilisation d’objets magiques, même distrait ou menacé.']),
    dict(id='fiendish_resilience', level=8, fr='Résistance du fiélon', en='Fiendish resilience',
         text="""Il tire de son pacte une résistance de fiélon : une fois par jour, il se referme sur lui-même et ses blessures se ferment toutes seules.""",
         rules=[
             'Une fois par jour, action libre : entre dans un état second pendant 2 minutes.',
             'Guérison accélérée 1 au niveau 8, 2 au niveau 13, 5 au niveau 18.',
         ],
         usesPerDay='1',
         effects=[{'target': 'fast_healing', 'op': 'add', 'condition': "active('toggle.warlock_fiendish_resilience')",
                   'value': f"if({L} >= 18, 5, if({L} >= 13, 2, 1))"}],
         note='Capacité surnaturelle. La guérison accélérée n’a pas encore de statistique lue par la fiche : à activer pendant l’état second (2 minutes).'),
    dict(id='energy_resistance', level=10, fr='Résistance aux énergies destructives', en='Energy resistance',
         text="""Deux formes d’énergie, choisies une fois pour toutes, ne le blessent presque plus.""",
         rules=[
             'Niveau 10 : résistance 5 à deux des cinq énergies (acide, électricité, feu, froid, son). Le choix est définitif.',
             'Niveau 20 : résistance 10 aux deux mêmes énergies.',
         ],
         note='Capacité surnaturelle. Le choix des deux énergies n’est pas dans le modèle (cible energy_resistance.<énergie>, valeur 5 puis 10) : à ajouter à la main.'),
    dict(id='imbue_item', level=12, fr='Objet enchanté', en='Imbue item',
         text="""À partir du niveau 12, il fabrique des objets magiques même sans connaître les sorts qu’ils contiennent : il se fie à son pouvoir pour combler les vides.""",
         rules=[
             'Il doit posséder le don de création d’objet correspondant.',
             'Il remplace le sort manquant par un test d’Utilisation d’objets magiques : DD 15 + niveau du sort (profane) ou 25 + niveau du sort (divin).',
             'En cas de réussite, il crée l’objet comme s’il avait lancé le sort. En cas d’échec, l’objet n’est pas fini mais il ne perd ni PX ni po ; il ne peut retenter qu’après un nouveau niveau.',
         ],
         note='Capacité surnaturelle.'),
]
