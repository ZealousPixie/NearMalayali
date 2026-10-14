// Delivers pending notifications through Expo's push service (which relays
// to Apple APNs and Google FCM).
//
// Called by the database (pg_net trigger + pg_cron every minute) with the
// shared secret in the x-push-secret header. It claims a batch, sends it,
// and records the real result per notification. A notification is marked
// "sent" only when Expo accepted it for at least one of the user's devices.
// Each run also checks Expo receipts for earlier pushes and marks them
// "delivered" (accepted by Apple/Google) or "failed".
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';
import { type Claimed, lockScreenText } from './text.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH = 100;


interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) {
    return json({ error: 'FORBIDDEN' }, 403);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN'); // optional, enables Expo's enhanced push security

  let sent = 0;
  let failed = 0;

  for (let round = 0; round < 5; round++) {
    const { data, error } = await admin.rpc('claim_push_batch', { p_limit: BATCH });
    if (error) return json({ error: 'CLAIM_FAILED', detail: error.message }, 500);
    const batch = (data ?? []) as Claimed[];
    if (batch.length === 0) break;

    // One Expo message per (notification, token).
    const messages: { notificationId: number; token: string; payload: Record<string, unknown> }[] = [];
    for (const n of batch) {
      const text = lockScreenText(n);
      for (const token of n.tokens) {
        messages.push({
          notificationId: n.notification_id,
          token,
          payload: {
            to: token,
            title: text.title,
            body: text.body,
            data: { ...n.data, notificationId: n.notification_id, kind: n.kind },
            sound: 'default',
            priority: n.kind === 'proximity' || n.kind === 'message' ? 'high' : 'normal',
            channelId: n.kind === 'proximity' ? 'proximity' : 'default',
          },
        });
      }
    }

    const tickets: { ticket_id: string; notification_id: number; token: string }[] = [];
    const okByNotification = new Map<number, boolean>();
    const errorByNotification = new Map<number, string>();
    const deadTokens: string[] = [];

    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      let chunkTickets: ExpoTicket[] = [];
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(chunk.map((m) => m.payload)),
        });
        if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
        chunkTickets = ((await res.json()) as { data: ExpoTicket[] }).data ?? [];
      } catch (e) {
        for (const m of chunk) errorByNotification.set(m.notificationId, String(e));
        continue;
      }
      chunk.forEach((m, idx) => {
        const t = chunkTickets[idx];
        if (t?.status === 'ok') {
          okByNotification.set(m.notificationId, true);
          if (t.id) tickets.push({ ticket_id: t.id, notification_id: m.notificationId, token: m.token });
        } else {
          errorByNotification.set(m.notificationId, t?.details?.error ?? t?.message ?? 'UNKNOWN');
          if (t?.details?.error === 'DeviceNotRegistered') deadTokens.push(m.token);
        }
      });
    }

    if (deadTokens.length) await admin.rpc('remove_push_tokens', { p_tokens: deadTokens });
    if (tickets.length) await admin.rpc('record_push_tickets', { p_tickets: tickets });

    for (const n of batch) {
      const ok = okByNotification.get(n.notification_id) === true;
      await admin.rpc('complete_push', {
        p_notification_id: n.notification_id,
        p_ok: ok,
        p_error: ok ? null : (errorByNotification.get(n.notification_id) ?? 'NO_TICKET'),
      });
      if (ok) sent++;
      else failed++;
    }

    if (batch.length < BATCH) break;
  }

  const receipts = await checkReceipts(admin, accessToken);
  return json({ sent, failed, receipts });
});

// Asks Expo what Apple/Google said about pushes sent 15+ minutes ago.
async function checkReceipts(
  admin: SupabaseClient,
  accessToken: string | undefined,
): Promise<{ checked: number } | { error: string }> {
  const { data, error } = await admin.rpc('claim_receipt_batch', { p_limit: 1000 });
  if (error) return { error: error.message };
  const ids = ((data ?? []) as { ticket_id: string }[]).map((r) => r.ticket_id);
  if (!ids.length) return { checked: 0 };
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return { error: `Expo receipts HTTP ${res.status}` };
    const body = (await res.json()) as { data?: Record<string, { status: 'ok' | 'error'; message?: string; details?: { error?: string } }> };
    const receipts = Object.entries(body.data ?? {}).map(([ticket_id, r]) => ({
      ticket_id,
      status: r.status,
      error: r.status === 'error' ? (r.details?.error ?? r.message ?? 'UNKNOWN') : null,
    }));
    if (receipts.length) {
      const { error: recordError } = await admin.rpc('record_push_receipts', { p_receipts: receipts });
      if (recordError) return { error: recordError.message };
    }
    return { checked: receipts.length };
  } catch (e) {
    return { error: String(e) };
  }
}
