/** Petits utilitaires DOM pour les écrans de menu. */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Élément #${id} introuvable`);
  return element as T;
}

export type Screen = "home" | "lobby" | "game" | "podium";

export function showScreen(screen: Screen) {
  document.body.dataset.screen = screen;
}

export function colorToCss(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Ligne de liste de joueurs : pastille de couleur, nom, badges, puis éventuelles commandes. */
export function playerRow(
  color: number,
  name: string,
  badges: { text: string; ok?: boolean }[],
  actions: HTMLElement[] = [],
) {
  const li = document.createElement("li");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = colorToCss(color);
  const label = document.createElement("span");
  label.className = "grow";
  label.textContent = name; // textContent : jamais de HTML venant des autres joueurs
  li.append(dot, label);
  for (const badge of badges) {
    const span = document.createElement("span");
    span.className = badge.ok ? "badge ok" : "badge";
    span.textContent = badge.text;
    li.append(span);
  }
  li.append(...actions);
  return li;
}

/** Lecture/écriture best-effort : le stockage peut être bloqué (navigation privée…). */
export const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // tant pis : simple confort
    }
  },
};
