import { MapSchema, Schema, type } from "@colyseus/schema";
import type { Phase } from "@whosclaude/shared";

/**
 * État diffusé à tous les clients. Volontairement minimal :
 * rien ici ne doit permettre de distinguer un joueur d'un PNJ.
 */
export class Entity extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("int8") dir = -1;
}

export class GameState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("uint8") countdown = 0;
  @type({ map: Entity }) entities = new MapSchema<Entity>();
}
