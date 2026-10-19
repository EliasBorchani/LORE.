L = "level('class.cleric')"

CLASS = dict(
    id='cleric', fr='Prêtre', en='Cleric', hitDie=8, skillPoints=2, epicBonusFeatEvery=3, labels=['divine', 'prepared'],
    spellcasting={'ability': 'wis', 'kind': 'divine', 'mode': 'prepared'},
    table=('cleric', '/page94.html'), spellColumns=10,
    text="""Le prêtre est la main de son dieu dans le monde. Il porte l’armure lourde, la masse et le symbole sacré, et il sait s’en servir : il soigne au cœur de la mêlée, chasse les morts qui marchent et rappelle à la vie ceux qu’on croyait perdus. Chaque matin, il prie, et son dieu lui confie les sorts du jour. Ce que le prêtre en fait, en revanche, ne regarde que lui, et il en rendra compte un jour.""",
    rules=[
        'Dé de vie : d8. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : à un pas au plus de celui de son dieu (sur l’axe Bien–Mal ou Loi–Chaos) ; neutre seulement si son dieu l’est.',
        'Formé aux armes courantes, à toutes les armures et aux boucliers (sauf le pavois) ; souvent aussi à l’arme de prédilection de son dieu, grâce à un domaine.',
        'Sorts divins préparés, basés sur la Sagesse, du niveau 0 au niveau 9, plus un sort de domaine par niveau.',
        'Un prêtre qui trahit gravement son dieu perd ses sorts et pouvoirs jusqu’à sa pénitence.',
        'Aptitudes : aura, sorts et domaines, renvoi ou intimidation des morts-vivants (1).',
    ],
    note='Dieu, domaines et alignement par rapport au dieu : pas encore dans le modèle (les domaines viendront avec le contenu).',
    skills=['skill.concentration', 'skill.craft', 'skill.diplomacy', 'skill.heal', 'skill.knowledge_arcana',
            'skill.knowledge_history', 'skill.knowledge_religion', 'skill.knowledge_planes', 'skill.profession',
            'skill.spellcraft'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.light_armor', 'proficiency.medium_armor',
                   'proficiency.heavy_armor', 'proficiency.shields'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='aura', level=1, fr='Aura', en='Aura',
         text="""La foi laisse une trace. Autour du prêtre d’un dieu bon brille une lueur que sentent les paladins ; autour de celui d’un dieu cruel, une ombre.""",
         rules=['Aura de Bien, de Mal, de Loi ou de Chaos selon l’alignement de son dieu, d’une puissance égale à son niveau de prêtre (pour les sorts de détection).']),
    dict(id='spells', level=1, fr='Sorts de prêtre', en='Cleric spells',
         text="""Chaque jour, à heure fixe, le prêtre prie, et son dieu remplit ses mains de miracles. Il en garde toujours un pour soigner, au cas où.""",
         rules=[
             'Sorts divins de la liste du prêtre, préparés chaque jour à l’heure de sa prière parmi toute la liste.',
             'Caractéristique : Sagesse. Il faut au moins 10 + niveau du sort en Sagesse pour le préparer ou le lancer. DD : 10 + niveau du sort + modificateur de Sagesse.',
             'Sorts par jour selon le niveau de prêtre ; sorts en bonus grâce à une Sagesse élevée.',
             'Domaines : choisit deux domaines de son dieu, qui lui donnent chacun un pouvoir. À chaque niveau de sort qu’il peut lancer, un emplacement de plus, réservé à un sort de l’un de ses domaines.',
             'Incantation spontanée : un prêtre bon (ou neutre qui renvoie les morts-vivants) peut sacrifier un sort préparé, hors domaine, pour lancer un sort de soins du même niveau ; un prêtre mauvais (ou neutre qui les intimide), un sort de blessure.',
             'Ne lance pas les sorts d’un alignement opposé au sien ou à celui de son dieu.',
         ],
         # The domain slot: one more slot at every spell level the class table opens.
         effects=[{'target': f'slots.cleric[{level}]', 'op': 'add', 'value': 1,
                   'condition': f'@slots.base[class.cleric:{level}] >= 0'} for level in range(1, 10)],
         note='Le sort de domaine est compté dans les emplacements ; le choix des domaines viendra avec leur contenu.'),
    dict(id='turn_undead', level=1, fr='Renvoi ou intimidation des morts-vivants', en='Turn or rebuke undead',
         text="""Le prêtre lève son symbole sacré et prononce le nom de son dieu. Les morts-vivants fuient, s’effondrent en poussière, ou s’agenouillent, selon le dieu.""",
         rules=['Un prêtre bon renvoie ou détruit les morts-vivants ; un prêtre mauvais les intimide ou les contrôle ; un prêtre neutre choisit une fois pour toutes.',
                'Utilisations par jour : 3 + modificateur de Charisme. Action simple.',
                'Test de renvoi (1d20 + modificateur de Charisme) pour le plus puissant affecté, puis dégâts de renvoi (2d6 + niveau de prêtre + modificateur de Charisme) en dés de vie affectés.',
                'Les morts-vivants de dés de vie au plus la moitié de son niveau sont détruits (ou contrôlés).'],
         usesPerDay='3 + @ability.cha.mod',
         effects=[{'target': 'turn_undead.level', 'op': 'add', 'value': L}]),
]
