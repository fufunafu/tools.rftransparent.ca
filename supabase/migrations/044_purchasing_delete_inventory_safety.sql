-- The original receive trigger fires on INSERT and UPDATE of qty_received
-- but not on DELETE. That means if a user removes a line item that had
-- already been received, the previously-bumped inventory is orphaned —
-- on-hand stays inflated by the deleted qty_received.
--
-- Now that we allow editing PO lines even after the PO is Received or
-- Cancelled, this matters. Add a BEFORE DELETE trigger that subtracts
-- the line's qty_received from product inventory so deletes are
-- inventory-safe.

create or replace function purchasing_undo_receive_on_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(old.qty_received, 0) > 0 and old.product_id is not null then
    update purchasing_products
       set current_inventory = current_inventory - old.qty_received,
           updated_at = now()
     where id = old.product_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_purchasing_undo_receive_on_delete
  on purchasing_order_items;
create trigger trg_purchasing_undo_receive_on_delete
before delete on purchasing_order_items
for each row execute function purchasing_undo_receive_on_delete();
