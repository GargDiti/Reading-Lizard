export const SESSION_EXPIRED_EVENT = "reading-lizard:session-expired";

export function notifySessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}
