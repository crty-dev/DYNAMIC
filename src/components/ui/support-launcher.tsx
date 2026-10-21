import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { openSupportChat, autoStartSupportChat, isCrispEager } from "../../lib/crisp";

/**
 * The live chat of the marketing site.
 *
 * On a desktop the Crisp widget is loaded with the page and opens by itself
 * (its own bubble in the corner is the launcher). On a phone the chat panel
 * would cover the whole screen, so the visitor gets a button and the script
 * is only fetched when it is tapped.
 */
const DESKTOP = "(min-width: 768px)";

export function SupportLauncher() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);

    const apply = () => {
      setIsDesktop(query.matches);
      // The chat opens by itself on a desktop, unless it was turned off.
      if (query.matches && isCrispEager()) autoStartSupportChat();
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // On a desktop the Crisp bubble is the launcher.
  if (isDesktop) return null;

  return (
    <button
      type="button"
      className="support-launcher"
      onClick={() => openSupportChat()}
      aria-label="Canlı destek sohbetini aç"
    >
      <MessageCircle size={18} aria-hidden />
      <span>Destek</span>
    </button>
  );
}
