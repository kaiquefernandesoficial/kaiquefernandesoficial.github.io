// Armazenamento local persistente (IndexedDB), sem dependências.
function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open('aura', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
      if (!r.result.objectStoreNames.contains('fila')) r.result.createObjectStore('fila', { keyPath: 'op_id' });
      if (!r.result.objectStoreNames.contains('pesos')) r.result.createObjectStore('pesos', { keyPath: 'id' });
      if (!r.result.objectStoreNames.contains('registros')) r.result.createObjectStore('registros', { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function op<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const req = fn(db.transaction(loja, modo).objectStore(loja));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

export const kv = {
  get: (k: string) => op<string | undefined>('kv', 'readonly', (s) => s.get(k)),
  set: (k: string, v: string) => op('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k: string) => op('kv', 'readwrite', (s) => s.delete(k)),
};

export type Estado = 'pendente' | 'sincronizado' | 'erro' | 'local';
export type Peso = { id: string; ocorreu_em: string; peso_kg: string; nota: string; estado: Estado };
export type OpFila = { op_id: string; acao: 'peso_registrar' | 'peso_editar' | 'registro_salvar' | 'registro_excluir'; id?: string; ocorreu_em?: string; peso_kg?: string; nota?: string; registro?: RegistroLocal };

export const fila = {
  todas: () => op<OpFila[]>('fila', 'readonly', (s) => s.getAll()),
  add: (o: OpFila) => op('fila', 'readwrite', (s) => s.put(o)),
  remover: (id: string) => op('fila', 'readwrite', (s) => s.delete(id)),
};

export const pesos = {
  todos: () => op<Peso[]>('pesos', 'readonly', (s) => s.getAll()),
  put: (p: Peso) => op('pesos', 'readwrite', (s) => s.put(p)),
};


export type RegistroLocal = { id: string; modulo: string; titulo: string; data: string; detalhes: Record<string, string>; criado_em: string };
export const registros = {
  todos: async (modulo?: string): Promise<RegistroLocal[]> => {
    const itens = await op<RegistroLocal[]>('registros', 'readonly', (s) => s.getAll());
    return itens.filter((x) => !modulo || x.modulo === modulo).sort((a,b) => b.data.localeCompare(a.data));
  },
  salvarLocal: (r: RegistroLocal) => op('registros', 'readwrite', (s) => s.put(r)),
  removerLocal: (id: string) => op('registros', 'readwrite', (s) => s.delete(id)),
  // salvar/remover também entram na fila de sincronização (dados importados de teste ficam só locais)
  salvar: async (r: RegistroLocal) => { await registros.salvarLocal(r); if (!r.id.startsWith('import-')) await fila.add({ op_id: `reg-${r.id}`, acao: 'registro_salvar', registro: r }); },
  remover: async (id: string) => { await registros.removerLocal(id); if (!id.startsWith('import-')) await fila.add({ op_id: `reg-${id}`, acao: 'registro_excluir', id }); },
};
