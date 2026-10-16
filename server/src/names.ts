import { NAME_MAX_LENGTH } from "@whosclaude/shared";

/**
 * Pseudo unique dans la room : « Alice », puis « Alice (2) »… Sans pseudo, « Joueur N »
 * avec le plus petit N libre. Évite les ambiguïtés (et les usurpations) au podium.
 * Le résultat ne dépasse jamais NAME_MAX_LENGTH caractères.
 */
export function uniqueName(wanted: string, taken: ReadonlySet<string>): string {
  if (!wanted) {
    for (let n = 1; ; n++) if (!taken.has(`Joueur ${n}`)) return `Joueur ${n}`;
  }
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const base = Array.from(wanted).slice(0, NAME_MAX_LENGTH - suffix.length).join("").trimEnd();
    if (!taken.has(base + suffix)) return base + suffix;
  }
}
