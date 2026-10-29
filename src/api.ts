import { API_URL } from './config';

export type RespostaApi = {
  ok: boolean; erro?: string; usuario?: string; sessao?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registros?: any[]; agora?: string; arquivo?: string; dataUrl?: string;
};

// text/plain evita o pré-voo CORS, que o Apps Script não responde.
export async function chamarApi(corpo: Record<string, unknown>): Promise<RespostaApi> {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(corpo),
  });
  return r.json();
}
