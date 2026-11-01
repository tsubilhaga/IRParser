import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openRouter = vi.fn();

function request(body: string, origin: string | null = 'https://irparser.test') {
  const headers: Record<string, string> = { host: 'irparser.test' };
  if (origin) headers.origin = origin;
  return new NextRequest('https://irparser.test/api/ai-extract', { method: 'POST', body, headers });
}

const send = (text: unknown = 'informe', origin?: string | null) =>
  import('./route').then(({ POST }) => POST(request(JSON.stringify({ text }), origin)));

const modelReplies = (content: string) =>
  openRouter.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('OPENROUTER_API_KEY', 'chave-secreta');
  vi.stubEnv('OPENROUTER_MODEL', 'vendor/model');
  vi.stubGlobal('fetch', openRouter);
  openRouter.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/ai-extract', () => {
  it.each([
    ['bloco json', '```json\n{"results":{}}\n```'],
    ['bloco sem linguagem', '```\n{"results":{}}\n```'],
    ['texto antes', 'Aqui:\n```json\n{"results":{}}\n```'],
    ['raciocínio antes', '<think>{rascunho}</think>\n```json\n{"results":{}}\n```'],
    ['fim colado', '```json\n{"results":{}}```'],
    ['json puro', '{"results":{}}'],
  ])('interpreta resposta com %s', async (_label, content) => {
    modelReplies(content);
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: {} });
  });

  it('usa o modelo configurado', async () => {
    modelReplies('{"results":{}}');
    await send();
    expect(JSON.parse(openRouter.mock.calls[0][1].body).model).toBe('vendor/model');
  });

  it('exige modelo configurado', async () => {
    vi.stubEnv('OPENROUTER_MODEL', '');
    const response = await send();
    expect(response.status).toBe(500);
    expect(openRouter).not.toHaveBeenCalled();
  });

  it('informa falha do provedor sem repassar a resposta dele', async () => {
    openRouter.mockResolvedValue(new Response('{"segredo":1}', { status: 404 }));
    const response = await send();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain('404');
  });

  it('devolve erro quando a IA não responde JSON', async () => {
    modelReplies('não sei');
    const response = await send();
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.raw).toBeUndefined();
  });

  it('recusa texto grande demais', async () => {
    const response = await send('x'.repeat(200_001));
    expect(response.status).toBe(413);
    expect(openRouter).not.toHaveBeenCalled();
  });

  it('recusa corpo inválido', async () => {
    const { POST } = await import('./route');
    expect((await POST(request('{'))).status).toBe(400);
  });

  it.each([[''], ['   '], [123]])('recusa texto vazio ou inválido: %j', async (text) => {
    expect((await send(text)).status).toBe(400);
  });

  it.each([['https://outro.site'], [null]])('recusa origem %j', async (origin) => {
    expect((await send('informe', origin)).status).toBe(403);
    expect(openRouter).not.toHaveBeenCalled();
  });
});
