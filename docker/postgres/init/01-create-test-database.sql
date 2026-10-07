-- Runs once, on first initialization of the Postgres volume.
-- Integration tests run against this separate database.
CREATE DATABASE nile_test;