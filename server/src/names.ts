import { NAME_MAX_LENGTH } from "@whosclaude/shared";

/** Forme de comparaison : « Alice », « alice » et « Ａｌｉｃｅ » (pleine chasse) se confondent. */
function nameKey(name: string) {
  return name.normalize("NFKC").toLowerCase();
}

/**
 * Pseudo unique dans la room : « Alice », puis « Alice (2) »… Sans pseudo, « Joueur N »
 * avec le plus petit N libre. Évite les ambiguïtés (et les usurpations) au podium.
 * Le résultat ne dépasse jamais NAME_MAX_LENGTH caractères.
 * Limite connue : les homoglyphes (« А » cyrillique pour « A ») ne sont pas détectés.
 */
export function uniqueName(wanted: string, taken: Iterable<string>): string {
  const keys = new Set(Array.from(taken, nameKey));
  const isFree = (name: string) => !keys.has(nameKey(name));

  if (!wanted) {
    let n = 1;
    while (!isFree(`Joueur ${n}`)) n++;
    return `Joueur ${n}`;
  }
  if (isFree(wanted)) return wanted;
  let n = 2;
  for (;;) {
    const suffix = ` (${n})`;
    const candidate = Array.from(wanted).slice(0, NAME_MAX_LENGTH - suffix.length).join("").trimEnd() + suffix;
    if (isFree(candidate)) return candidate;
    n++;
  }
}
