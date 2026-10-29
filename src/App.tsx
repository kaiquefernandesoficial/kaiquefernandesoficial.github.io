import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { GOOGLE_CLIENT_ID } from './config';
import { chamarApi } from './api';
import { fila, kv, pesos, registros, type Peso, type RegistroLocal } from './db';
import { sincronizar } from './sync';
import Home from './Home';
import { calcularTrajeto, duracaoSono, formatarDuracao as formatarDur } from './rotinaCalc';
import { lerCsv, lerXlsx, type Planilha } from './importData';

declare const google: any;
type Tela = 'inicio' | 'corpo' | 'medidas' | 'alimentacao' | 'treinos' | 'rotina' | 'sono' | 'metas' | 'relatorios' | 'instantes' | 'configuracoes';
const NAV: { id: Tela; icon: string; label: string; group: string }[] = [
  { id: 'inicio', icon: '✦', label: 'Visão geral', group: 'PRINCIPAL' },
  { id: 'corpo', icon: '⚖️', label: 'Meu corpo', group: 'PRINCIPAL' },
  { id: 'medidas', icon: '📏', label: 'Medidas', group: 'PRINCIPAL' },
  { id: 'alimentacao', icon: '🥗', label: 'Alimentação', group: 'CUIDADOS' },
  { id: 'treinos', icon: '🏋️', label: 'Treinos', group: 'CUIDADOS' },
  { id: 'sono', icon: '🌙', label: 'Sono & descanso', group: 'CUIDADOS' },
  { id: 'rotina', icon: '🗓️', label: 'Rotina', group: 'ORGANIZAÇÃO' },
  { id: 'metas', icon: '🎯', label: 'Metas', group: 'ORGANIZAÇÃO' },
  { id: 'relatorios', icon: '📈', label: 'Relatórios', group: 'ORGANIZAÇÃO' },
  { id: 'instantes', icon: '📸', label: 'Instantes', group: 'PESSOAL' },
  { id: 'configuracoes', icon: '⚙️', label: 'Configurações', group: 'PESSOAL' },
];
const MSG: Record<string, string> = {
  NAO_AUTORIZADO: 'Esta conta Google não está autorizada.', TOKEN_INVALIDO: 'Login inválido. Tente novamente.',
  TOKEN_EXPIRADO: 'O login expirou. Entre novamente.', ERRO_INTERNO: 'Erro no servidor. Tente novamente.',
  MUITAS_TENTATIVAS: 'Muitas tentativas. Aguarde alguns minutos.',
};
const ROTULO: Record<Peso['estado'], string> = { pendente: '⏳ Aguardando sincronização', sincronizado: '✓ Sincronizado', erro: '⚠ Precisa de atenção', local: '📥 Importado para teste' };

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [aviso, setAviso] = useState('');
  const botao = useRef<HTMLDivElement>(null);
  const aoLogar = useCallback(async (resp: { credential: string }) => {
    try {
      const r = await chamarApi({ acao: 'entrar', idToken: resp.credential, dispositivo: `${navigator.platform || 'Dispositivo'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Web'}` });
      if (r.ok && r.sessao) { await kv.set('sessao', r.sessao); setLogado(true); }
      else setAviso(MSG[r.erro ?? 'ERRO_INTERNO'] ?? `Não foi possível entrar (${r.erro ?? 'erro desconhecido'}).`);
    } catch { setAviso('Não foi possível conectar ao Aura. Verifique a conexão e tente novamente.'); }
  }, []);
  useEffect(() => { kv.get('sessao').then((s) => setLogado(!!s)).catch(() => setLogado(false)); }, []);
  useEffect(() => {
    if (logado !== false) return;
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => { if (!google?.accounts?.id) { setAviso('O login Google não carregou. Recarregue a página.'); return; }
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: aoLogar });
      if (botao.current) google.accounts.id.renderButton(botao.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-BR', width: 280 });
    };
    s.onerror = () => setAviso('Não foi possível carregar o login Google.'); document.body.appendChild(s);
    return () => { s.remove(); };
  }, [logado, aoLogar]);
  if (logado === null) return <main className="loading-screen"><div className="brand-mark">✦</div><p>Preparando seu espaço…</p></main>;
  if (!logado) return <main className="login-screen"><div className="login-glow"/><div className="login-card"><div className="brand-mark">✦</div><p className="eyebrow">SEU ESPAÇO, SUAS REGRAS</p><h1>Aura<span>.</span></h1><p className="login-copy">Uma experiência pessoal para cuidar da sua rotina, acompanhar sua evolução e celebrar cada passo.</p><div className="login-features"><span>⚖️ Corpo</span><span>🌿 Bem-estar</span><span>✦ Evolução</span></div><div className="google-button" ref={botao}/>{aviso && <p className="error-message" role="alert">{aviso}</p>}<p className="privacy-note">🔒 Acesso restrito à conta autorizada</p></div><footer className="login-footer">AURA · SEU UNIVERSO PESSOAL</footer></main>;
  return <Workspace aoSair={() => setLogado(false)} />;
}

