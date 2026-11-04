BAB = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10]
SAVE = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
WILL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]


def per_day(level):
    # Table 1-5: 5 spells of level 0 at level 1, then 6; each spell level starts at 3 and gains 1 per level up to 6.
    out = [5 if level == 1 else 6]
    for s in range(1, 10):
        first = 1 if s == 1 else 2 * s
        if level >= first:
            out.append(6 if (s == 9 and level == 20) else min(6, 3 + level - first))
    return out + [None] * (10 - len(out))


# Table 1-6, read from the page image: per level, one (element, any element) pair per spell level, written « o+a+b »
# in the book (o = the order's spell). spellsKnown holds the total 1 + a + b.
KNOWN = [
    [(2, 2), (1, 1)],
    [(3, 2), (1, 1)],
    [(3, 2), (2, 1)],
    [(3, 3), (2, 1), (1, 0)],
    [(4, 3), (2, 2), (1, 1)],
    [(4, 3), (2, 2), (1, 1), (1, 0)],
    [(4, 4), (3, 2), (2, 1), (1, 1)],
    [(4, 4), (3, 2), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (2, 2), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (2, 2), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (2, 1), (1, 1), (1, 0)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (2, 1), (2, 1), (1, 1)],
    [(5, 4), (3, 2), (3, 2), (2, 2), (2, 2), (2, 2), (2, 1), (2, 1), (2, 1), (2, 1)],
]

ROWS = []
for i in range(20):
    known = [1 + a + b for a, b in KNOWN[i]]
    ROWS.append({'level': i + 1, 'bab': BAB[i], 'fort': SAVE[i], 'ref': SAVE[i], 'will': WILL[i],
                 'spellsPerDay': per_day(i + 1), 'spellsKnown': known + [None] * (10 - len(known))})

