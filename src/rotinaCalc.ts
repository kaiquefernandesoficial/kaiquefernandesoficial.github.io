// Cálculos de rotina e deslocamento: funções puras, sem interface, testáveis em tests/.
export type EventoTransporte = { id: string; data: string; acao: 'embarque' | 'desembarque'; etapa: string };
export type EtapaCalc = {
  etapa: string; embarqueId: string; desembarqueId: string | null;
  embarqueMs: number; desembarqueMs: number | null;
  duracaoMs: number | null; emAndamento: boolean;
};
export type TrajetoCalc = {
  etapas: EtapaCalc[]; transporteMs: number; conexaoMs: number;
  totalMs: number | null; totalFinal: boolean; avisos: string[];
};

const ms = (iso: string) => new Date(iso).getTime();

export function calcularTrajeto(evs: EventoTransporte[], inicioISO: string | null, fimISO: string | null, agoraMs: number): TrajetoCalc {
  const avisos: string[] = [];
  const fim = fimISO ? ms(fimISO) : null;
  const emb = evs.filter((e) => e.acao === 'embarque').sort((a, b) => ms(a.data) - ms(b.data));
  const des = evs.filter((e) => e.acao === 'desembarque').sort((a, b) => ms(a.data) - ms(b.data));
  const etapas: EtapaCalc[] = emb.map((e) => {
    const inicio = ms(e.data);
    const d = des.find((x) => x.etapa === e.etapa);
    const base = { etapa: e.etapa, embarqueId: e.id, embarqueMs: inicio };
    if (!d) {
      if (fim !== null) { avisos.push(`Etapa ${e.etapa}: sem desembarque registrado; duração incompleta.`); return { ...base, desembarqueId: null, desembarqueMs: null, duracaoMs: null, emAndamento: false }; }
      return { ...base, desembarqueId: null, desembarqueMs: null, duracaoMs: Math.max(0, agoraMs - inicio), emAndamento: true };
    }
    const fimEtapa = ms(d.data);
    if (fimEtapa < inicio) { avisos.push(`Etapa ${e.etapa}: o desembarque está antes do embarque. Corrija um dos horários.`); return { ...base, desembarqueId: d.id, desembarqueMs: fimEtapa, duracaoMs: null, emAndamento: false }; }
    return { ...base, desembarqueId: d.id, desembarqueMs: fimEtapa, duracaoMs: fimEtapa - inicio, emAndamento: false };
  });
  const transporteMs = etapas.reduce((s, e) => s + (e.duracaoMs ?? 0), 0);
  let conexaoMs = 0;
  for (let i = 1; i < etapas.length; i++) {
    const ant = etapas[i - 1].desembarqueMs;
    if (ant === null || etapas[i - 1].duracaoMs === null) continue;
    if (etapas[i].embarqueMs < ant) { avisos.push(`Etapa ${etapas[i].etapa}: embarca antes do desembarque da etapa anterior.`); continue; }
    conexaoMs += etapas[i].embarqueMs - ant;
  }
  let totalMs: number | null = null;
  if (inicioISO) {
    const fimTotal = fim ?? agoraMs;
    if (fimTotal < ms(inicioISO)) avisos.push('A chegada está antes da saída. Corrija um dos horários.');
    else totalMs = fimTotal - ms(inicioISO);
  }
  return { etapas, transporteMs, conexaoMs, totalMs, totalFinal: fim !== null, avisos };
}

export function formatarDuracao(msTotal: number): string {
  const min = Math.max(0, Math.floor(msTotal / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, '0')}min` : `${min} min`;
}

export function chaveDia(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Horários de referência (previstos, nunca gravados como reais).
export function marcosDoDia(diaSemana: number) {
  return [
    { key: 'acordei', titulo: 'Acordar', previsto: '04:30' },
    { key: 'sai_casa', titulo: 'Sair de casa', previsto: '05:30' },
    { key: 'cheguei_trabalho', titulo: 'Chegar ao trabalho', previsto: '08:00' },
    { key: 'almoco', titulo: 'Almoço', previsto: '12:00' },
    { key: 'volta_almoco', titulo: 'Voltar do almoço', previsto: '13:00' },
    { key: 'sai_trabalho', titulo: 'Sair do trabalho', previsto: diaSemana === 5 ? '17:00' : '18:00' },
    { key: 'cheguei_casa', titulo: 'Chegar em casa', previsto: '21:20' },
  ];
}

// Tempo entre deitar e acordar (HH:MM). Não é o tempo efetivamente dormido: não desconta interrupções.
export function duracaoSono(deitar?: string, acordar?: string): number | null {
  const p = (s?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? ''); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  const a = p(deitar), b = p(acordar);
  if (a === null || b === null || a === b) return null;
  return (b > a ? b - a : b + 1440 - a) * 60000;
}
