-- Stage A: profile media storage rules.
begin;
set search_path to public, extensions;
select plan(4);

create temp table u (name text primary key, id uuid);
grant select on u to authenticated;
insert into u values ('alice', tests.create_user('alice@example.com')), ('bob', tests.create_user('bob@example.com'));
create function pg_temp.uid(n text) returns uuid language sql stable as $$ select id from u where name = n $$;

select tests.login_as(pg_temp.uid('alice'));
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('profile-media', '%s/avatar.jpg', auth.uid())$$, pg_temp.uid('alice')),
                'upload into own folder allowed');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('profile-media', '%s/avatar.jpg', auth.uid())$$, pg_temp.uid('bob')),
                 '42501', null, 'upload into another member''s folder refused');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('profile-media', 'avatar.jpg', auth.uid())$$,
                 '42501', null, 'upload outside any folder refused');
select tests.logout();

insert into storage.objects (bucket_id, name, owner) values ('profile-media', pg_temp.uid('bob') || '/b.jpg', pg_temp.uid('bob'));
select tests.login_as(pg_temp.uid('alice'));
delete from storage.objects where name like pg_temp.uid('bob') || '/%';
select tests.logout();
select is((select count(*)::int from storage.objects where owner = pg_temp.uid('bob')), 1, 'cannot delete another member''s file');

select * from finish();
rollback;
