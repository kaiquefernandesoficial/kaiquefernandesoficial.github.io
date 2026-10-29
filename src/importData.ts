export type Planilha = { nome: string; cabecalho: string[]; linhas: string[][] };

function decodificar(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflarRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw' as CompressionFormat);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function lerZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Não consegui ler o arquivo .xlsx. Tente salvar novamente pelo Excel ou Google Planilhas.');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const arquivos = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const metodo = view.getUint16(offset + 10, true);
    const comprimido = view.getUint32(offset + 20, true);
    const nomeLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const comentarioLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nome = decodificar(bytes.slice(offset + 46, offset + 46 + nomeLen));
    const localNomeLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const inicio = localOffset + 30 + localNomeLen + localExtraLen;
    const conteudo = bytes.slice(inicio, inicio + comprimido);
    if (metodo === 0) arquivos.set(nome, conteudo);
    else if (metodo === 8) arquivos.set(nome, await inflarRaw(conteudo));
    offset += 46 + nomeLen + extraLen + comentarioLen;
  }
  return arquivos;
}

function textoXml(xml: string): Document { return new DOMParser().parseFromString(xml, 'application/xml'); }
function colIndex(ref: string): number { const letras = ref.match(/^[A-Z]+/)?.[0] || 'A'; return [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1; }

export async function lerXlsx(file: File): Promise<Planilha[]> {
  const files = await lerZip(await file.arrayBuffer());
  const workbookRaw = files.get('xl/workbook.xml');
  const relRaw = files.get('xl/_rels/workbook.xml.rels');
  if (!workbookRaw || !relRaw) throw new Error('O arquivo não parece ser uma planilha Excel válida.');
  const workbook = textoXml(decodificar(workbookRaw));
  const rels = textoXml(decodificar(relRaw));
  const caminhos = new Map<string, string>();
  rels.querySelectorAll('Relationship').forEach(r => caminhos.set(r.getAttribute('Id') || '', r.getAttribute('Target') || ''));
  const sharedRaw = files.get('xl/sharedStrings.xml');
  const shared = sharedRaw ? [...textoXml(decodificar(sharedRaw)).querySelectorAll('si')].map(si => [...si.querySelectorAll('t')].map(t => t.textContent || '').join('')) : [];
  const sheets: Planilha[] = [];
  for (const sheet of [...workbook.querySelectorAll('sheets > sheet')]) {
    const nome = sheet.getAttribute('name') || 'Planilha';
    const id = sheet.getAttribute('r:id') || '';
    let target = caminhos.get(id) || '';
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = `xl/${target}`;
    const raw = files.get(target);
    if (!raw) continue;
    const doc = textoXml(decodificar(raw));
    const linhas: string[][] = [];
    for (const row of [...doc.querySelectorAll('sheetData > row')]) {
      const cells: string[] = [];
      for (const cell of [...row.querySelectorAll(':scope > c')]) {
        const idx = colIndex(cell.getAttribute('r') || 'A1');
        let value = cell.querySelector('v')?.textContent || '';
        if (cell.getAttribute('t') === 's') value = shared[Number(value)] || '';
        else if (cell.getAttribute('t') === 'inlineStr') value = [...cell.querySelectorAll('is t')].map(t => t.textContent || '').join('');
        cells[idx] = value;
      }
      linhas.push(cells.map(v => v || ''));
    }
    const first = linhas.findIndex(r => r.some(v => v.trim() !== ''));
    if (first >= 0) sheets.push({ nome, cabecalho: linhas[first].map(v => v.trim()), linhas: linhas.slice(first + 1).filter(r => r.some(v => v.trim() !== '')) });
  }
  return sheets;
}

export function lerCsv(text: string): Planilha[] {
  const primeira = text.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas: string[][] = [];
  let linha: string[] = [], campo = '', aspas = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i + 1] === '"' && aspas) { campo += '"'; i++; }
    else if (c === '"') aspas = !aspas;
    else if (c === sep && !aspas) { linha.push(campo); campo = ''; }
    else if ((c === '\n' || c === '\r') && !aspas) { if (c === '\r' && text[i + 1] === '\n') i++; linha.push(campo); if (linha.some(x => x.trim())) linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); if (linha.some(x => x.trim())) linhas.push(linha); }
  if (linhas.length < 2) throw new Error('O CSV não contém cabeçalho e linhas de dados.');
  return [{ nome: 'CSV', cabecalho: linhas[0].map(x => x.trim()), linhas: linhas.slice(1) }];
}
