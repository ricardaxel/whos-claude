import { ROOM_CODE, sanitizeName } from "@whosclaude/shared";
import { byId, storage } from "./dom";

const NAME_KEY = "whosclaude.name";

export interface HomeActions {
  create(name: string): Promise<void>;
  join(code: string, name: string): Promise<void>;
}

/** Accueil : pseudo, puis créer une partie ou en rejoindre une avec un code. */
export class HomeScreen {
  private name = byId<HTMLInputElement>("home-name");
  private code = byId<HTMLInputElement>("home-code");
  private createButton = byId<HTMLButtonElement>("home-create");
  private joinButton = byId<HTMLButtonElement>("home-join");
  private error = byId("home-error");

  constructor(private readonly actions: HomeActions) {
    this.name.value = storage.get(NAME_KEY) ?? "";
    // Lien d'invitation : ?room=CODE pré-remplit le code.
    this.code.value = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";

    this.createButton.addEventListener("click", () => this.submit(() => this.actions.create(this.readName())));
    this.joinButton.addEventListener("click", () => this.submitJoin());
    this.code.addEventListener("keydown", (e) => e.key === "Enter" && this.submitJoin());
  }

  show(error = "") {
    this.error.textContent = error;
    this.setBusy(false);
    (this.code.value ? this.joinButton : this.createButton).focus();
  }

  private submitJoin() {
    const code = this.code.value.trim().toUpperCase();
    if (code.length !== ROOM_CODE.length) {
      this.error.textContent = `Le code fait ${ROOM_CODE.length} lettres.`;
      return;
    }
    this.submit(() => this.actions.join(code, this.readName()));
  }

  private readName() {
    const name = sanitizeName(this.name.value);
    storage.set(NAME_KEY, name);
    return name;
  }

  private async submit(action: () => Promise<void>) {
    this.error.textContent = "";
    this.setBusy(true);
    try {
      await action();
    } catch (error) {
      this.error.textContent = error instanceof Error ? error.message : String(error);
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean) {
    this.createButton.disabled = busy;
    this.joinButton.disabled = busy;
  }
}
