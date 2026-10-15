import { Client, Room } from "colyseus";
import {
  AssignMessage, COUNTDOWN_SECONDS, Dir, IDLE, InputMessage, isDir, MSG, Phase,
  RESULTS_SECONDS, RevealMessage, step, TICK_RATE,
} from "@whosclaude/shared";
import { Entity, GameState } from "./GameState.js";
import type { GameMode, NpcBrain } from "./modes/GameMode.js";
import { RaceMode } from "./modes/RaceMode.js";

/** Données côté serveur uniquement : qui contrôle quoi. Jamais synchronisé. */
interface Controller extends NpcBrain {
  /** sessionId du joueur, ou null si l'entité est un PNJ. */
  playerId: string | null;
  /** Direction demandée par le joueur (ignorée pour les PNJ). */
  input: Dir;
}

export class GameRoom extends Room<GameState> {
  maxClients = 8;
  state = new GameState();

  private mode: GameMode = new RaceMode();
  private controllers = new Map<string, Controller>();
  private entityByPlayer = new Map<string, string>();
  private phaseTimer = 0;

  onCreate() {
    this.resetRound();

    this.onMessage(MSG.input, (client, message: InputMessage) => {
      const entityId = this.entityByPlayer.get(client.sessionId);
      if (!entityId || !isDir(message?.dir)) return;
      this.controllers.get(entityId)!.input = this.mode.mapInput(message.dir);
    });

    this.onMessage(MSG.start, () => {
      if (this.state.phase !== "lobby") return;
      this.setPhase("countdown", COUNTDOWN_SECONDS);
    });

    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    this.assignEntity(client);
  }

  onLeave(client: Client) {
    // L'entité redevient un PNJ et continue sa vie.
    const entityId = this.entityByPlayer.get(client.sessionId);
    if (!entityId) return;
    const controller = this.controllers.get(entityId)!;
    controller.playerId = null;
    controller.timer = 0;
    this.entityByPlayer.delete(client.sessionId);
  }

  /** Nouvelle manche : nouvelles entités, nouveaux identifiants, nouvelle attribution. */
  private resetRound() {
    this.state.entities.clear();
    this.controllers.clear();
    this.entityByPlayer.clear();

    for (const position of this.mode.spawnPositions()) this.spawnEntity(position.x, position.y);
    for (const client of this.clients) this.assignEntity(client);
    this.setPhase("lobby", 0);
  }

  private assignEntity(client: Client) {
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

  private spawnEntity(x: number, y: number) {
    // Identifiant aléatoire : l'ordre de création ne révèle rien.
    const id = Math.random().toString(36).slice(2, 10);
    const entity = new Entity();
    entity.x = x;
    entity.y = y;
    this.state.entities.set(id, entity);
    // Délai initial aléatoire pour que les PNJ ne démarrent pas tous ensemble.
    this.controllers.set(id, { playerId: null, input: IDLE, timer: Math.random() * 1.2 });
  }

  private setPhase(phase: Phase, seconds: number) {
    this.state.phase = phase;
    this.phaseTimer = seconds;
    this.state.countdown = Math.ceil(seconds);
  }

  private update(dt: number) {
    switch (this.state.phase) {
      case "countdown":
        this.phaseTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.phaseTimer));
        if (this.phaseTimer <= 0) this.setPhase("racing", 0);
        break;
      case "racing":
        this.moveEntities(dt);
        this.checkWinner();
        break;
      case "finished":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.resetRound();
        break;
    }
  }

  private moveEntities(dt: number) {
    this.state.entities.forEach((entity, id) => {
      const controller = this.controllers.get(id)!;
      if (controller.playerId === null) this.mode.thinkNpc(entity, controller, dt);
      else entity.dir = controller.input;

      const next = step(entity.x, entity.y, entity.dir as Dir, dt);
      entity.x = next.x;
      entity.y = next.y;
    });
  }

  private checkWinner() {
    const playerEntityIds = [...this.entityByPlayer.values()];
    const finishers = playerEntityIds
      .map((id) => ({ id, entity: this.state.entities.get(id)! }))
      .filter(({ entity }) => this.mode.hasWon(entity))
      .sort((a, b) => b.entity.x - a.entity.x);
    if (finishers.length === 0) return;

    this.state.entities.forEach((entity) => (entity.dir = IDLE));
    this.setPhase("finished", RESULTS_SECONDS);
    const message: RevealMessage = { winnerEntityId: finishers[0].id, playerEntityIds };
    this.broadcast(MSG.reveal, message);
  }
}
