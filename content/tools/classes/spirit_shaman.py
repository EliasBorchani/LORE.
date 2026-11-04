L = "level('class.spirit_shaman')"

N = None
BAB = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15]
REF = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]
GOOD = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12]
# Spells per day (Table 1-1): from level 5 the shaman has at most 6 of each level; a new level starts at 2.
# Retrieved spells per day (Table 1-2, read from the page image) are the spells known.
KNOWN = [
    [3, 1], [3, 2], [3, 2, 1], [3, 3, 1], [3, 3, 1, 1], [3, 3, 2, 1], [3, 3, 2, 1, 1], [3, 3, 2, 2, 1],
    [3, 3, 3, 2, 1, 1], [3, 3, 3, 2, 2, 1], [3, 3, 3, 3, 2, 1, 1], [3, 3, 3, 3, 2, 2, 1],
    [3, 3, 3, 3, 3, 2, 1, 1], [3, 3, 3, 3, 3, 2, 2, 1], [3, 3, 3, 3, 3, 3, 2, 1, 1],
    [3, 3, 3, 3, 3, 3, 2, 2, 1], [3, 3, 3, 3, 3, 3, 3, 2, 1, 1], [3, 3, 3, 3, 3, 3, 3, 2, 2, 1],
    [3, 3, 3, 3, 3, 3, 3, 3, 2, 2], [3, 3, 3, 3, 3, 3, 3, 3, 3, 2],
]


def per_day(lv):
    row = [min(6, lv + 2)]
    for s in range(1, 10):
        row.append(min(6, lv - 2 * s + 3) if lv >= 2 * s - 1 else N)
    return row


def pad(r):
    return r + [N] * (10 - len(r))


ROWS = [{'level': lv, 'bab': BAB[lv - 1], 'fort': GOOD[lv - 1], 'ref': REF[lv - 1], 'will': GOOD[lv - 1],
         'spellsPerDay': per_day(lv), 'spellsKnown': pad(KNOWN[lv - 1])} for lv in range(1, 21)]

CLASS = dict(
    id='spirit_shaman', fr='Chaman spiritiste', en='Spirit Shaman', hitDie=8, skillPoints=4, epicBonusFeatEvery=3,
    source='Complete Divine', labels=['divine', 'spontaneous'],
    spellcasting={'ability': 'wis', 'kind': 'divine', 'mode': 'spontaneous'},
    rows=ROWS,
    text="""Le chaman spiritiste est le go-between entre le monde des vivants et celui des esprits : fées, éléments, ancêtres. Il ne prie aucun dieu, il négocie avec ce qui habite les arbres, les pierres et les tombes. Sa magie est celle du druide, mais il la choisit chaque matin en envoyant son esprit-guide discuter à sa place.""",
    rules=[
        'Dé de vie : d8. Points de compétence : 4 + modificateur d’Intelligence par niveau, ×4 au niveau 1.',
        'Alignement : au choix.',
        'Formé à l’arc court, au bâton, à la dague, au dard, à l’épieu, à la fronde, au gourdin, à la hachette, à la hache de lancer, au javelot, à la lance et à la pique ; aux armures légères et aux boucliers (sauf le pavois).',
        'Sorts divins de la liste du druide, basés sur la Sagesse (le DD utilise le Charisme), du niveau 0 au niveau 9. Il les lance spontanément, mais son répertoire n’est pas fixe : chaque jour, pendant 1 heure de méditation, il « recueille » dans toute la liste des druides un nombre de sorts donné par la Table 1-2 (3, 1 au niveau 1…). Les dons de métamagie s’appliquent quand il recueille le sort, jamais à la volée.',
        'Aptitudes : empathie sauvage et esprit-guide (1) ; correction des esprits (2) ; détection des esprits (3) ; bénédiction des esprits (4) ; soutien spirituel (5) ; guerrier spectral (6) ; protection des esprits (7) ; forme spirituelle 1/jour (9), 2 (15), 3 (20) ; assistant magique (10) ; rappel de l’esprit (11) ; exorcisme (13) ; affaiblissement des esprits (16) ; voyage spirituel (17) ; élu des esprits (19) ; esprit incarné (20).',
        'Au-delà du niveau 20 : un don supplémentaire tous les 3 niveaux (23, 26, 29…).',
    ],
    note='Sorts : le livre donne les sorts recueillis par jour (Table 1-2) ; ils servent ici de « sorts connus » et la liste change chaque jour. Le chaman choisit ses sorts du jour dans toute la liste des druides (relations de liste copiées plus tard). Le livre ne donne pas de règle épique propre au chaman spiritiste : un don supplémentaire tous les 3 niveaux au-delà du 20 (maison).',
    skills=['skill.spellcraft', 'skill.craft', 'skill.concentration', 'skill.knowledge_local', 'skill.knowledge_geography',
            'skill.knowledge_history', 'skill.knowledge_nature', 'skill.spot', 'skill.diplomacy',
            'skill.handle_animal', 'skill.ride', 'skill.swim', 'skill.listen', 'skill.heal', 'skill.profession',
            'skill.survival'],
    proficiencies=['item.shortbow', 'item.quarterstaff', 'item.dagger', 'item.dart', 'item.shortspear', 'item.sling',
                   'item.club', 'item.handaxe', 'item.throwing_axe', 'item.javelin', 'item.spear', 'item.longspear',
                   'proficiency.light_armor', 'proficiency.shields'],
    alignments=['lawful_good', 'neutral_good', 'chaotic_good', 'lawful_neutral', 'neutral', 'chaotic_neutral',
                'lawful_evil', 'neutral_evil', 'chaotic_evil'],
)

