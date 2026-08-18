create role wager_app with login password 'wager_app';

grant connect on database wager to wager_app;
grant usage, create on schema public to wager_app;