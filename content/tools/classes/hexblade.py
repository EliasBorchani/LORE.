L = "level('class.hexblade')"

BAB = list(range(1, 21))
SAVE = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
WILL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
N = None
# Spells per day, spell levels 1 to 4 (None = « — », 0 = bonus spells only), from Table 1-3.
PER_DAY = {
    4: [0, N, N, N], 5: [0, N, N, N], 6: [1, N, N, N], 7: [1, N, N, N], 8: [1, 0, N, N], 9: [1, 0, N, N],
    10: [1, 1, N, N], 11: [1, 1, 0, N], 12: [1, 1, 1, N], 13: [1, 1, 1, N], 14: [2, 1, 1, 0], 15: [2, 1, 1, 1],
    16: [2, 2, 1, 1], 17: [2, 2, 2, 1], 18: [3, 2, 2, 1], 19: [3, 3, 3, 2], 20: [3, 3, 3, 3],
}
# Spells known (Table 1-4).
KNOWN = {
    4: [2, N, N, N], 5: [2, N, N, N], 6: [3, N, N, N], 7: [3, N, N, N], 8: [4, 2, N, N], 9: [4, 2, N, N],
    10: [4, 3, N, N], 11: [4, 3, 2, N], 12: [4, 4, 3, N], 13: [4, 4, 3, N], 14: [4, 4, 4, 2], 15: [4, 4, 4, 3],
    16: [4, 4, 4, 3], 17: [5, 4, 4, 4], 18: [5, 5, 4, 4], 19: [5, 5, 5, 4], 20: [5, 5, 5, 5],
}
ROWS = []
for lv in range(1, 21):
    ROWS.append({'level': lv, 'bab': BAB[lv - 1], 'fort': SAVE[lv - 1], 'ref': SAVE[lv - 1], 'will': WILL[lv - 1],
                 'spellsPerDay': [N] + PER_DAY.get(lv, [N, N, N, N]),
                 'spellsKnown': [N] + KNOWN.get(lv, [N, N, N, N])})

