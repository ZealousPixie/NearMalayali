// Permanently deletes the calling user's account.
//
// Why an Edge Function: removing a row from auth.users needs the service-role
// key, which must never ship inside the mobile app. The function verifies the
// caller's own JWT, deletes their storage files, then deletes the auth user.
// Every public table references auth.users / profiles with ON DELETE CASCADE,
// so profile, settings, location, consents, blocks and connections go too.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

// Buckets with per-user folders. Chat photos are removed by the cleanup-media
// job once the database has erased the messages that referenced them.
const MEDIA_BUCKETS = ['profile-media', 'post-media'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'NOT_AUTHENTICATED' }, 401);
  const userId = userData.user.id;

  let body: { confirm?: string } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the confirmation check
  }
  if (body.confirm !== 'DELETE') return json({ error: 'CONFIRMATION_REQUIRED' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  for (const bucket of MEDIA_BUCKETS) {
    // Files live under "<userId>/..."; list in pages and remove.
    for (;;) {
      const { data: files, error } = await admin.storage.from(bucket).list(userId, { limit: 100 });
      if (error) return json({ error: 'STORAGE_CLEANUP_FAILED', detail: error.message }, 500);
      if (!files || files.length === 0) break;
      const { error: removeError } = await admin.storage
        .from(bucket)
        .remove(files.map((f) => `${userId}/${f.name}`));
      if (removeError) return json({ error: 'STORAGE_CLEANUP_FAILED', detail: removeError.message }, 500);
      if (files.length < 100) break;
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: 'DELETE_FAILED', detail: deleteError.message }, 500);

  return json({ deleted: true });
});
