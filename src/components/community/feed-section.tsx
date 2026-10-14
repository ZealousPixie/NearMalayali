import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { PostCard } from '@/components/post-card';
import { Banner, Button, ChoiceChips, EmptyState, LoadingView } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { homeFeed, listPosts, nextCursor, type Post } from '@/lib/community';
import { friendlyError } from '@/lib/errors';

type Source = 'home' | 'saved';

export function FeedSection({ me }: { me: string }) {
  const [source, setSource] = useState<Source>('home');
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (cursor?: ReturnType<typeof nextCursor>) => (source === 'home' ? homeFeed(cursor) : listPosts('bookmarks', null, cursor)),
    [source],
  );

  const refresh = useCallback(async () => {
    try {
      const page = await fetchPage();
      setPosts(page);
      setHasMore(page.length === 20);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [fetchPage]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function loadMore() {
    if (!posts) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor(posts));
      setPosts([...posts, ...page.filter((p) => !posts.some((x) => x.id === p.id))]);
      setHasMore(page.length === 20);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const update = (p: Post) => setPosts((prev) => prev?.map((x) => (x.id === p.id ? p : x)) ?? null);
  const remove = (id: string) => setPosts((prev) => prev?.filter((x) => x.id !== id) ?? null);

  return (
    <View style={{ gap: Spacing.md }}>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <ChoiceChips
            options={[
              { value: 'home', label: 'Following' },
              { value: 'saved', label: 'Saved' },
            ]}
            value={source}
            onChange={(v) => {
              setPosts(null);
              setSource(v);
            }}
          />
        </View>
      </View>
      <Button title="Write a post" icon="create-outline" onPress={() => router.push('/compose-post')} />
      {error ? <Banner message={error} action={<Button title="Retry" variant="ghost" onPress={refresh} />} /> : null}
      {posts === null && !error ? <LoadingView /> : null}
      {posts?.length === 0 ? (
        source === 'home' ? (
          <EmptyState
            icon="newspaper-outline"
            title="Your feed is quiet"
            message="Posts from your connections, people you follow and your groups appear here."
          />
        ) : (
          <EmptyState icon="bookmark-outline" title="Nothing saved" message="Tap Save on a post to keep it here." />
        )
      ) : null}
      {posts?.map((p) => <PostCard key={p.id} post={p} me={me} onChanged={update} onDeleted={remove} />)}
      {hasMore ? <Button title="Load more" variant="secondary" loading={loadingMore} onPress={loadMore} /> : null}
    </View>
  );
}
