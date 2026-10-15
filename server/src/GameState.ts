import { MapSchema, Schema, type } from "@colyseus/schema";

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
  @type({ map: Entity }) entities = new MapSchema<Entity>();
}
