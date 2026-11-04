from _variant import load, rows, powers
L = "level('class.ranger_variant')"
base = load('ranger')

CLASS = dict(
    id='ranger_variant', fr='Rôdeur (sans magie)', en='Ranger (variant, no spellcasting)', hitDie=8, skillPoints=6,
    epicBonusFeatEvery=3, source='Complete Warrior', labels=['martial'],
    rows=rows('ranger'),
    text="""Dans une campagne centrée sur les combattants, le rôdeur laisse ses prières de côté. Il garde sa piste, son ennemi juré et son compagnon, et y gagne la vitesse du chasseur, une bénédiction de la nature et des soins qu’il tient de la forêt elle-même.""",
    rules=[
        'Mêmes dé de vie, points de compétence, compétences, formation, alignement et progression d’attaque et de sauvegardes que le rôdeur du Manuel des Joueurs.',
        'Pas de sorts divins, pas de niveau de lanceur.',
        'Aptitudes du rôdeur conservées : ennemi juré, pistage et empathie sauvage (1) ; style de combat (2) ; endurance (3) ; compagnon animal (4) ; science du style de combat (6) ; déplacement facilité (7) ; pistage accéléré (8) ; esquive totale (9) ; maîtrise du style de combat (11) ; camouflage (13) ; discrétion totale (17).',
        'Aptitudes ajoutées : déplacement accéléré (6) ; bénédiction de la nature (11) ; contact guérisseur (13) ; liberté de mouvement (16).',
    ],
    note='Variante du Codex Martial : le rôdeur du Manuel des Joueurs sans les sorts. Les aptitudes inchangées reprennent celles du rôdeur (mêmes ids) ; celles dont les formules lisent le niveau de classe sont recopiées pour lire le niveau de rôdeur sans magie.',
    skills=list(base.CLASS['skills']),
    proficiencies=list(base.CLASS['proficiencies']),
    alignments=list(base.CLASS['alignments']),
)

POWERS = powers('ranger', {'spells'}, 'ranger_variant') + [
    dict(id='fast_movement', level=6, fr='Déplacement accéléré', en='Fast movement',
         text="""Le rôdeur parcourt la nature d’un pas plus long que celui des autres.""",
         rules=['Vitesse au sol de base : +3 m.', 'Sans effet en armure lourde ou avec une charge lourde.'],
         effects=[{'target': 'speed.land', 'op': 'add', 'value': 3}],
         note='Perte en armure lourde ou chargé : l’équipement porté n’est pas encore dans le modèle, le bonus s’applique toujours.'),
    dict(id='natures_blessing', level=11, fr='Bénédiction de la nature', en='Nature’s blessing',
         text="""La forêt lui prête un instant sa vigueur, sa vivacité ou sa sagesse.""",
         rules=['Une fois par jour, action simple : +4 en Dextérité, en Constitution ou en Sagesse (au choix) pendant 1 minute par niveau de rôdeur.'],
         usesPerDay=1,
         note='Choix de la caractéristique : pas encore dans le modèle (texte seulement).'),
    dict(id='healing_touch', level=13, fr='Contact guérisseur', en='Healing touch',
         text="""Une main posée sur un blessé, un peu d’herbe, et le poison ou la fièvre s’en vont.""",
         rules=['Une fois par jour, neutralisation du poison ou guérison des maladies (au choix), à un niveau de lanceur égal à la moitié de son niveau de rôdeur.'],
         usesPerDay=1),
    dict(id='free_movement', level=16, fr='Liberté de mouvement', en='Free movement',
         text="""Cordes, poigne, magie qui entrave : rien ne le retient un instant.""",
         rules=['Une fois par jour, liberté de mouvement sur lui seul, à un niveau de lanceur égal à la moitié de son niveau de rôdeur.'],
         usesPerDay=1),
]
