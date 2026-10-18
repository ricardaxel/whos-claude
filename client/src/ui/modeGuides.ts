import { ASSASSINS, type ModeId } from "@whosclaude/shared";

/** Une commande, sur chaque type de périphérique. */
export interface ControlRow {
  action: string;
  keyboard: string;
  gamepad: string;
  touch: string;
}

/** Règles d'un mode, affichées dans le salon (le jeu lui-même n'affiche plus de consignes). */
export interface ModeGuide {
  /** Ce qu'est le mode, en deux phrases. */
  pitch: string;
  /** Comment on gagne (et comment on perd). */
  goal: string[];
  /** Ce qu'il faut savoir pour ne pas se faire repérer. */
  tips: string[];
  controls: ControlRow[];
}

const minutes = Math.round(ASSASSINS.roundSeconds / 60);

export const MODE_GUIDES: Record<ModeId, ModeGuide> = {
  race: {
    pitch:
      "Une foule de personnages traverse la salle vers la ligne d'arrivée. Les joueurs s'y cachent, " +
      "et personne ne sait au départ lequel il contrôle : bouge pour le découvrir, discrètement.",
    goal: [
      "Franchis l'arrivée le premier, ou reste le dernier joueur en vie.",
      "Si un PNJ franchit l'arrivée avant tout le monde, l'IA gagne la manche : personne ne marque.",
    ],
    tips: [
      "Les PNJ avancent par à-coups : avancer sans jamais t'arrêter te trahit.",
      "Le sprint va bien plus vite, mais aucun PNJ ne court : on te repère aussitôt.",
      "Ton viseur est visible de tous et tu n'as qu'une balle. Elle tue qui elle touche, joueur, PNJ… ou toi.",
    ],
    controls: [
      { action: "Avancer", keyboard: "Espace, → ou D", gamepad: "RT ou A", touch: "« Avancer »" },
      { action: "Sprinter", keyboard: "Maj + Espace", gamepad: "LB ou Y", touch: "« Sprint »" },
      { action: "Viser", keyboard: "Souris", gamepad: "Un stick", touch: "Glisser" },
      { action: "Tirer", keyboard: "Clic ou F", gamepad: "RB ou X", touch: "« Tirer »" },
    ],
  },
  assassins: {
    pitch:
      "Joueurs et PNJ errent dans une salle plongée dans le noir, qu'une lumière parcourt au hasard. " +
      "Chaque joueur a un couteau, et doit d'abord découvrir quel personnage il contrôle.",
    goal: [
      "Sois le dernier joueur en vie.",
      `Au bout de ${minutes} minutes, la manche s'arrête : personne ne gagne.`,
    ],
    tips: [
      "Les PNJ ne frappent jamais : un coup de couteau, visible de tous, trahit un joueur.",
      "Dans la lumière, le geste se voit de loin ; dans l'ombre, à peine. Frappe dans le noir.",
      "Le couteau tue le personnage le plus proche, à portée de bras.",
    ],
    controls: [
      { action: "Se déplacer", keyboard: "Flèches, ZQSD, WASD", gamepad: "Stick gauche", touch: "Glisser" },
      { action: "Couteau", keyboard: "Espace, E ou clic", gamepad: "A, RB ou X", touch: "« Couteau »" },
    ],
  },
};

/** Fenêtre de règles d'un mode (que du texte : rien ne vient des joueurs). */
export function renderGuide(guide: ModeGuide): HTMLElement[] {
  const paragraph = (text: string, className?: string) => {
    const p = document.createElement("p");
    p.textContent = text;
    if (className) p.className = className;
    return p;
  };
  const section = (title: string, items: string[]) => {
    const block = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    }
    block.append(heading, list);
    return block;
  };

  const table = document.createElement("table");
  table.className = "controls";
  const head = table.createTHead().insertRow();
  for (const label of ["", "Clavier / souris", "Manette", "Téléphone"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of guide.controls) {
    const tr = body.insertRow();
    for (const text of [row.action, row.keyboard, row.gamepad, row.touch]) tr.insertCell().textContent = text;
  }
  const controls = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = "Commandes";
  controls.append(heading, table);

  return [paragraph(guide.pitch), section("Pour gagner", guide.goal), section("À savoir", guide.tips), controls];
}
