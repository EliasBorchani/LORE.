from _variant import load, rows, powers
L = "level('class.paladin_variant')"
base = load('paladin')

CLASS = dict(
    id='paladin_variant', fr='Paladin (sans magie)', en='Paladin (variant, no spellcasting)', hitDie=10, skillPoints=2,
    epicBonusFeatEvery=3, source='Complete Warrior', labels=['martial'],
    rows=rows('paladin'),
    text="""Dans une campagne centrée sur les combattants, le paladin renonce aux prières préparées. Il garde son serment, sa lumière, son destrier et ses mains qui guérissent, et gagne en échange des pouvoirs plus sûrs : une arme qui frappe comme le bien, une puissance divine qui gonfle ses bras, sa sagesse ou sa voix, des soins qui relèvent aussi sa monture.""",
    rules=[
        'Mêmes dé de vie, points de compétence, compétences, formation, alignement (loyal bon), code de conduite et progression d’attaque et de sauvegardes que le paladin du Manuel des Joueurs.',
        'Pas de sorts divins, pas de niveau de lanceur.',
        'Aptitudes du paladin conservées : aura de Bien, détection du Mal, châtiment du Mal (1) ; grâce divine, imposition des mains (2) ; aura de bravoure, santé divine (3) ; renvoi des morts-vivants (4) ; destrier (5) ; guérison des maladies (6).',
        'Aptitudes ajoutées : arme bénie (6) ; puissance divine (11) ; soins de la monture (13) ; épée sainte (16).',
    ],
    note='Variante du Codex Martial : le paladin du Manuel des Joueurs sans les sorts. Les aptitudes inchangées reprennent celles du paladin (mêmes ids) ; celles dont les formules lisent le niveau de classe sont recopiées pour lire le niveau de paladin sans magie.',
    skills=list(base.CLASS['skills']),
    proficiencies=list(base.CLASS['proficiencies']),
    alignments=['lawful_good'],
)

POWERS = powers('paladin', {'spells'}, 'paladin_variant') + [
    dict(id='blessed_weapon', level=6, fr='Arme bénie', en='Blessed weapon',
         text="""Dans ses mains, une arme ordinaire frappe comme si elle avait été forgée pour le bien.""",
         rules=['Toute arme de corps à corps qu’il manie est considérée comme d’alignement bon pour ignorer la réduction des dégâts.']),
    dict(id='divine_power', level=11, fr='Puissance divine', en='Divine power',
         text="""Une prière, et la force du ciel passe dans ses bras, sa sagesse ou sa voix.""",
         rules=['Une fois par jour, action simple : +4 en Force, en Sagesse ou en Charisme (au choix) pendant 1 minute par niveau de paladin.'],
         usesPerDay=1,
         note='Choix de la caractéristique : pas encore dans le modèle (texte seulement).'),
    dict(id='mount_healing', level=13, fr='Soins de la monture', en='Mount healing',
         text="""Ses mains qui guérissent soignent aussi la bête qui le porte, et la relèvent de ce qui l’abat.""",
         rules=['Quand il utilise l’imposition des mains sur sa monture, elle regagne 5 points de vie par point de soin dépensé.',
                'Peut aussi dépenser l’imposition des mains pour retirer un état à sa monture, à 5 points de soin par état : assourdi, aveuglé, confus, ébloui, empoisonné, épuisé, étourdi, fatigué, fiévreux, frappé d’aliénation mentale, frappé de débilité, hébété, malade, nauséeux.',
                'Un affaiblissement temporaire de caractéristique coûte 1 point de soin par point restauré.',
                'Peut retirer un état et rendre des points de vie en même temps, mais les points dépensés pour un état ne servent pas aux points de vie.']),
    dict(id='holy_sword', level=16, fr='Épée sainte', en='Holy sword',
         text="""Une fois par jour, l’épée du paladin s’embrase d’une lumière qui ne souffre pas le mal.""",
         rules=['Pouvoir magique : épée sainte, à un niveau de lanceur égal à la moitié de son niveau de paladin.'],
         usesPerDay=1,
         note='La page du Codex ne donne pas la fréquence ; une fois par jour, comme les pouvoirs magiques du rôdeur alternatif (à confirmer).'),
]
