/**
 * Personnages en pixel art 16×16, dans l'esprit des premiers Dragon Quest.
 *
 * Chaque personnage = une tête (coiffure ou couvre-chef), un corps (tunique, robe…)
 * et une palette. Les grilles sont décrites par des lettres (« canaux ») que la palette
 * traduit en couleurs : un même gabarit sert à plusieurs personnages.
 *
 * Données pures, sans Phaser : utilisées par le jeu (textures) comme par le script
 * de prévisualisation (scripts/render-sprites.ts).
 */

/** 16 lignes de 16 caractères ; « . » = transparent. */
export type Grid = readonly string[];
export type Facing = "down" | "up" | "left" | "right";
export const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
export const SPRITE_SIZE = 16;

/**
 * Canaux de couleur :
 * o contour · s/S peau (claire/ombre) · e yeux · h/H cheveux (base/reflet)
 * m/M/n couvre-chef (base/ombre/garniture) · a/A tenue (base/ombre) · c ceinture, détails
 * r/R cape · p jambes · k chaussures
 */
export type Channel = "o" | "s" | "S" | "e" | "h" | "H" | "m" | "M" | "n" | "a" | "A" | "c" | "r" | "R" | "p" | "k";
export type Palette = Partial<Record<Channel, string>>;

const BASE_PALETTE: Palette = { o: "#1a1020", s: "#f7c8a0", S: "#d9926a", e: "#1a1020" };

const rev = (row: string) => row.split("").reverse().join("");
/** Une ligne de 8 caractères est une demi-ligne, complétée par symétrie ; 16 = ligne complète. */
const full = (rows: readonly string[]) => rows.map((r) => (r.length === 8 ? r + rev(r) : r));

// --- Têtes : lignes 0 à 9, vues de face (down), de dos (up) et de profil gauche (left) ---

interface Head {
  down: readonly string[];
  up: readonly string[];
  left: readonly string[];
}

const FACE = ["..ohsess", "..ohsess", "..oSssss", "...oSsss", "....ooss"];
const SIDE_FACE = ["..osesshhhhhho..", "..osesshhhhhho..", "..ossssShhhhho..", "...oSssssShho...", "....oosssoo....."];

