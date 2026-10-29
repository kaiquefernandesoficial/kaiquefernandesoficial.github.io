import { useCallback, useEffect, useState } from 'react';
import { registros, type Peso, type RegistroLocal } from './db';
import { calcularTrajeto, chaveDia, duracaoSono, formatarDuracao, marcosDoDia } from './rotinaCalc';

type Tela = 'inicio' | 'corpo' | 'medidas' | 'alimentacao' | 'treinos' | 'rotina' | 'sono' | 'metas' | 'relatorios' | 'instantes' | 'configuracoes';
type Props = { lista: Peso[]; setTela: (t: Tela) => void; onToast: (s: string) => void; onQuickPeso: () => void };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const FRASES = [
  'Um passo pequeno hoje ainda é um passo.',
  'Constância vale mais do que intensidade.',
  'Você não precisa estar perfeito para continuar.',
  'Cuide do hoje; o amanhã agradece.',
  'Descansar também faz parte do caminho.',
  'O progresso mora nos dias comuns.',
  'Faça o simples bem-feito.',
  'Respire, ajuste a rota e siga.',
  'Cada registro é um compromisso com você.',
  'Disciplina é um jeito de cuidar de si.',
  'Hoje é um bom dia para recomeçar sem culpa.',
  'Água, descanso e movimento: o básico funciona.',
  'Pequenas vitórias constroem grandes mudanças.',
  'Seu ritmo é válido.',
  'Organize o dia e libere a cabeça.',
  'Um dia difícil não apaga a sua evolução.',
  'Faça o que dá hoje, com o que você tem.',
  'Cuidar de si também é ser produtivo.',
  'Foque no próximo passo, não na escada inteira.',
  'O que você repete, você se torna.',
  'Gratidão transforma o cansaço em motivo.',
  'Pausa não é desistência.',
  'Seja paciente: resultado leva tempo.',
  'Termine o dia com um sim para você.',
  'A rotina certa é a que cabe na sua vida.',
  'Coragem é seguir mesmo com dúvida.',
  'Mais um dia, mais uma chance de acertar.',
  'Você já chegou mais longe do que imagina.',
  'Faça hoje o seu melhor possível, e isso basta.',
  'Quem registra, enxerga. Quem enxerga, ajusta.',
  'Seu futuro agradece cada escolha de hoje.',
];

function Card(p: { icon: string; titulo: string; valor: string; nota: string; destino: Tela; setTela: (t: Tela) => void }) {
  return <article className="home-card">
    <div className="home-card-top"><span>{p.icon}</span><strong>{p.titulo}</strong></div>
    <div className="home-value">{p.valor}</div>
    <p>{p.nota}</p>
    <button onClick={() => p.setTela(p.destino)}>Ver detalhes →</button>
  </article>;
}

