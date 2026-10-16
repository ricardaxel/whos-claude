/**
 * Ce qu'une source d'input (clavier/souris, manette, tactile…) rapporte à chaque frame.
 * Toutes les sources parlent ce même langage d'intentions, jamais de touches.
 */
export interface SourceFrame {
  /** Action « avancer » maintenue. */
  advance?: boolean;
  /** Sprint maintenu : plus rapide, mais réservé aux joueurs (les PNJ ne sprintent jamais). */
  sprint?: boolean;
  /** Déplacement libre voulu, chaque axe entre -1 et 1 (flèches/ZQSD, stick, joystick tactile). */
  move?: { x: number; y: number };
  /** Action du mode (coup de couteau…), front montant. */
  action?: boolean;
  /** Appuyé pendant cette frame (front montant). */
  fire?: boolean;
  start?: boolean;
  /** Visée absolue, en coordonnées de l'arène (souris, doigt posé). */
  aimAt?: { x: number; y: number };
  /** Déplacement relatif de la visée, en pixels d'arène (stick, glisser façon trackpad). */
  aimDelta?: { x: number; y: number };
}

export interface InputSource {
  /** Appelé une fois par frame ; les fronts montants sont consommés à la lecture. */
  read(dt: number): SourceFrame;
  destroy?(): void;
}

/** Intentions fusionnées de toutes les sources. */
export interface InputFrame {
  advance: boolean;
  sprint: boolean;
  move: { x: number; y: number };
  action: boolean;
  fire: boolean;
  start: boolean;
  aim: { x: number; y: number };
}
