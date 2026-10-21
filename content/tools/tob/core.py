# Writes content/srd/tob/core.json: the nine disciplines of the Tome of Battle and the Martial Lore skill.
# Usage: python3 content/tools/tob/core.py
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = 'Book of Nine Swords'


def describe(paragraph, rules):
    return paragraph.strip() + '\n\nEn jeu\n' + '\n'.join('• ' + r for r in rules)


# id, French, English, classes, key skill (French), weapons (French), text
DISCIPLINES = [
    ('desert_wind', 'Vent du désert', 'Desert Wind', 'Sage de l’épée', 'Acrobaties',
     'cimeterre, masse d’armes légère, pic de guerre léger, cimeterre à deux mains, lance',
     """L’école du feu et du mouvement. Ses adeptes ne restent jamais en place : ils tournoient, bondissent et laissent derrière eux des traînées de flammes nées de la seule vitesse de leur lame."""),
    ('devoted_spirit', 'Esprit dévoué', 'Devoted Spirit', 'Croisé', 'Intimidation',
     'cimeterre à deux mains, massue, épée longue, maillet',
     """La voie de la foi armée. Le croisé puise dans sa cause une énergie qui soigne ses alliés, le garde debout quand d’autres tomberaient et frappe ceux qui s’opposent à ce qu’il défend."""),
    ('diamond_mind', 'Esprit de diamant', 'Diamond Mind', 'Sage de l’épée, Maître des lames', 'Concentration',
     'rapière, épieu, épée bâtarde (katana), trident',
     """La vitesse vient de l’esprit, pas du corps. L’adepte lit le combat avant qu’il n’ait lieu, frappe là où l’adversaire sera et répond aux menaces par la pure clarté de sa pensée."""),
    ('iron_heart', 'Cœur de fer', 'Iron Heart', 'Maître des lames', 'Équilibre',
     'épée bâtarde, hache de guerre naine, épée longue, double-lame',
     """La maîtrise absolue de l’épée. Des années d’exercice font du pratiquant une arme sans défaut : frappes multiples, parades impossibles, et un coup final qui ne laisse aucune chance."""),
    ('setting_sun', 'Soleil couchant', 'Setting Sun', 'Sage de l’épée', 'Psychologie',
     'épée courte, bâton, nunchaku, combat à mains nues',
     """Retourner la force de l’ennemi contre lui. L’adepte esquive, déséquilibre et projette, et finit par laisser l’adversaire se vaincre lui-même."""),
    ('shadow_hand', 'Main de l’ombre', 'Shadow Hand', 'Sage de l’épée', 'Discrétion',
     'dague, épée courte, sai, siangham, combat à mains nues, chaîne cloutée',
     """Ne jamais montrer à l’adversaire ce qu’il s’attend à voir. Feintes, téléportations d’ombre en ombre et frappes empoisonnées par le froid du néant : l’école de l’assassin."""),
    ('stone_dragon', 'Dragon de pierre', 'Stone Dragon', 'Croisé, Sage de l’épée, Maître des lames', 'Équilibre',
     'épée à deux mains, grande hache, masse d’armes lourde, combat à mains nues',
     """La force et l’endurance de la montagne. Pieds bien ancrés au sol, l’adepte brise les armures et les os, et encaisse ce qui renverserait un autre."""),
    ('tiger_claw', 'Griffe du tigre', 'Tiger Claw', 'Sage de l’épée, Maître des lames', 'Saut',
     'kukri, kama, griffe, hachette, grande hache, combat à mains nues',
     """L’instinct contre la pensée. L’adepte devient bête : il bondit, déchire, frappe de deux armes à la fois et se nourrit du sang qu’il fait couler."""),
    ('white_raven', 'Corbeau blanc', 'White Raven', 'Croisé, Maître des lames', 'Diplomatie',
     'épée longue, hache d’armes, marteau de guerre, épée à deux mains, hallebarde',
     """Aucun guerrier ne se bat seul. Cris de guerre, ordres et charges menées en tête : chaque manœuvre du corbeau blanc rend les alliés plus forts que la somme de leurs lames."""),
]


def discipline(row):
    id_, fr, en, classes, skill, weapons, text = row
    return {
        'id': f'discipline.{id_}', 'type': 'discipline', 'name': {'fr': fr, 'en': en}, 'provenance': 'official',
        'source': SOURCE, 'labels': [],
        'description': {'fr': describe(text, [
            f'Enseignée par : {classes}.',
            f'Compétence clé : {skill}.',
            f'Armes associées : {weapons}.',
        ])},
    }


MARTIAL_LORE = {
    'id': 'skill.martial_lore', 'type': 'skill', 'name': {'fr': 'Savoir martial', 'en': 'Martial Lore'},
    'provenance': 'official', 'source': SOURCE, 'labels': ['skill'],
    'description': {'fr': describe(
        """Reconnaître une manœuvre au premier geste, deviner l’école d’un adversaire à sa garde : le savoir des initiés des Neuf Épées.""",
        ['Caractéristique associée : Intelligence. Formation nécessaire.',
         'Identifier une manœuvre qu’on voit initier : DD 10 + niveau de la manœuvre, sans action, une seule tentative.',
         'Identifier une manœuvre écrite sur un parchemin martial : DD 10 + niveau de la manœuvre, une action complexe, une tentative par jour.',
         'Connaître toutes les disciplines d’une créature qu’on voit initier : DD 20 + son niveau d’initiateur.'])},
    'skill': {'ability': 'int', 'trainedOnly': True},
}

out = ROOT / 'content/srd/tob/core.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'entities': [discipline(r) for r in DISCIPLINES] + [MARTIAL_LORE]}, ensure_ascii=False, indent=2) + '\n')
print(out)
