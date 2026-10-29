import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularTrajeto } from '../src/rotinaCalc.ts';

const t = (hm: string) => `2026-10-29T${hm}:00.000Z`;
const MIN = 60000;
const ev = (id: string, acao: 'embarque' | 'desembarque', etapa: string, hm: string) => ({ id, acao, etapa, data: t(hm) });
const agora = Date.parse(t('07:00'));

test('duração de cada transporte: 05:35 até 06:02 = 27 min', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '05:35'), ev('b', 'desembarque', '1', '06:02')], t('05:30'), null, agora);
  assert.equal(r.etapas[0].duracaoMs, 27 * MIN);
});
test('tempo de conexão: 06:02 até 06:08 = 6 min', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '05:35'), ev('b', 'desembarque', '1', '06:02'), ev('c', 'embarque', '2', '06:08'), ev('d', 'desembarque', '2', '06:40')], t('05:30'), null, agora);
  assert.equal(r.conexaoMs, 6 * MIN);
  assert.equal(r.transporteMs, (27 + 32) * MIN);
});
test('total da ida finalizada: 05:30 até 08:00 = 150 min', () => {
  const r = calcularTrajeto([], t('05:30'), t('08:00'), agora);
  assert.equal(r.totalMs, 150 * MIN);
  assert.equal(r.totalFinal, true);
});
test('trajeto em andamento usa o horário atual', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '06:30')], t('05:30'), null, agora);
  assert.equal(r.totalMs, 90 * MIN);
  assert.equal(r.etapas[0].emAndamento, true);
  assert.equal(r.etapas[0].duracaoMs, 30 * MIN);
});
test('corrigir o horário do embarque recalcula as durações', () => {
  const antes = calcularTrajeto([ev('a', 'embarque', '1', '05:35'), ev('b', 'desembarque', '1', '06:02')], t('05:30'), null, agora);
  const depois = calcularTrajeto([ev('a', 'embarque', '1', '05:40'), ev('b', 'desembarque', '1', '06:02')], t('05:30'), null, agora);
  assert.equal(antes.etapas[0].duracaoMs, 27 * MIN);
  assert.equal(depois.etapas[0].duracaoMs, 22 * MIN);
});
test('desembarque antes do embarque: sem duração negativa e com aviso', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '06:00'), ev('b', 'desembarque', '1', '05:50')], t('05:30'), null, agora);
  assert.equal(r.etapas[0].duracaoMs, null);
  assert.equal(r.transporteMs, 0);
  assert.equal(r.avisos.length, 1);
});
test('sem saída registrada, o total fica incompleto (não inventa horário)', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '05:35')], null, null, agora);
  assert.equal(r.totalMs, null);
});
test('chegada antes da saída: total nulo e aviso', () => {
  const r = calcularTrajeto([], t('08:00'), t('07:00'), agora);
  assert.equal(r.totalMs, null);
  assert.equal(r.avisos.length, 1);
});
test('chegou sem registrar desembarque: etapa incompleta, não conta como em andamento', () => {
  const r = calcularTrajeto([ev('a', 'embarque', '1', '05:35')], t('05:30'), t('08:00'), agora);
  assert.equal(r.etapas[0].duracaoMs, null);
  assert.equal(r.etapas[0].emAndamento, false);
  assert.equal(r.avisos.length, 1);
});
test('ida e volta são independentes (cálculo por lista de eventos)', () => {
  const ida = calcularTrajeto([ev('a', 'embarque', '1', '05:35'), ev('b', 'desembarque', '1', '06:02')], t('05:30'), t('06:10'), agora);
  const volta = calcularTrajeto([ev('c', 'embarque', '1', '18:10'), ev('d', 'desembarque', '1', '19:00')], t('18:00'), t('19:10'), agora);
  assert.equal(ida.transporteMs, 27 * MIN);
  assert.equal(volta.transporteMs, 50 * MIN);
});

import { duracaoSono } from '../src/rotinaCalc.ts';
test('sono: cruza a meia-noite e rejeita dados inválidos', () => {
  assert.equal(duracaoSono('23:00', '06:30'), 450 * MIN);
  assert.equal(duracaoSono('01:00', '08:00'), 420 * MIN);
  assert.equal(duracaoSono('22:00', '22:00'), null);
  assert.equal(duracaoSono('25:00', '06:00'), null);
  assert.equal(duracaoSono(undefined, '06:00'), null);
});
