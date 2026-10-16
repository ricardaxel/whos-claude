import {
  CROSSHAIR_COLORS, isModeId, type KickMessage, MODES, MSG, ReadyMessage, ROUNDS, SettingsMessage,
} from "@whosclaude/shared";
import type { GameRoom } from "../net";
import { byId, playerRow } from "./dom";

/**
 * Salon : code à partager, joueurs et leur statut, réglages (modifiables par l'hôte seul).
 * Le serveur reste maître : l'écran envoie des demandes et affiche l'état reçu.
 */
export class LobbyScreen {
  private room?: GameRoom;
  private code = byId("lobby-code");
  private copyButton = byId<HTMLButtonElement>("lobby-copy");
  private players = byId<HTMLUListElement>("lobby-players");
  private mode = byId<HTMLSelectElement>("lobby-mode");
  private modeDescription = byId("lobby-mode-description");
  private rounds = byId<HTMLSelectElement>("lobby-rounds");
  private hostHint = byId("lobby-host-hint");
  private readyButton = byId<HTMLButtonElement>("lobby-ready");
  private startButton = byId<HTMLButtonElement>("lobby-start");

  constructor(onLeave: () => void) {
    for (const info of Object.values(MODES)) this.mode.add(option(info.name, info.id));
    for (let n = ROUNDS.min; n <= ROUNDS.max; n++) this.rounds.add(option(String(n), String(n)));

    this.mode.addEventListener("change", () => {
      if (isModeId(this.mode.value)) this.sendSettings({ modeId: this.mode.value });
    });
    this.rounds.addEventListener("change", () => this.sendSettings({ rounds: Number(this.rounds.value) }));
    this.readyButton.addEventListener("click", () => this.toggleReady());
    this.startButton.addEventListener("click", () => this.room?.send(MSG.startMatch));
    this.copyButton.addEventListener("click", () => this.copyLink());
    byId("lobby-leave").addEventListener("click", onLeave);
  }

  attach(room: GameRoom) {
    this.room = room;
    this.code.textContent = room.roomId;
    this.copyButton.textContent = "Copier le lien";
  }

  /** Bascule « prêt » ; aussi déclenché par Entrée / Start via la couche d'inputs. */
  toggleReady() {
    const me = this.room?.state.players.get(this.room.sessionId);
    if (!this.room || !me) return;
    const message: ReadyMessage = { ready: !me.ready };
    this.room.send(MSG.ready, message);
  }

  render() {
    const room = this.room;
    if (!room) return;
    const { state, sessionId } = room;
    const isHost = state.hostId === sessionId;

    this.players.replaceChildren(
      ...[...state.players.entries()].map(([id, p]) => {
        const badges = [];
        if (id === state.hostId) badges.push({ text: "hôte" });
        else badges.push(p.ready ? { text: "prêt", ok: true } : { text: "pas prêt" });
        if (id === sessionId) badges.push({ text: "toi" });
        const actions = isHost && id !== sessionId ? [this.kickButton(id, p.name)] : [];
        return playerRow(CROSSHAIR_COLORS[p.color] ?? 0xffffff, p.name, badges, actions);
      }),
    );

    // Ne pas écraser un menu déroulant que l'hôte est en train d'utiliser.
    if (document.activeElement !== this.mode) this.mode.value = state.modeId;
    if (document.activeElement !== this.rounds) this.rounds.value = String(state.totalRounds);
    this.mode.disabled = !isHost;
    this.rounds.disabled = !isHost;
    this.modeDescription.textContent = isModeId(state.modeId) ? MODES[state.modeId].description : "";

    const me = state.players.get(sessionId);
    const othersReady = [...state.players.entries()].every(([id, p]) => id === state.hostId || p.ready);
    this.readyButton.hidden = isHost;
    this.readyButton.textContent = me?.ready ? "Je ne suis plus prêt" : "Je suis prêt";
    this.startButton.hidden = !isHost;
    this.startButton.disabled = !othersReady;
    this.hostHint.textContent = isHost
      ? othersReady ? "Tout le monde est prêt." : "En attente des joueurs pas encore prêts…"
      : "L'hôte choisit les réglages et lance le match.";
  }

  /** Réservé à l'hôte : exclut un joueur, qui ne pourra plus revenir dans cette partie. */
  private kickButton(playerId: string, name: string) {
    const button = document.createElement("button");
    button.className = "kick";
    button.textContent = "Exclure";
    button.addEventListener("click", () => {
      if (!confirm(`Exclure ${name} de la partie ?`)) return;
      const message: KickMessage = { playerId };
      this.room?.send(MSG.kick, message);
    });
    return button;
  }

  private sendSettings(settings: SettingsMessage) {
    this.room?.send(MSG.settings, settings);
  }

  private async copyLink() {
    if (!this.room) return;
    const url = `${location.origin}${location.pathname}?room=${this.room.roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      this.copyButton.textContent = "Lien copié !";
    } catch {
      this.copyButton.textContent = url; // presse-papiers refusé : on affiche le lien
    }
  }
}

function option(label: string, value: string) {
  const element = document.createElement("option");
  element.textContent = label;
  element.value = value;
  return element;
}
