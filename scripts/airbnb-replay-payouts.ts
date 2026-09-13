/** Dry-run by default. --apply records notices atomically; safe to repeat. */
import { createClient } from '@supabase/supabase-js';
import { payoutFromEmail, recordPayout } from '../src/lib/airbnb/process-payout';
async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let found = 0, failed = 0;
  for (let offset = 0; ; offset += 500) {
    const {data, error} = await admin.from('airbnb_inbound_emails').select('id,raw').order('id').range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) {
      try {
        const payout = payoutFromEmail(row.raw);
        if (!payout) continue;
        found++;
        const result = process.argv.includes('--apply') ? await recordPayout(admin, payout, row.id) : {dry_run: true};
        console.log(JSON.stringify({id:row.id, date:payout.paid_on, deposit:payout.deposit_amount, currency:payout.deposit_currency, items:payout.items.map(item => ({code:item.reservation_code, amount:item.amount, currency:item.currency, check_in:item.check_in, check_out:item.check_out})), result}));
      } catch(error) { failed++; console.error(JSON.stringify({id:row.id, error:(error as Error).message})); }
    }
    if (!data || data.length < 500) break;
  }
  console.log(JSON.stringify({found,failed}));
  if(failed) process.exitCode = 1;
}
main().catch(e => {console.error(e.message); process.exitCode=1;});
