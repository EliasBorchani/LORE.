import type { FieldSpec, FormSchema } from '../../cms/schema'

const name: FieldSpec = { key: 'name', kind: 'name', label: 'Nom', description: 'Comme il apparaîtra partout : fiche, catalogue, recherche.' }
const description: FieldSpec = {
  key: 'description',
  kind: 'description',
  label: 'Description',
  description: 'Ce que l’entrée fait, en quelques phrases, pour la personne qui la lit à la table.',
}
const source: FieldSpec = { key: 'source', kind: 'source', label: 'Source', description: 'Le livre d’où elle vient, si elle vient d’un livre.', optional: true }
const prerequisite: FieldSpec = {
  key: 'prerequisite',
  kind: 'prerequisite',
  label: 'Prérequis',
  description: 'Ce qu’il faut avoir pour la prendre : un don, une caractéristique, un bonus de base à l’attaque…',
  optional: true,
}
const usesPerDay: FieldSpec = {
  key: 'usesPerDay',
  kind: 'usesPerDay',
  label: 'Utilisations par jour',
  description: 'Combien de fois par jour on peut s’en servir, si c’est limité.',
  optional: true,
}
const tableValue: FieldSpec = {
  key: 'tableValue',
  kind: 'tableValue',
  label: 'Valeur choisie à la table',
  description: 'Le joueur choisit un nombre quand il l’active (Attaque en puissance : jusqu’à son bonus de base à l’attaque). Les effets peuvent ensuite valoir « la valeur choisie ».',
  optional: true,
}
const repeatable: FieldSpec = {
  key: 'repeatable',
  kind: 'repeatable',
  label: 'Peut être pris plusieurs fois',
  description: 'Chaque prise ajoute encore ses effets, ou porte sur un nouveau choix : « +3 à la compétence choisie » (Talent).',
  optional: true,
}
const effects: FieldSpec = {
  key: 'effects',
  kind: 'effects',
  label: 'Effets',
  description: 'Ce qu’elle change sur la fiche. Choisissez une recette ; la fiche calcule le reste.',
}
const labels: FieldSpec = {
  key: 'labels',
  kind: 'labels',
  label: 'Étiquettes',
  description: 'Pour la ranger et la retrouver : un don de guerrier en bonus doit porter « Bonus de guerrier ».',
  optional: true,
}

const FORMS: FormSchema[] = [
  {
    type: 'feat',
    intro: 'Un don : un talent qu’un personnage choisit en montant de niveau.',
    sections: [
      { id: 'essentials', title: 'Essentiel', fields: [name, description, labels, source] },
      { id: 'rules', title: 'Règles', fields: [prerequisite, repeatable, tableValue, effects, usesPerDay] },
    ],
  },
  {
    type: 'class_power',
    intro: 'Un pouvoir de classe : ce qu’une classe donne à un niveau (Rage, Esquive totale…).',
    sections: [
      { id: 'essentials', title: 'Essentiel', fields: [name, description, labels, source] },
      { id: 'rules', title: 'Règles', fields: [tableValue, effects, usesPerDay, prerequisite] },
    ],
  },
]

const ABILITY_OPTIONS = [
  { value: 'str', label: 'Force' }, { value: 'dex', label: 'Dextérité' }, { value: 'con', label: 'Constitution' },
  { value: 'int', label: 'Intelligence' }, { value: 'wis', label: 'Sagesse' }, { value: 'cha', label: 'Charisme' },
]

FORMS.push(
  {
    type: 'skill',
    intro: 'Une compétence : ce qu’un personnage apprend en y mettant des rangs (Escalade, Bluff…).',
    sections: [
      { id: 'essentials', title: 'Essentiel', fields: [name, description, source] },
      {
        id: 'rules',
        title: 'Règles',
        fields: [
          { key: 'skill.ability', kind: 'choice', label: 'Caractéristique associée', description: 'Son modificateur s’ajoute aux rangs.', options: [{ value: '', label: '— aucune (la fiche ne la calcule pas)' }, ...ABILITY_OPTIONS] },
          { key: 'skill.trainedOnly', kind: 'flag', label: 'Formation nécessaire', description: 'Sans rang, on ne peut pas s’en servir.' },
          {
            key: 'skill.armorCheckPenalty',
            kind: 'choice',
            label: 'Malus d’armure',
            description: 'Le malus d’armure aux tests s’applique-t-il ? Natation le prend deux fois.',
            options: [{ value: '', label: 'non' }, { value: 1, label: 'oui' }, { value: 2, label: 'oui, deux fois' }],
          },
          { ...effects, label: 'Synergies et autres effets', description: 'Avec 5 rangs ici, +2 dans une autre compétence : choisissez « Synergie ».', optional: true },
        ],
      },
    ],
  },
  {
    type: 'statistic',
    intro: 'Une statistique : un nombre que les effets peuvent changer et que la fiche nomme (Santé mentale…).',
    sections: [{ id: 'essentials', title: 'Essentiel', fields: [{ ...name, description: 'Comme la fiche et les effets la nommeront.' }, description, source] }],
  },
  {
    type: 'situation',
    intro: 'Une situation : un bonus qui ne compte que dans ce cas, montré à part sur la fiche (« contre le poison »).',
    sections: [{ id: 'essentials', title: 'Essentiel', fields: [{ ...name, description: 'Lu juste après le bonus : « +2 contre les morts-vivants ».' }, description] }],
  },
  {
    type: 'source',
    intro: 'Un livre : d’où viennent des entrées. Seul son titre anglais compte.',
    sections: [{ id: 'essentials', title: 'Essentiel', fields: [{ ...name, english: true, label: 'Titre anglais', description: 'Tel qu’il est imprimé.' }, { ...description, optional: true }] }],
  },
)

