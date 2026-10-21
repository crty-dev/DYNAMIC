import { useEffect } from "react";
import { autoStartSupportChat, isCrispEager } from "../../lib/crisp";

/**
 * The live chat of the marketing site.
 *
 * It only exists on a desktop: the chat panel covers the whole screen on a
 * phone, so the chat is not offered there at all (the CSS in landing.css
 * hides the widget as well, in case the page is resized down).
 */
const DESKTOP = "(min-width: 768px)";

export function SupportChat() {
  useEffect(() => {
    if (!isCrispEager()) return;
    const query = window.matchMedia(DESKTOP);
    if (!query.matches) return;
    autoStartSupportChat();
  }, []);

  return null;
}
