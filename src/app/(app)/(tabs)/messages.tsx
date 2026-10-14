import { AppText, NotYetAvailable, Screen } from '@/components/ui';

export default function MessagesTab() {
  return (
    <Screen edges={['top']}>
      <AppText variant="title">Messages</AppText>
      <NotYetAvailable
        stage="Stage C"
        feature="Private messages and group chats"
        details="One-to-one and group conversations with photos, voice notes, reactions and replies. People who aren't connected with you will arrive as message requests, according to your privacy settings."
      />
    </Screen>
  );
}
