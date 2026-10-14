// Reporting (any member) and moderation tools (moderators and admins only;
// the database refuses these calls for everyone else).
import { supabase } from './supabase';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type ReportTarget = 'profile' | 'post' | 'comment' | 'message' | 'group' | 'event' | 'notice';
export const REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'spam', label: 'Spam' },
  { value: 'impersonation', label: 'Pretending to be someone' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'self_harm', label: 'Self-harm or suicide' },
  { value: 'underage', label: 'Under 18' },
  { value: 'privacy', label: 'Shares private information' },
  { value: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];
export const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label])) as Record<ReportReason, string>;

export const reportContent = (type: ReportTarget, id: string, reason: ReportReason, details: string) =>
  rpc<number>('report_content', { p_type: type, p_id: id, p_reason: reason, p_details: details });

export interface MyReport {
  id: number;
  target_type: ReportTarget;
  reason: ReportReason;
  status: 'open' | 'reviewing' | 'actioned' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
}
export async function myReports(): Promise<MyReport[]> {
  return (await rpc<MyReport[] | null>('my_reports')) ?? [];
}

export interface Restriction {
  suspended_until: string | null;
  reason: string;
}
export const myRestriction = () => rpc<Restriction | null>('my_restriction');

// ---- Moderators ---------------------------------------------------------------
export const isModerator = () => rpc<boolean>('is_moderator');
export const myRoles = async () => (await rpc<string[] | null>('my_roles')) ?? [];
export const openReportCount = () => rpc<number>('mod_open_report_count');

export interface QueueReport {
  id: number;
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  details: string;
  snapshot: Record<string, unknown>;
  status: MyReport['status'];
  created_at: string;
  reporter_username: string | null;
  target_user_id: string | null;
  target_username: string | null;
  target_display_name: string | null;
  target_account_status: string | null;
  reports_on_target: number;
  reports_on_user: number;
  resolution_note: string | null;
  handled_by_username: string | null;
}

export async function listReports(status: 'open' | 'actioned' | 'dismissed' | 'all'): Promise<QueueReport[]> {
  return (await rpc<QueueReport[] | null>('mod_list_reports', { p_status: status, p_limit: 100 })) ?? [];
}
export async function getReport(id: number): Promise<QueueReport | null> {
  const rows = (await rpc<QueueReport[] | null>('mod_list_reports', { p_status: 'all', p_limit: 1, p_id: id })) ?? [];
  return rows[0] ?? null;
}
export const resolveReport = (id: number, status: 'reviewing' | 'actioned' | 'dismissed', note?: string) =>
  rpc<void>('mod_resolve_report', { p_report: id, p_status: status, p_note: note ?? null });
export const removeContent = (type: ReportTarget, id: string, reason: string, reportId?: number) =>
  rpc<void>('mod_remove_content', { p_type: type, p_id: id, p_reason: reason, p_report: reportId ?? null });
export const warnUser = (userId: string, reason: string, reportId?: number) =>
  rpc<void>('mod_warn_user', { p_user: userId, p_reason: reason, p_report: reportId ?? null });
export const suspendUser = (userId: string, days: number | null, reason: string, reportId?: number) =>
  rpc<void>('mod_suspend_user', { p_user: userId, p_days: days, p_reason: reason, p_report: reportId ?? null });
export const unsuspendUser = (userId: string, reason: string) => rpc<void>('mod_unsuspend_user', { p_user: userId, p_reason: reason });

export interface ModUser {
  id: string;
  username: string | null;
  display_name: string;
  account_status: string;
  created_at: string;
  reports_against: number;
  roles: string[];
}
export async function findUsers(query: string): Promise<ModUser[]> {
  return (await rpc<ModUser[] | null>('mod_find_users', { p_query: query })) ?? [];
}

export interface ModUserSummary {
  id: string;
  username: string | null;
  display_name: string;
  avatar_path: string | null;
  account_status: string;
  created_at: string;
  roles: string[];
  restriction: Restriction | null;
  reports_against: number;
  open_reports_against: number;
  reports_made: number;
  actions: { action: string; reason: string; until: string | null; target_type: string | null; created_at: string; moderator: string | null }[];
}
export const userSummary = (userId: string) => rpc<ModUserSummary | null>('mod_user_summary', { p_user: userId });
export const setRole = (userId: string, role: 'admin' | 'moderator', grant: boolean) =>
  rpc<void>('admin_set_role', { p_user: userId, p_role: role, p_grant: grant });

export interface AuditEntry {
  id: number;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
export async function auditLog(before?: number): Promise<AuditEntry[]> {
  return (await rpc<AuditEntry[] | null>('admin_audit_log', { p_before: before ?? null, p_limit: 100 })) ?? [];
}

/** Signed link to a photo attached to a reported item (moderators only). */
export async function reportedMediaUrl(bucket: 'chat-media' | 'post-media', path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
