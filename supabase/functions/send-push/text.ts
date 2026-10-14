export interface Claimed {
  notification_id: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  show_previews: boolean;
  tokens: string[];
}

// What appears on the lock screen. Proximity alerts are already generic; for
// everything else, previews off means no names or message text.
export function lockScreenText(n: Claimed): { title: string; body: string } {
  if (n.kind === 'proximity' || n.show_previews) return { title: n.title, body: n.body };
  return { title: 'NearMalayali', body: 'You have a new notification' };
}

