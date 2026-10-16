/**
 * Appelle `callback` quand la page perd le focus : onglet masqué, application mise en
 * arrière-plan sur téléphone, ou fenêtre quittée sur ordinateur. Renvoie le désabonnement.
 */
export function onFocusLost(callback: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") callback();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", callback);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", callback);
  };
}
