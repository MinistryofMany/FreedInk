CREATE OR REPLACE FUNCTION blog_post_versions_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A')
                 || setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS blog_post_versions_tsv_trg ON blog_post_versions;
--> statement-breakpoint
CREATE TRIGGER blog_post_versions_tsv_trg
BEFORE INSERT OR UPDATE OF title, content ON blog_post_versions
FOR EACH ROW EXECUTE FUNCTION blog_post_versions_tsv_update();
--> statement-breakpoint
UPDATE blog_post_versions
   SET search_tsv = setweight(to_tsvector('english', coalesce(title, '')), 'A')
                 || setweight(to_tsvector('english', coalesce(content, '')), 'B')
 WHERE search_tsv IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS blog_post_versions_search_idx ON blog_post_versions USING GIN(search_tsv);
