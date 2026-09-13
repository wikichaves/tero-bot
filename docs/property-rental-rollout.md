# Property rental eligibility rollout

1. Apply only the `Property rental eligibility` section of `supabase/schema.sql` (additive boolean, default true).
2. Mark the verified Pantone property as non-rental:

```sql
update public.properties set is_rental = false
where id = '65b8dd8f-0f67-4d8d-91b6-7b89c431477f' and name = 'Pantone';
```

3. Merge/deploy after owner review (schema is CODEOWNERS-protected).
4. Verify Pantone is unchecked in Admin → Properties → Edit and excluded from the new reservation selector. Existing history/Earnings, remote controls, rooms, bills and energy are unchanged. Other existing properties default to rental; editable individually.

The flag controls new manual reservations; it does not delete or stop ingestion of historical Airbnb records.
