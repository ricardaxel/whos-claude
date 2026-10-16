import { getStateCallbacks } from "colyseus.js";
import type { Phase } from "@whosclaude/shared";
import { createRoom, GameRoom, joinRoom } from "./net";
import type { GameScene } from "./GameScene";
import { showScreen, type Screen } from "./ui/dom";
import { HomeScreen } from "./ui/HomeScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { PodiumScreen } from "./ui/PodiumScreen";

/**
 * Flux de session côté client : accueil → salon → match → podium → salon.
 * Hors accueil, l'écran affiché découle uniquement de `state.phase` reçu du serveur.
 * Les menus ne se redessinent que sur les changements qui les concernent,
 * jamais à chaque patch de la manche.
 */
export class Session {
  private room?: GameRoom;
  private leavingOnPurpose = false;
  private home: HomeScreen;
  private lobby: LobbyScreen;
  private podium = new PodiumScreen();

  constructor(private readonly scene: GameScene) {
    this.home = new HomeScreen({
      create: (name) => this.enter(createRoom({ name })),
      join: (code, name) => this.enter(joinRoom(code, { name })),
    });
    this.lobby = new LobbyScreen(() => this.leave());
    showScreen("home");
    this.home.show();
  }

  private async enter(pending: Promise<GameRoom>) {
    const room = await pending;
    this.room = room;
    this.leavingOnPurpose = false;
    // L'URL devient le lien d'invitation.
    history.replaceState(null, "", `?room=${room.roomId}`);

    this.lobby.attach(room);
    this.scene.attach(room, { toggleReady: () => this.lobby.toggleReady() });
    this.bindMenus(room);
    room.onLeave(() => this.onLeft());
  }

  private bindMenus(room: GameRoom) {
    const $ = getStateCallbacks(room);
    const renderMenus = () => this.renderMenus();

    $(room.state).listen("phase", (phase: Phase) => {
      const screen: Screen = phase === "lobby" ? "lobby" : phase === "podium" ? "podium" : "game";
      showScreen(screen);
      renderMenus();
    });
    for (const field of ["hostId", "modeId", "totalRounds"] as const) $(room.state).listen(field, renderMenus);
    // Les contrôles tactiles affichés dépendent du mode (voir index.html).
    $(room.state).listen("modeId", (modeId: string) => (document.body.dataset.mode = modeId));
    $(room.state).players.onAdd((player: any) => {
      $(player).onChange(renderMenus);
      renderMenus();
    });
    $(room.state).players.onRemove(renderMenus);
  }

  private renderMenus() {
    const room = this.room;
    if (!room) return;
    if (room.state.phase === "lobby") this.lobby.render();
    if (room.state.phase === "podium") this.podium.render(room);
  }

  private async leave() {
    this.leavingOnPurpose = true;
    await this.room?.leave();
  }

  private onLeft() {
    this.scene.detach();
    this.room = undefined;
    history.replaceState(null, "", location.pathname);
    showScreen("home");
    this.home.show(this.leavingOnPurpose ? "" : "Connexion perdue avec la partie.");
  }
}
