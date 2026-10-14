import { assertEquals } from 'jsr:@std/assert@1';
import { type Claimed, lockScreenText } from './text.ts';

const base: Claimed = {
  notification_id: 1,
  user_id: 'u',
  kind: 'message',
  title: 'Anu sent you a message',
  body: 'See you at the Onam lunch!',
  data: {},
  show_previews: false,
  tokens: ['t'],
};

Deno.test('hides names and text on the lock screen when previews are off', () => {
  assertEquals(lockScreenText(base), { title: 'NearMalayali', body: 'You have a new notification' });
});

Deno.test('shows the text when previews are on', () => {
  assertEquals(lockScreenText({ ...base, show_previews: true }), { title: base.title, body: base.body });
});

Deno.test('proximity alerts are already generic and always shown as written', () => {
  const n = { ...base, kind: 'proximity', title: 'A fellow Malayali is nearby', body: 'Would you like to discover your community?' };
  assertEquals(lockScreenText(n), { title: n.title, body: n.body });
});
