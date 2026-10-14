-- Stage D: reporting, the moderation queue, removals, suspensions, roles and audit.
begin;
set search_path to public, extensions;
select plan(33);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values
  ('anu', tests.create_user('anu@example.com')),
  ('biju', tests.create_user('biju@example.com')),
  ('chinnu', tests.create_user('chinnu@example.com')),
  ('mod', tests.create_user('mod@example.com')),
  ('admin', tests.create_user('admin@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;
select tests.onboard(pg_temp.uid(name), name) from u;
insert into public.user_roles (user_id, role) values (pg_temp.uid('mod'), 'moderator'), (pg_temp.uid('admin'), 'admin');
select tests.connect(pg_temp.uid('anu'), pg_temp.uid('biju'));
create temp table ids (name text primary key, id text);
grant select, insert on ids to authenticated;

-- Content to report
select tests.login_as(pg_temp.uid('anu'));
insert into ids values ('post', public.create_post('Buy cheap visas, DM me', 'public')::text);
insert into ids values ('private', public.create_post('For connections only', 'connections')::text);
insert into ids values ('conv', public.start_direct_conversation(pg_temp.uid('biju'))::text);
insert into ids values ('m1', public.send_message((select id::uuid from ids where name = 'conv'), 'earlier message')::text);
insert into ids values ('m2', public.send_message((select id::uuid from ids where name = 'conv'), 'abusive message')::text);
select tests.logout();

-- Reporting
select tests.login_as(pg_temp.uid('biju'));
insert into ids values ('r1', public.report_content('post', (select id from ids where name = 'post'), 'scam', 'Selling visas')::text);
select is(public.report_content('post', (select id from ids where name = 'post'), 'scam')::text, (select id from ids where name = 'r1'),
          'reporting twice returns the same open report');
insert into ids values ('rm', public.report_content('message', (select id from ids where name = 'm2'), 'harassment')::text);
select tests.logout();
select is((select snapshot ->> 'body' from public.reports where id = (select id::bigint from ids where name = 'rm')), 'abusive message',
          'the reported message is captured');
select ok((select snapshot::text not like '%earlier message%' from public.reports where id = (select id::bigint from ids where name = 'rm')),
          'the rest of the conversation is not captured');

select tests.login_as(pg_temp.uid('chinnu'));
select throws_ok($$select public.report_content('post', (select id from ids where name = 'private'), 'spam')$$,
                 'PT404', 'REPORT_TARGET_NOT_FOUND', 'cannot report what you cannot see');
select throws_ok($$select public.report_content('message', (select id from ids where name = 'm2'), 'spam')$$,
                 'PT404', 'REPORT_TARGET_NOT_FOUND', 'cannot report messages from chats you are not in');
select throws_ok($$select public.report_content('post', 'not-a-uuid', 'spam')$$, 'PT404', 'REPORT_TARGET_NOT_FOUND',
                 'malformed ids are rejected cleanly');
select throws_ok($$select public.report_content('post', (select id from ids where name = 'post'), 'because')$$, '22023', 'REPORT_INVALID',
                 'reason must be from the list');
insert into ids values ('r2', public.report_content('post', (select id from ids where name = 'post'), 'spam')::text);
insert into ids values ('rp', public.report_content('profile', pg_temp.uid('anu')::text, 'impersonation')::text);
select throws_ok($$select * from public.reports$$, '42501', null, 'members cannot read the reports table');
select throws_ok($$select * from public.mod_list_reports()$$, 'PT403', 'NOT_ALLOWED', 'members cannot open the moderation queue');
select is((select count(*)::int from public.my_reports()), 2, 'reporters can follow their own reports');
select tests.logout();

select tests.login_as(pg_temp.uid('anu'));
select throws_ok($$select public.report_content('post', (select id from ids where name = 'post'), 'spam')$$, '22023', 'REPORT_INVALID',
                 'cannot report your own content');
select public.delete_post((select id::uuid from ids where name = 'private'));
select tests.logout();

-- Moderation
select tests.login_as(pg_temp.uid('mod'));
select is(public.mod_open_report_count(), 4, 'moderator sees the open count');
select is((select reports_on_target from public.mod_list_reports() where id = (select id::bigint from ids where name = 'r1')), 2,
          'queue shows how often the item was reported');
select is((select count(*)::int from public.mod_list_reports() where reason = 'harassment'), 1, 'message report is in the queue');
select throws_ok($$select public.mod_remove_content('post', (select id from ids where name = 'post'), '')$$, '22023', 'REASON_REQUIRED',
                 'removals need a reason');
select lives_ok($$select public.mod_remove_content('post', (select id from ids where name = 'post'), 'Scams are not allowed', (select id::bigint from ids where name = 'r1'))$$,
                'moderator removes the post');
select is((select count(*)::int from public.mod_list_reports('actioned')), 2, 'both reports on the post are closed');
select is((select snapshot ->> 'body' from public.mod_list_reports('actioned') limit 1), 'Buy cheap visas, DM me',
          'evidence survives removal');
select lives_ok($$select public.mod_resolve_report((select id::bigint from ids where name = 'rp'), 'dismissed', 'Not impersonation')$$,
                'moderator dismisses a report');
select throws_ok($$select public.mod_suspend_user(pg_temp.uid('anu'), null, 'Repeated scams')$$, 'PT403', 'NOT_ALLOWED',
                 'moderators cannot suspend indefinitely');
select throws_ok($$select public.mod_suspend_user(pg_temp.uid('admin'), 7, 'Testing')$$, 'PT403', 'NOT_ALLOWED',
                 'moderators cannot suspend staff');
select lives_ok($$select public.mod_suspend_user(pg_temp.uid('anu'), 7, 'Repeated scams', (select id::bigint from ids where name = 'rm'))$$,
                'moderator suspends for 7 days');
select throws_ok($$select * from public.admin_audit_log()$$, 'PT403', 'NOT_ALLOWED', 'moderators cannot read the audit log');
select tests.logout();

select is((select count(*)::int from public.notifications where user_id = pg_temp.uid('anu') and kind = 'security'), 1,
          'author is told their post was removed and why');
select is((select account_status::text from public.profiles where id = pg_temp.uid('anu')), 'suspended', 'account is suspended');

select tests.login_as(pg_temp.uid('anu'));
select throws_ok($$select public.create_post('I am back', 'public')$$, 'PT403', 'NOT_ALLOWED', 'suspended members cannot post');
select is((public.my_restriction() ->> 'reason'), 'Repeated scams', 'suspended member can see why');
select tests.logout();

select tests.login_as(pg_temp.uid('biju'));
select is(public.get_profile(pg_temp.uid('anu')), null, 'suspended profiles are hidden');
select tests.logout();

-- Timed suspensions end on their own
update public.user_restrictions set suspended_until = now() - interval '1 minute' where user_id = pg_temp.uid('anu');
select is(public.lift_expired_suspensions(), 1, 'expired suspension is lifted');
select is((select account_status::text from public.profiles where id = pg_temp.uid('anu')), 'active', 'account is active again');

-- Moderators can open media of reported messages only
insert into storage.objects (bucket_id, name, owner) values
  ('chat-media', (select id from ids where name = 'conv') || '/reported.jpg', pg_temp.uid('anu')),
  ('chat-media', (select id from ids where name = 'conv') || '/private.jpg', pg_temp.uid('anu'));
update public.reports set snapshot = snapshot || jsonb_build_object('attachment_path', (select id from ids where name = 'conv') || '/reported.jpg')
 where id = (select id::bigint from ids where name = 'rm');
select tests.login_as(pg_temp.uid('mod'));
select set_eq($$select name from storage.objects where bucket_id = 'chat-media'$$,
              array[(select id from ids where name = 'conv') || '/reported.jpg'],
              'moderators see the reported photo and no other chat media');
select tests.logout();

-- Admin
select tests.login_as(pg_temp.uid('admin'));
select lives_ok($$select public.admin_set_role(pg_temp.uid('chinnu'), 'moderator', true)$$, 'admin grants a role');
select ok((select count(*) > 0 from public.admin_audit_log() where action = 'content_removed'), 'removals are in the audit log');
select tests.logout();

select * from finish();
rollback;
