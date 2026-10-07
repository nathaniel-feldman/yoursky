// Deletes the signed-in student's account. Profile, skies and friendships cascade; orders keep no user link.
import { makeDeleteHandler } from '../_shared/sky.js';
import { corsFor, withCors } from '../_shared/http.js';
import { admin, resolveUser } from '../_shared/supabase.ts';

const handler = makeDeleteHandler({
  resolveUser,
  deleteUser: async (id: string) => {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  },
});

Deno.serve(withCors(corsFor(Deno.env.get('ALLOWED_ORIGINS') ?? ''), handler));
