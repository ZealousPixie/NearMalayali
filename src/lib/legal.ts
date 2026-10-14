// Draft legal texts shown in the app. They describe what the app actually
// does today and MUST be reviewed by a lawyer before public launch.
import { LEGAL_VERSIONS } from './env';

interface LegalDoc {
  title: string;
  version: string;
  sections: { heading: string; body: string }[];
}

export const LEGAL_DOCS: Record<'terms' | 'privacy' | 'guidelines', LegalDoc> = {
  terms: {
    title: 'Terms of Service',
    version: LEGAL_VERSIONS.terms,
    sections: [
      { heading: 'Who can use NearMalayali', body: 'You must be 18 or over and able to form a binding agreement. One person, one account.' },
      {
        heading: 'Your account',
        body: 'Keep your password safe and tell us if you think your account has been misused. You may use a chosen display name, but must not impersonate anyone.',
      },
      {
        heading: 'Your content',
        body: 'You own what you post. You give NearMalayali permission to store and show it to the people your settings allow, only to run the service.',
      },
      {
        heading: 'Meeting people',
        body: 'NearMalayali helps you find people; it does not vet them. Meet in public places, tell someone where you are going, and use blocking and reporting if anyone makes you uncomfortable.',
      },
      {
        heading: 'Ending your account',
        body: 'You can deactivate or permanently delete your account at any time in Settings › Account. We may suspend accounts that break these terms or the Community Guidelines.',
      },
      {
        heading: 'No guarantees',
        body: 'Nearby discovery depends on your phone, its settings and its operating system. We do not guarantee that every nearby member will be detected or that alerts arrive instantly.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    version: LEGAL_VERSIONS.privacy,
    sections: [
      {
        heading: 'What we collect',
        body: 'Your email address, password (stored only as a secure hash by our authentication provider), date of birth (to check you are 18+, never shown to anyone), the profile details you choose to add, your settings, and consent records.',
      },
      {
        heading: 'Location',
        body: 'Nothing about your location is collected unless you turn on discovery and grant location permission. We then keep only your single most recent position, never a history. It is deleted when you turn discovery off, pause, deactivate, or after 24 hours without an update. Other members never see your exact position: distances are shown as ranges and the map shows only areas with at least three people.',
      },
      {
        heading: 'Who sees your information',
        body: 'Your display name, username and photo are visible to signed-in members. You decide whether other profile fields are visible to everyone, only connections, or only you. People you block cannot see you at all.',
      },
      {
        heading: 'Where it is stored',
        body: 'Data is stored with Supabase (database, authentication and files). It is encrypted in transit (TLS) and at rest. Messages, when available, will not be end-to-end encrypted.',
      },
      {
        heading: 'Your choices',
        body: 'You can edit your profile, change visibility, pause or switch off discovery, and permanently delete your account and data from within the app.',
      },
      { heading: 'Contact', body: 'Privacy questions: privacy@nearmalayali.example (placeholder until a real address is set up).' },
    ],
  },
  guidelines: {
    title: 'Community Guidelines',
    version: LEGAL_VERSIONS.guidelines,
    sections: [
      { heading: 'Be respectful', body: 'No harassment, hate speech, threats, or bullying, including about religion, caste, gender, sexuality or region.' },
      {
        heading: 'Respect privacy and safety',
        body: 'Never try to work out where someone lives or follow their movements. Do not share other people\'s personal details or photos without permission.',
      },
      { heading: 'Be genuine', body: 'No fake accounts, impersonation, spam, scams, or misleading offers of jobs, housing or visas.' },
      { heading: 'Keep it legal', body: 'No illegal goods or services, and no sexual content involving anyone under 18 — ever.' },
      {
        heading: 'Enforcement',
        body: 'Content may be removed and accounts suspended for breaking these rules. Block anyone you don\'t want to hear from; reporting tools are arriving soon.',
      },
    ],
  },
};