function Workspace({ aoSair }: { aoSair: () => void }) {
  const [tela, setTela] = useState<Tela>('inicio');
  const [lista, setLista] = useState<Peso[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncBusy, setSyncBusy] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [toast, setToast] = useState('');
  const carregar = useCallback(async () => { const t = await pesos.todos(); setLista(t.sort((a,b) => b.ocorreu_em.localeCompare(a.ocorreu_em))); }, []);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncBusy(true);
    const r = await sincronizar();
    if (r === 'sessao_invalida') { await kv.del('sessao'); aoSair(); }
    await carregar(); setSyncBusy(false);
  }, [aoSair, carregar]);
  useEffect(() => { carregar(); sync(); const on = () => { setOnline(true); sync(); }; const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); const t = window.setInterval(sync, 30000); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.clearInterval(t); }; }, [carregar, sync]);
  useEffect(() => { const handler = (e: Event) => setToast((e as CustomEvent<string>).detail); window.addEventListener('aura-toast', handler); return () => window.removeEventListener('aura-toast', handler); }, []);
  async function sair() { const sessao = await kv.get('sessao'); try { if (sessao) await chamarApi({ acao: 'sair', sessao }); } catch { /* logout local continua disponível offline */ } await kv.del('sessao'); aoSair(); }
  const atual = lista[0];
  const variacao = lista.length > 1 ? Number(lista[0].peso_kg) - Number(lista[1].peso_kg) : null;
  const pendentes = lista.filter(p => p.estado !== 'sincronizado').length;
  const titulo = NAV.find(n => n.id === tela)?.label ?? 'Visão geral';
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => setTela('inicio')}><span className="brand-symbol">✦</span><span>Aura<small>SEU ESPAÇO PESSOAL</small></span></button><div className="side-scroll">{['PRINCIPAL','CUIDADOS','ORGANIZAÇÃO','PESSOAL'].map(group => <div className="nav-group" key={group}><p className="nav-caption">{group}</p>{NAV.filter(n => n.group === group).map(n => <button key={n.id} className={`nav-item ${tela === n.id ? 'active' : ''}`} onClick={() => setTela(n.id)}><span className="nav-icon">{n.icon}</span><span>{n.label}</span>{n.id === 'corpo' && pendentes > 0 && <i className="nav-dot"/>}</button>)}</div>)}</div><div className="sidebar-bottom"><div className={`connection ${online ? 'is-online' : 'is-offline'}`}><span className="connection-dot"/><span>{online ? (syncBusy ? 'Sincronizando…' : 'Conectado') : 'Modo offline'}</span></div><button className="profile-mini" onClick={() => setTela('configuracoes')}><span className="avatar">K</span><span><strong>{localStorage.getItem('aura_nome') || 'Meu espaço'}</strong><small>Conta pessoal</small></span><span className="more-dots">···</span></button><button className="logout-link" onClick={sair}>↪ Sair da conta</button></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><span>Meu espaço</span><b>/</b><strong>{titulo}</strong></div><div className="top-actions"><span className="date-label">{new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'})}</span><button className="icon-button" aria-label="Notificações" onClick={() => setToast(pendentes ? `Você tem ${pendentes} registro(s) aguardando sincronização.` : 'Tudo em dia por aqui ✨')}>♧{pendentes > 0 && <i/>}</button><button className="add-button" onClick={() => { setTela('corpo'); setShowQuick(true); }}>＋ <span>Novo registro</span></button></div></header>
      {!online && <div className="offline-banner">☁️ Você está offline. Os registros compatíveis ficam salvos neste dispositivo e serão sincronizados quando a conexão voltar.</div>}
      {tela === 'inicio' && <Home lista={lista} setTela={setTela} onToast={setToast} onQuickPeso={() => {setTela('corpo');setShowQuick(true);}} />}
      {tela === 'corpo' && <BodyPage lista={lista} carregar={carregar} sync={sync} showQuick={showQuick} closeQuick={() => setShowQuick(false)} onToast={setToast} setTela={setTela}/>}
      {tela !== 'inicio' && tela !== 'corpo' && <FunctionalModulePage tela={tela} setTela={setTela} onToast={setToast} />}
      <footer className="app-footer"><span>✦ AURA</span><span>Seu progresso, no seu ritmo.</span><span className="footer-sync">{syncBusy ? '⟳ Sincronizando' : online ? '✓ Estado atualizado' : '◌ Alterações locais'}</span></footer>
    </main>
    <nav className="mobile-nav">{NAV.filter(n => ['inicio','corpo','alimentacao','treinos','rotina'].includes(n.id)).map(n => <button key={n.id} className={tela === n.id ? 'active' : ''} onClick={() => setTela(n.id)}><span>{n.icon}</span><small>{n.id === 'inicio' ? 'Início' : n.id === 'corpo' ? 'Corpo' : n.id === 'alimentacao' ? 'Comida' : n.id === 'treinos' ? 'Treinos' : 'Rotina'}</small></button>)}</nav>
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')}>×</button></div>}
  </div>;
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type DailyStep = { key: string; icon: string; title: string; hint: string; planned: string; optional?: boolean };
type Direcao = 'ida' | 'volta';
const TRANSPORTES = ['Ônibus', 'Trem', 'Metrô', 'CPTM', 'Van', 'A pé', 'Carro', 'Outro'];
function DailyRoutine({ setTela, onToast, compact = false }: { setTela: (t: Tela) => void; onToast: (s: string) => void; compact?: boolean }) {
  const [itens, setItens] = useState<RegistroLocal[]>([]);
  const [agora, setAgora] = useState(() => new Date());
  const [salvando, setSalvando] = useState(false);
  const [direcao, setDirecao] = useState<Direcao>('ida');
  const [transporte, setTransporte] = useState('Ônibus');
  const [aguaMl, setAguaMl] = useState('250');
  const [refeicao, setRefeicao] = useState('Almoço');
  const [alimentos, setAlimentos] = useState('');
  const [editHoraId, setEditHoraId] = useState<string | null>(null);
  const [horaEditada, setHoraEditada] = useState('');
  const dia = localDayKey(agora);
  const sexta = agora.getDay() === 5;
  const fimDeSemana = agora.getDay() === 0 || agora.getDay() === 6;
  const carregar = useCallback(async () => {
    const todos = await registros.todos('rotina');
    setItens(todos.filter(x => x.detalhes?.dia === dia && (x.detalhes?.tipoRegistro === 'marco-dia' || x.detalhes?.tipoRegistro === 'transporte' || x.detalhes?.tipoRegistro === 'agua' || x.detalhes?.tipoRegistro === 'refeicao')));
  }, [dia]);
  useEffect(() => { void carregar(); const id = window.setInterval(() => setAgora(new Date()), 60000); return () => window.clearInterval(id); }, [carregar]);
  const eventos = useMemo(() => [...itens].sort((a,b) => a.data.localeCompare(b.data)), [itens]);
  const evento = (key: string) => itens.find(x => x.detalhes?.tipoRegistro === 'marco-dia' && x.detalhes?.etapa === key);
  const acordou = !!evento('acordei');
  const saiuCasa = !!evento('sai_casa');
  const chegouTrabalho = !!evento('cheguei_trabalho');
  const saiuTrabalho = !!evento('sai_trabalho');
  const chegouCasa = !!evento('cheguei_casa');
  const transporteHoje = itens.filter(x => x.detalhes?.tipoRegistro === 'transporte' && x.detalhes?.direcao === direcao).sort((a,b) => a.data.localeCompare(b.data));
  const embarqueAtivo = [...transporteHoje].reverse().find(x => x.detalhes?.acao === 'embarque' && !transporteHoje.some(y => y.detalhes?.acao === 'desembarque' && y.detalhes?.etapaTransporte === x.detalhes?.etapaTransporte));
  const proxEtapa = transporteHoje.reduce((max,x) => Math.max(max, Number(x.detalhes?.etapaTransporte || 0)), 0) + (embarqueAtivo ? 0 : 1);
  const formatarDuracao = formatarDur;
  const marcoInicioTrajeto = direcao === 'ida' ? evento('sai_casa') : evento('sai_trabalho');
  const marcoFimTrajeto = direcao === 'ida' ? evento('cheguei_trabalho') : evento('cheguei_casa');
  const trajetoIniciado = !!marcoInicioTrajeto;
  const trajetoFinalizado = !!marcoFimTrajeto;
  const calc = calcularTrajeto(transporteHoje.map(x => ({ id: x.id, data: x.data, acao: x.detalhes.acao as 'embarque' | 'desembarque', etapa: x.detalhes.etapaTransporte })), marcoInicioTrajeto?.data ?? null, marcoFimTrajeto?.data ?? null, agora.getTime());
  const etapasCalculadas = calc.etapas.map(e => ({ embarque: transporteHoje.find(x => x.id === e.embarqueId)!, desembarque: transporteHoje.find(x => x.id === e.desembarqueId), duracaoMs: e.duracaoMs ?? 0, emAndamento: e.emAndamento, incompleta: e.duracaoMs === null && !e.emAndamento }));
  const duracaoTotalMs = calc.totalMs; const tempoEmTransporteMs = calc.transporteMs; const tempoConexaoMs = calc.conexaoMs;
  const etapasBase: DailyStep[] = [
    { key: 'acordei', icon: '☀️', title: 'Acordei', hint: 'Registre seu despertar para montar a rotina do dia.', planned: '04:30' },
    { key: 'sai_casa', icon: '🚪', title: 'Saí de casa', hint: 'Início do deslocamento.', planned: '05:30' },
    { key: 'cheguei_trabalho', icon: '🏢', title: 'Cheguei ao trabalho', hint: 'Conclua a sequência de transporte da ida antes de registrar a chegada.', planned: '08:00' },
    { key: 'almoco', icon: '🍽️', title: 'Comecei o almoço', hint: 'Pausa para comer e descansar.', planned: '12:00' },
    { key: 'volta_almoco', icon: '↩️', title: 'Voltei do almoço', hint: 'Retorno às atividades.', planned: '13:00' },
    { key: 'sai_trabalho', icon: '🌆', title: 'Saí do trabalho', hint: 'Fim do expediente.', planned: sexta ? '17:00' : '18:00' },
    { key: 'cheguei_casa', icon: '🏠', title: 'Cheguei em casa', hint: 'Fim do deslocamento e começo do tempo pessoal.', planned: '21:20' },
  ];
  async function salvarEvento(titulo: string, detalhes: Record<string,string>, id?: string, data?: string) {
    const hora = data ? new Date(data) : new Date();
    const tipo = detalhes.tipoRegistro || 'marco-dia';
    const item: RegistroLocal = { id: id || crypto.randomUUID(), modulo: 'rotina', titulo, data: hora.toISOString(), detalhes: { ...detalhes, dia, horarioReal: hora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}), status: 'Concluído' }, criado_em: new Date().toISOString() };
    await registros.salvar(item); await carregar(); return item;
  }
  async function marcar(step: DailyStep) {
    if (salvando) return;
    const existing = evento(step.key);
    if (existing) { await registros.remover(existing.id); await carregar(); onToast(`Registro de “${step.title}” desfeito.`); return; }
    if (step.key !== 'acordei' && !acordou) { onToast('Registre “Acordei” primeiro para liberar sua rotina.'); return; }
    setSalvando(true);
    try { await salvarEvento(step.title, {tipoRegistro:'marco-dia', etapa:step.key, horarioPlanejado:step.planned, observacao:''}, `marco-dia-${dia}-${step.key}`); onToast(`${step.title} registrado às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} ✦`); }
    catch { onToast('Não foi possível salvar este marco. Tente novamente.'); }
    finally { setSalvando(false); }
  }
  async function registrarTransporte(acao: 'embarque'|'desembarque') {
    if (salvando) return;
    if (!acordou) { onToast('Registre “Acordei” antes de começar a rotina.'); return; }
    if (acao === 'embarque' && embarqueAtivo) { onToast('Registre o desembarque antes de iniciar outra etapa.'); return; }
    if (acao === 'desembarque' && !embarqueAtivo) { onToast('Registre um embarque antes do desembarque.'); return; }
    setSalvando(true);
    try {
      const etapa = acao === 'embarque' ? proxEtapa : Number(embarqueAtivo?.detalhes?.etapaTransporte || proxEtapa-1);
      const nome = acao === 'embarque' ? `Peguei ${transporte.toLowerCase()}` : `Desci de ${embarqueAtivo?.detalhes?.transporte?.toLowerCase() || 'transporte'}`;
      await salvarEvento(nome, {tipoRegistro:'transporte', direcao, acao, transporte: acao === 'embarque' ? transporte : (embarqueAtivo?.detalhes?.transporte || transporte), etapaTransporte:String(etapa)}, `transporte-${dia}-${direcao}-${crypto.randomUUID()}`);
      onToast(`${nome} registrado com horário real.`);
    } catch { onToast('Não foi possível registrar a etapa de transporte.'); }
    finally { setSalvando(false); }
  }
  async function registrarAgua() {
    const ml = Number(aguaMl); if (!Number.isFinite(ml) || ml < 1 || ml > 3000) { onToast('Informe uma quantidade de água entre 1 e 3000 ml.'); return; }
    await salvarEvento(`Bebi ${ml} ml de água`, {tipoRegistro:'agua', quantidadeMl:String(ml)}); setAguaMl('250'); onToast(`💧 ${ml} ml de água registrados.`);
  }
  async function registrarRefeicao() {
    if (!alimentos.trim()) { onToast('Descreva brevemente o que comeu.'); return; }
    await salvarEvento(refeicao, {tipoRegistro:'refeicao', refeicao, alimentos:alimentos.trim()}); setAlimentos(''); onToast(`${refeicao} registrada na rotina.`);
  }
  async function corrigirTipo(item: RegistroLocal) {
    const novo = window.prompt(`Tipo de transporte (${TRANSPORTES.join(', ')}):`, item.detalhes.transporte)?.trim();
    if (!novo) return;
    const tipo = TRANSPORTES.find(t => t.toLowerCase() === novo.toLowerCase()) ?? novo;
    for (const x of itens.filter(y => y.detalhes?.tipoRegistro === 'transporte' && y.detalhes.direcao === item.detalhes.direcao && y.detalhes.etapaTransporte === item.detalhes.etapaTransporte)) {
      await registros.salvar({ ...x, titulo: x.detalhes.acao === 'embarque' ? `Peguei ${tipo.toLowerCase()}` : `Desci de ${tipo.toLowerCase()}`, detalhes: { ...x.detalhes, transporte: tipo } });
    }
    await carregar(); onToast('Tipo de transporte corrigido.');
  }
  async function apagar(item: RegistroLocal) { if (!window.confirm(`Desfazer “${item.titulo}”?`)) return; await registros.remover(item.id); await carregar(); onToast('Registro removido do histórico.'); }
  async function salvarHorario(item: RegistroLocal) {
    if (!horaEditada) return;
    const [h,m] = horaEditada.split(':').map(Number); const data = new Date(item.data); data.setHours(h,m,0,0);
    const detalhes = {...item.detalhes, horarioCorrigido:'sim', horarioReal:horaEditada}; await registros.salvar({...item, data:data.toISOString(), detalhes}); await carregar(); setEditHoraId(null); onToast('Horário corrigido.');
  }
  const concluidas = etapasBase.filter(e => !!evento(e.key)).length;
  const etapasTotais = etapasBase.length;
  return <section className={`daily-routine ${compact ? 'daily-routine-compact' : ''}`}>
    <div className="daily-routine-head"><div><p className="eyebrow">{compact ? 'SEU DIA, NA PRÁTICA' : 'ROTINA & DESLOCAMENTO'}</p><h2>{compact ? 'Como está seu dia?' : 'Minha rotina de hoje'}<em>.</em></h2><p>{agora.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' })} · {acordou ? 'rotina ativada' : 'registre seu despertar para começar'}</p></div>{compact && <button className="text-button" onClick={() => setTela('rotina')}>Ver rotina completa ↗</button>}</div>
    <div className="daily-progress"><span style={{width:`${acordou ? Math.max(10,concluidas/etapasTotais*100) : 0}%`}} /></div>
    {!acordou && <div className="daily-next"><span className="next-icon">☀️</span><div><small>PRIMEIRO PASSO</small><strong>Comece registrando que acordou</strong><span>Isso ativa sua rotina, hidratação, refeições e deslocamento.</span></div><button onClick={()=>void marcar(etapasBase[0])} disabled={salvando}>Registrar agora</button></div>}
    {acordou && <>
      <div className="daily-next"><span className="next-icon">✦</span><div><small>ROTINA ATIVADA</small><strong>{fimDeSemana ? 'Seu dia está livre para adaptar' : `Expediente previsto: ${sexta?'08h–17h':'08h–18h'}`}</strong><span>Os horários são referências; os registros usam o horário real.</span></div><button onClick={()=>setTela('alimentacao')}>Ver alimentação</button></div>
      <div className="routine-tools">
        <section className="routine-tool-card"><div className="routine-tool-title"><span>💧</span><div><strong>Hidratação</strong><small>Registro rápido, sem sair da rotina</small></div></div><div className="routine-inline"><input aria-label="Quantidade de água em ml" type="number" min="1" max="3000" value={aguaMl} onChange={e=>setAguaMl(e.target.value)}/><span>ml</span><button className="gold-button" onClick={()=>void registrarAgua()}>Bebi água</button></div><div className="routine-presets">{[150,250,500].map(n=><button key={n} onClick={()=>setAguaMl(String(n))}>{n} ml</button>)}</div></section>
        <section className="routine-tool-card"><div className="routine-tool-title"><span>🍽️</span><div><strong>Refeição</strong><small>Guarde o que comeu com a hora real</small></div></div><select aria-label="Tipo de refeição" value={refeicao} onChange={e=>setRefeicao(e.target.value)}>{['Café da manhã','Lanche da manhã','Almoço','Lanche da tarde','Jantar','Ceia','Outro'].map(x=><option key={x}>{x}</option>)}</select><textarea aria-label="O que comeu" rows={2} placeholder="O que você comeu?" value={alimentos} onChange={e=>setAlimentos(e.target.value)}/><button className="gold-button" onClick={()=>void registrarRefeicao()}>Registrar refeição</button></section>
      </div>
      <section className="routine-plan panel"><div className="panel-heading"><div><p className="eyebrow">SEU DIA ORGANIZADO</p><h3>Próximos cuidados</h3></div><span className="count-pill">{itens.filter(x=>['agua','refeicao'].includes(x.detalhes?.tipoRegistro||'')).length} registros</span></div><div className="routine-plan-grid">{(fimDeSemana ? [{hora:'08:00',nome:'Café da manhã',tipo:'refeicao'},{hora:'10:00',nome:'Água',tipo:'agua'},{hora:'12:30',nome:'Almoço',tipo:'refeicao'},{hora:'15:00',nome:'Água',tipo:'agua'},{hora:'16:00',nome:'Lanche',tipo:'refeicao'},{hora:'19:30',nome:'Jantar',tipo:'refeicao'}] : [{hora:'06:00',nome:'Café da manhã',tipo:'refeicao'},{hora:'07:30',nome:'Água',tipo:'agua'},{hora:'09:30',nome:'Lanche da manhã',tipo:'refeicao'},{hora:'10:00',nome:'Água',tipo:'agua'},{hora:'12:00',nome:'Almoço',tipo:'refeicao'},{hora:'13:30',nome:'Água',tipo:'agua'},{hora:'15:30',nome:'Lanche da tarde',tipo:'refeicao'},{hora:'16:00',nome:'Água',tipo:'agua'},{hora:'18:30',nome:'Água',tipo:'agua'},{hora:'19:30',nome:'Jantar',tipo:'refeicao'}]).map((plano,i)=>{const registrado=plano.tipo==='agua' ? itens.filter(x=>x.detalhes?.tipoRegistro==='agua').length >= ( (fimDeSemana ? [{hora:'08:00',tipo:'refeicao'},{hora:'10:00',tipo:'agua'},{hora:'12:30',tipo:'refeicao'},{hora:'15:00',tipo:'agua'},{hora:'16:00',tipo:'refeicao'},{hora:'19:30',tipo:'refeicao'}] : [{hora:'06:00',tipo:'refeicao'},{hora:'07:30',tipo:'agua'},{hora:'09:30',tipo:'refeicao'},{hora:'10:00',tipo:'agua'},{hora:'12:00',tipo:'refeicao'},{hora:'13:30',tipo:'agua'},{hora:'15:30',tipo:'refeicao'},{hora:'16:00',tipo:'agua'},{hora:'18:30',tipo:'agua'},{hora:'19:30',tipo:'refeicao'}]).slice(0,i+1).filter(y=>y.tipo==='agua').length ) : itens.some(x=>x.detalhes?.tipoRegistro==='refeicao' && x.detalhes?.refeicao===plano.nome);return <article className={`routine-plan-item ${registrado?'done':''}`} key={`${plano.hora}-${plano.nome}`}><span>{plano.tipo==='agua'?'💧':'🍽️'}</span><div><small>{plano.hora}</small><strong>{plano.nome}</strong></div><button onClick={()=>{if(plano.tipo==='agua'){void registrarAgua();}else{setRefeicao(plano.nome);document.querySelector('.routine-tool-card select')?.scrollIntoView({behavior:'smooth',block:'center'});onToast(`Selecione ou confirme os alimentos de: ${plano.nome}.`);}}}>{registrado?'✓ Registrado':plano.tipo==='agua'?'Registrar água':'Registrar refeição'}</button></article>})}</div><p className="routine-help">Horários sugeridos e ajustáveis; não são notificações do sistema. Marque o que fizer e adapte ao seu dia.</p></section>
      <div className="routine-transport panel"><div className="panel-heading"><div><p className="eyebrow">DESLOCAMENTO EM ETAPAS</p><h3>Seu trajeto, do seu jeito</h3></div><div className="routine-direction"><button className={direcao==='ida'?'selected':''} onClick={()=>setDirecao('ida')}>🏢 Ida</button><button className={direcao==='volta'?'selected':''} onClick={()=>setDirecao('volta')}>🏠 Volta</button></div></div>
        <p className="routine-help">Adicione quantas etapas precisar. Só é possível iniciar outro transporte depois de registrar o desembarque.</p>
        <section className="transport-metrics" aria-label="Resumo de duração do trajeto">
          <article className="transport-metric transport-metric-total"><span>⏱️</span><div><small>{trajetoFinalizado ? 'TEMPO TOTAL DO TRAJETO' : 'TEMPO TOTAL ATÉ AGORA'}</small><strong>{duracaoTotalMs === null ? 'Aguardando saída' : formatarDuracao(duracaoTotalMs)}</strong><em>{trajetoIniciado ? `${new Date(marcoInicioTrajeto!.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}${trajetoFinalizado ? ` → ${new Date(marcoFimTrajeto!.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` : ' · em andamento'}` : 'Registre a saída para iniciar a contagem'}</em></div></article>
          <article className="transport-metric"><span>🚍</span><div><small>TEMPO NOS TRANSPORTES</small><strong>{etapasCalculadas.length ? formatarDuracao(tempoEmTransporteMs) : '—'}</strong><em>{etapasCalculadas.length} {etapasCalculadas.length === 1 ? 'etapa iniciada' : 'etapas iniciadas'}</em></div></article>
          <article className="transport-metric"><span>🔄</span><div><small>TEMPO DE CONEXÃO</small><strong>{etapasCalculadas.length > 1 ? formatarDuracao(tempoConexaoMs) : '—'}</strong><em>Entre um transporte e outro</em></div></article>
        </section>
        {calc.avisos.map(a=><p className="error-message" key={a}>⚠ {a}</p>)}{etapasCalculadas.length > 0 && <div className="transport-duration-list"><h4>Duração por etapa</h4>{etapasCalculadas.map(({embarque,desembarque,duracaoMs,emAndamento,incompleta})=><article className="transport-duration-item" key={embarque.id}><span>{embarque.detalhes.transporte==='Trem'||embarque.detalhes.transporte==='CPTM'||embarque.detalhes.transporte==='Metrô'?'🚆':embarque.detalhes.transporte==='A pé'?'🚶':'🚌'}</span><div><strong>Etapa {embarque.detalhes.etapaTransporte} · {embarque.detalhes.transporte}</strong><small>{new Date(embarque.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} → {desembarque ? new Date(desembarque.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : (incompleta?'sem desembarque':'em andamento')}</small></div><strong className="transport-duration-value">{incompleta?'incompleta':formatarDuracao(duracaoMs)}{emAndamento?'*':''}</strong></article>)}</div>}
        <div className="transport-events">{transporteHoje.map((x,i)=><article key={x.id} className="transport-event"><span>{x.detalhes.acao==='embarque'?'🚌':'🚏'}</span><div><strong>Etapa {x.detalhes.etapaTransporte}: {x.titulo}</strong><small>{new Date(x.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} · {x.detalhes.direcao==='ida'?'Ida':'Volta'}</small></div><button onClick={()=>void apagar(x)} aria-label="Corrigir ou remover etapa">↶</button></article>)}</div>
        <p className="routine-help">* A duração da etapa em andamento é atualizada enquanto a tela estiver aberta. O tempo total inclui esperas e conexões entre sair e chegar; caminhadas só são contabilizadas se você as registrar como etapa.</p>
        {embarqueAtivo ? <div className="transport-active"><span>🚦</span><div><strong>Em deslocamento: {embarqueAtivo.detalhes.transporte}</strong><small>Registre o desembarque para liberar a próxima etapa.</small></div><button className="gold-button" onClick={()=>void registrarTransporte('desembarque')} disabled={salvando}>Desci do transporte</button></div> : <div className="transport-add"><label>Próximo transporte<select value={transporte} onChange={e=>setTransporte(e.target.value)}>{TRANSPORTES.map(t=><option key={t}>{t}</option>)}</select></label><button className="gold-button" onClick={()=>void registrarTransporte('embarque')} disabled={salvando}>＋ Peguei {transporte.toLowerCase()}</button></div>}
        <div className="transport-destination">{direcao==='ida'?<><span>🏢</span><div><strong>Chegada ao trabalho</strong><small>Registre depois de concluir as etapas do trajeto.</small></div><button className="secondary-button" disabled={chegouTrabalho} onClick={()=>void marcar(etapasBase[2])}>{chegouTrabalho?'✓ Cheguei': 'Cheguei ao trabalho'}</button></>:<><span>🏠</span><div><strong>Chegada em casa</strong><small>O trajeto de volta é independente do trajeto de ida.</small></div><button className="secondary-button" disabled={chegouCasa} onClick={()=>void marcar(etapasBase[6])}>{chegouCasa?'✓ Cheguei':'Cheguei em casa'}</button></>}</div>
      </div>
      <div className="daily-timeline">{etapasBase.map((step,index)=>{const r=evento(step.key); const bloqueado=step.key!=='acordei'&&!acordou; return <article className={`daily-step ${r?'is-done':''}`} key={step.key}><div className="daily-step-rail"><span className="daily-step-icon">{r?'✓':step.icon}</span>{index<etapasBase.length-1&&<i/>}</div><div className="daily-step-copy"><div className="daily-step-title"><strong>{step.title}</strong>{r&&<span className="daily-actual">Realizado {r.detalhes.horarioReal}</span>}</div><p>{step.hint}</p><small>Previsto: {step.planned}{fimDeSemana?' · opcional hoje':''}</small></div><button className={`daily-check ${r?'checked':''}`} onClick={()=>void marcar(step)} disabled={salvando||bloqueado}>{r?'↶ Desfazer':'＋ Registrar'}</button></article>;})}</div>
      <section className="routine-history panel"><div className="panel-heading"><div><p className="eyebrow">ACONTECEU HOJE</p><h3>Linha do tempo <span className="count-pill">{eventos.length}</span></h3></div></div>{eventos.length===0?<p className="routine-help">Seus registros aparecerão aqui em ordem cronológica.</p>:eventos.map(x=><article className="routine-history-item" key={x.id}><span className="routine-history-time">{new Date(x.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span><div><strong>{x.titulo}</strong><small>{x.detalhes.tipoRegistro==='transporte'?`Transporte · ${x.detalhes.direcao==='ida'?'Ida':'Volta'} · etapa ${x.detalhes.etapaTransporte}`:x.detalhes.tipoRegistro==='agua'?`${x.detalhes.quantidadeMl} ml`:x.detalhes.tipoRegistro==='refeicao'?`${x.detalhes.refeicao}: ${x.detalhes.alimentos}`:'Marco da rotina'}</small>{editHoraId===x.id&&<div className="routine-edit-time"><input type="time" value={horaEditada} onChange={e=>setHoraEditada(e.target.value)}/><button onClick={()=>void salvarHorario(x)}>Salvar hora</button><button onClick={()=>setEditHoraId(null)}>Cancelar</button></div>}</div><div className="routine-history-actions">{x.detalhes.tipoRegistro==='transporte'&&<button onClick={()=>void corrigirTipo(x)}>⇄ Tipo</button>}<button onClick={()=>{setEditHoraId(x.id);setHoraEditada(new Date(x.data).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}));}}>✎ Hora</button><button onClick={()=>void apagar(x)}>×</button></div></article>)}</section>
    </>}
    <div className="daily-routine-foot"><span>📝 Seus registros são salvos localmente neste dispositivo.</span><button className="text-button" onClick={()=>setTela('sono')}>Registrar sono ↗</button></div>
  </section>;
}

function WeightChart({ data }: { data: Peso[] }) { const nums = data.map(p => Number(p.peso_kg)); const min = Math.min(...nums)-1; const max = Math.max(...nums)+1; const points = nums.map((n,i) => `${30+i*(540/Math.max(1,nums.length-1))},${180-((n-min)/(max-min||1))*140}`).join(' '); return <div className="weight-chart"><svg viewBox="0 0 600 210" role="img" aria-label="Gráfico dos últimos registros de peso"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#d4af37" stopOpacity=".24"/><stop offset="100%" stopColor="#d4af37" stopOpacity="0"/></linearGradient></defs>{[40,85,130,180].map(y=><line key={y} x1="20" x2="580" y1={y} y2={y} stroke="#29271f" strokeDasharray="4 6"/>)}<polygon points={`30,200 ${points} 570,200`} fill="url(#chartFill)"/><polyline points={points} fill="none" stroke="#d4af37" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{nums.map((n,i)=><circle key={i} cx={30+i*(540/Math.max(1,nums.length-1))} cy={180-((n-min)/(max-min||1))*140} r="4" fill="#0f0f0d" stroke="#e8cb68" strokeWidth="2"/> )}</svg><div className="chart-dates">{[data[0],data[Math.floor((data.length-1)/2)],data[data.length-1]].filter(Boolean).map((p,i)=><span key={i}>{new Date(p.ocorreu_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}</span>)}</div></div>; }

function BodyPage({ lista, carregar, sync, showQuick, closeQuick, onToast, setTela }: { lista: Peso[]; carregar: () => Promise<void>; sync: () => Promise<void>; showQuick: boolean; closeQuick: () => void; onToast: (s: string) => void; setTela: (t: Tela) => void }) {
  const [kg,setKg] = useState(''); const [nota,setNota] = useState(''); const [erro,setErro] = useState(''); const [open,setOpen] = useState(showQuick); const [editId,setEditId] = useState<string|null>(null);
  useEffect(() => { if (showQuick) setOpen(true); }, [showQuick]);
  async function registrar(e: FormEvent) { e.preventDefault(); const v=kg.trim().replace(',','.'); const n=Number(v); if (!v || !Number.isFinite(n) || n<20 || n>400) {setErro('Informe um peso entre 20 e 400 kg.');return;} setErro(''); if (editId) { await editarPeso(editId, v, nota); setKg('');setNota('');setEditId(null);setOpen(false);closeQuick();await carregar();void sync();onToast('Peso corrigido ✦'); return; } const id=crypto.randomUUID(); const ocorreu_em=new Date().toISOString(); await pesos.put({id,ocorreu_em,peso_kg:v,nota,estado:'pendente'}); await fila.add({op_id:id,acao:'peso_registrar',ocorreu_em,peso_kg:v,nota}); setKg('');setNota('');setOpen(false);closeQuick();await carregar();void sync();onToast('Registro salvo neste dispositivo ✦'); }
  async function editarPeso(id: string, v: string, nota: string) {
    const atual = lista.find(p => p.id === id); if (!atual) return;
    const pendente = (await fila.todas()).find(o => o.op_id === id);
    if (pendente) { await fila.add({ ...pendente, peso_kg: v, nota }); await pesos.put({ ...atual, peso_kg: v, nota }); return; }
    if (atual.estado === 'local') { await pesos.put({ ...atual, peso_kg: v, nota }); return; }
    await pesos.put({ ...atual, peso_kg: v, nota, estado: 'pendente' });
    await fila.add({ op_id: crypto.randomUUID(), acao: 'peso_editar', id, ocorreu_em: atual.ocorreu_em, peso_kg: v, nota });
  }
  const ultima=lista[0]; return <div className="page-content"><section className="page-title-row"><div><p className="eyebrow">CORPO & BEM-ESTAR</p><h1>Meu corpo <em>em evolução.</em></h1><p className="subtitle">Cada registro é uma informação a seu favor.</p></div><button className="gold-button" onClick={() => setOpen(!open)}>＋ Novo registro</button></section>
    <section className="body-summary-grid"><article className="body-current"><span className="eyebrow">ÚLTIMO PESO</span><div className="body-big-number">{ultima ? Number(ultima.peso_kg).toLocaleString('pt-BR',{maximumFractionDigits:2}) : '—'}<small> kg</small></div><p>{ultima ? `Registrado em ${new Date(ultima.ocorreu_em).toLocaleString('pt-BR')}` : 'Você ainda não tem registros.'}</p><span className="status-chip">{ultima ? ROTULO[ultima.estado] : '✦ Pronto para começar'}</span></article><article className="body-summary"><span className="summary-icon">📏</span><span className="eyebrow">MEDIDAS</span><h3>Conheça suas medidas</h3><p>Registre cintura, quadril e outras medidas para ampliar seu histórico corporal.</p><button className="text-button" onClick={() => setTela('medidas')}>Abrir medidas →</button></article><article className="body-summary"><span className="summary-icon">📸</span><span className="eyebrow">FOTOGRAFIAS</span><h3>Compare seus momentos</h3><p>O diário fotográfico privado fará parte do acompanhamento corporal.</p><button className="text-button" onClick={() => setTela('instantes')}>Ver sessões →</button></article></section>
    {open && <form className="panel record-form" onSubmit={registrar}><div className="panel-heading"><div><p className="eyebrow">{editId?'CORREÇÃO':'NOVO REGISTRO'}</p><h3>{editId?'Corrigir peso registrado':'Como está seu peso hoje?'}</h3></div><button type="button" className="close-button" onClick={() => {setOpen(false);setEditId(null);closeQuick();}}>×</button></div><label>Peso atual (kg)<input autoFocus inputMode="decimal" placeholder="Ex.: 82,4" value={kg} onChange={e=>setKg(e.target.value)}/></label><label>Nota pessoal <span className="optional">opcional</span><textarea placeholder="Como você está se sentindo? Alguma observação…" value={nota} onChange={e=>setNota(e.target.value)} rows={3}/></label>{erro&&<p className="error-message">{erro}</p>}<div className="form-actions"><span>🔒 Registro pessoal · poderá ser sincronizado</span><button className="gold-button" type="submit">{editId?'Salvar correção':'Salvar registro'} ✦</button></div></form>}
    <section className="panel history-panel"><div className="panel-heading"><div><p className="eyebrow">SEUS DADOS</p><h3>Histórico de peso <span className="count-pill">{lista.length}</span></h3></div><span className="history-lock">🔒 Privado</span></div>{lista.length===0?<div className="empty-state"><span>⚖️</span><h3>Seu histórico começa com um registro</h3><p>Quando você adicionar seu peso, ele aparecerá aqui com data e estado de sincronização.</p><button className="gold-button" onClick={()=>setOpen(true)}>＋ Registrar primeiro peso</button></div>:<div className="history-table"><div className="history-table-head"><span>DATA</span><span>PESO</span><span>NOTA</span><span>ESTADO</span></div>{lista.map(p=><div className="history-row" key={p.id}><span>{new Date(p.ocorreu_em).toLocaleString('pt-BR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span className="peso-cell"><strong>{Number(p.peso_kg).toLocaleString('pt-BR',{maximumFractionDigits:2})} kg</strong><button className="row-edit" onClick={()=>{setEditId(p.id);setKg(p.peso_kg.replace('.',','));setNota(p.nota);setOpen(true);window.scrollTo({top:0,behavior:'smooth'});}}>✎ Editar</button></span><span className="history-note">{p.nota||'—'}</span><span className={`record-state ${p.estado}`}>{ROTULO[p.estado]}</span></div>)}</div>}</section>
  </div>;
}
function ModulePage({ tela, setTela }: { tela: Tela; setTela: (t: Tela) => void }) {
  const info: Record<string,{icon:string;eyebrow:string;title:string;desc:string;features:string[]}> = {
    alimentacao:{icon:'🥗',eyebrow:'NUTRIÇÃO & CUIDADO',title:'Alimentação com intenção.',desc:'Planeje suas refeições, registre o que consumiu e construa uma relação organizada com sua rotina alimentar.',features:['Cardápio semanal e calendário mensal','Alimentos, quantidades e substituições','Registro real do consumo','Importação de planilhas com prévia']},
    treinos:{icon:'🏋️',eyebrow:'MOVIMENTO & ENERGIA',title:'Seu movimento, sua evolução.',desc:'Organize treinos, caminhadas, corridas e outras atividades com histórico e indicadores que façam sentido para você.',features:['Treinos e exercícios personalizados','Séries, repetições, cargas e distância','Cronômetro e registro manual','Histórico e evolução por modalidade']},
    rotina:{icon:'🗓️',eyebrow:'TEMPO & ORGANIZAÇÃO',title:'Uma rotina que cabe na sua vida.',desc:'Organize compromissos fixos, atividades flexíveis e deslocamentos sem transformar o dia em uma lista impossível.',features:['Rotina de trabalho e pausas','Deslocamentos por etapas','Reorganização em dias atípicos','Lembretes internos adaptativos']},
    sono:{icon:'🌙',eyebrow:'DESCANSO & RECUPERAÇÃO',title:'Descanse sem cobrança.',desc:'Registre horários, interrupções e como você se sente ao acordar. Observe tendências sem inventar dados que não existem.',features:['Início, despertar e interrupções','Qualidade percebida e notas','Histórico e gráficos de regularidade','Sugestões compatíveis com compromissos']},
    metas:{icon:'🎯',eyebrow:'INTENÇÃO & PROGRESSO',title:'Metas possíveis. Progresso real.',desc:'Acompanhe hábitos e resultados com metas orientadas, ajustes transparentes e espaço para pausas justificadas.',features:['Metas de hábito e de resultado','Ponto de partida baseado no histórico','Marcos, consistência e evolução','Revisão sem punição automática']},
    relatorios:{icon:'📈',eyebrow:'DADOS & DESCOBERTAS',title:'Enxergue sua evolução.',desc:'Reúna seus registros em relatórios claros, compare períodos e exporte os dados que escolher.',features:['Visões semanais, mensais e anuais','Períodos personalizados','Comparação entre planejado e realizado','Exportação de dados selecionados']},
    instantes:{icon:'📸',eyebrow:'MEMÓRIAS & DIÁRIO',title:'Guarde os momentos que importam.',desc:'Um espaço privado para fotografias, legendas e registros pessoais, com a identidade visual do Aura.',features:['Fotos e legendas personalizadas','Efeitos visuais e textos sobre a imagem','Linha do tempo pessoal','Arquivos privados no Google Drive']},
    configuracoes:{icon:'⚙️',eyebrow:'PREFERÊNCIAS & SEGURANÇA',title:'Seu espaço, do seu jeito.',desc:'Personalize sua experiência, gerencie sua sessão e acompanhe o estado da sincronização.',features:['Preferências por módulo','Sessões e segurança da conta','Unidades, aparência e navegação','Backup, exportação e sincronização']},
  };
  const d=info[tela] ?? info.rotina; return <div className="page-content module-page"><section className="module-hero"><div className="module-hero-copy"><p className="eyebrow">{d.eyebrow}</p><h1>{d.title}</h1><p>{d.desc}</p><span className="planned-badge"><i/> MÓDULO EM IMPLEMENTAÇÃO</span></div><div className="module-icon-art">{d.icon}<span>✦</span></div></section><div className="section-heading"><div><p className="eyebrow">VISÃO DO MÓDULO</p><h2>O que estamos construindo</h2></div></div><section className="feature-grid">{d.features.map((f,i)=><article className="feature-card" key={f}><span className="feature-number">0{i+1}</span><span className="feature-check">✧</span><h3>{f}</h3><p>Planejado para fazer parte da sua experiência pessoal no Aura.</p></article>)}</section><section className="implementation-note"><span>🛠️</span><div><strong>Esta tela é a estrutura inicial do módulo.</strong><p>Os recursos listados ainda não estão conectados a um armazenamento funcional. Eles serão implementados por etapas, sem apresentar dados de demonstração como se fossem registros reais.</p></div></section><div className="module-next-actions"><button className="gold-button" onClick={()=>setTela('corpo')}>Ir para acompanhamento corporal ↗</button><button className="secondary-button" onClick={()=>setTela('inicio')}>Voltar ao painel</button></div></div>;
}


const MODULES: Record<string, { icon: string; eyebrow: string; title: string; desc: string; fields: { key: string; label: string; type?: string; placeholder?: string; options?: string[]; required?: boolean }[]; empty: string }> = {
  medidas: { icon: '📏', eyebrow: 'CORPO & BEM-ESTAR', title: 'Medidas corporais', desc: 'Acompanhe suas medidas ao longo do tempo. Os registros ficam salvos neste dispositivo.', fields: [ {key:'cintura',label:'Cintura (cm)',type:'number'}, {key:'quadril',label:'Quadril (cm)',type:'number'}, {key:'peito',label:'Peito/tórax (cm)',type:'number'}, {key:'braco',label:'Braço (cm)',type:'number'}, {key:'coxa',label:'Coxa (cm)',type:'number'}, {key:'nota',label:'Observações',type:'textarea'} ], empty:'Registre suas primeiras medidas para começar a acompanhar as mudanças.' },
  alimentacao: { icon: '🥗', eyebrow: 'NUTRIÇÃO & CUIDADO', title: 'Alimentação', desc: 'Registre refeições e alimentos consumidos. Comece simples, sem julgamentos.', fields: [{key:'refeicao',label:'Refeição',options:['Café da manhã','Lanche da manhã','Almoço','Lanche da tarde','Jantar','Ceia','Outro'],required:true},{key:'alimentos',label:'O que você comeu?',type:'textarea',required:true,placeholder:'Alimentos e quantidades'},{key:'agua',label:'Água junto da refeição (ml)',type:'number'},{key:'fome',label:'Fome antes da refeição',options:['Baixa','Moderada','Alta']},{key:'nota',label:'Observações',type:'textarea'}], empty:'Suas refeições registradas aparecerão aqui.' },
  treinos: { icon: '🏋️', eyebrow: 'MOVIMENTO & ENERGIA', title: 'Treinos e atividades', desc: 'Registre exercícios, caminhadas e qualquer movimento que queira acompanhar.', fields: [{key:'atividade',label:'Atividade',required:true,placeholder:'Ex.: caminhada, musculação'},{key:'duracao',label:'Duração (minutos)',type:'number'},{key:'distancia',label:'Distância (km)',type:'number'},{key:'intensidade',label:'Intensidade',options:['Leve','Moderada','Intensa']},{key:'nota',label:'Exercícios / observações',type:'textarea'}], empty:'Quando registrar uma atividade, seu histórico aparecerá aqui.' },
  rotina: { icon: '🗓️', eyebrow: 'TEMPO & ORGANIZAÇÃO', title: 'Minha rotina', desc: 'Organize compromissos, tarefas e deslocamentos em um só lugar.', fields: [{key:'atividade',label:'Compromisso ou tarefa',required:true,placeholder:'Ex.: sair para o trabalho'},{key:'inicio',label:'Horário de início',type:'time'},{key:'fim',label:'Horário de término',type:'time'},{key:'categoria',label:'Categoria',options:['Trabalho','Deslocamento','Casa','Pessoal','Saúde','Outro']},{key:'feito',label:'Status',options:['Planejado','Concluído','Adiado']},{key:'nota',label:'Observações',type:'textarea'}], empty:'Adicione um compromisso ou tarefa para organizar seu dia.' },
  sono: { icon: '🌙', eyebrow: 'DESCANSO & RECUPERAÇÃO', title: 'Sono e descanso', desc: 'Registre seu descanso e observe padrões com base no que você informar.', fields: [{key:'deitar',label:'Horário em que foi dormir',type:'time',required:true},{key:'acordar',label:'Horário em que acordou',type:'time',required:true},{key:'qualidade',label:'Como foi o sono?',options:['Muito ruim','Ruim','Regular','Bom','Muito bom']},{key:'despertares',label:'Despertares durante a noite',type:'number'},{key:'nota',label:'Como se sentiu ao acordar?',type:'textarea'}], empty:'Registre uma noite para começar seu diário de sono.' },
  metas: { icon: '🎯', eyebrow: 'INTENÇÃO & PROGRESSO', title: 'Minhas metas', desc: 'Defina objetivos realistas e acompanhe o andamento sem pressão.', fields: [{key:'meta',label:'Qual é a sua meta?',required:true,placeholder:'Ex.: caminhar 3 vezes na semana'},{key:'categoria',label:'Área',options:['Saúde','Corpo','Alimentação','Movimento','Rotina','Estudos','Pessoal','Financeiro','Outra']},{key:'prazo',label:'Data desejada',type:'date'},{key:'progresso',label:'Progresso (%)',type:'number'},{key:'status',label:'Status',options:['Em andamento','Concluída','Pausada']},{key:'nota',label:'Por que isso importa?',type:'textarea'}], empty:'Sua próxima meta pode começar pequena.' },
  instantes: { icon: '📸', eyebrow: 'MEMÓRIAS & DIÁRIO', title: 'Instantes', desc: 'Um diário pessoal para registrar momentos, pensamentos e lembranças. Os textos e fotos ficam neste dispositivo.', fields: [{key:'texto',label:'Frase na foto (aparece curvada no canto)',placeholder:'Ex.: Bom dia'},{key:'titulo',label:'Título (opcional)',placeholder:'Se ficar vazio, usamos a data e a hora'},{key:'humor',label:'Como você está se sentindo?',options:['😊 Feliz','🥰 Grato','😌 Em paz','🤔 Pensativo','😔 Triste','😤 Frustrado','✨ Esperançoso']},{key:'foto',label:'Ou escolher da galeria',type:'file'},{key:'nota',label:'Tags / pessoas / lugar',placeholder:'Ex.: família, casa, domingo'}], empty:'Guarde aqui seu primeiro instante especial.' },
};

// Recorte quadrado central, no máximo 1280 px, em JPEG.
function paraJpeg(fonte: ImageBitmap | HTMLVideoElement, largura: number, altura: number): string {
  const lado = Math.min(largura, altura);
  const saida = Math.round(lado * Math.min(1, 1280 / lado));
  const c = document.createElement('canvas');
  c.width = saida; c.height = saida;
  c.getContext('2d')!.drawImage(fonte, (largura - lado) / 2, (altura - lado) / 2, lado, lado, 0, 0, saida, saida);
  return c.toDataURL('image/jpeg', 0.85);
}

const MAX_FRASE = 24;
// Foto com bordas arredondadas e a frase curvada no canto superior esquerdo.
function InstantFrame({ foto, texto }: { foto: string; texto?: string }) {
  const t = (texto ?? '').trim().toUpperCase();
  const curva = t.length > 0 && t.length <= MAX_FRASE;
  const fs = Math.max(2.8, Math.min(6.5, 48 / (Math.max(1, t.length) * 0.75)));
  return <div className="instant-frame">
    <img src={foto} alt="Foto do instante" />
    {curva && <svg viewBox="0 0 100 100" className="instant-text" role="img" aria-label={`Frase: ${t}`}>
      <defs><path id="arco-instante" d="M 9,42 A 33,33 0 0 1 42,9" /></defs>
      <text style={{ fontSize: fs, letterSpacing: fs * 0.13 }}><textPath href="#arco-instante" startOffset="50%" textAnchor="middle">{t}</textPath></text>
    </svg>}
  </div>;
}

function CameraModal({ aoCapturar, aoFechar }: { aoCapturar: (dataUrl: string) => void; aoFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const [lado, setLado] = useState<'environment' | 'user'>('environment');
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setErro('Este navegador não abre a câmera aqui. Use “Ou escolher da galeria”.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: lado }, audio: false });
        if (!vivo) { s.getTracks().forEach(t => t.stop()); return; }
        fluxo.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play(); }
      } catch { setErro('Não foi possível acessar a câmera. Permita o acesso no navegador ou use a galeria.'); }
    })();
    return () => { vivo = false; fluxo.current?.getTracks().forEach(t => t.stop()); };
  }, [lado]);
  function capturar() { const v = video.current; if (v && v.videoWidth) aoCapturar(paraJpeg(v, v.videoWidth, v.videoHeight)); }
  return <div className="camera-overlay" role="dialog" aria-label="Câmera">
    <div className="camera-frame"><video ref={video} playsInline muted /></div>
    {erro && <p className="error-message" role="alert">{erro}</p>}
    <div className="camera-actions">
      <button type="button" onClick={aoFechar}>Cancelar</button>
      <button type="button" className="gold-button" onClick={capturar} disabled={!!erro}>📷 Capturar</button>
      <button type="button" onClick={() => setLado(l => l === 'environment' ? 'user' : 'environment')}>🔄 Virar</button>
    </div>
  </div>;
}

function FunctionalModulePage({ tela, setTela, onToast }: { tela: Tela; setTela: (t: Tela) => void; onToast: (s: string) => void }) {
  const [itens, setItens] = useState<RegistroLocal[]>([]);
  const [abrir, setAbrir] = useState(false);
  const [valores, setValores] = useState<Record<string,string>>({});
  const [foto, setFoto] = useState('');
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [camera, setCamera] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const cfg = MODULES[tela] ?? (tela === 'relatorios' ? null : null);
  const carregar = useCallback(async () => { setItens(await registros.todos(tela)); }, [tela]);
  useEffect(() => { void carregar(); setAbrir(false); setValores({}); setFoto(''); setEditando(null); }, [carregar]);

  if (tela === 'rotina') return <DailyRoutine setTela={setTela} onToast={onToast} />;
  if (tela === 'relatorios') return <ReportsPage setTela={setTela} />;
  if (tela === 'configuracoes') return <SettingsPage onToast={onToast} />;
  if (!cfg) return <div className="page-content"><h1>Tela indisponível</h1><button className="gold-button" onClick={() => setTela('inicio')}>Voltar ao início</button></div>;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const campoObrigatorio = cfg!.fields.find(f => f.required && !valores[f.key]?.trim() && !(f.key === 'foto' && foto));
    if (campoObrigatorio) { setErro(`Preencha o campo “${campoObrigatorio.label}”.`); return; }
    if (tela === 'instantes' && !foto && !valores.texto?.trim()) { setErro('Tire uma foto ou escreva uma frase.'); return; }
    setErro('');
    const agora = new Date().toISOString();
    const item: RegistroLocal = { id: editando ?? crypto.randomUUID(), modulo: tela, titulo: valores.titulo || valores.meta || valores.atividade || valores.refeicao || (tela === 'sono' && valores.deitar && valores.acordar ? `Sono ${valores.deitar}–${valores.acordar}` : tela === 'instantes' ? `Instante ${new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}` : cfg!.title), data: valores.data || agora, detalhes: { ...valores, ...(foto ? {foto} : {}) }, criado_em: agora };
    await registros.salvar(item); await carregar(); setValores({}); setFoto(''); setEditando(null); setAbrir(false); onToast('Registro salvo neste dispositivo ✦');
  }
  async function excluir(id: string) { if (!window.confirm('Excluir este registro? Esta ação não pode ser desfeita.')) return; await registros.remover(id); await carregar(); onToast('Registro excluído.'); }
  function editar(item: RegistroLocal) { setEditando(item.id); setValores({...item.detalhes}); setFoto(item.detalhes.foto || ''); setAbrir(true); window.scrollTo({top:0,behavior:'smooth'}); }
  async function lidarFoto(file?: File) { if (!file) return; if (!file.type.startsWith('image/')) {setErro('Escolha um arquivo de imagem.');return;} try { const b = await createImageBitmap(file); setFoto(paraJpeg(b, b.width, b.height)); setErro(''); } catch { setErro('Não foi possível ler esta imagem.'); } }
  const visiveis = itens.filter(i => `${i.titulo} ${Object.values(i.detalhes).join(' ')}`.toLowerCase().includes(busca.toLowerCase()));
  return <div className="page-content">
    {camera && <CameraModal aoCapturar={(url) => { setFoto(url); setCamera(false); setAbrir(true); setErro(''); }} aoFechar={() => setCamera(false)} />}<section className="page-title-row"><div><p className="eyebrow">{cfg.eyebrow}</p><h1>{cfg.title}<em>.</em></h1><p className="subtitle">{cfg.desc}</p></div>{tela === 'instantes' ? <button className="gold-button" onClick={() => {setEditando(null);setValores({});setFoto('');setErro('');setAbrir(true);setCamera(true);}}>📷 Registrar</button> : <button className="gold-button" onClick={() => {setAbrir(!abrir);setEditando(null);setValores({});setFoto('');setErro('');}}>＋ Novo registro</button>}</section>
    {tela === 'medidas' && <div className="module-mini-stats"><article><span>📐</span><small>Registros</small><strong>{itens.length}</strong></article><article><span>🗓️</span><small>Última atualização</small><strong>{itens[0] ? new Date(itens[0].data).toLocaleDateString('pt-BR') : '—'}</strong></article></div>}
    {abrir && <form className="panel record-form functional-form" onSubmit={salvar}><div className="panel-heading"><div><p className="eyebrow">{editando ? 'EDITAR REGISTRO' : 'NOVO REGISTRO'}</p><h3>{editando ? 'Atualize as informações' : 'Preencha os detalhes'}</h3></div><button type="button" className="close-button" onClick={() => {setAbrir(false);setEditando(null);}}>×</button></div><div className="fields-grid">{cfg.fields.map(f => <label key={f.key} className={f.type === 'textarea' ? 'field-wide' : ''}>{f.label}{f.type === 'textarea' ? <textarea rows={3} placeholder={f.placeholder} value={valores[f.key] || ''} onChange={e=>setValores({...valores,[f.key]:e.target.value})}/> : f.type === 'file' ? <input type="file" accept="image/*" onChange={e=>void lidarFoto(e.target.files?.[0])}/> : f.options ? <select value={valores[f.key] || ''} onChange={e=>setValores({...valores,[f.key]:e.target.value})}><option value="">Selecione…</option>{f.options.map(o=><option key={o}>{o}</option>)}</select> : <input type={f.type || 'text'} required={f.required} maxLength={tela==='instantes'&&f.key==='texto'?MAX_FRASE:undefined} placeholder={f.placeholder} value={valores[f.key] || ''} onChange={e=>setValores({...valores,[f.key]:e.target.value})}/>}</label>)}</div>{tela === 'instantes' && <div className="camera-row"><button type="button" className="secondary-button" onClick={() => setCamera(true)}>📷 {foto ? 'Tirar outra foto' : 'Abrir câmera'}</button></div>}{foto && tela === 'instantes' && <div className="photo-preview"><InstantFrame foto={foto} texto={valores.texto} /><button type="button" className="secondary-button" onClick={()=>setFoto('')}>Remover foto</button></div>}{erro && <p className="error-message">{erro}</p>}<div className="form-actions"><span>💾 Salvo localmente neste dispositivo</span><button className="gold-button" type="submit">{editando ? 'Salvar alterações' : 'Salvar registro'} ✦</button></div></form>}
    <section className="panel history-panel"><div className="panel-heading"><div><p className="eyebrow">SEU HISTÓRICO</p><h3>Registros <span className="count-pill">{itens.length}</span></h3></div><input className="search-input" placeholder="Buscar registros…" value={busca} onChange={e=>setBusca(e.target.value)}/></div>
    {visiveis.length === 0 ? <div className="empty-state"><span>{cfg.icon}</span><h3>{busca ? 'Nenhum resultado encontrado' : 'Tudo começa com o primeiro registro'}</h3><p>{busca ? 'Tente buscar por outro termo.' : cfg.empty}</p>{!busca && <button className="gold-button" onClick={()=>setAbrir(true)}>＋ Adicionar agora</button>}</div> : <div className="record-cards">{visiveis.map(item=><article className="saved-record" key={item.id}>{item.detalhes.foto && tela==='instantes' && <InstantFrame foto={item.detalhes.foto} texto={item.detalhes.texto} />}{tela==='instantes'&&item.detalhes.texto&&(!item.detalhes.foto||item.detalhes.texto.length>MAX_FRASE)&&<p className="insta-caption">{item.detalhes.texto}</p>}<div className="saved-record-top"><div><span className="record-date">{new Date(item.data).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'})}</span><h4>{item.titulo}</h4>{tela==='sono'&&duracaoSono(item.detalhes.deitar,item.detalhes.acordar)!==null&&<span className="record-date">⏱ Deitar → acordar: {formatarDur(duracaoSono(item.detalhes.deitar,item.detalhes.acordar)!)}</span>}</div><div className="record-actions"><button aria-label="Editar registro" onClick={()=>editar(item)}>✎</button><button aria-label="Excluir registro" onClick={()=>void excluir(item.id)}>×</button></div></div><div className="record-detail-grid">{cfg.fields.filter(f=>f.type!=='file' && item.detalhes[f.key] && !(tela==='instantes'&&f.key==='texto')).map(f=><div key={f.key}><small>{f.label}</small><p>{item.detalhes[f.key]}</p></div>)}</div></article>)}</div>}</section>
  </div>;
}

function ReportsPage({setTela}:{setTela:(t:Tela)=>void}) {
 const [dados,setDados]=useState<Record<string,RegistroLocal[]>>({});
 useEffect(()=>{void Promise.all(['medidas','alimentacao','treinos','rotina','sono','metas','instantes'].map(async m=>[m,await registros.todos(m)] as const)).then(p=>setDados(Object.fromEntries(p)));},[]);
 const nomes:Record<string,string>={medidas:'Medidas',alimentacao:'Refeições',treinos:'Atividades',rotina:'Tarefas',sono:'Registros de sono',metas:'Metas',instantes:'Instantes'};
 return <div className="page-content"><section className="page-title-row"><div><p className="eyebrow">DADOS & DESCOBERTAS</p><h1>Seus relatórios<em>.</em></h1><p className="subtitle">Um resumo baseado nos registros que você realmente salvou.</p></div><button className="gold-button" onClick={()=>{const blob=new Blob([JSON.stringify({exportado_em:new Date().toISOString(),dados},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`aura-relatorio-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}}>↓ Exportar dados</button></section><section className="report-grid">{Object.entries(nomes).map(([k,n])=><article className="report-card" key={k}><span>{({'medidas':'📏','alimentacao':'🥗','treinos':'🏋️','rotina':'🗓️','sono':'🌙','metas':'🎯','instantes':'📸'} as Record<string,string>)[k]}</span><small>{n}</small><strong>{dados[k]?.length ?? '…'}</strong><button className="text-button" onClick={()=>setTela(k as Tela)}>Abrir módulo →</button></article>)}</section><div className="implementation-note"><span>📊</span><div><strong>Relatório fiel aos dados disponíveis</strong><p>As contagens refletem os registros locais salvos neste dispositivo. O peso continua disponível na tela Meu corpo. Nenhum dado é inventado para preencher gráficos.</p></div></div></div>;
}
function ImportarPlanilha({onToast}:{onToast:(s:string)=>void}) {
 const [arquivo,setArquivo]=useState<File|null>(null); const [planilhas,setPlanilhas]=useState<Planilha[]>([]); const [erro,setErro]=useState(''); const [lendo,setLendo]=useState(false); const [importando,setImportando]=useState(false); const [resumo,setResumo]=useState('');
 async function selecionar(file?:File){ if(!file)return; setArquivo(file);setErro('');setResumo('');setPlanilhas([]);setLendo(true);try{const ext=file.name.toLowerCase().split('.').pop();const sheets=ext==='csv'?lerCsv(await file.text()):ext==='xlsx'?await lerXlsx(file):null;if(!sheets)throw new Error('Formato não suportado. Escolha um arquivo .xlsx ou .csv.');setPlanilhas(sheets);const linhas=sheets.reduce((n,s)=>n+s.linhas.length,0);setResumo(`Arquivo lido: ${sheets.length} aba(s), ${linhas} linha(s) de dados. Confira antes de importar.`);}catch(e){setErro(e instanceof Error?e.message:'Não foi possível ler o arquivo.');}finally{setLendo(false);}}
 function normalizar(s:string){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
 function dataISO(v:string):string { if(!v)return new Date().toISOString(); const n=Number(v); if(Number.isFinite(n)&&n>20000&&n<80000)return new Date(Date.UTC(1899,11,30)+n*86400000).toISOString(); const br=v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if(br)return new Date(Date.UTC(Number(br[3]),Number(br[2])-1,Number(br[1]),12)).toISOString(); const d=new Date(v);return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString(); }
 function valor(row:string[],headers:string[],...keys:string[]){const idx=headers.findIndex(h=>keys.includes(normalizar(h)));return idx>=0?(row[idx]||'').trim():'';}
 async function importar(){if(!planilhas.length)return;setImportando(true);setErro('');let pesoCount=0,regCount=0,ignoradas=0;try{
  for(const sheet of planilhas){const sn=normalizar(sheet.nome);let modulo='';if(sn==='peso'||sn.includes('peso'))modulo='peso';else if(sn.includes('medida'))modulo='medidas';else if(sn.includes('alimentacao'))modulo='alimentacao';else if(sn.includes('hidratacao')||sn==='agua')modulo='alimentacao';else if(sn.includes('treino'))modulo='treinos';else if(sn.includes('sono'))modulo='sono';else if(sn.includes('rotina'))modulo='rotina';else if(sn.includes('meta'))modulo='metas';else if(sn.includes('instante'))modulo='instantes';else {ignoradas+=sheet.linhas.length;continue;}
   for(const row of sheet.linhas){const headers=sheet.cabecalho;const data=dataISO(valor(row,headers,'data','datainicio'));if(modulo==='peso'){const kg=valor(row,headers,'peso kg','pesokg','peso');const peso=Number(kg.replace(',','.'));if(!Number.isFinite(peso)||peso<=0){ignoradas++;continue;}const hora=valor(row,headers,'hora')||'12:00';const occurred=new Date(`${data.slice(0,10)}T${hora.length===5?hora+':00':hora}Z`);const iso=Number.isNaN(occurred.getTime())?data:occurred.toISOString();await pesos.put({id:`import-${crypto.randomUUID()}`,ocorreu_em:iso,peso_kg:String(peso),nota:valor(row,headers,'observacoes','observacao','nota')||'Importado de planilha para teste',estado:'local'});pesoCount++;continue;}
    const detalhes:Record<string,string>={};headers.forEach((h,i)=>{if(h&&row[i]?.trim())detalhes[h]=row[i].trim();});let titulo=valor(row,headers,'refeicao','atividade','tarefa','meta','titulo','titulo do instante','categoria')||sheet.nome;if(modulo==='alimentacao'&&sn.includes('hidratacao'))titulo='Hidratação diária';await registros.salvar({id:`import-${crypto.randomUUID()}`,modulo,titulo,data,detalhes,criado_em:new Date().toISOString()});regCount++;
   }
  }
  const msg=`Importação concluída: ${pesoCount} registro(s) de peso e ${regCount} registro(s) nos módulos. ${ignoradas} linha(s) ignorada(s). Os dados foram salvos somente neste navegador e não serão enviados ao Google Sheets automaticamente.`;setResumo(msg);onToast('Planilha importada para teste ✦');
 }catch(e){setErro(e instanceof Error?e.message:'Falha durante a importação.');}finally{setImportando(false);}}
 return <article className="panel settings-card import-card"><p className="eyebrow">IMPORTAÇÃO DE HISTÓRICO</p><h3>Importar dados de uma planilha</h3><p>Envie um arquivo Excel (.xlsx) ou CSV. O Aura identifica as abas conhecidas e grava os registros neste navegador, sem sincronizar os dados de teste com sua conta.</p><label className="upload-drop"><span>📥</span><strong>{arquivo?arquivo.name:'Escolher arquivo de planilha'}</strong><small>{lendo?'Lendo arquivo…':'Aceita .xlsx e .csv · mantenha os cabeçalhos da planilha de modelo'}</small><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>void selecionar(e.target.files?.[0])}/></label>{erro&&<p className="error-message" role="alert">{erro}</p>}{resumo&&<p className="import-summary" role="status">{resumo}</p>}{planilhas.length>0&&<><div className="import-preview"><strong>Prévia do arquivo</strong>{planilhas.map(p=><div key={p.nome}><span>{p.nome}</span><small>{p.linhas.length} linha(s) · {p.cabecalho.length} coluna(s)</small></div>)}</div><button className="gold-button" disabled={lendo||importando} onClick={()=>void importar()}>{importando?'Importando…':'Importar dados para o Aura'}</button><p className="import-warning">⚠️ A importação adiciona registros; não apaga os existentes. Se importar o mesmo arquivo mais de uma vez, os dados serão duplicados. Use preferencialmente no Aura Teste.</p></>}</article>;
}

function SettingsPage({onToast}:{onToast:(s:string)=>void}) {
 const [nome,setNome]=useState(localStorage.getItem('aura_nome')||'Meu espaço'); const [unidade,setUnidade]=useState(localStorage.getItem('aura_unidade')||'kg'); const [tema,setTema]=useState(localStorage.getItem('aura_tema')||'escuro');
 function salvar(){localStorage.setItem('aura_nome',nome);localStorage.setItem('aura_unidade',unidade);localStorage.setItem('aura_tema',tema);document.documentElement.dataset.theme=tema;onToast('Preferências salvas neste dispositivo ✦');}
 async function exportar(){const dados={exportado_em:new Date().toISOString(),pesos:await pesos.todos(),registros:await registros.todos()};const blob=new Blob([JSON.stringify(dados,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`aura-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);onToast('Backup exportado. Guarde o arquivo em local seguro.');}
 return <div className="page-content"><section className="page-title-row"><div><p className="eyebrow">PREFERÊNCIAS</p><h1>Configurações<em>.</em></h1><p className="subtitle">Ajuste sua experiência. Senha e bloqueio ficam para uma etapa futura, como você pediu.</p></div></section><section className="settings-grid"><form className="panel settings-card" onSubmit={e=>{e.preventDefault();salvar();}}><p className="eyebrow">PERSONALIZAÇÃO</p><h3>Seu espaço, do seu jeito</h3><label>Nome exibido<input value={nome} onChange={e=>setNome(e.target.value)}/></label><label>Unidade de peso<select value={unidade} onChange={e=>setUnidade(e.target.value)}><option value="kg">Quilogramas (kg)</option><option value="lb">Libras (lb) — visual apenas</option></select></label><label>Aparência<select value={tema} onChange={e=>setTema(e.target.value)}><option value="escuro">Escuro — Aura original</option><option value="mais-escuro">Noturno profundo</option></select></label><button className="gold-button" type="submit">Salvar preferências</button></form><article className="panel settings-card"><p className="eyebrow">DADOS & PRIVACIDADE</p><h3>Backup e armazenamento</h3><p>Seus novos módulos são salvos localmente neste navegador/dispositivo. O backup exporta registros em arquivo JSON.</p><button className="gold-button" onClick={()=>void exportar()}>↓ Exportar backup completo</button><div className="implementation-note"><span>ℹ️</span><div><strong>Sobre a sincronização</strong><p>O peso usa a integração existente com Google Apps Script. Os outros módulos estão salvos localmente e ainda não sincronizam com a planilha. Não limpe os dados do navegador sem exportar um backup.</p></div></div></article><ImportarPlanilha onToast={onToast}/></section></div>;
}
