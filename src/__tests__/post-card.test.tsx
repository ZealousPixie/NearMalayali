import { fireEvent, render, screen } from '@testing-library/react-native';

import { PostCard } from '@/components/post-card';
import { reactToPost, setBookmark, type Post } from '@/lib/community';

jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } } }));
jest.mock('@/lib/community', () => ({
  ...jest.requireActual('@/lib/community'),
  reactToPost: jest.fn(() => Promise.resolve()),
  setBookmark: jest.fn(() => Promise.resolve()),
  postMediaUrl: jest.fn(() => Promise.resolve('https://example.test/p.jpg')),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const post: Post = {
  id: 'p1',
  author_id: 'u2',
  author_username: 'biju',
  author_name: 'Biju',
  author_avatar: null,
  author_verified: false,
  visibility: 'public',
  group_id: null,
  group_name: null,
  body: 'Onam sadya on Sunday',
  created_at: new Date().toISOString(),
  edited_at: null,
  media: [],
  reaction_count: 0,
  comment_count: 2,
  my_reaction: null,
  bookmarked: false,
  shared: null,
};

describe('PostCard', () => {
  it('shows the post and saves it through the server', async () => {
    const onChanged = jest.fn();
    await render(<PostCard post={post} me="u1" onChanged={onChanged} onDeleted={jest.fn()} />);
    expect(screen.getByText('Onam sadya on Sunday')).toBeTruthy();
    expect(screen.getByLabelText('2 comments')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Save post'));
    expect(setBookmark).toHaveBeenCalledWith('u1', 'p1', true);
    expect(onChanged).toHaveBeenCalledWith({ ...post, bookmarked: true });
  });

  it('does not update the post when saving fails', async () => {
    (setBookmark as jest.Mock).mockRejectedValueOnce(new Error('RATE_LIMITED'));
    const onChanged = jest.fn();
    await render(<PostCard post={post} me="u1" onChanged={onChanged} onDeleted={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Save post'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(await screen.findByText(/doing that too often/)).toBeTruthy();
    expect(reactToPost).not.toHaveBeenCalled();
  });
});