const HEADS = {
  /** Casque d'acier à garde-joues (guerrier). */
  helmet: {
    down: ["....oooo", "...ommmn", "..ommnmm", "..ommmmm", "..oMMMMM", "..omsess", "..omsess", "..oMssss", "...oSsss", "....ooss"],
    up: ["....oooo", "...ommmn", "..ommnmm", "..ommmmm", "..oMMMMM", "..ommmmm", "..ommmmm", "..oMmmmm", "...oMMMM", "....ooss"],
    left: [".....ooooooo....", "....ommmnnmmo...", "...ommnmmmmmmo..", "...ommmmmmmmmo..", "...oMMMMMMMMMo..", "..osesmmmmmmmo..", "..osesmmmmmmmo..", "..ossssMmmmmmo..", "...oSssssMMMo...", "....oosssoo....."],
  },
  /** Heaume à cimier doré (paladin). */
  crestHelmet: {
    down: ["......on", "...ooomn", "..ommmmn", "..ommmmm", "..onnnnn", "..omsess", "..omsess", "..oMssss", "...oSsss", "....ooss"],
    up: ["......on", "...ooomn", "..ommmmn", "..ommmmm", "..onnnnn", "..ommmmm", "..ommmmm", "..oMmmmm", "...oMMMM", "....ooss"],
    left: [".......ono......", "....ommmnmmmo...", "...ommmmnmmmmo..", "...ommmmmmmmmo..", "...onnnnnnnnno..", "..osesmmmmmmmo..", "..osesmmmmmmmo..", "..ossssMmmmmmo..", "...oSssssMMMo...", "....oosssoo....."],
  },
  /** Capuche qui encadre le visage (prêtre, rôdeur). */
  hood: {
    down: ["....oooo", "...ommmm", "..ommmmm", "..ommmmm", "..ommsss", "..omsess", "..omsess", "..omSsss", "..oMmSss", "...oMMMs"],
    up: ["....oooo", "...ommmm", "..ommmmm", "..ommmmm", "..ommmmm", "..ommmmm", "..ommmmm", "..ommmmm", "..oMmmmm", "...oMMMM"],
    left: [".....ooooooo....", "....ommmmmmmo...", "...ommmmmmmmmo..", "...ommmmmmmmmo..", "...osmmmmmmmmo..", "..osesmmmmmmmo..", "..osesmmmmmmmo..", "..ossssMmmmmmo..", "...oSssMmmmmMo..", "....ooMMMMMo...."],
  },
  /** Chapeau pointu à large bord (mage). */
  pointyHat: {
    down: [".......o", "......om", ".....omm", "....ommm", ".oonnnnn", ...FACE],
    up: [".......o", "......om", ".....omm", "....ommm", ".oonnnnn", "..ohhhhh", "..ohhhhh", "..ohhhhh", "...ohhhh", "....ooss"],
    left: [".........oo.....", "........omo.....", ".......ommo.....", ".....ommmmo.....", "..oonnnnnnnnoo..", ...SIDE_FACE],
  },
  /** Cheveux en épis et bandeau (artiste martial). */
  headband: {
    down: ["...o.o.o", "..ohohoh", "..ohhhhh", "..ommmmm", "..ohhsss", ...FACE],
    up: ["...o.o.o", "..ohohoh", "..ohhhhh", "..ommmmm", "..ohhhhh", "..ohhhhh", "..ohhhhh", "..ohhhhh", "...ohhhh", "....ooss"],
    left: ["....o.o.o.o.....", "...ohohohohoo...", "...ohhhhhhhhho..", "...ommmmmmmmmmm.", "...osshhhhhhhom.", ...SIDE_FACE],
  },
  /** Bandana noué et foulard (voleur). */
  bandana: {
    down: ["....oooo", "...ommmm", "..ommnmm", "..oMMMMM", "..ohhsss", "..ohsess", "..ohsess", "..oSssss", "...oSsss", "....occc"],
    up: ["....oooo", "...ommmm", "..ommnmm", "..oMMMMM", "..ohhhmm", "..ohhhhh", "..ohhhhh", "..ohhhhh", "...ohhhh", "....occc"],
    left: [".....ooooooo....", "....ommmmmmmo...", "...ommnmmmnmmo..", "...oMMMMMMMMMmo.", "...osshhhhhhhmo.", "..osesshhhhhho..", "..osesshhhhhho..", "..ossssShhhhho..", "...oSssssShho...", "....occcccco...."],
  },
  /** Béret à plume (ménestrel). Asymétrique : lignes complètes. */
  featherHat: {
    down: ["..........oo....", "....oooooonno...", "...ommmmmmmno...", "..ommmmmmmmmmo..", "..oMMMMMMMMMMo..", ...FACE],
    up: ["....oo..........", "...onnoooooo....", "...onmmmmmmmo...", "..ommmmmmmmmmo..", "..oMMMMMMMMMMo..", "..ohhhhh", "..ohhhhh", "..ohhhhh", "...ohhhh", "....ooss"],
    left: ["..........oo....", "....oooooonno...", "...ommmmmmmno...", "..ommmmmmmmmmo..", "..oMMMMMMMMMMo..", ...SIDE_FACE],
  },
  /** Casque à cornes (gladiateur). */
  hornedHelmet: {
    down: [".o......", ".no.oooo", ".nnommmm", "..oommmm", "..oMMMMM", "..omsess", "..omsess", "..oSssss", "...oSsss", "....ooss"],
    up: [".o......", ".no.oooo", ".nnommmm", "..oommmm", "..oMMMMM", "..ommmmm", "..ommmmm", "..oMmmmm", "...oMMMM", "....ooss"],
    left: ["...........o....", "....oooooooono..", "...ommmmmmmmnno.", "...ommmmmmmmmo..", "...oMMMMMMMMMo..", "..osesmmmmmmmo..", "..osesmmmmmmmo..", "..ossssMmmmmmo..", "...oSssssMMMo...", "....oosssoo....."],
  },
  /** Cheveux longs et diadème (sage). */
  longHair: {
    down: ["....oooo", "...ohhhH", "..ohhHhh", "..onnnnn", "..ohhsss", "..ohsess", "..ohsess", "..ohSsss", "..ohhSss", "..ohhoss"],
    up: ["....oooo", "...ohhhH", "..ohhHhh", "..onnnnn", "..ohhhhh", "..ohhhhh", "..ohhhhh", "..ohhhhh", "..ohhhhh", "..ohhhhh"],
    left: [".....ooooooo....", "....ohhhHHhho...", "...ohhHhhhhhho..", "...onnnnnnnnno..", "...osshhhhhhho..", "..osesshhhhhho..", "..osesshhhhhho..", "..ossssShhhhho..", "...oSssshhhhho..", "....oossohhho..."],
  },
} satisfies Record<string, Head>;