export default function Home({ lista, setTela, onToast, onQuickPeso }: Props) {
  const [dados, setDados] = useState<Record<string, RegistroLocal[]>>({});
  const [agora, setAgora] = useState(() => new Date());
  const dia = chaveDia(agora);
  const carregar = useCallback(async () => {
    const mods = ['rotina', 'alimentacao', 'treinos', 'sono'];
    const p = await Promise.all(mods.map(async (m) => [m, await registros.todos(m)] as const));
    setDados(Object.fromEntries(p));
  }, []);
  useEffect(() => { void carregar(); const t = window.setInterval(() => setAgora(new Date()), 30000); return () => window.clearInterval(t); }, [carregar]);

  const hoje = (dados.rotina ?? []).filter((x) => x.detalhes?.dia === dia);
  const marco = (k: string) => hoje.find((x) => x.detalhes?.tipoRegistro === 'marco-dia' && x.detalhes?.etapa === k);
  const acordou = marco('acordei');
  const proximo = acordou ? marcosDoDia(agora.getDay()).find((m) => !marco(m.key)) : undefined;
  const aguaMl = hoje.filter((x) => x.detalhes?.tipoRegistro === 'agua').reduce((s, x) => s + (Number(x.detalhes.quantidadeMl) || 0), 0);
  const metaAgua = Number(localStorage.getItem('aura_meta_agua')) || 0;
  const refeicoes = [...hoje.filter((x) => x.detalhes?.tipoRegistro === 'refeicao'), ...(dados.alimentacao ?? []).filter((x) => x.detalhes?.refeicao && chaveDia(new Date(x.data)) === dia)].sort((a, b) => b.data.localeCompare(a.data));

  const direcao = marco('sai_trabalho') ? 'volta' : 'ida';
  const ini = marco(direcao === 'ida' ? 'sai_casa' : 'sai_trabalho');
  const fimM = marco(direcao === 'ida' ? 'cheguei_trabalho' : 'cheguei_casa');
  const calc = calcularTrajeto(
    hoje.filter((x) => x.detalhes?.tipoRegistro === 'transporte' && x.detalhes?.direcao === direcao)
      .map((x) => ({ id: x.id, data: x.data, acao: x.detalhes.acao as 'embarque' | 'desembarque', etapa: x.detalhes.etapaTransporte })),
    ini?.data ?? null, fimM?.data ?? null, agora.getTime());
  const trajeto = calc.totalMs === null ? 'Sem saída' : formatarDuracao(calc.totalMs);
  const trajetoNota = !ini ? 'Registre a saída para contar' : `${direcao === 'ida' ? 'Ida' : 'Volta'} · ${calc.totalFinal ? 'concluída' : 'em andamento'} · ${calc.etapas.length} etapa(s)`;

  const sono = (dados.sono ?? [])[0];
  const durS = sono ? duracaoSono(sono.detalhes?.deitar, sono.detalhes?.acordar) : null;
  const treinosHoje = (dados.treinos ?? []).filter((x) => chaveDia(new Date(x.data)) === dia);
  const treinoUlt = (dados.treinos ?? [])[0];
  const atual = lista[0];
  const variacao = lista.length > 1 ? Number(lista[0].peso_kg) - Number(lista[1].peso_kg) : null;

  async function salvar(titulo: string, detalhes: Record<string, string>, id?: string) {
    const d = new Date();
    await registros.salvar({ id: id ?? crypto.randomUUID(), modulo: 'rotina', titulo, data: d.toISOString(), detalhes: { ...detalhes, dia, horarioReal: hhmm(d.toISOString()), status: 'Concluído' }, criado_em: d.toISOString() });
    await carregar();
  }
  async function acordei() {
    if (acordou) { onToast('Você já registrou que acordou hoje.'); return; }
    await salvar('Acordei', { tipoRegistro: 'marco-dia', etapa: 'acordei', horarioPlanejado: '04:30', observacao: '' }, `marco-dia-${dia}-acordei`);
    onToast(`Acordei registrado às ${hhmm(new Date().toISOString())} ✦`);
  }
  async function agua() { await salvar('Bebi 250 ml de água', { tipoRegistro: 'agua', quantidadeMl: '250' }); onToast('💧 250 ml registrados.'); }

  const nomeSalvo = (localStorage.getItem('aura_nome') || '').trim();
  const nome = !nomeSalvo || nomeSalvo === 'Meu espaço' ? 'Kaique' : nomeSalvo;
  const frase = FRASES[Math.floor(new Date(dia).getTime() / 86400000) % FRASES.length];
  const saud = agora.getHours() < 12 ? 'Bom dia' : agora.getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  return <div className="page-content home">
    <section className="home-hero">
      <p className="eyebrow">{agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</p>
      <h1>{saud}, {nome}.</h1>
      <p className="home-quote">“{frase}”</p>
      <p className="home-status">{acordou ? `Rotina ativa · você acordou às ${acordou.detalhes.horarioReal}` : 'Registre que acordou para ativar a rotina do dia.'}</p>
      {proximo && <p className="home-next">Próximo: <strong>{proximo.titulo}</strong> · previsto {proximo.previsto}</p>}
      <div className="home-actions">
        {!acordou && <button className="gold-button" onClick={() => void acordei()}>☀️ Acordei</button>}
        <button className="secondary-button" onClick={() => void agua()}>💧 +250 ml</button>
        <button className="secondary-button" onClick={onQuickPeso}>⚖️ Peso</button>
      </div>
    </section>
    <section className="home-grid">
      <Card icon="🗓️" titulo="Rotina e trajeto" valor={trajeto} nota={trajetoNota} destino="rotina" setTela={setTela} />
      <Card icon="💧" titulo="Água hoje" valor={`${aguaMl.toLocaleString('pt-BR')} ml`} nota={metaAgua ? `Meta: ${metaAgua.toLocaleString('pt-BR')} ml` : 'Meta ainda não definida'} destino="rotina" setTela={setTela} />
      <Card icon="🥗" titulo="Alimentação" valor={`${refeicoes.length} ${refeicoes.length === 1 ? 'refeição' : 'refeições'}`} nota={refeicoes[0] ? `Última: ${refeicoes[0].titulo}` : 'Nada registrado hoje'} destino="alimentacao" setTela={setTela} />
      <Card icon="🏋️" titulo="Treinos" valor={treinosHoje.length ? `${treinosHoje.length} hoje` : '—'} nota={treinoUlt ? `Último: ${treinoUlt.titulo}` : 'Nenhum treino registrado'} destino="treinos" setTela={setTela} />
      <Card icon="🌙" titulo="Sono" valor={sono?.detalhes?.deitar && sono.detalhes.acordar ? `${sono.detalhes.deitar}–${sono.detalhes.acordar}` : '—'} nota={sono ? `${durS !== null ? formatarDuracao(durS) + ' · ' : ''}${new Date(sono.data).toLocaleDateString('pt-BR')}${sono.detalhes.qualidade ? ' · ' + sono.detalhes.qualidade : ''}` : 'Nenhum registro de sono'} destino="sono" setTela={setTela} />
      <Card icon="⚖️" titulo="Corpo" valor={atual ? `${Number(atual.peso_kg).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg` : '—'} nota={variacao === null ? 'Último peso registrado' : `${variacao > 0 ? '+' : ''}${variacao.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg desde o anterior`} destino="corpo" setTela={setTela} />
    </section>
  </div>;
}
