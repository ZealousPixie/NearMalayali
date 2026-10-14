// A single post with its comments.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { AppText, Avatar, Banner, Button, Divider, ErrorView, LoadingView, Screen, TextField } from '@/components/ui';
import { Spacing, useTheme } from '@/constants/theme';
import { type Comment, commentOnPost, deleteComment, getPost, listComments, type Post } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const c = useTheme();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, cs] = await Promise.all([getPost(id), listComments(id)]);
      setPost(p);
      setComments(cs);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function send() {
    setSending(true);
    setActionError(null);
    try {
      await commentOnPost(id, text, replyTo?.id);
      setText('');
      setReplyTo(null);
      await load();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  function commentMenu(cm: Comment) {
    const canDelete = !cm.deleted && (cm.author_id === session?.user.id || post?.author_id === session?.user.id);
    Alert.alert(cm.author_name, undefined, [
      ...(cm.parent_id === null && !cm.deleted ? [{ text: 'Reply', onPress: () => setReplyTo(cm) }] : []),
      ...(cm.author_id ? [{ text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: cm.author_id! } }) }] : []),
      ...(canDelete
        ? [
            {
              text: 'Delete comment',
              style: 'destructive' as const,
              onPress: async () => {
                try {
                  await deleteComment(cm.id);
                  await load();
                } catch (e) {
                  setActionError(friendlyError(e));
                }
              },
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  if (error && post === undefined) return <ErrorView message={friendlyError(error)} onRetry={load} />;
  if (post === undefined || !session) return <LoadingView />;
  if (post === null) return <ErrorView message="This post isn't available. It may have been deleted, or you can't see it." />;

  return (
    <Screen edges={['bottom']}>
      <PostCard post={post} me={session.user.id} showComments={false} onChanged={setPost} onDeleted={() => router.back()} />
      <AppText variant="subtitle">Comments</AppText>
      {comments.length === 0 ? <AppText muted>No comments yet.</AppText> : null}
      {comments.map((cm) => (
        <Pressable
          key={cm.id}
          accessibilityRole="button"
          accessibilityHint="Opens comment options"
          onPress={() => commentMenu(cm)}
          style={{ flexDirection: 'row', gap: Spacing.sm, marginLeft: cm.parent_id ? Spacing.xl : 0 }}>
          <Avatar path={cm.author_avatar} name={cm.author_name} size={32} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              {cm.author_name} <AppText variant="caption" muted>· {timeAgo(cm.created_at)}</AppText>
            </AppText>
            <AppText style={cm.deleted ? { fontStyle: 'italic', color: c.textSecondary } : undefined}>
              {cm.deleted ? 'Comment deleted' : cm.body}
            </AppText>
          </View>
        </Pressable>
      ))}
      <Divider />
      {replyTo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="caption" muted style={{ flex: 1 }}>
            Replying to {replyTo.author_name}
          </AppText>
          <Button title="Cancel" variant="ghost" onPress={() => setReplyTo(null)} />
        </View>
      ) : null}
      <TextField label="Add a comment" value={text} onChangeText={setText} multiline maxLength={2000} />
      {actionError ? <Banner message={actionError} /> : null}
      <Button title="Comment" icon="send" loading={sending} disabled={!text.trim()} onPress={send} />
    </Screen>
  );
}
