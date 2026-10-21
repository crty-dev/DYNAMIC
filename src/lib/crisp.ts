/**
 * Crisp live chat.
 *
 * On a desktop the chat is loaded with the page and opens by itself, so a
 * visitor does not have to look for a button. On a phone the chat panel would
 * cover the whole screen, so the chat is only loaded when the visitor taps
 * the launcher.
 *
 * The script and the website id are public by design (the browser needs
 * them). What the chat itself collects is documented in docs/PRIVACY.md.
 */

const CRISP_WEBSITE_ID = "4280acc8-3c15-4051-a42b-dfb5842104d4";
const CRISP_SRC = "https://client.crisp.chat/l.js";

type CrispWindow = Window & {
  $crisp?: unknown[];
  CRISP_WEBSITE_ID?: string;
  CRISP_RUNTIME_CONFIG?: { locale?: string; disable_full_view?: boolean };
};

/** The chat is only loaded on demand when this is off. */
export function isCrispEager(): boolean {
  return !(typeof import.meta !== "undefined" && import.meta.env?.VITE_CRISP_EAGER === "0");
}

/** Loads the Crisp script (once) and applies the brand configuration. */
function loadCrisp(): void {
  if (typeof window === "undefined") return;
  const w = window as CrispWindow;

  w.$crisp = w.$crisp ?? [];
  w.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
  // The interface is Turkish, the chat should be too.
  w.CRISP_RUNTIME_CONFIG = { ...w.CRISP_RUNTIME_CONFIG, locale: "tr" };

  if (!document.querySelector(`script[src="${CRISP_SRC}"]`)) {
    const script = document.createElement("script");
    script.src = CRISP_SRC;
    script.async = true;
    document.head.appendChild(script);
  }

  // $crisp.push is async safe: the actions are queued until the script is
  // ready. The brand colours follow the DYNAMIC palette.
  w.$crisp.push(["config", "color:theme", ["teal"]]);
  w.$crisp.push(["config", "locale", ["tr"]]);
}

/** Loads the chat and opens the conversation. */
export function openSupportChat(): void {
  loadCrisp();
  const w = window as CrispWindow;
  w.$crisp?.push(["do", "chat:open"]);
}

/**
 * Desktop behaviour: the chat is there from the first paint and opens by
 * itself. The visitor can close it, the bubble stays in the corner.
 */
export function autoStartSupportChat(): void {
  loadCrisp();
  const w = window as CrispWindow;
  w.$crisp?.push(["do", "chat:open"]);
}