export type HeadId = keyof typeof HEADS;

// --- Corps : lignes 10 à 15, en trois poses (debout, pas A, pas B) ---

/** Lignes 10 à 13 (torse) et 14-15 (jambes) pour chaque pose. */
interface Body {
  down: { torso: readonly string[]; legs: readonly [readonly string[], readonly string[], readonly string[]] };
  left: {
    torso: readonly [readonly string[], readonly string[], readonly string[]];
    legs: readonly [readonly string[], readonly string[], readonly string[]];
  };
}

// Marche de face : un pied posé loin devant, l'autre levé (bien lisible même petit).
const FRONT_STAND = ["....oppo", "...okko."];
const FRONT_STEP_A = ["...opppo.okko...", "..okkko........."];
const FRONT_STEP_B = FRONT_STEP_A.map(rev);
// Marche de profil : grande enjambée, puis jambes croisées ; le bras balance en sens inverse.
const SIDE_STAND = [".....oppppo.....", "....okkkkko....."];
const SIDE_STEP_A = ["....opo..opo....", "...okko..okko..."];
const SIDE_STEP_B = [".....oppo.......", "....okkkko......"];

/** Torse de profil pour les trois poses : la main pend, part en avant, puis en arrière. */
const sideTorso = (top: string, mid: string, bottom: string) =>
  [
    [top, mid, "....occsccco....", bottom],
    [top, mid, "...osccccco.....", bottom],
    [top, mid, "....occcccso....", bottom],
  ] as const;

const BODIES = {
  /** Tunique, ceinture, jambes et bottes. */
  tunic: {
    down: { torso: ["...oaaAa", "..osaaAa", "..oscccc", "...oaaaa"], legs: [FRONT_STAND, FRONT_STEP_A, FRONT_STEP_B] },
    left: { torso: sideTorso("....oaaaaaao....", "....oaaAAaao....", "....oaaaaaao...."), legs: [SIDE_STAND, SIDE_STEP_A, SIDE_STEP_B] },
  },
  /** Robe longue : seules les chaussures dépassent. */
  robe: {
    down: {
      torso: ["...oaaAa", "..osaaAa", "..osaaca", "..oaaaaa"],
      legs: [
        ["..oAaaaa", "....okko"],
        ["..oAaaaaaaaaAo..", "...okkko........"],
        ["..oAaaaaaaaaAo..", "........okkko..."],
      ],
    },
    left: {
      torso: sideTorso("....oaaaaaao....", "....oaaAAaao....", "...oaaaaaaaao..."),
      legs: [
        ["...oAaaaaaaAo...", "....okkkko......"],
        ["...oAaaaaaaAo...", "..okkko........."],
        ["...oAaaaaaaAo...", ".......okko....."],
      ],
    },
  },
  /** Torse nu, ceinture et pagne. */
  bare: {
    down: { torso: ["...osssS", "..osssSs", "..oscccc", "...oaaAa"], legs: [FRONT_STAND, FRONT_STEP_A, FRONT_STEP_B] },
    left: { torso: sideTorso("....osssssso....", "....ossSSsso....", "....oaaaaaao...."), legs: [SIDE_STAND, SIDE_STEP_A, SIDE_STEP_B] },
  },
} satisfies Record<string, Body>;

export type BodyId = keyof typeof BODIES;

/** Dos avec une cape (remplace le torse de dos). */
const CAPE_BACK = ["...orrrr", "..osrRrr", "..osrRrr", "...orrrr"];

export interface CharacterLook {
  id: string;
  /** Nom affiché (classe inspirée de Dragon Quest IX). */
  name: string;
  head: HeadId;
  body: BodyId;
  cape?: boolean;
  palette: Palette;
}

