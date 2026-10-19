CLASS = dict(
    id='sorcerer', fr='Ensorceleur', en='Sorcerer', hitDie=4, skillPoints=2, epicBonusFeatEvery=3, labels=['arcane', 'spontaneous'],
    spellcasting={'ability': 'cha', 'kind': 'arcane', 'mode': 'spontaneous'},
    table=('sorcerer', '/page58.html'), spellColumns=10, knownTable=('sorcerer', '/page59.html'),
    text="""L’ensorceleur n’a jamais ouvert un grimoire. La magie est dans son sang : un dragon dans l’arbre généalogique, une étoile tombée le soir de sa naissance, personne ne sait vraiment. Elle s’est réveillée un jour, d’abord en étincelles, puis en flammes. Il connaît peu de sorts, mais il les connaît par cœur, et il peut les lancer encore et encore pendant que le magicien cherche sa page.""",
    rules=[
        'Dé de vie : d4. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : tous.',
        'Formé aux armes courantes ; ni armure ni bouclier (ils font échouer les sorts à composante gestuelle).',
        'Sorts profanes spontanés, basés sur le Charisme, du niveau 0 au niveau 9.',
        'Aptitude : appel de familier (1).',
    ],
    skills=['skill.bluff', 'skill.concentration', 'skill.craft', 'skill.knowledge_arcana', 'skill.profession',
            'skill.spellcraft'],
    proficiencies=['proficiency.simple_weapons'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts d’ensorceleur', en='Sorcerer spells',
         text="""Pas de livre, pas de préparation : l’ensorceleur tend la main et le sort vient. Son répertoire est court, mais il y puise librement tout au long de la journée.""",
         rules=[
             'Sorts profanes de la liste des ensorceleurs et magiciens, lancés sans préparation.',
             'Caractéristique : Charisme. Il faut au moins 10 + niveau du sort en Charisme pour l’apprendre ou le lancer. DD : 10 + niveau du sort + modificateur de Charisme.',
             'Sorts par jour et sorts connus selon le niveau d’ensorceleur ; sorts en bonus grâce à un Charisme élevé (pas pour les sorts connus).',
             'Au niveau 4, puis tous les 2 niveaux pairs, peut échanger un sort connu contre un autre de même niveau, au moins 2 niveaux sous son plus haut niveau de sort.',
             'Lance ses sorts avec un don de métamagie, mais l’incantation devient une action complexe.',
         ]),
    dict(id='summon_familiar', level=1, fr='Appel de familier', en='Summon familiar',
         text="""Un chat aux yeux trop intelligents, un corbeau qui répond quand on lui parle : le familier est un petit animal lié à l’âme du lanceur de sorts. Il l’espionne pour lui, porte ses sorts et partage ses pensées.""",
         rules=[
             'Rituel de 24 heures et 100 po : chat, chauve-souris, corbeau, crapaud, faucon, furet, hibou, lézard, rat, serpent (Très Petit) ou belette.',
             'Le maître gagne un bonus selon l’animal (par exemple +3 PV avec le crapaud, +2 en Discrétion avec le chat) et la vigilance quand le familier est à portée de bras.',
             'Le familier gagne en armure naturelle et en Intelligence avec le niveau du maître, et des pouvoirs : lien télépathique, transfert d’effet magique, esquive extraordinaire (1) ; conduit pour sorts de contact (3) ; parler avec le maître (5) ; parler aux animaux de son espèce (7) ; résistance à la magie (11) ; scrutation (13).',
             'S’il meurt, le maître rate un jet de Vigueur DD 15 ou perd 200 PX par niveau ; un nouveau familier demande un an et un jour.',
         ],
         effects=[{'target': 'familiar.master_level', 'op': 'add', 'value': "level('class.sorcerer')"}]),
]
