// Owner/admin-only profile management. Lists profiles, creates new auth
// users (email+password), and updates role / active flag. Anything that
// touches auth.users uses the supabase admin API and therefore must run
// with service-role privilege server-side.

import { jsonResponse, preflight } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { AuthError, requireStaff } from '../_shared/auth.ts';
import { correlationFromRequest, log } from '../_shared/logger.ts';

const ROLES = new Set(['owner', 'admin', 'mia', 'sales_rep', 'viewer']);

interface CreatePayload {
  action: 'create';
  email: string;
  password: string;
  fullName?: string | null;
  role: string;
}
interface UpdatePayload {
  action: 'update';
  userId: string;
  role?: string;
  isActive?: boolean;
  fullName?: string | null;
  password?: string;
}
type Payload = CreatePayload | UpdatePayload;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const correlationId = correlationFromRequest(req);

  let staff;
  try {
    staff = await requireStaff(req, { allow: ['owner', 'admin'] });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(req, { error: err.message }, err.status);
    throw err;
  }

  const supabase = getServiceSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) return jsonResponse(req, { error: error.message }, 500);
    return jsonResponse(req, { ok: true, profiles: data ?? [] });
  }

  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const body = (await req.json().catch(() => ({}))) as Payload;

  if (body.action === 'create') {
    if (!body.email || !body.password || !body.role) {
      return jsonResponse(req, { error: 'Missing email, password, or role' }, 400);
    }
    if (!ROLES.has(body.role)) return jsonResponse(req, { error: 'Invalid role' }, 400);
    if (body.password.length < 12) return jsonResponse(req, { error: 'Password too short (>=12)' }, 400);

    const created = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (created.error) return jsonResponse(req, { error: created.error.message }, 400);

    const userId = created.data.user!.id;
    const profileUpsert = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        email: body.email,
        full_name: body.fullName ?? null,
        role: body.role,
        is_active: true,
      })
      .select('id, email, full_name, role, is_active')
      .single();
    if (profileUpsert.error) return jsonResponse(req, { error: profileUpsert.error.message }, 500);

    log.info('user_created', { fn: 'users-manage', correlationId, by: staff.userId, target: userId, role: body.role });
    return jsonResponse(req, { ok: true, profile: profileUpsert.data });
  }

  if (body.action === 'update') {
    if (!body.userId) return jsonResponse(req, { error: 'Missing userId' }, 400);
    const updates: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!ROLES.has(body.role)) return jsonResponse(req, { error: 'Invalid role' }, 400);
      updates.role = body.role;
    }
    if (body.isActive !== undefined) updates.is_active = body.isActive;
    if (body.fullName !== undefined) updates.full_name = body.fullName;

    if (body.password !== undefined) {
      if (body.password.length < 12) return jsonResponse(req, { error: 'Password too short (>=12)' }, 400);
      const authUpdate = await supabase.auth.admin.updateUserById(body.userId, {
        password: body.password,
      });
      if (authUpdate.error) return jsonResponse(req, { error: authUpdate.error.message }, 400);
    }

    let data;
    if (Object.keys(updates).length > 0) {
      const profileUpdate = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', body.userId)
        .select('id, email, full_name, role, is_active')
        .single();
      if (profileUpdate.error) return jsonResponse(req, { error: profileUpdate.error.message }, 500);
      data = profileUpdate.data;
    } else {
      const profileRead = await supabase
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', body.userId)
        .single();
      if (profileRead.error) return jsonResponse(req, { error: profileRead.error.message }, 500);
      data = profileRead.data;
    }

    log.info('user_updated', {
      fn: 'users-manage', correlationId, by: staff.userId, target: body.userId,
      updates: { ...updates, password: body.password !== undefined ? '[updated]' : undefined },
    });
    return jsonResponse(req, { ok: true, profile: data });
  }

  return jsonResponse(req, { error: 'Unsupported action' }, 400);
});
