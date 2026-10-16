/**
 * Profondeurs d'affichage communes. L'obscurité passe AU-DESSUS des personnages et des
 * effets (coup de couteau) : ce qui se passe dans le noir reste à peine visible, et
 * bien visible dans la lumière. Viseurs, révélations et interface restent au-dessus.
 */
export const DEPTH = {
  decor: 0,
  deadBody: 1,
  entity: 5,
  effect: 6,
  darkness: 20,
  crosshair: 25,
  aimGhost: 26,
  reveal: 30,
  hud: 40,
} as const;
