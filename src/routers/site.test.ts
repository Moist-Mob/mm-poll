import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import express from 'express';
import bodyParser from 'body-parser';

import { parseKanoAnswers } from './site.js';

// the kano ballot travels as application/x-www-form-urlencoded and is parsed
// by qs (bodyParser.urlencoded extended); make sure the field naming survives
// the round trip through the same parser the app uses
describe('parseKanoAnswers', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(bodyParser.urlencoded({ extended: true }));
    app.post('/', (req, res) => {
      try {
        res.json({ ok: parseKanoAnswers(req.body.answers) });
      } catch (e) {
        res.json({ error: String(e) });
      }
    });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const post = async (form: string): Promise<{ ok?: unknown; error?: string }> => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    return res.json();
  };

  it('parses the posted form, including option ids past the qs array limit', async () => {
    const res = await post('answers[o1][f]=1&answers[o1][d]=5&answers[o41][f]=2&answers[o41][d]=3');
    expect(res.ok).toEqual([
      { option_id: 1, functional: 1, dysfunctional: 5 },
      { option_id: 41, functional: 2, dysfunctional: 3 },
    ]);
  });

  it('rejects unprefixed numeric keys (qs turns them into an array)', async () => {
    expect((await post('answers[1][f]=1&answers[1][d]=5')).error).toBeDefined();
  });

  it('rejects a feature missing one of the two answers', async () => {
    expect((await post('answers[o1][f]=1')).error).toBeDefined();
  });

  it('rejects unexpected keys, non-numeric values, and a missing body', async () => {
    expect((await post('answers[x1][f]=1&answers[x1][d]=5')).error).toBeDefined();
    expect((await post('answers[o1][f]=a&answers[o1][d]=5')).error).toBeDefined();
    expect((await post('poll_id=1')).error).toBeDefined();
  });
});
