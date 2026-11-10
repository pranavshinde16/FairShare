-- Runs once, when the Postgres volume is first created.
-- A separate database for integration tests, so tests never touch development data.
CREATE DATABASE fairshare_test OWNER fairshare;