CLASS = dict(
    id='shugenja', fr='Shugenja', en='Shugenja', hitDie=6, skillPoints=4, epicBonusFeatEvery=3,
    source='Complete Divine', labels=['divine', 'spontaneous'],
    spellcasting={'ability': 'cha', 'kind': 'divine', 'mode': 'spontaneous'},
    rows=ROWS,
    text="""Le shugenja prie les esprits de l’air, de la terre, du feu et de l’eau, et ils lui répondent. Il écrit ses invocations sur des bandelettes de papier, les ofudas, qu’il lit à voix haute pour lancer un sort. Chacun se voue à un élément, qui colore toute sa magie, et se tient à l’écart de l’élément contraire.""",
    rules=[
        'Dé de vie : d6. Points de compétence : 4 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : tous.',
        'Formé aux armes courantes et à l’épée courte ; ni armure ni bouclier. L’armure plus lourde que le cuir donne un malus aux tests d’Acrobaties, Déplacement silencieux, Discrétion, Équilibre, Escalade, Escamotage, Évasion, Natation et Saut, mais ne gêne pas ses sorts.',
        'Sorts divins spontanés, basés sur le Charisme, du niveau 0 au niveau 9 ; liste propre au shugenja.',
        'Aptitudes : concentration élémentaire (1), perception élémentaire (1).',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…).',
    ],
    note='Épique : le Codex Divin donne ici la table jusqu’au niveau 20 seulement ; le don supplémentaire tous les 3 niveaux au-delà est la règle maison des classes du Codex. Les sorts connus de la table sont le total « o + élément + autre » (o = sort d’ordre). Les listes de sorts du shugenja (pages 146 à 151) sont dans un autre lot.',
    skills=['skill.spellcraft', 'skill.craft', 'skill.concentration', 'skill.knowledge', 'skill.diplomacy',
            'skill.heal', 'skill.profession'],
    proficiencies=['proficiency.simple_weapons', 'item.short_sword'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts de shugenja', en='Shugenja spells',
         text="""Le shugenja ne prépare rien : au moment de lancer, il choisit un sort parmi ceux qu’il connaît et lit son ofuda. Son répertoire est mince, mais l’ordre dont il vient lui offre un sort de chaque niveau.""",
         rules=[
             'Sorts divins de la liste des shugenjas, lancés sans préparation (comme un ensorceleur).',
             'Caractéristique : Charisme. Il faut au moins 10 + niveau du sort en Charisme pour l’apprendre ou le lancer. DD : 10 + niveau du sort + modificateur de Charisme. Sorts en bonus grâce à un Charisme élevé.',
             'Sorts par jour selon le niveau de shugenja (table 1-5). Il peut dépenser un emplacement d’un niveau supérieur pour lancer un sort ; le sort garde son niveau réel.',
             'Sorts connus (table 1-6) : au niveau 1, quatre sorts de niveau 0 et deux sorts du 1er niveau de son choix, plus un sort de chaque niveau imposé par son ordre. Le Charisme ne change pas le nombre de sorts connus.',
             'Aux niveaux 4, 6, 8…, il peut remplacer un sort connu par un autre du même niveau, au plus de 2 niveaux sous son plus haut niveau de sorts ; un seul échange par niveau, et il doit rester conforme à sa concentration élémentaire.',
             'Pas de livre de sorts : il écrit ses sorts sur des ofudas, qui servent de focaliseur divin. Il peut utiliser Écriture de parchemins (parchemins divins).',
             'Métamagie : il choisit son sort au moment de le lancer, donc un sort métamagique prend une action complexe de plus (action complexe pour un sort d’une action simple, sinon +1 action complexe). Il ne peut pas utiliser Incantation rapide.',
         ],
         note='Les sorts d’ordre et l’obligation de choisir la moitié des sorts connus dans son élément ne sont pas contrôlés par la feuille.'),
    dict(id='elemental_focus', level=1, fr='Concentration élémentaire', en='Elemental focus',
         text="""Chaque shugenja se voue à l’air, la terre, le feu ou l’eau, souvent selon l’ordre qui l’a formé. Cet élément devient sa spécialité, et son contraire lui est fermé.""",
         rules=[
             'Il choisit un élément de prédilection : Air, Terre, Feu ou Eau (l’ordre de l’Ineffable Mystère laisse le choix libre).',
             'Au moins la moitié de ses sorts connus de chaque niveau sont de cet élément (table 1-6, « o + a + b » : o = le sort imposé par l’ordre, a = sorts de son élément à choisir en plus, b = sorts à choisir dans n’importe quel élément non interdit). La feuille compte le total 1 + a + b.',
             'Il gagne le don École de prédilection pour les sorts de son élément, quelle que soit l’école : +1 au DD des jets de sauvegarde contre ces sorts.',
             'Il ne peut pas apprendre de sorts de l’élément contraire : Air contre Terre, Feu contre Eau (et inversement).',
             'Air : voyage, intuition, influence, divination, illusion. Terre : détermination, santé, croissance, solidité de la matière. Feu : destruction, vision, mais aussi intelligence, inspiration, création. Eau : transformation, purification, guérison, amitié.',
         ],
         note='Nom anglais à confirmer (« Elemental focus »). L’élément choisi et l’élément interdit se notent dans les notes de la fiche ; le +1 au DD dépend de l’élément de chaque sort lancé : pas dans le modèle. Le Vide est un cinquième élément réservé à une classe de prestige (chapitre 2).'),
    dict(id='elemental_sense', level=1, fr='Perception élémentaire', en='Elemental sense',
         text="""L’un des premiers talents du shugenja, si simple qu’on le compte comme un pouvoir magique : sentir où se cachent l’air, la terre, le feu ou l’eau autour de lui.""",
         rules=[
             'Pouvoir magique, action complexe : il sent toutes les sources d’un élément choisi (Air, Terre, Feu ou Eau) dans 3 m. Il connaît leur taille, pas leur position ni leur nature exactes.',
             'Chaque round de concentration de plus ajoute 1,50 m au rayon, jusqu’à niveau de shugenja × 1,50 m en plus.',
             'Ou il se concentre sur une seule source par round et fait un test d’Art de la magie : 20 = position approximative ; 25 = naturelle ou issue d’un sort (Art de la magie DD 20 + niveau du sort pour le sort) ; 30 = créature ou objet ; 35 = nature exacte.',
             '3 utilisations par jour au niveau 1, +1 tous les 5 niveaux (4 au niveau 5, 5 au niveau 10…).',
             'Bloqué par 1 m de bois ou de terre, 30 cm de pierre, 2,5 cm de métal ordinaire ou une mince feuille de plomb.',
         ],
         note='Nom anglais à confirmer (« Elemental sense »).',
         usesPerDay="3 + floor(level('class.shugenja') / 5)"),
    dict(id='orders', level=1, fr='Ordres de shugenja', en='Shugenja orders',
         text="""Nul shugenja ne s’instruit seul : il sort d’un ordre, qui lui lègue la prière d’un sort par niveau. Chaque ordre a sa couleur, du feu qui dévore à la pierre que l’on sculpte.""",
         rules=[
             'Chaque ordre donne un sort connu par niveau, du niveau 0 au niveau 9 (le « o » de la table 1-6).',
             'Impénétrable Creuset : Résistance, Arme magique, Cacophonie, Arme magique suprême, Renvoi, Protection contre la mort, Bannissement, Champ de force, Entrave, Emprisonnement.',
             'Ineffable Mystère : Résistance, Bouclier entropique, Dissimulation d’objet, Dissipation de la magie, Immunité contre les sorts, Résistance à la magie, Zone d’antimagie, Renvoi des sorts, Protection contre les sorts, Disjonction de Mordenkainen.',
             'Œil Omnivoyant : Assistance divine, Détection des collets et des fosses, Détection de pensées, Clairaudience/clairvoyance, Divination, Communion avec la nature, Orientation, Mythes et légendes, Vision mystique, Prémonition.',
             'Douce Pluie : Soins superficiels, Soins légers, Augure, Soins importants, Soins intensifs, Communion, Guérison suprême, Résurrection, Guérison suprême de groupe, Capture d’âme.',
             'Flamme Dévorante : Illumination, Mains brûlantes, Flammes, Lumière brûlante, Boule de feu, Colonne de feu, Feux purificateurs, Tempête de feu, Boule de feu à retardement, Nuée de météores.',
             'Lande Interdite : Détection de la magie, Regain d’assurance, Odorat, Restauration partielle, Cerf fantôme, Brume de pureté, Contrôle du climat, Scrutation suprême, Flétrissure, Grand tertre.',
             'Sculpture Parfaite : Réparation, Pierre magique, Ramollissement de la terre et de la pierre, Façonnage de la pierre, Subversion planaire, Transmutation de la pierre en boue, Pétrification, Statue, Tremblement de terre, Aversion.',
             'Zéphire de Printemps : Hébétement, Déguisement, Flou, Invisibilité, Marche dans les airs, Invisibilité suprême, Voile, Double illusoire, Écran, Prémonition.',
         ],
         note='Les sorts d’ordre ne sont pas contrôlés par la feuille : le joueur les choisit parmi les sorts connus.'),
]
