import assert from 'node:assert/strict';
import test from 'node:test';
import { manualReservationSchema, manualIdentity, reservationPeriod } from './manual';
const stay = { property_id: '11111111-1111-4111-8111-111111111111', guest_name: 'Hernán Chaves', guest_phone: '', check_in: '2026-01-19', check_out: '2026-01-31', guest_count: '', payout_amount: '3000', payout_currency: 'USD', notes: '' };
test('validates real dates and a positive stay duration', () => {
  assert.equal(manualReservationSchema.safeParse(stay).success, true);
  for (const dates of [{check_in:'2026-02-30'}, {check_out:'2026-01-19'}, {check_out:'2026-01-18'}]) assert.equal(manualReservationSchema.safeParse({...stay,...dates}).success, false);
});
test('distinguishes unknown income from zero and validates money', () => {
  assert.equal(manualReservationSchema.parse({...stay,payout_amount:''}).payout_amount, '');
  assert.equal(manualReservationSchema.parse({...stay,payout_amount:'0'}).payout_amount, 0);
  assert.equal(manualReservationSchema.parse({...stay,payout_amount:'937.03'}).payout_amount, 937.03);
  for (const amount of ['-1','1.001','Infinity','abc']) assert.equal(manualReservationSchema.safeParse({...stay,payout_amount:amount}).success, false);
});
test('normalizes repeated submissions but keeps properties and dates distinct', () => {
  assert.equal(manualIdentity(stay), manualIdentity({...stay,guest_name:'  HERNAN   CHAVES  '}));
  assert.notEqual(manualIdentity(stay), manualIdentity({...stay,property_id:'another'}));
  assert.notEqual(manualIdentity(stay), manualIdentity({...stay,check_out:'2026-02-01'}));
});
test('checkout is exclusive and checkin is current', () => {
  assert.equal(reservationPeriod(stay.check_in,stay.check_out,'2026-01-18'),'future');
  assert.equal(reservationPeriod(stay.check_in,stay.check_out,'2026-01-19'),'current');
  assert.equal(reservationPeriod(stay.check_in,stay.check_out,'2026-01-31'),'past');
});
