import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  DEFAULT_MODE, ROUNDS,
  type CrosshairState, type EntityState, type GameStateShape, type ModeId, type Phase, type PlayerInfoState,
} from "@whosclaude/shared";

/**
 * Personnage dans l'arène. Volontairement minimal :
 * rien ici ne doit permettre de distinguer un joueur d'un PNJ.
 */
export class Entity extends Schema implements EntityState {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("int8") dir = -1;
  @type("boolean") alive = true;
}

/** Viseur d'un joueur. Public, mais son identifiant n'a aucun lien avec celui de l'entité. */
export class Crosshair extends Schema implements CrosshairState {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("uint8") color = 0;
  @type("boolean") loaded = true;
}

/**
 * Joueur tel que le voient les autres (salon, scores).
 * Ne contient JAMAIS de référence à son entité.
 */
export class PlayerInfo extends Schema implements PlayerInfoState {
  @type("string") name = "";
  @type("uint8") color = 0;
  @type("boolean") ready = false;
  @type("uint8") score = 0;
}

export class GameState extends Schema implements GameStateShape {
  @type("string") phase: Phase = "lobby";
  @type("uint8") countdown = 0;

  // Salon et match
  @type("string") hostId = "";
  @type("string") modeId: ModeId = DEFAULT_MODE;
  @type("uint8") totalRounds: number = ROUNDS.default;
  @type("uint8") round = 0;
  @type({ map: PlayerInfo }) players = new MapSchema<PlayerInfo>();

  // Manche en cours
  @type({ map: Entity }) entities = new MapSchema<Entity>();
  @type({ map: Crosshair }) crosshairs = new MapSchema<Crosshair>();
}
