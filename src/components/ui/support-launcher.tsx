import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { openSupportChat, isCrispEager } from "../../lib/crisp";

/**
 * The live chat launcher of the marketing site.
 *
 * The Crisp script is a third party script: it is only fetched when the
 * visitor asks for support, so a visitor that never clicks stays free of
 * third party cookies and requests. Set VITE_CRISP_EAGER=1 to load it on
 * every page view instead (the classic snippet behaviour).
 */
export function SupportLauncher() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isCrispEager()) return;
    // Eager mode: the widget is expected to be on the page from the start.
    openSupportChat({ open: false });
    setReady(true);
  }, []);

  return (
    <button
      type="button"
      className="support-launcher"
      onClick={() => {
        openSupportChat();
        setReady(true);
      }}
      aria-label="Canlı destek sohbetini aç"
      data-ready={ready ? "true" : undefined}
    >
      <MessageCircle size={18} aria-hidden />
      <span>Destek</span>
    </button>
  );
}
