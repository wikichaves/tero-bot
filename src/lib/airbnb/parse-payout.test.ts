import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePayout } from './parse-payout';
import { parseAirbnbEmail } from './parse-email';
import { payoutFromEmail } from './process-payout';
const es = `Hoy te enviamos $438.272,33 ARS
Tu dinero se envió el 23 de julio y debería llegar antes del 30 de julio de 2026.
Identificador de la cuenta de Airbnb
1234
Detalles
Guest Example
-$72,94 USD
Cobro como coanfitrión • 22/5/2026 - 31/7/2026
Listing (123)
HMABC12345
Guest Example
$368,55 USD
Alojamiento • 22/5/2026 - 31/7/2026
Listing (123)
HMABC12345
Total pagado:
$438.272,33 ARS`;
const en = `Your money was sent on December 24 and should arrive by December 31, 2025.
Payout ID
examplePayout1
Details
Guest Example
$8,593.53 USD
Home • 12/23/2025 - 01/01/2026
Listing (123)
HMABC12345
Total paid:
$U335,866.43 UYU`;
test('signed net earnings and deposit are distinct', () => {
 const p=parsePayout(es); assert.equal(Math.round(p.items.reduce((n,x)=>n+x.amount,0)*100),29561);
 assert.equal(p.deposit_currency,'ARS'); assert.equal(p.items[0].currency,'USD');
});
test('forwarded headers do not change payout identity',()=>assert.deepEqual(parsePayout('Forward from someone\n'+es),parsePayout(es)));
test('different installments retain distinct identities',()=>assert.notEqual(parsePayout(es).key,parsePayout(es.replace('23 de julio','24 de julio')).key));
test('English dates span year and preserve payout ID',()=>{
 const p=parsePayout(en); assert.equal(p.items[0].check_out,'2026-01-01'); assert.equal(p.paid_on,'2025-12-24'); assert.equal(p.key,'airbnb:examplePayout1');
});
test('Spanish messages may use US dates when only that order is valid',()=>{
 const p=parsePayout(es.replaceAll('22/5/2026 - 31/7/2026','03/11/2026 - 04/09/2026'));
 assert.equal(p.items[0].check_in,'2026-03-11'); assert.equal(p.items[0].check_out,'2026-04-09');
});
test('ambiguous Spanish stay dates fail closed',()=>assert.throws(()=>parsePayout(es.replaceAll('22/5/2026 - 31/7/2026','03/04/2026 - 05/06/2026')),/Ambiguous/));
test('malformed extra item fails rather than silently omitting it',()=>assert.throws(()=>parsePayout(es.replace('Total pagado:', 'Unknown\nHMOTHER123\nTotal pagado:')),/Unparsed/));
test('payout cannot be mistaken for confirmation',()=>assert.equal(parseAirbnbEmail({subject:'Te enviamos un cobro',text:es}).kind,'unknown'));
test('text and HTML are not counted twice',()=>assert.equal(payoutFromEmail({Subject:'Te enviamos un cobro',TextBody:es,HtmlBody:es} as Parameters<typeof payoutFromEmail>[0])?.items.length,2));
test('December payout arriving in January is assigned previous year',()=>assert.equal(parsePayout(en.replace('December 31, 2025','January 3, 2026')).paid_on,'2025-12-24'));