/** The nine disciplines of the Tome of Battle; a ruleset's own discipline is written in « Avancé ». */
export const DISCIPLINES = [
  ['desert_wind', 'Vent du désert'], ['devoted_spirit', 'Esprit dévoué'], ['diamond_mind', 'Esprit de diamant'],
  ['iron_heart', 'Cœur de fer'], ['setting_sun', 'Soleil couchant'], ['shadow_hand', 'Main de l’ombre'],
  ['stone_dragon', 'Dragon de pierre'], ['tiger_claw', 'Griffe du tigre'], ['white_raven', 'Corbeau blanc'],
]

function maneuverForm(type: 'maneuver' | 'stance', intro: string): FormSchema {
  const text = (key: string, label: string, description: string): FieldSpec => ({ key: `maneuver.${key}`, kind: 'text', label, description, optional: true })
  return {
    type,
    intro,
    sections: [
      { id: 'essentials', title: 'Essentiel', fields: [name, description, labels, source] },
      {
        id: 'rules',
        title: 'Règles',
        fields: [
          { key: 'maneuver.discipline', kind: 'choice', label: 'Discipline', description: 'Une classe l’apprend si elle enseigne cette discipline.', options: [{ value: '', label: '— à choisir' }, ...DISCIPLINES.map(([id, label]) => ({ value: `discipline.${id}`, label }))] },
          { key: 'maneuver.level', kind: 'choice', label: 'Niveau', description: 'Un initiateur l’apprend à partir du niveau d’initiateur 2 × niveau − 1.', options: [{ value: '', label: '— à choisir' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: n, label: String(n) }))] },
          { key: 'maneuver.kind', kind: 'choice', label: 'Type', description: 'Coup, renforcement, contre ou posture.', options: [{ value: '', label: '— à choisir' }, { value: 'strike', label: 'Coup' }, { value: 'boost', label: 'Renforcement' }, { value: 'counter', label: 'Contre' }, { value: 'stance', label: 'Posture' }] },
          { key: 'maneuver.requires', kind: 'choice', label: 'Manœuvres demandées', description: 'Combien de manœuvres de la même discipline il faut déjà connaître.', options: [{ value: '', label: 'aucune' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))], optional: true },
          text('prerequisite', 'Autre prérequis', 'Ce que la fiche ne vérifie pas (un alignement).'),
          text('initiationAction', 'Action', '1 action simple, 1 action rapide…'),
          text('range', 'Portée', 'Attaque au corps à corps, personnelle, 18 m…'),
          text('target', 'Cible', 'Une créature, vous…'),
          text('area', 'Zone d’effet', 'Rayonnement de 9 m centré sur vous…'),
          text('duration', 'Durée', 'Posture, 1 round, instantanée…'),
          text('savingThrow', 'Jet de sauvegarde', 'Vigueur partiel, Réflexes annule…'),
          effects,
        ],
      },
    ],
  }
}

FORMS.push(
  maneuverForm('maneuver', 'Une manœuvre : un coup, un renforcement ou un contre qu’un initiateur prépare et dépense en combat.'),
  maneuverForm('stance', 'Une posture : une manière de combattre que l’initiateur garde tant qu’il le veut, une seule à la fois.'),
)

/** Every other type until it gets its own form: the common fields; its own blocks stay in « Avancé ». */
function generic(type: string): FormSchema {
  return {
    type,
    intro: 'Les champs communs à toutes les entrées. Ce qui est propre à cette catégorie se règle dans « Avancé ».',
    sections: [
      { id: 'essentials', title: 'Essentiel', fields: [name, description, labels, source] },
      { id: 'rules', title: 'Règles', fields: [tableValue, effects, { ...prerequisite }, usesPerDay] },
    ],
  }
}

export function formFor(type: string): FormSchema {
  return FORMS.find((f) => f.type === type) ?? generic(type)
}

/** Types with a form of their own (the others use the generic one). */
export const GUIDED_TYPES = FORMS.map((f) => f.type)
