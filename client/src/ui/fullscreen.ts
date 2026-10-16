/**
 * Plein écran sur téléphone : la barre d'adresse du navigateur prend une bonne part
 * d'un écran en paysage.
 *
 * - Android (Chrome, Firefox, Samsung Internet) : API Fullscreen, avec un bouton et un
 *   passage automatique en créant ou rejoignant une partie ; l'écran est verrouillé en
 *   paysage quand le téléphone le permet.
 * - iPhone : l'API n'existe pas pour une page web. En revanche, ajoutée à l'écran
 *   d'accueil (Partager → Sur l'écran d'accueil), la page s'ouvre sans barre d'adresse
 *   grâce aux balises posées ici.
 */

const BUTTON_ID = "fullscreen-toggle";
const LABEL = { enter: "Plein écran", exit: "Quitter le plein écran" };

/** L'API Fullscreen est-elle utilisable ici (absente sur iPhone) ? */
export function fullscreenSupported() {
  return document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === "function";
}

/** Écran tactile (téléphone, tablette) : c'est là que le plein écran compte. */
export function isTouchDevice() {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * Passe en plein écran. À appeler pendant un geste de l'utilisateur (clic, toucher) :
 * le navigateur refuse sinon. Sans effet si c'est impossible ou déjà le cas.
 */
export function enterFullscreen() {
  if (!fullscreenSupported() || document.fullscreenElement) return;
  document.documentElement
    .requestFullscreen({ navigationUI: "hide" })
    .then(lockLandscape)
    .catch(() => {}); // refus du navigateur : on reste simplement en mode normal
}

/** Plein écran automatique en entrant dans une partie, sur écran tactile seulement. */
export function enterFullscreenOnTouch() {
  if (isTouchDevice()) enterFullscreen();
}

function lockLandscape() {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation?.lock?.("landscape").catch(() => {}); // pas toujours permis : sans gravité
}

/** Ajoute le bouton plein écran (écrans tactiles) et les balises « écran d'accueil ». */
export function setupFullscreen() {
  addHomeScreenTags();
  if (!fullscreenSupported() || document.getElementById(BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.hidden = !isTouchDevice();
  Object.assign(button.style, {
    position: "fixed", top: "8px", right: "8px", zIndex: "40", fontSize: "14px", padding: "6px 10px",
    background: "rgba(7, 5, 11, 0.75)", border: "3px double currentColor", borderRadius: "6px",
  });
  const refresh = () => (button.textContent = document.fullscreenElement ? LABEL.exit : LABEL.enter);
  refresh();
  button.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else enterFullscreen();
  });
  document.addEventListener("fullscreenchange", refresh);
  document.body.append(button);
}

/** Balises lues par iOS et Android quand on ajoute la page à l'écran d'accueil. */
function addHomeScreenTags() {
  const head = document.head;
  const meta = (name: string, content: string) => {
    if (head.querySelector(`meta[name="${name}"]`)) return;
    const tag = document.createElement("meta");
    tag.name = name;
    tag.content = content;
    head.append(tag);
  };
  meta("apple-mobile-web-app-capable", "yes");
  meta("mobile-web-app-capable", "yes");
  meta("apple-mobile-web-app-status-bar-style", "black-translucent");
  meta("apple-mobile-web-app-title", "WhosClaude");
  if (!head.querySelector('link[rel="manifest"]')) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/manifest.webmanifest";
    head.append(link);
  }
}
