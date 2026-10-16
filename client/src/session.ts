import { createRoom, GameRoom, joinRoom } from "./net";
import type { GameScene } from "./GameScene";
import { showScreen, type Screen } from "./ui/dom";
import { HomeScreen } from "./ui/HomeScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { PodiumScreen } from "./ui/PodiumScreen";

/**
 * Flux de session côté client : accueil → salon → match → podium → salon.
 * Hors accueil, l'écran affiché découle uniquement de `state.phase` reçu du serveur.
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
    room.onStateChange(() => this.refresh());
    room.onLeave(() => this.onLeft());
    this.refresh();
  }

  private refresh() {
    const room = this.room;
    const phase = room?.state.phase;
    if (!room || !phase) return; // premier état pas encore reçu

    const screen: Screen = phase === "lobby" ? "lobby" : phase === "podium" ? "podium" : "game";
    showScreen(screen);
    if (screen === "lobby") this.lobby.render();
    if (screen === "podium") this.podium.render(room);
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