CLASS = dict(
    id='hexblade', fr='Tourmenteur', en='Hexblade', hitDie=10, skillPoints=2, epicBonusFeatEvery=3,
    source='Complete Warrior', labels=['martial', 'arcane', 'spontaneous'],
    spellcasting={'ability': 'cha', 'kind': 'arcane', 'mode': 'spontaneous'},
    rows=ROWS,
    # Hexblade caster level: half the class level from level 4, none before.
    effects=[{'target': 'caster_level.hexblade', 'op': 'add', 'value': f"if({L} >= 4, floor({L} / 2), 0) - {L}"}],
    text="""Le tourmenteur est un épéiste qui a un peu de magie dans le sang. Il se bat comme un guerrier, maudit ses adversaires pour leur gâcher le combat, et résiste à la magie avec un aplomb qui irrite les mages. Plus tard viennent quelques sorts, un familier et une aura qui fait glisser les coups sur lui.""",
    rules=[
        'Dé de vie : d10. Points de compétence : 2 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : jamais bon.',
        'Formé à toutes les armes courantes et de guerre et aux armures légères ; pas aux boucliers. Pas de risque d’échec des sorts en armure légère ; armure intermédiaire, lourde ou bouclier : risque normal.',
        'Sorts profanes spontanés de sa propre liste, basés sur le Charisme, du niveau 1 au niveau 4, à partir du niveau 4 ; niveau de lanceur : la moitié de son niveau de tourmenteur.',
        'Aptitudes : tourment (1, 5, 9, 13, 17) ; résistance profane (2) ; ardeur (3) ; appel de familier et sorts (4) ; dons supplémentaires (5, 10, 15, 20) ; tourment supérieur (7) ; aura de malchance (12, 16, 20) ; tourment suprême (19).',
        'Un tourmenteur dont l’alignement devient bon perd ses aptitudes surnaturelles et ses sorts, et ne progresse plus dans la classe.',
    ],
    note='Perte des pouvoirs en cas d’alignement bon : seulement dans le texte. Le livre ne donne pas de règle épique propre au tourmenteur : un don supplémentaire tous les 3 niveaux au-delà du 20 (à confirmer). La liste de sorts est dans le lot des listes.',
    skills=['skill.spellcraft', 'skill.craft', 'skill.bluff', 'skill.concentration', 'skill.knowledge_arcana',
            'skill.diplomacy', 'skill.ride', 'skill.intimidate', 'skill.profession'],
    proficiencies=['proficiency.simple_weapons', 'proficiency.martial_weapons', 'proficiency.light_armor'],
    alignments=['lawful_neutral', 'neutral', 'chaotic_neutral', 'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='hexblades_curse', level=1, fr='Tourment', en='Hexblade’s curse',
         text="""D’un regard, le tourmenteur jette sur un adversaire une malédiction qui lui gâche tout : ses coups, ses sorts, ses réflexes.""",
         rules=['Action libre, une fois par jour au niveau 1, puis une fois de plus aux niveaux 5, 9, 13 et 17.',
                'La cible doit être vue et à 18 m ou moins. Pendant 1 heure : −2 aux jets d’attaque, aux jets de sauvegarde, aux tests de caractéristique et de compétence, et aux jets de dégâts des armes.',
                'Jet de Volonté (DD 10 + moitié de son niveau + modificateur de Charisme) pour annuler l’effet ; un jet réussi immunise cette cible contre ce tourmenteur pendant 24 heures.',
                'Plusieurs tourments sur la même cible ne se cumulent pas. Délivrance des malédictions ou dissipation de la magie y met fin.'],
         usesPerDay=f"1 + floor(({L} - 1) / 4)",
         note='Le malus touche la cible, pas la fiche du tourmenteur : pas d’effet chiffré.'),
    dict(id='arcane_resistance', level=2, fr='Résistance profane', en='Arcane resistance',
         text="""La magie hostile glisse sur lui plus facilement que sur les autres.""",
         rules=['Bonus égal à son bonus de Charisme (au moins +1) aux jets de sauvegarde contre les sorts et les pouvoirs magiques.'],
         effects=[{'target': 'save.all', 'op': 'add', 'value': 'max(1, @ability.cha.mod)', 'situation': 'situation.vs_spells'}]),
    dict(id='mettle', level=3, fr='Ardeur', en='Mettle',
         text="""Là où d’autres encaissent la moitié d’un sort, lui serre les dents et n’en sent rien.""",
         rules=['Quand il réussit un jet de Vigueur ou de Volonté contre une attaque qui, en cas de réussite, n’a qu’un effet réduit (« Vigueur, partiel » ou « Volonté, partiel »), il ne subit aucun effet.',
                'Sans effet s’il est inconscient ou endormi.'],
         note='Pas encore dans le modèle (texte seulement).'),
    dict(id='summon_familiar', level=4, fr='Appel de familier', en='Summon familiar',
         text="""Un chat aux yeux trop intelligents, un corbeau qui répond quand on lui parle : le familier est un petit animal lié à l’âme de son maître.""",
         rules=['Rituel de 24 heures et 100 po. Comme un ensorceleur de 3 niveaux de moins pour les pouvoirs et caractéristiques du familier.',
                'S’il meurt ou est renvoyé, le maître rate un jet de Vigueur DD 15 ou perd 200 PX par niveau de tourmenteur ; un nouveau familier demande un an et un jour.',
                'Un personnage multiclassé n’a qu’un seul familier à la fois.'],
         effects=[{'target': 'familiar.master_level', 'op': 'add', 'value': f"max(0, {L} - 3)"}]),
    dict(id='spells', level=4, fr='Sorts de tourmenteur', en='Hexblade spells',
         text="""Quelques sorts, appris sans livre et lancés sans préparation : de quoi pousser un adversaire à l’erreur et protéger l’épéiste.""",
         rules=['Sorts profanes de la liste du tourmenteur, du niveau 1 au niveau 4, lancés sans préparation.',
                'Caractéristique : Charisme. Il faut au moins 10 + niveau du sort en Charisme. DD : 10 + niveau du sort + modificateur de Charisme.',
                'Sorts par jour selon le niveau de tourmenteur, plus des sorts en bonus grâce à un Charisme élevé ; un « 0 » dans la table veut dire seulement les sorts en bonus. Sorts connus fixes, sans bonus de Charisme.',
                'Niveau de lanceur : la moitié de son niveau de tourmenteur.',
                'Aux niveaux 12, 15 et 18, peut échanger un sort connu contre un autre de même niveau, au moins 2 niveaux sous son plus haut niveau de sort.']),
    dict(id='bonus_feats', level=5, fr='Dons supplémentaires', en='Bonus feats',
         text="""Ses talents d’épéiste et de lanceur de sorts se prolongent par des dons choisis dans une liste courte.""",
         rules=['Un don supplémentaire aux niveaux 5, 10, 15 et 20, à choisir dans la liste de la classe ; il doit en remplir les conditions.',
                'Liste : École renforcée (enchantement, nécromancie ou transmutation seulement), École supérieure (mêmes écoles), Efficacité des sorts accrue, Efficacité des sorts supérieure, Magie de guerre.'],
         effects=[{'target': 'feat_slots.hexblade_bonus', 'op': 'add', 'value': f"min(4, floor({L} / 5))"}],
         note='Liste de dons : Spell Focus et Greater Spell Focus restreints aux écoles d’Enchantement, Nécromancie et Transmutation.'),
    dict(id='greater_hexblades_curse', level=7, fr='Tourment supérieur', en='Greater hexblade’s curse',
         text="""Sa malédiction mord plus fort.""",
         rules=['Le malus du tourment passe à −4 (au lieu de −2).']),
    dict(id='aura_of_unluck', level=12, fr='Aura de malchance', en='Aura of unluck',
         text="""Autour de lui, les coups dévient comme si la chance avait changé de camp.""",
         rules=['Action libre : toute attaque, au corps à corps ou à distance, contre lui a 20 % de chances de rater (comme un camouflage).',
                'Dure 3 rounds + son bonus de Charisme (s’il est positif).',
                'Une fois par jour au niveau 12, puis une fois de plus aux niveaux 16 et 20.'],
         usesPerDay=f"1 + (if({L} >= 16, 1, 0)) + (if({L} >= 20, 1, 0))"),
    dict(id='dire_hexblades_curse', level=19, fr='Tourment suprême', en='Dire hexblade’s curse',
         text="""Son tourment est devenu écrasant.""",
         rules=['Le malus du tourment passe à −6 (au lieu de −4).']),
]
