import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../admin/marne-invest/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Script Marne Invest absent');
const start = script.indexOf('function bankNormalizeHeader(');
const end = script.indexOf('function bankImportLabel(', start);
assert.ok(start >= 0 && end > start, 'Parser CSV bancaire absent');
const parse = new Function(script.slice(start, end) + '\nreturn bankCsvRows;')();

test('CSV : une décimale non citée ne peut pas être perdue dans une colonne supplémentaire', () => {
  assert.throws(() => parse('Date,Libellé,Montant\n2026-11-20,Loyer,600,50'));
});

test('CSV : les séparateurs de milliers incohérents sont refusés', () => {
  for (const amount of ['1.2,34', '1,2.34', '12.34,56', '12,34.56', '1..234,56']) {
    assert.throws(() => parse('Date;Libellé;Montant\n2026-11-20;Loyer;' + amount), amount);
  }
});

test('CSV : les regroupements français et internationaux conservent les centimes', () => {
  for (const amount of ['1.234,56', '1,234.56', '1 234,56', '1\u202f234,56']) {
    assert.equal(parse('Date;Libellé;Montant\n2026-11-20;Loyer;' + amount)[0].amount, '1234.56', amount);
  }
});

test('CSV : un montant entre parenthèses reste un débit', () => {
  assert.equal(parse('Date;Libellé;Montant\n2026-11-20;Assurance;(1.234,56)')[0].amount, '-1234.56');
});

test('CSV : aucun caractère ne peut suivre un champ cité fermé', () => {
  assert.throws(() => parse('Date;Libellé;Montant\n2026-11-20;"Loyer"SUITE;600'));
});

test('CSV : guillemets échappés et séparateurs cités conservent le libellé', () => {
  const rows = parse('Date;Libellé;Montant\n2026-11-20;"VIREMENT; ""MARNE""";600,50');
  assert.equal(rows[0].description, 'VIREMENT; "MARNE"');
  assert.equal(rows[0].amount, '600.50');
});

test('CSV : un crédit négatif ne devient jamais un encaissement positif', () => {
  assert.throws(() => parse('Date;Libellé;Débit;Crédit\n2026-11-20;Annulation;;-600,50'));
});

test('CSV : les colonnes Montant et Débit/Crédit ne peuvent pas se contredire', () => {
  for (const cells of ['600,00;;700,00', '600,00;100,00;', '600,00;100,00;700,00']) {
    assert.throws(() => parse('Date;Libellé;Montant;Débit;Crédit\n2026-11-20;Loyer;' + cells), cells);
  }
});

test('CSV : les colonnes redondantes cohérentes ne doublent pas le montant', () => {
  const rows = parse('Date;Libellé;Montant;Débit;Crédit\n2026-11-20;Loyer;600,50;;600,50\n2026-11-21;Assurance;-40,00;40,00;');
  assert.deepEqual(rows.map(row => row.amount), ['600.50', '-40.00']);
});
