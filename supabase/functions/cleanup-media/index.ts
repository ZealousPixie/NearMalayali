// Deletes stored files nothing refers to any more: photos from unsent
// messages and deleted posts, abandoned uploads and replaced profile photos.
// Files attached to reports still under review are kept as evidence.
//
// Called daily by the database (pg_cron + pg_net) with the shared secret in
// the x-push-secret header (the same secret as send-push).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) {
    return json({ error: 'FORBIDDEN' }, 403);
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  let removed = 0;
  const failures: string[] = [];
  for (let round = 0; round < 10; round++) {
    const { data, error } = await admin.rpc('orphaned_media', { p_limit: 500 });
    if (error) return json({ error: 'LIST_FAILED', detail: error.message, removed }, 500);
    const rows = (data ?? []) as { bucket_id: string; name: string }[];
    if (!rows.length) break;

    const byBucket = new Map<string, string[]>();
    for (const r of rows) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.name]);
    let progressed = false;
    for (const [bucket, names] of byBucket) {
      const { data: deleted, error: removeError } = await admin.storage.from(bucket).remove(names);
      if (removeError) {
        failures.push(`${bucket}: ${removeError.message}`);
        continue;
      }
      removed += deleted?.length ?? 0;
      if (deleted?.length) progressed = true;
    }
    if (!progressed || rows.length < 500) break;
  }
  return json({ removed, failures });
});
