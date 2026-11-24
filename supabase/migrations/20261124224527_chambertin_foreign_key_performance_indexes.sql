-- Index de couverture des clés étrangères confirmées par les diagnostics Supabase.
-- Aucun changement de données ni de contrainte.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';
CREATE INDEX IF NOT EXISTS accounting_reader_draft_items_product_id_idx ON public.accounting_reader_draft_items (product_id);
CREATE INDEX IF NOT EXISTS invoice_ocr_verified_product_lines_product_id_idx ON public.invoice_ocr_verified_product_lines (product_id);
CREATE INDEX IF NOT EXISTS kitchen_cold_readings_connected_device_id_idx ON public.kitchen_cold_readings (connected_device_id);
CREATE INDEX IF NOT EXISTS kitchen_cold_readings_taken_by_idx ON public.kitchen_cold_readings (taken_by);
CREATE INDEX IF NOT EXISTS kitchen_defaults_default_cold_room_id_idx ON public.kitchen_defaults (default_cold_room_id);
CREATE INDEX IF NOT EXISTS kitchen_defaults_default_dish_type_id_idx ON public.kitchen_defaults (default_dish_type_id);
CREATE INDEX IF NOT EXISTS kitchen_defaults_default_oven_id_idx ON public.kitchen_defaults (default_oven_id);
CREATE INDEX IF NOT EXISTS kitchen_login_attempts_staff_id_idx ON public.kitchen_login_attempts (staff_id);
CREATE INDEX IF NOT EXISTS kitchen_reheat_status_reviews_reheat_id_idx ON public.kitchen_reheat_status_reviews (reheat_id);
CREATE INDEX IF NOT EXISTS kitchen_reheats_ended_by_idx ON public.kitchen_reheats (ended_by);
CREATE INDEX IF NOT EXISTS kitchen_reheats_started_by_idx ON public.kitchen_reheats (started_by);
CREATE INDEX IF NOT EXISTS kitchen_sensor_room_changes_new_room_id_idx ON public.kitchen_sensor_room_changes (new_room_id);
CREATE INDEX IF NOT EXISTS kitchen_sensor_room_changes_old_room_id_idx ON public.kitchen_sensor_room_changes (old_room_id);
CREATE INDEX IF NOT EXISTS kitchen_task_checks_performed_by_idx ON public.kitchen_task_checks (performed_by);
CREATE INDEX IF NOT EXISTS kitchen_tasks_assigned_to_idx ON public.kitchen_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS rental_bank_lines_matched_lease_id_idx ON public.rental_bank_lines (matched_lease_id);
CREATE INDEX IF NOT EXISTS rental_documents_lease_id_idx ON public.rental_documents (lease_id);
CREATE INDEX IF NOT EXISTS rental_leases_tenant_row_id_property_id_idx ON public.rental_leases (tenant_row_id,property_id);
CREATE INDEX IF NOT EXISTS rental_mail_outbox_in_reply_to_message_id_idx ON public.rental_mail_outbox (in_reply_to_message_id);
CREATE INDEX IF NOT EXISTS rental_payments_property_id_idx ON public.rental_payments (property_id);
CREATE INDEX IF NOT EXISTS rental_work_orders_lease_id_idx ON public.rental_work_orders (lease_id);