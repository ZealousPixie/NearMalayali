import { Stack, useLocalSearchParams } from 'expo-router';

import { AppText, Banner, EmptyState, Screen } from '@/components/ui';
import { LEGAL_DOCS } from '@/lib/legal';

export default function LegalDocument() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const content = LEGAL_DOCS[doc as keyof typeof LEGAL_DOCS];
  if (!content) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="document-outline" title="Document not found" message="This document doesn't exist." />
      </Screen>
    );
  }
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: content.title }} />
      <AppText variant="title">{content.title}</AppText>
      <AppText variant="caption" muted>
        Version {content.version}
      </AppText>
      <Banner tone="warning" message="Draft for review by a qualified lawyer before public launch." />
      {content.sections.map((s) => (
        <AppText key={s.heading}>
          <AppText style={{ fontWeight: '700' }}>{s.heading}{'\n'}</AppText>
          {s.body}
        </AppText>
      ))}
    </Screen>
  );
}
