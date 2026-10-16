// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen, type HomeActions } from "../src/ui/HomeScreen";
import { loadPage } from "./page";

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const errorText = () => document.getElementById("home-error")!.textContent;

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

function actions(overrides: Partial<HomeActions> = {}) {
  return { create: vi.fn(async () => {}), join: vi.fn(async () => {}), ...overrides };
}

/** Laisse les promesses des actions se résoudre. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("HomeScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    setUrl("http://localhost:5173/");
    loadPage();
  });

  it("préremplit le code depuis le lien d'invitation, en majuscules", () => {
    setUrl("http://localhost:5173/?room=abcd");
    new HomeScreen(actions());
    expect(input("home-code").value).toBe("ABCD");
  });

  it("refuse un code de mauvaise longueur sans appeler le serveur", () => {
    const acts = actions();
    new HomeScreen(acts);
    input("home-code").value = "ABC";
    button("home-join").click();
    expect(acts.join).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/4 lettres/);
  });

  it("rejoint avec le code en majuscules et le pseudo nettoyé, puis le mémorise", async () => {
    const acts = actions();
    new HomeScreen(acts);
    input("home-name").value = "  Zoé​ ";
    input("home-code").value = " wxyz ";
    button("home-join").click();
    await flush();
    expect(acts.join).toHaveBeenCalledWith("WXYZ", "Zoé");
    expect(localStorage.getItem("whosclaude.name")).toBe("Zoé");

    loadPage();
    new HomeScreen(actions());
    expect(input("home-name").value).toBe("Zoé");
  });

  it("affiche l'erreur et réactive les boutons après un échec", async () => {
    let fail!: (error: Error) => void;
    const acts = actions({ create: vi.fn(() => new Promise<void>((_, reject) => (fail = reject))) });
    new HomeScreen(acts);
    button("home-create").click();
    expect(button("home-create").disabled).toBe(true);
    expect(button("home-join").disabled).toBe(true);

    fail(new Error("Aucune partie avec ce code."));
    await flush();
    expect(errorText()).toBe("Aucune partie avec ce code.");
    expect(button("home-create").disabled).toBe(false);
    expect(button("home-join").disabled).toBe(false);
  });
});
