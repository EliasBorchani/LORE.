CLASS = dict(
    id='fighter', fr='Guerrier', en='Fighter', hitDie=10, skillPoints=2, epicBonusFeatEvery=2, labels=['martial'],
    table=('fighter', '/page61.html'),
    text="""Pas de magie, pas de prière, pas de chanson. Le guerrier a une arme, une armure, et des milliers d’heures d’entraînement. Chevalier en armure de plaque, mercenaire à la hache, archer de la garde : tous ont appris la même leçon, que le combat se gagne par la technique avant de se gagner par la force. Plus que n’importe qui, il choisit ses talents, un par un, et devient la meilleure version de l’arme qu’il a décidé d’être.""",
    rules=[
        'Dé de vie : d10. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : tous.',
        'Formé à toutes les armes courantes et de guerre, à toutes les armures et à tous les boucliers, pavois compris.',
        'Aptitude : un don supplémentaire au niveau 1, puis à chaque niveau pair.',
    ],
    skills=['skill.climb', 'skill.craft', 'skill.handle_animal', 'skill.intimidate', 'skill.jump', 'skill.ride',
            'skill.swim'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.martial_weapons', 'proficiency.light_armor',
                   'proficiency.medium_armor', 'proficiency.heavy_armor', 'proficiency.shields',
                   'proficiency.tower_shield'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='bonus_feats', level=1, fr='Dons supplémentaires', en='Bonus feats',
         text="""Là où d’autres apprennent des sorts, le guerrier apprend des bottes, des parades et des feintes. C’est sa seule aptitude de classe, et elle suffit.""",
         rules=['Un don supplémentaire au niveau 1, puis aux niveaux 2, 4, 6 et ainsi de suite à chaque niveau pair (11 au niveau 20).',
                'À choisir parmi les dons de guerrier (marqués comme tels) ; les conditions restent nécessaires.',
                'Ces dons s’ajoutent aux dons gagnés par le niveau.'],
         effects=[{'target': 'feat_slots.fighter_bonus', 'op': 'add', 'value': "1 + floor(level('class.fighter') / 2)"}]),
]
