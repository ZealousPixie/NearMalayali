// A member's posts that the viewer is allowed to see.
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { AppText, Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { listPosts, nextCursor, type Post } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

export function UserPosts({ userId, me }: { userId: string; me: string }) {
  const load = useCallback(() => listPosts('user', userId), [userId]);
  const { data, error, reload, setData } = useAsync<Post[]>(load);
  const [more, setMore] = useState<Post[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (error && !data) return <AppText muted>{friendlyError(error)}</AppText>;
  if (!data) return null;
  const posts = [...data, ...more];

  async function loadMore() {
    setLoading(true);
    try {
      const page = await listPosts('user', userId, nextCursor(posts));
      setMore((m) => [...m, ...page]);
      if (page.length < 20) setDone(true);
    } finally {
      setLoading(false);
    }
  }

  const update = (p: Post) => {
    setData(data.map((x) => (x.id === p.id ? p : x)));
    setMore((m) => m.map((x) => (x.id === p.id ? p : x)));
  };
  const remove = (id: string) => {
    setData(data.filter((x) => x.id !== id));
    setMore((m) => m.filter((x) => x.id !== id));
  };

  return (
    <View style={{ gap: Spacing.md }}>
      <AppText variant="subtitle">Posts</AppText>
      {posts.length === 0 ? <AppText muted>No posts you can see yet.</AppText> : null}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} me={me} onChanged={update} onDeleted={remove} />
      ))}
      {posts.length >= 20 && !done ? <Button title="Load more" variant="secondary" loading={loading} onPress={loadMore} /> : null}
      {error ? <Button title="Retry" variant="ghost" onPress={reload} /> : null}
    </View>
  );
}
