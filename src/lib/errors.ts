// Turns Supabase / database / network errors into messages people can act on.

const SERVER_CODES: Record<string, string> = {
  AGE_INELIGIBLE: 'NearMalayali is for people aged 18 and over.',
  DOB_INVALID: 'Please check your date of birth.',
  USERNAME_INVALID: 'Usernames are 3–24 characters: letters, numbers and underscores.',
  USERNAME_RESERVED: 'That username is reserved. Please choose another.',
  USERNAME_TAKEN: 'That username is already taken.',
  DISPLAY_NAME_INVALID: 'Enter a display name of up to 50 characters.',
  CONSENT_REQUIRED: 'Please accept the terms, privacy policy and community guidelines.',
  ALREADY_ONBOARDED: 'Your profile is already set up.',
  RATE_LIMITED: 'You are doing that too often. Please wait a little and try again.',
  NOT_AUTHENTICATED: 'Your session has ended. Please sign in again.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Contact support if you think this is a mistake.',
  PAUSE_TOO_LONG: 'You can pause discovery for up to 30 days at a time.',
  CONFIRMATION_REQUIRED: 'Please confirm that you want to delete your account.',
  DISCOVERY_OFF: 'Turn on discovery to see who is around you. You can still explore other towns.',
  LOCATION_STALE: 'We need a fresh location to show people near you.',
  LOCATION_INVALID: 'That location doesn\'t look right.',
  RADIUS_INVALID: 'Please choose one of the listed distances.',
  RADIUS_TOO_SMALL_FOR_AREA_SEARCH: 'When exploring another town, choose 5 km or more.',
  NOT_ALLOWED: 'This isn\'t available for your account right now.',
  USER_UNAVAILABLE: 'This member isn\'t available.',
  NOT_ACCEPTING_REQUESTS: 'This member isn\'t accepting connection requests.',
  REQUEST_NOT_FOUND: 'That request is no longer pending.',
  MESSAGES_RESTRICTED: 'This member only accepts messages from their connections.',
  REQUEST_PENDING: 'You can send up to 3 messages until they accept your message request.',
  CONVERSATION_NOT_FOUND: 'This conversation isn\'t available.',
  MESSAGE_NOT_FOUND: 'That message is no longer available.',
  MESSAGE_INVALID: 'Type a message first.',
  MESSAGE_TOO_LONG: 'Messages can be up to 4,000 characters.',
  ATTACHMENT_INVALID: 'That attachment couldn\'t be sent.',
  REPLY_INVALID: 'The message you replied to is no longer available.',
  TITLE_INVALID: 'Enter a name of up to 80 characters.',
  MEMBERS_INVALID: 'Choose between 1 and 100 people.',
  PHOTO_PERMISSION_DENIED: 'Allow photo access in your phone\'s Settings to share photos.',
  IMAGE_TOO_LARGE: 'That photo is too large. Please choose another.',
};

// Messages from Supabase Auth (GoTrue), matched case-insensitively.
const AUTH_PATTERNS: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email or password is incorrect.'],
  [/email not confirmed/i, 'Please verify your email first. We can send you a new code.'],
  [/user already registered|already been registered/i, 'An account with this email already exists. Try signing in.'],
  [/token has expired or is invalid|otp.*(expired|invalid)/i, 'That code is wrong or has expired. Request a new one.'],
  [/password should be|weak password|password.*(characters|contain)/i, 'Choose a stronger password: at least 8 characters with letters and numbers.'],
  [/new password should be different/i, 'Choose a password you have not used for this account.'],
  [/for security purposes, you can only request this after/i, 'Please wait a minute before requesting another code.'],
  [/rate limit|too many requests/i, 'Too many attempts. Please wait a few minutes and try again.'],
  [/signups not allowed|signup.*disabled/i, 'New sign-ups are currently closed.'],
  [/network request failed|failed to fetch|network error|timeout/i, 'Can\'t reach NearMalayali. Check your connection and try again.'],
];

export function friendlyError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : '';

  const code = message.trim();
  if (SERVER_CODES[code]) return SERVER_CODES[code];
  for (const [re, text] of AUTH_PATTERNS) {
    if (re.test(message)) return text;
  }
  return 'Something went wrong. Please try again.';
}
