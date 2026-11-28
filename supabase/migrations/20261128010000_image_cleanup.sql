-- Days after which stored images of finished posts are deleted to save space (0 = keep them).
-- Set per server with /setup options image_days. Separate from retention_days: nothing else is erased.
ALTER TABLE guilds ADD COLUMN image_days integer NOT NULL DEFAULT 0;
