// A post in a feed or list, with working reactions, comments, bookmark,
// share and author actions. Photos are loaded through short-lived links.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText, Avatar, Card } from '@/components/ui';
import { Radius, Spacing, useTheme } from '@/constants/theme';
import { REACTIONS } from '@/lib/chat';
import { deletePost, type Post, type PostMedia, postMediaUrl, reactToPost, setBookmark } from '@/lib/community';
import { friendlyError } from '@/lib/errors';
import { timeAgo } from '@/lib/format';

const VISIBILITY_LABEL = { public: 'Everyone', connections: 'Connections', group: 'Group' } as const;

export function PostCard({
  post,
  me,
  onChanged,
  onDeleted,
  showComments = true,
  canModerate = false,
}: {
  post: Post;
  me: string;
  onChanged: (p: Post) => void;
  onDeleted: (id: string) => void;
  showComments?: boolean;
  /** Group owners, admins and moderators can remove posts in their group. */
  canModerate?: boolean;
}) {
  const c = useTheme();
  const [error, setError] = useState<string | null>(null);
  const mine = post.author_id === me;

  async function react(emoji: string | null) {
    setError(null);
    try {
      await reactToPost(post.id, emoji);
      const delta = (emoji ? 1 : 0) - (post.my_reaction ? 1 : 0);
      onChanged({ ...post, my_reaction: emoji, reaction_count: post.reaction_count + delta });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function chooseReaction() {
    Alert.alert('React', undefined, [
      ...REACTIONS.map((e) => ({ text: e, onPress: () => react(e) })),
      ...(post.my_reaction ? [{ text: 'Remove my reaction', onPress: () => react(null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function toggleBookmark() {
    setError(null);
    try {
      await setBookmark(me, post.id, !post.bookmarked);
      onChanged({ ...post, bookmarked: !post.bookmarked });
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function openMenu() {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (mine) {
      options.push({ text: 'Edit', onPress: () => router.push({ pathname: '/compose-post', params: { edit: post.id } }) });
      options.push({
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete this post?', 'It is removed for everyone, with its photos.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deletePost(post.id);
                  onDeleted(post.id);
                } catch (e) {
                  setError(friendlyError(e));
                }
              },
            },
          ]),
      });
    } else {
      options.push({ text: 'View profile', onPress: () => router.push({ pathname: '/profile/[id]', params: { id: post.author_id } }) });
      options.push({
        text: 'Report post',
        onPress: () =>
          router.push({ pathname: '/report', params: { type: 'post', id: post.id, name: post.author_name, user: post.author_id } }),
      });
      if (post.group_id && canModerate) {
        options.push({
          text: 'Remove from group',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePost(post.id);
              onDeleted(post.id);
            } catch (e) {
              setError(friendlyError(e));
            }
          },
        });
      }
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Post', undefined, options);
  }

  return (
    <Card style={{ gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${post.author_name}'s profile`}
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: post.author_id } })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 }}>
          <Avatar path={post.author_avatar} name={post.author_name} size={40} />
          <View style={{ flex: 1 }}>
            <AppText style={{ fontWeight: '600' }} numberOfLines={1}>
              {post.author_name}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {timeAgo(post.created_at)}
              {post.edited_at ? ' · edited' : ''} · {post.group_name ?? VISIBILITY_LABEL[post.visibility]}
            </AppText>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post options"
          onPress={openMenu}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-horizontal" size={20} color={c.textSecondary} />
        </Pressable>
      </View>

      {post.body ? <AppText selectable>{post.body}</AppText> : null}
      <PostPhotos media={post.media} />

      {post.shared ? (
        'unavailable' in post.shared ? (
          <AppText variant="caption" muted>
            The shared post is no longer available.
          </AppText>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: (post.shared as { id: string }).id } })}
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: Radius.sm, padding: Spacing.sm, gap: Spacing.xs }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              {post.shared.author_name} · {timeAgo(post.shared.created_at)}
            </AppText>
            {post.shared.body ? <AppText numberOfLines={6}>{post.shared.body}</AppText> : null}
            <PostPhotos media={post.shared.media} />
          </Pressable>
        )
      ) : null}

      {error ? (
        <AppText variant="caption" style={{ color: c.danger }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action
          icon={post.my_reaction ? undefined : 'heart-outline'}
          label={`${post.my_reaction ?? ''}${post.reaction_count ? ` ${post.reaction_count}` : post.my_reaction ? '' : ' React'}`}
          a11y={post.my_reaction ? `You reacted ${post.my_reaction}. Change reaction` : 'React'}
          onPress={chooseReaction}
        />
        {showComments ? (
          <Action
            icon="chatbubble-outline"
            label={post.comment_count ? String(post.comment_count) : 'Comment'}
            a11y={`${post.comment_count} comments`}
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: post.id } })}
          />
        ) : null}
        {post.visibility === 'public' && !post.shared ? (
          <Action icon="repeat-outline" label="Share" a11y="Share to your feed" onPress={() => router.push({ pathname: '/compose-post', params: { share: post.id } })} />
        ) : null}
        <Action
          icon={post.bookmarked ? 'bookmark' : 'bookmark-outline'}
          label={post.bookmarked ? 'Saved' : 'Save'}
          a11y={post.bookmarked ? 'Remove from saved' : 'Save post'}
          onPress={toggleBookmark}
        />
      </View>
    </Card>
  );
}

function Action({ icon, label, a11y, onPress }: { icon?: 'heart-outline' | 'chatbubble-outline' | 'repeat-outline' | 'bookmark' | 'bookmark-outline'; label: string; a11y: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: Spacing.xs }}>
      {icon ? <Ionicons name={icon} size={20} color={c.textSecondary} /> : null}
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </Pressable>
  );
}

export function PostPhotos({ media }: { media: PostMedia[] }) {
  if (!media.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
      {media.map((m) => (
        <PrivatePhoto key={m.path} media={m} single={media.length === 1} />
      ))}
    </View>
  );
}

function PrivatePhoto({ media, single }: { media: PostMedia; single: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    postMediaUrl(media.path).then(
      (u) => active && setUrl(u),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [media.path]);
  const ratio = single && media.width && media.height ? media.width / media.height : 1;
  if (failed) {
    return (
      <AppText variant="caption" muted>
        Photo couldn't be loaded.
      </AppText>
    );
  }
  return (
    <Image
      source={url ? { uri: url } : undefined}
      accessibilityLabel="Photo"
      contentFit="cover"
      style={{
        width: single ? '100%' : '49%',
        aspectRatio: single ? Math.max(0.6, Math.min(ratio, 2)) : 1,
        borderRadius: Radius.sm,
        backgroundColor: '#0001',
      }}
    />
  );
}
