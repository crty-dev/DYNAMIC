/**
 * Crisp live chat.
 *
 * DYNAMIC does not track its visitors, so the third party chat script is not
 * loaded on page load: it is fetched the first time somebody asks for
 * support. Until then no request leaves the site and no third party cookie is
 * set - the promise in the hero ("no cookies, no personal data") stays true
 * for every visitor who does not open the chat.
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

/** True when the operator asked for the widget to load on every page view. */
export function isCrispEager(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_CRISP_EAGER === "1"
  );
}

/** Loads the chat (once) and opens the conversation. */
export function openSupportChat({ open = true }: { open?: boolean } = {}): void {
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
  if (open) w.$crisp.push(["do", "chat:open"]);
}
