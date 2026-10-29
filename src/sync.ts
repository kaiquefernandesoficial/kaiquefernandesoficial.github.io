import { chamarApi, type RespostaApi } from './api';
import { fila, kv, pesos, registros, type OpFila } from './db';

export type ResultadoSync = 'ok' | 'sem_conexao' | 'sessao_invalida';

// Fotos vão primeiro para o Drive privado; a planilha guarda só a referência.
async function enviarRegistro(o: OpFila, sessao: string): Promise<RespostaApi> {
  let reg = o.registro!;
  const foto = reg.detalhes?.foto;
  if (foto && foto.startsWith('data:')) {
    const f = await chamarApi({ acao: 'foto_enviar', sessao, registro_id: reg.id, dataUrl: foto });
    if (!f.ok) return f;
    reg = { ...reg, detalhes: { ...reg.detalhes, foto: `drive:${f.arquivo}` } };
  }
  return chamarApi({ acao: 'registro_salvar', sessao, registro: reg });
}

// Só marca "sincronizado" depois da confirmação do servidor.
export async function sincronizar(): Promise<ResultadoSync> {
  const sessao = await kv.get('sessao');
  if (!sessao) return 'sessao_invalida';
  try {
    if (!(await kv.get('migrado_v4'))) { // envia uma vez os registros que já existiam só no aparelho
      const pend = new Set((await fila.todas()).map((o) => o.op_id));
      for (const r of await registros.todos())
        if (!r.id.startsWith('import-') && !pend.has(`reg-${r.id}`)) await fila.add({ op_id: `reg-${r.id}`, acao: 'registro_salvar', registro: r });
      await kv.set('migrado_v4', '1');
    }
    for (const o of await fila.todas()) {
      let r: RespostaApi;
      if (o.acao === 'registro_salvar') r = await enviarRegistro(o, sessao);
      else if (o.acao === 'registro_excluir') r = await chamarApi({ acao: 'registro_excluir', sessao, id: o.id });
      else r = await chamarApi({ ...o, sessao });
      if (r.erro === 'SESSAO_INVALIDA') return 'sessao_invalida';
      if (o.acao === 'registro_salvar' || o.acao === 'registro_excluir') {
        if (r.ok || r.erro === 'DADOS_INVALIDOS') await fila.remover(o.op_id); // inválido não adianta repetir
        continue; // ACAO_DESCONHECIDA/outros: mantém na fila (backend ainda não atualizado)
      }
      const alvo = o.id ?? o.op_id;
      const local = (await pesos.todos()).find((p) => p.id === alvo);
      if (r.ok) {
        if (local) await pesos.put({ ...local, estado: 'sincronizado' });
        await fila.remover(o.op_id);
      } else if (r.erro === 'DADOS_INVALIDOS' || r.erro === 'ACAO_DESCONHECIDA') {
        if (local) await pesos.put({ ...local, estado: 'erro' });
        await fila.remover(o.op_id);
      } else return 'sem_conexao';
    }
    const lista = await chamarApi({ acao: 'peso_listar', sessao });
    if (lista.erro === 'SESSAO_INVALIDA') return 'sessao_invalida';
    const locais = await pesos.todos();
    for (const p of lista.registros ?? []) {
      const l = locais.find((x) => x.id === p.id);
      if (l && l.estado !== 'sincronizado') continue; // não sobrescreve correção local ainda não confirmada
      await pesos.put({ ...p, estado: 'sincronizado' });
    }
    // traz alterações vindas de outros aparelhos
    const pull = await chamarApi({ acao: 'registros_listar', sessao, desde: (await kv.get('ultimo_pull')) ?? '' });
    if (pull.erro === 'SESSAO_INVALIDA') return 'sessao_invalida';
    if (pull.ok) {
      const pend = new Set((await fila.todas()).map((o) => o.op_id));
      const atuais = new Map((await registros.todos()).map((r) => [r.id, r]));
      for (const x of pull.registros ?? []) {
        if (pend.has(`reg-${x.id}`)) continue;
        if (x.excluido) { await registros.removerLocal(x.id); continue; }
        const det = { ...x.detalhes };
        const fotoLocal = atuais.get(x.id)?.detalhes?.foto;
        if (det.foto?.startsWith('drive:') && fotoLocal?.startsWith('data:')) det.foto = fotoLocal;
        await registros.salvarLocal({ id: x.id, modulo: x.modulo, titulo: x.titulo, data: x.data, detalhes: det, criado_em: x.criado_em });
      }
      if (pull.agora) await kv.set('ultimo_pull', pull.agora);
      let baixadas = 0; // baixa fotos do Drive aos poucos
      for (const r of await registros.todos()) {
        const f = r.detalhes?.foto;
        if (f?.startsWith('drive:') && baixadas < 4) {
          baixadas++;
          const g = await chamarApi({ acao: 'foto_obter', sessao, arquivo: f.slice(6) });
          if (g.ok && g.dataUrl) await registros.salvarLocal({ ...r, detalhes: { ...r.detalhes, foto: g.dataUrl } });
        }
      }
    }
    return 'ok';
  } catch {
    return 'sem_conexao';
  }
}
