-- Rename the default supplier from 'Main supplier' to 'Allen'.
-- Safe to re-run.

alter table purchasing_orders
  alter column supplier_name set default 'Allen';

update purchasing_orders
   set supplier_name = 'Allen'
 where supplier_name = 'Main supplier';
