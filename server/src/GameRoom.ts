import { Client, Room } from "colyseus";
import {
  ARENA, AssignMessage, Dir, DIR_VECTORS, ENTITY_COUNT, ENTITY_RADIUS, IDLE,
  InputMessage, isDir, MSG, step, TICK_RATE,
} from "@whosclaude/shared";
import { Entity, GameState } from "./GameState.js";

/** Données côté serveur uniquement : qui contrôle quoi. Jamais synchronisé. */
interface Controller {
  /** sessionId du joueur, ou null si l'entité est un PNJ. */
  playerId: string | null;
  /** Direction demandée par le joueur (ignorée pour les PNJ). */
  input: Dir;
  /** Temps restant avant que le PNJ ne change de comportement. */
  npcTimer: number;
}

export class GameRoom extends Room<GameState> {
  maxClients = 8;
  state = new GameState();

  private controllers = new Map<string, Controller>();
  private entityByPlayer = new Map<string, string>();

  onCreate() {
    for (let i = 0; i < ENTITY_COUNT; i++) this.spawnEntity();

    this.onMessage(MSG.input, (client, message: InputMessage) => {
      const entityId = this.entityByPlayer.get(client.sessionId);
      if (!entityId || !isDir(message?.dir)) return;
      this.controllers.get(entityId)!.input = message.dir;
    });

    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    // Le joueur prend le contrôle d'un PNJ existant : aucune entité n'apparaît,
    // donc rien dans le flux réseau ne trahit son arrivée.
    const free = [...this.controllers.entries()].filter(([, c]) => c.playerId === null);
    const [entityId, controller] = free[Math.floor(Math.random() * free.length)];
    controller.playerId = client.sessionId;
    controller.input = this.state.entities.get(entityId)!.dir as Dir;
    this.entityByPlayer.set(client.sessionId, entityId);

    const message: AssignMessage = { entityId };
    client.send(MSG.assign, message);
  }

  onLeave(client: Client) {
    // L'entité redevient un PNJ et continue sa vie.
    const entityId = this.entityByPlayer.get(client.sessionId);
    if (!entityId) return;
    const controller = this.controllers.get(entityId)!;
    controller.playerId = null;
    controller.npcTimer = 0;
    this.entityByPlayer.delete(client.sessionId);
  }

  private spawnEntity() {
    // Identifiant aléatoire : l'ordre de création ne révèle rien.
    const id = Math.random().toString(36).slice(2, 10);
    const entity = new Entity();
    entity.x = ENTITY_RADIUS + Math.random() * (ARENA.width - 2 * ENTITY_RADIUS);
    entity.y = ENTITY_RADIUS + Math.random() * (ARENA.height - 2 * ENTITY_RADIUS);
    this.state.entities.set(id, entity);
    this.controllers.set(id, { playerId: null, input: IDLE, npcTimer: 0 });
  }

  private update(dt: number) {
    this.state.entities.forEach((entity, id) => {
      const controller = this.controllers.get(id)!;
      if (controller.playerId === null) this.thinkNpc(entity, controller, dt);
      else entity.dir = controller.input;

      const next = step(entity.x, entity.y, entity.dir as Dir, dt);
      entity.x = next.x;
      entity.y = next.y;
      if (next.blocked && controller.playerId === null) controller.npcTimer = 0;
    });
  }

  /** IA volontairement simple : alterner pauses et marches dans une des 8 directions. */
  private thinkNpc(entity: Entity, controller: Controller, dt: number) {
    controller.npcTimer -= dt;
    if (controller.npcTimer > 0) return;

    if (Math.random() < 0.4) {
      entity.dir = IDLE;
      controller.npcTimer = 0.5 + Math.random() * 2.5;
    } else {
      entity.dir = this.pickDirectionAwayFromWalls(entity);
      controller.npcTimer = 0.5 + Math.random() * 3;
    }
  }

  private pickDirectionAwayFromWalls(entity: Entity): Dir {
    const margin = ENTITY_RADIUS * 3;
    const candidates = DIR_VECTORS.flatMap(([vx, vy], dir) => {
      if (vx < 0 && entity.x < margin) return [];
      if (vx > 0 && entity.x > ARENA.width - margin) return [];
      if (vy < 0 && entity.y < margin) return [];
      if (vy > 0 && entity.y > ARENA.height - margin) return [];
      return [dir as Dir];
    });
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
