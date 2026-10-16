import { getStateCallbacks } from "colyseus.js";
import type { Phase } from "@whosclaude/shared";
import { createRoom, GameRoom, joinRoom, reconnectRoom } from "./net";
import type { GameScene } from "./GameScene";
import { showScreen, type Screen } from "./ui/dom";
import { setupFullscreen } from "./ui/fullscreen";
import { HomeScreen } from "./ui/HomeScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { PodiumScreen } from "./ui/PodiumScreen";

/**
 * Flux de session côté client : accueil → salon → match → podium → salon.
 * Hors accueil, l'écran affiché découle uniquement de `state.phase` reçu du serveur.
 * Les menus ne se redessinent que sur les changements qui les concernent,
 * jamais à chaque patch de la manche.
 */
/** Code de fermeture d'un départ volontaire (room.leave()) côté Colyseus. */
const CONSENTED_LEAVE = 4000;

export class Session {
  /**
   * Après une coupure, tentatives de retour (ms d'attente avant chacune). Le serveur
   * garde la place 20 s : on essaie pendant une quinzaine de secondes.
   */
  static reconnectDelaysMs = [300, 1000, 2000, 4000, 7000];

  private room?: GameRoom;
  private leavingOnPurpose = false;
  /**
   * Numéro de la tentative de connexion en cours : créer ou rejoindre une partie depuis
   * l'accueil annule une boucle de reconnexion encore active (une seule room à la fois).
   */
  private attempt = 0;
  private home: HomeScreen;
  private lobby: LobbyScreen;
  private podium = new PodiumScreen();

  constructor(private readonly scene: GameScene) {
    setupFullscreen();
    this.home = new HomeScreen({
      create: (name) => this.enter(createRoom({ name })),
      join: (code, name) => this.enter(joinRoom(code, { name })),
    });
    this.lobby = new LobbyScreen(() => this.leave());
    showScreen("home");
    this.home.show();
  }

  private async enter(pending: Promise<GameRoom>) {
    this.attempt++;
    this.attachRoom(await pending);
  }

  private attachRoom(room: GameRoom) {
    this.room = room;
    this.leavingOnPurpose = false;
    // L'URL devient le lien d'invitation.
    history.replaceState(null, "", `?room=${room.roomId}`);

    this.lobby.attach(room);
    this.scene.attach(room, { toggleReady: () => this.lobby.toggleReady() });
    this.bindMenus(room);
    room.onLeave((code) => void this.onLeft(code));
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

  private async onLeft(code?: number) {
    const token = this.room?.reconnectionToken;
    this.scene.detach();
    this.room = undefined;

    // Coupure involontaire (écran verrouillé, wifi…) : on tente de reprendre sa place.
    if (!this.leavingOnPurpose && code !== CONSENTED_LEAVE && token) {
      const attempt = ++this.attempt;
      const cancelled = () => attempt !== this.attempt;
      showScreen("home");
      this.home.show("Connexion perdue… reconnexion en cours");
      for (const delay of Session.reconnectDelaysMs) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelled()) return; // le joueur a créé ou rejoint une autre partie entre-temps
        try {
          const room = await reconnectRoom(token);
          if (cancelled()) return void room.leave(); // retrouvée trop tard : on la quitte
          this.attachRoom(room);
          return;
        } catch {
          // la partie n'est pas encore joignable : on réessaie
        }
      }
      if (cancelled()) return;
    }

    history.replaceState(null, "", location.pathname);
    showScreen("home");
    this.home.show(this.leavingOnPurpose ? "" : "Connexion perdue avec la partie.");
  }
}