POWERS = [
    dict(id='spells', level=1, fr='Sorts de chaman spiritiste', en='Spirit shaman spells',
         text="""Le matin, le chaman médite une heure et envoie son esprit-guide négocier avec les esprits : ils lui « recueillent » les sorts de druide du jour. Une fois la journée commencée, il les lance comme un ensorceleur, sans préparation.""",
         rules=[
             'Sorts divins de la liste du druide, du niveau 0 au niveau 9. Caractéristique : Sagesse (10 + niveau du sort minimum pour recueillir et lancer). DD : 10 + niveau du sort + modificateur de Charisme.',
             'Sorts par jour selon le niveau (Table 1-1), plus des sorts en bonus grâce à une Sagesse élevée.',
             'Sorts recueillis (Table 1-2, repris dans les « sorts connus ») : chaque jour il choisit, dans toute la liste du druide, autant de sorts de chaque niveau. La liste change donc tous les jours.',
             'Il lance librement les sorts recueillis, tant qu’il lui reste un emplacement du niveau voulu : cinq fois le même tour de magie est possible.',
             'Les dons de métamagie s’appliquent au moment de recueillir le sort (un emplacement recueilli du niveau final) ; pas de métamagie à la volée, et le temps d’incantation ne rallonge pas.',
         ],
         note='Les sorts connus de la fiche sont ceux du jour : ils sont à refaire à chaque méditation. La liste complète des sorts de druide est celle de la classe (relations ajoutées plus tard).'),
    dict(id='wild_empathy', level=1, fr='Empathie sauvage', en='Wild empathy',
         text="""Guidé par les esprits des bêtes, le chaman calme ou amadoue un animal d’un regard, d’une posture, d’un grognement bien placé.""",
         rules=['Test d’empathie sauvage : 1d20 + niveau de chaman + modificateur de Charisme, comme un test de Diplomatie pour changer l’attitude d’un animal.',
                'Il faut se voir à 9 m ou moins ; compter environ une minute.',
                'Ne marche pas sur les créatures magiques.'],
         effects=[{'target': 'check.wild_empathy', 'op': 'add', 'value': f"{L} + @ability.cha.mod"}]),
    dict(id='spirit_guide', feat='feat.alertness', level=1, fr='Esprit-guide', en='Spirit guide',
         text="""Le chaman a un esprit-guide, une présence que lui seul perçoit, qui ne se confond avec aucune créature. Son aspect (aigle, loup, ours, tortue…) ne change rien aux règles : il traduit ce que le chaman est ou ce qu’il aime.""",
         rules=['Il choisit la forme de son esprit-guide au niveau 1 (aigle, araignée, blaireau, buffle, corneille, coyote, élan, faucon, grue, hibou, lapin, lézard, loup, loutre, ours, puma, ragondin, renard, scorpion, serpent, tortue, vautour).',
                'Don Vigilance gratuit, tant qu’il a son esprit-guide.',
                'Aux niveaux 5 et 10, l’esprit-guide donne soutien spirituel et assistant magique.'],
         note='La forme de l’esprit-guide est à noter sur la fiche (sans effet de jeu). Don Vigilance donné par la relation de la capacité.'),
    dict(id='chastise_spirits', level=2, fr='Correction des esprits', en='Chastise spirits',
         text="""Le chaman lâche une onde de magie divine qui blesse les esprits hostiles autour de lui : fées, élémentaires, morts-vivants intangibles et autres créatures spirituelles.""",
         rules=['Action simple, un nombre de fois par jour égal à 3 + modificateur de Charisme.',
                'Inflige 1d6 par niveau de chaman à tous les esprits dans 9 m ; jet de Volonté (DD 10 + niveau de chaman + modificateur de Charisme) pour moitié.',
                'Atteint automatiquement les créatures intangibles (pas de 50 % d’échec).',
                'Sont des « esprits » : morts-vivants intangibles, fées, élémentaires, créatures sous forme astrale, créatures du sous-type esprit, hommes-esprits et telthors, créatures spirituelles créées par certains sorts.'],
         usesPerDay=f"3 + @ability.cha.mod"),
    dict(id='detect_spirits', level=3, fr='Détection des esprits', en='Detect spirits',
         text="""L’esprit-guide sent les esprits alentour et prévient le chaman de leur présence.""",
         rules=['À volonté, comme détection des morts-vivants, mais pour les esprits.']),
    dict(id='blessing_of_the_spirits', level=4, fr='Bénédiction des esprits', en='Blessing of the spirits',
         text="""Après un petit rite méditatif, le chaman se met à l’abri des esprits hostiles.""",
         rules=['Rite de 10 minutes, sur lui seul.',
                'Fonctionne comme protection contre le Mal, mais contre les esprits, jusqu’à ce qu’il y mette fin ou que l’effet soit dissipé. Un nouveau rite de 10 minutes le recrée.']),
    dict(id='follow_the_guide', level=5, fr='Soutien spirituel', en='Follow the guide',
         text="""L’esprit-guide aide le chaman à garder la tête froide quand un charme essaie de le dominer.""",
         rules=['Si un sort ou pouvoir d’enchantement le touche et qu’il rate son jet de sauvegarde, il peut le retenter 1 round plus tard avec le même DD.',
                'Une seule nouvelle tentative par jet de sauvegarde raté.']),
    dict(id='ghost_warrior', level=6, fr='Guerrier spectral', en='Ghost warrior',
         text="""Quand il se bat, ses armes frappent comme celles d’un fantôme et les spectres peinent à le toucher.""",
         rules=['Toute arme qu’il tient a la propriété spectrale (elle blesse les créatures intangibles).',
                'Contre les attaques de contact des créatures intangibles, sa CA normale compte (et non sa CA de contact).'],
         note='Propriété d’arme (spectrale, « ghost touch ») et CA contre les attaques de contact intangibles : pas dans le modèle.'),
    dict(id='ward_of_the_spirits', level=7, fr='Protection des esprits', en='Ward of the spirits',
         text="""Un rite d’une minute dresse autour du chaman et de ses compagnons une barrière contre les esprits hostiles.""",
         rules=['Une fois par jour, rite de 1 minute.',
                'Dure 10 minutes par niveau de chaman, comme cercle magique contre le Mal mais contre les esprits ; protège aussi ses compagnons.'],
         usesPerDay=1),
    dict(id='spirit_form', level=9, fr='Forme spirituelle', en='Spirit form',
         text="""Le chaman devient esprit lui-même, un instant : intangible, léger, difficile à toucher, mais dangereux à son tour.""",
         rules=['Action simple, 1 fois par jour (2 au niveau 15, 3 au niveau 20). Dure 1 minute au plus.',
                'Sous-type intangible : immunité aux attaques non magiques, 50 % d’ignorer les dégâts d’une source tangible, traverse les objets solides.',
                'Perd les bonus d’armure, de bouclier et d’armure naturelle à la CA ; gagne un bonus de parade égal à son modificateur de Charisme (au moins +1).',
                'Pas de Force contre les créatures tangibles, mais attaque de contact au corps à corps (Dextérité) : 1d6 de dégâts ; compte comme arme magique pour passer la réduction des dégâts.'],
         usesPerDay=f"if({L} >= 20, 3, if({L} >= 15, 2, 1))",
         note='Immunité, 50 % d’échec et dégâts de la forme : pas d’effet chiffré ; le bonus de parade et la perte des bonus d’armure dépendent de l’état actif.'),
    dict(id='guide_magic', level=10, fr='Assistant magique', en='Guide magic',
         text="""L’esprit-guide peut tenir à sa place un sort qui demande de la concentration, pendant que le chaman fait autre chose.""",
         rules=['Action libre : l’esprit-guide maintient la concentration d’un sort ou pouvoir magique, un seul à la fois ; le chaman peut agir librement.',
                'L’esprit fait les tests de Concentration avec le bonus du chaman ; aucun test quand le chaman subit des dégâts, et il ne peut pas être interrompu.'],
         note='Nom anglais à confirmer.'),
    dict(id='spirit_recall', level=11, fr='Rappel de l’esprit', en='Recall spirit',
         text="""Juste après une mort, le chaman rattache l’esprit d’un défunt à son corps.""",
         rules=['Une fois par semaine, dans le round qui suit la mort de la victime.',
                'Fonctionne comme rappel à la vie, sans perte de niveau, de Constitution ni de sorts ; la créature revient à −1 pv et stabilisée.'],
         note='Nom anglais à confirmer (peut-être « Revenance »). Usage hebdomadaire : le modèle ne tient que des usages par jour, texte seul.'),
    dict(id='exorcism', level=13, fr='Exorcisme', en='Exorcism',
         text="""Le chaman chasse l’esprit qui occupe un corps qui n’est pas le sien.""",
         rules=['Action complexe contre une créature ou un esprit possédant.',
                'Test de niveau de chaman + modificateur de Charisme contre DD 10 + DV de la créature possédante + son modificateur de Charisme.',
                'Si réussi, le possédant quitte le corps ; il ne peut pas le reprendre pendant 24 heures.']),
    dict(id='weaken_spirits', level=16, fr='Affaiblissement des esprits', en='Weaken spirits',
         text="""Au lieu de blesser les esprits avec sa correction, le chaman préfère les dépouiller de leurs défenses.""",
         rules=['Avec la correction des esprits, il peut infliger moins de dégâts : chaque tranche de 3d6 abandonnée affaiblit les esprits touchés 1 round de plus (niveau 16 : 7d6 de dégâts au lieu de 16d6 = 3 rounds).',
                'Un esprit affaibli perd sa résistance à la magie et la réduction des dégâts que les armes magiques, en argent, en fer froid ou alignées ignorent ; les intangibles perdent leurs immunités et leurs 50 % d’échec.',
                'Les esprits qui réussissent leur jet de Volonté échappent aussi à l’affaiblissement.']),
    dict(id='spirit_journey', level=17, fr='Voyage spirituel', en='Spirit journey',
         text="""Le chaman fait disparaître son corps et passe par le monde des esprits.""",
         rules=['Une fois par jour. Comme traversée des ombres, mais pour lui seul, depuis n’importe quel endroit, par le plan des Esprits.'],
         usesPerDay=1),
    dict(id='spirit_chosen', level=19, fr='Élu des esprits', en='Chosen of the spirits',
         text="""Au bout d’un long rite, le chaman acquiert une protection contre la mort.""",
         rules=['Rite de 8 heures, qui coûte 1 000 points d’expérience.',
                'Reçoit l’équivalent de guérison suprême (niveau de lanceur = niveau de chaman) s’il tombe à 0 pv ou moins, ou si une caractéristique tombe à 0 ; effet immédiat, même sous −10 pv.',
                'Le rite est épuisé à l’activation : il faut en refaire un.'],
         note='Protection à usage unique, hors modèle. Nom anglais à confirmer.'),
    dict(id='embodied_spirit', level=20, fr='Esprit incarné', en='Embodied spirit',
         text="""Le chaman ne fait plus qu’un avec le monde des esprits : pour les sorts et les effets, il est une fée.""",
         rules=['Compte comme une créature du type fée (plus un humanoïde) pour les sorts et les effets magiques.',
                'Réduction des dégâts 5/fer froid.'],
         effects=[],
         note='Nom anglais à confirmer. Réduction des dégâts /fer froid : le modèle ne tient que la réduction sans type (damage_reduction.none), texte seul.'),
]
