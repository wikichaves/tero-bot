import test from "node:test";
import assert from "node:assert/strict";
import { parseAvailabilityQuery, isAvailabilityQuery, freeRanges } from "../src/lib/availability/query";
test("general and scoped requests",()=>{
 assert.equal(isAvailabilityQuery('/disponibilidad@tero_ops_bot'),true);
 assert.equal(parseAvailabilityQuery('/disponibilidad').filter,'');
 assert.equal(parseAvailabilityQuery('/disponibilidad Casa Merced').filter,'casa merced');
 assert.equal(parseAvailabilityQuery('/disponibilidad Casa Bosque 4').filter,'casa bosque 4');
 assert.equal(parseAvailabilityQuery('/disponibilidad 14 de Julio').error,false);
});
test("capacity request and date interval",()=>{
 assert.equal(isAvailabilityQuery('busco casa para 6 personas'),true);
 const q=parseAvailabilityQuery('busco casa para 6 personas del 01/01/2027 al 08/01/2027');
 assert.deepEqual(q,{guests:6,start:'2027-01-01',end:'2027-01-08',filter:'',error:false});
});
test("reject invalid, partial and ambiguous dates",()=>{
 for(const s of ['/disponibilidad 31/02/2027 05/03/2027','/disponibilidad 01/01/2027','/disponibilidad 08/01/2027 01/01/2027','/disponibilidad del 1/1 al 8/1','/disponibilidad enero','busco casa para 0 personas']) assert.equal(parseAvailabilityQuery(s).error,true,s);
});
test("free night ranges preserve exclusive checkout",()=>{
 assert.deepEqual(freeRanges(['2026-12-30','2026-12-31','2027-01-01','2027-01-02'],new Set(['2027-01-01'])),[{start:'2026-12-30',end:'2027-01-01'},{start:'2027-01-02',end:'2027-01-03'}]);
});
