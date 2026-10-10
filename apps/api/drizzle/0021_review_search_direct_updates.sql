-- submissions: keep the search index readable immediately after writes.
ALTER INDEX "submissions_queue_search_idx" SET (fastupdate = off);--> statement-breakpoint
SELECT gin_clean_pending_list('public.submissions_queue_search_idx'::regclass);
