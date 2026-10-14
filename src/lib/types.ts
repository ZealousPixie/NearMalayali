// Row shapes the app reads. Kept by hand for now; can be replaced with
// `supabase gen types typescript` once a project is linked.

export type FieldVisibility = 'public' | 'connections' | 'only_me';
export type MessagePermission = 'everyone' | 'requests' | 'connections_only';
export type ConnectPermission = 'everyone' | 'nobody';
export type AccountStatus = 'active' | 'deactivated' | 'suspended';

export interface Profile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_path: string | null;
  cover_path: string | null;
  is_verified: boolean;
  account_status: AccountStatus;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface ProfileDetails {
  user_id: string;
  bio: string;
  languages: string[];
  home_region: string;
  interests: string[];
  occupation: string;
  intro: string;
  connection_preferences: string[];
}

export interface ProfileVisibility {
  user_id: string;
  bio: FieldVisibility;
  languages: FieldVisibility;
  home_region: FieldVisibility;
  interests: FieldVisibility;
  occupation: FieldVisibility;
  intro: FieldVisibility;
  connection_preferences: FieldVisibility;
  connections_list: FieldVisibility;
  group_memberships: FieldVisibility;
  searchable: boolean;
  who_can_message: MessagePermission;
  who_can_connect: ConnectPermission;
  show_online_status: boolean;
  read_receipts: boolean;
  typing_indicators: boolean;
}

export interface DiscoverySettings {
  user_id: string;
  discoverable: boolean;
  map_visible: boolean;
  proximity_alerts: boolean;
  discovery_radius_m: number;
  alert_radius_m: number;
  alert_cooldown_hours: number;
  paused_until: string | null;
}

export interface NotificationPreferences {
  user_id: string;
  push_enabled: boolean;
  proximity: boolean;
  connection_requests: boolean;
  connection_accepted: boolean;
  messages: boolean;
  group_invites: boolean;
  follows: boolean;
  reactions_comments: boolean;
  event_invites: boolean;
  event_reminders: boolean;
  group_activity: boolean;
  security: boolean;
  show_previews: boolean;
}

/** What get_profile() returns: hidden fields are simply absent. */
export interface PublicProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  cover_path: string | null;
  is_verified: boolean;
  member_since: string;
  is_self: boolean;
  is_connected: boolean;
  bio?: string;
  languages?: string[];
  home_region?: string;
  interests?: string[];
  occupation?: string;
  intro?: string;
  connection_preferences?: string[];
}

export interface PersonSummary {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  is_verified?: boolean;
  home_region?: string | null;
}

export const CONNECTION_PREFERENCES: { value: string; label: string }[] = [
  { value: 'friendship', label: 'Friendship' },
  { value: 'newcomer_help', label: 'Newcomer help' },
  { value: 'family_meetups', label: 'Family meetups' },
  { value: 'networking', label: 'Networking' },
  { value: 'professional', label: 'Professional' },
  { value: 'sports', label: 'Sports' },
  { value: 'culture', label: 'Culture & arts' },
  { value: 'faith', label: 'Faith' },
  { value: 'study', label: 'Study' },
];

export const VISIBILITY_LABELS: Record<FieldVisibility, string> = {
  public: 'Everyone',
  connections: 'Connections',
  only_me: 'Only me',
};
