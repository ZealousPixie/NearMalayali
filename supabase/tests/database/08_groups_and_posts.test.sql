-- Stage C: groups, posts, comments, reactions, feed and post media access.
begin;
set search_path to public, extensions;
select plan(34);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com')),
  ('chinnu', tests.create_user('chinnu@example.com')),
  ('deepa', tests.create_user('deepa@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid(name), name) from u;
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('biju'));
create temp table g (name text primary key, id uuid);
grant select, insert on g to authenticated;
create temp table p (name text primary key, id uuid);
grant select, insert on p to authenticated;

-- Groups -------------------------------------------------------------------
select tests.login_as(pg_temp.uid('anu'));
insert into g values ('open', public.create_group('Perth Malayalis', 'Everyone welcome', 'public', 'Perth'));
insert into g values ('club', public.create_group('Kathakali club', 'Ask to join', 'approval'));
insert into g values ('secret', public.create_group('Onam committee', 'Planning', 'private'));
select is((public.group_details((select id from g where name = 'open')) ->> 'my_role'), 'owner', 'creator owns the group');
select ok((public.group_details((select id from g where name = 'open')) ->> 'conversation_id') is not null, 'group has a linked chat');
select throws_ok($$select public.create_group('ab', '', 'public')$$, '22023', 'GROUP_NAME_INVALID', 'group names need 3+ characters');
select tests.logout();

select tests.login_as(pg_temp.uid('chinnu'));
select set_eq($$select name from public.list_groups('discover')$$, array['Perth Malayalis', 'Kathakali club'],
              'private groups are hidden from non-members');
select is(public.group_details((select id from g where name = 'secret')), null, 'private group details are hidden');
select throws_ok($$select public.join_group((select id from g where name = 'secret'))$$, 'PT404', 'GROUP_NOT_FOUND',
                 'cannot join a private group uninvited');
select is(public.join_group((select id from g where name = 'open')), 'JOINED', 'public groups are joined instantly');
select ok(public.is_conversation_member((select conversation_id from public.groups where id = (select id from g where name = 'open')), pg_temp.uid('chinnu')),
          'joining adds you to the group chat');
select is(public.join_group((select id from g where name = 'club')), 'REQUESTED', 'approval groups take requests');
select is((select count(*)::int from public.list_group_members((select id from g where name = 'club'))), 0,
          'a pending requester cannot see the member list');
select tests.logout();

select tests.login_as(pg_temp.uid('anu'));
select is((select count(*)::int from public.list_group_members((select id from g where name = 'club'), 'requested')), 1,
          'admin sees the join request');
select lives_ok($$select public.respond_join_request((select id from g where name = 'club'), pg_temp.uid('chinnu'), true)$$,
                'admin accepts');
select lives_ok($$select public.invite_to_group((select id from g where name = 'secret'), pg_temp.uid('biju'))$$,
                'admin invites a connection to the private group');
select throws_ok($$select public.invite_to_group((select id from g where name = 'secret'), pg_temp.uid('deepa'))$$,
                 'PT404', 'USER_UNAVAILABLE', 'only connections can be invited');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is((public.group_details((select id from g where name = 'secret')) ->> 'my_status'), 'invited', 'invitee can see the private group');
select is(public.join_group((select id from g where name = 'secret')), 'JOINED', 'invitee joins');
select tests.logout();

select tests.login_as(pg_temp.uid('chinnu'));
select throws_ok($$select public.remove_group_member((select id from g where name = 'open'), pg_temp.uid('anu'))$$,
                 'PT403', 'NOT_ALLOWED', 'members cannot remove others');
select tests.logout();

-- Posts --------------------------------------------------------------------
select tests.login_as(pg_temp.uid('anu'));
insert into p values ('pub', public.create_post('Onam sadya at the hall this Sunday!', 'public'));
insert into p values ('conn', public.create_post('Only for my connections', 'connections'));
insert into p values ('grp', public.create_post('Committee notes', 'group', (select id from g where name = 'secret')));
select throws_ok($$select public.create_post('   ')$$, '22023', 'POST_EMPTY', 'empty posts are rejected');
select throws_ok($$select public.create_post('x', 'group')$$, '22023', 'VISIBILITY_INVALID', 'group posts need a group');
select throws_ok($$insert into public.posts (author_id, visibility, body) values (pg_temp.uid('anu'), 'public', 'x')$$,
                 '42501', null, 'posts cannot be inserted directly');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select set_eq($$select (x ->> 'id')::uuid from public.home_feed() x$$,
              array[(select id from p where name = 'pub'), (select id from p where name = 'conn'), (select id from p where name = 'grp')],
              'a connection in the group sees all three posts in their feed');
select lives_ok($$select public.react_to_post((select id from p where name = 'pub'), '❤️')$$, 'biju reacts');
select lives_ok($$select public.comment_on_post((select id from p where name = 'pub'), 'Count me in')$$, 'biju comments');
select tests.logout();

select tests.login_as(pg_temp.uid('deepa'));
select is((select count(*)::int from public.home_feed()), 0, 'strangers do not get the posts in their feed');
select is((select count(*)::int from public.list_posts('user', pg_temp.uid('anu'))), 1, 'strangers see only public posts on a profile');
select is((select count(*)::int from public.posts), 1, 'RLS hides connection and private-group posts from strangers');
select throws_ok($$select public.comment_on_post((select id from p where name = 'conn'), 'hi')$$, 'PT404', 'POST_NOT_FOUND',
                 'cannot comment on a post you cannot see');
select lives_ok($$select public.follow_user(pg_temp.uid('anu'))$$, 'deepa follows anu');
select is((select count(*)::int from public.home_feed()), 1, 'followers get public posts only');
select tests.logout();

select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('anu') and kind in ('reaction', 'comment')), 2,
          'author is notified of the reaction and comment');

-- Blocking hides posts both ways
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('anu'), pg_temp.uid('deepa'));
select tests.login_as(pg_temp.uid('deepa'));
select is((select count(*)::int from public.list_posts('user', pg_temp.uid('anu'))), 0, 'blocked members cannot see posts');
select tests.logout();

-- Post media
insert into storage.objects (bucket_id, name, owner) values ('post-media', pg_temp.uid('anu')::text || '/a.jpg', pg_temp.uid('anu'));
select tests.login_as(pg_temp.uid('anu'));
insert into p values ('photo', public.create_post('Photo for connections', 'connections', null,
  jsonb_build_array(jsonb_build_object('path', pg_temp.uid('anu')::text || '/a.jpg', 'width', 800, 'height', 600))));
select throws_ok($$select public.create_post('stolen', 'public', null, jsonb_build_array(jsonb_build_object('path', pg_temp.uid('biju')::text || '/x.jpg')))$$,
                 '22023', 'MEDIA_INVALID', 'cannot attach files from someone else''s folder');
select tests.logout();
select tests.login_as(pg_temp.uid('biju'));
select is((select count(*)::int from storage.objects where bucket_id = 'post-media'), 1, 'connections can read the photo');
select tests.logout();
select tests.login_as(pg_temp.uid('chinnu'));
select is((select count(*)::int from storage.objects where bucket_id = 'post-media'), 0, 'others cannot read the photo');
select tests.logout();

select * from finish();
rollback;