/** Les 10 apparences ; l'indice dans ce tableau est la valeur `look` synchronisée. */
export const LOOKS: readonly CharacterLook[] = [
  {
    id: "warrior", name: "Guerrier", head: "helmet", body: "tunic", cape: true,
    palette: { m: "#a8b4c0", M: "#6b7785", n: "#e8eef2", a: "#4a6fb5", A: "#34508a", c: "#8a5a2b", r: "#b03030", R: "#7a1e1e", p: "#6b5a48", k: "#4a3020" },
  },
  {
    id: "paladin", name: "Paladin", head: "crestHelmet", body: "tunic", cape: true,
    palette: { m: "#d8dce6", M: "#9aa0b0", n: "#e8b830", a: "#e8e8f0", A: "#b8bccc", c: "#e8b830", r: "#3050b0", R: "#20387a", p: "#9aa0b0", k: "#6b7785" },
  },
  {
    id: "priest", name: "Prêtre", head: "hood", body: "robe",
    palette: { m: "#f0f0f8", M: "#b8bcd0", a: "#3a6ad0", A: "#2a4ca0", c: "#f0d050", k: "#6b4a2b" },
  },
  {
    id: "mage", name: "Mage", head: "pointyHat", body: "robe",
    palette: { m: "#6a3aa8", M: "#4a2878", n: "#e8c040", h: "#c0c0c8", H: "#e0e0e8", a: "#6a3aa8", A: "#4a2878", c: "#e8c040", k: "#4a3020" },
  },
  {
    id: "martialArtist", name: "Artiste martial", head: "headband", body: "tunic",
    palette: { m: "#d03030", h: "#2a2028", H: "#4a3a48", a: "#f08a2a", A: "#c06a18", c: "#2a2028", p: "#2a2028", k: "#2a2028" },
  },
  {
    id: "thief", name: "Voleur", head: "bandana", body: "tunic",
    palette: { m: "#3a8a5a", M: "#2a6040", n: "#e0d070", h: "#5a3a20", a: "#5a4a6a", A: "#3e3250", c: "#b03030", p: "#3a3040", k: "#2a2028" },
  },
  {
    id: "minstrel", name: "Ménestrel", head: "featherHat", body: "tunic",
    palette: { m: "#c03050", M: "#8a2038", n: "#f8f8f8", h: "#e0b040", a: "#f0c838", A: "#c09a20", c: "#c03050", p: "#5a8a3a", k: "#6b4a2b" },
  },
  {
    id: "gladiator", name: "Gladiateur", head: "hornedHelmet", body: "bare",
    palette: { m: "#8a6a40", M: "#5a4428", n: "#f0e8d0", c: "#6b4a2b", a: "#b03030", A: "#802020", p: "#f7c8a0", k: "#6b4a2b" },
  },
  {
    id: "ranger", name: "Rôdeur", head: "hood", body: "tunic",
    palette: { m: "#4a8a3a", M: "#2f6028", a: "#4a8a3a", A: "#2f6028", c: "#8a5a2b", p: "#6b5a48", k: "#4a3020" },
  },
  {
    id: "sage", name: "Sage", head: "longHair", body: "robe",
    palette: { h: "#f0d070", H: "#fff0a0", n: "#3ac0a0", a: "#f0f0f0", A: "#c0c4cc", c: "#3aa080", k: "#8a6a40" },
  },
];

/** Palette complète d'un personnage (contour, peau et yeux communs). */
export function paletteOf(look: CharacterLook): Palette {
  return { ...BASE_PALETTE, ...look.palette };
}

/**
 * Images d'un personnage : pour chaque orientation, [debout, pas A, pas B].
 * Le profil droit est le miroir du profil gauche.
 */
export function characterFrames(look: CharacterLook): Record<Facing, [Grid, Grid, Grid]> {
  const head = HEADS[look.head];
  const body: Body = BODIES[look.body];
  const front = (headRows: readonly string[], torso: readonly string[]) =>
    poses((pose) => full([...headRows, ...torso, ...body.down.legs[pose]]));
  const left = poses((pose) => [...full(head.left), ...body.left.torso[pose], ...body.left.legs[pose]]);
  return {
    down: front(head.down, body.down.torso),
    up: front(head.up, look.cape ? CAPE_BACK : body.down.torso),
    left,
    right: poses((pose) => left[pose].map(rev)),
  };
}

/** Les trois poses (debout, pas A, pas B). */
function poses<T>(build: (pose: 0 | 1 | 2) => T): [T, T, T] {
  return [build(0), build(1), build(2)];
}

/** Ordre des poses pendant la marche : pas A, debout, pas B, debout. */
export const WALK_CYCLE = [1, 0, 2, 0] as const;
/** Durée d'une pose de marche (ms). */
export const WALK_FRAME_MS = 140;

/**
 * Orientation à afficher pour une direction de déplacement (0 = est, sens horaire).
 * Comme dans Dragon Quest, les diagonales utilisent les vues de profil.
 * À l'arrêt (dir < 0), on garde l'orientation précédente.
 */
export function facingFromDir(dir: number, previous: Facing): Facing {
  switch (dir) {
    case 0: case 1: case 7: return "right";
    case 3: case 4: case 5: return "left";
    case 2: return "down";
    case 6: return "up";
    default: return previous;
  }
}
