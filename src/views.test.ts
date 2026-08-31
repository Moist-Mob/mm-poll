// @vitest-environment happy-dom

import { KANO_SCALE } from './kano.js';
import { formEntries, renderPage, text, trySubmit } from './testing/dom.js';

const base = { user: { login: 'someone' }, admin: true, localId: 'csrf-token-value', title: 't' };

describe('ranked-choice ballot (poll-cast)', () => {
  const poll = {
    poll_id: 3,
    kind: 'irv',
    open: true,
    title: 'Next game',
    options: [
      { option_id: 11, name: 'Alpha' },
      { option_id: 22, name: 'Beta' },
      { option_id: 33, name: 'Gamma' },
    ],
  };

  const form = () => document.getElementById('submit-vote') as HTMLFormElement;
  const rows = () => Array.from(document.querySelectorAll<HTMLLIElement>('#ballot li.row'));
  const row = (name: string) => rows().find(li => text(li.querySelector('.name')) === name)!;
  const tap = (name: string) => row(name).querySelector<HTMLButtonElement>('button.pick')!.click();
  const up = (name: string) => row(name).querySelector<HTMLButtonElement>('button.up')!;
  const down = (name: string) => row(name).querySelector<HTMLButtonElement>('button.down')!;
  const divider = () => text(document.querySelector('#ballot .divider'));
  // names in DOM order, with a marker for the divider
  const order = () =>
    Array.from(document.querySelectorAll('#ballot > li')).map(li =>
      li.classList.contains('divider') ? '---' : text(li.querySelector('.name'))
    );
  const badge = (name: string) => text(row(name).querySelector('.badge'));
  const ranks = () => formEntries(form()).filter(([k]) => k.startsWith('ranks['));

  beforeEach(async () => {
    vi.stubGlobal('alert', vi.fn());
    await renderPage('poll-cast', { ...base, remaining: '1 hour', poll });
  });

  it('starts with nothing ranked and refuses an empty ballot', () => {
    expect(order()).toEqual(['---', 'Alpha', 'Beta', 'Gamma']);
    expect(divider()).toMatch(/Tap your favourite/);
    expect(rows().every(li => !li.classList.contains('chosen'))).toBe(true);

    expect(trySubmit(form())).toBe(false);
    expect(alert).toHaveBeenCalledWith('Rank at least one option!');
    expect(ranks()).toEqual([]);
  });

  it('tapping ranks items in tap order and submits them as ranks[i]', () => {
    tap('Beta');
    tap('Alpha');
    expect(order()).toEqual(['Beta', 'Alpha', '---', 'Gamma']);
    expect(badge('Beta')).toEqual('1');
    expect(badge('Alpha')).toEqual('2');
    expect(badge('Gamma')).toEqual('');
    expect(row('Beta').querySelector('button.pick')!.getAttribute('aria-pressed')).toEqual('true');
    expect(divider()).toMatch(/^2 ranked/);

    expect(trySubmit(form())).toBe(true);
    expect(ranks()).toEqual([
      ['ranks[0]', '22'],
      ['ranks[1]', '11'],
    ]);
    // the rest of the submission is intact
    expect(formEntries(form())).toEqual(
      expect.arrayContaining([
        ['csrf-token', 'csrf-token-value'],
        ['poll_id', '3'],
      ])
    );
  });

  it('tapping a ranked item removes it, parks it just below the line, and renumbers', () => {
    tap('Alpha');
    tap('Beta');
    tap('Gamma');
    tap('Alpha');
    expect(order()).toEqual(['Beta', 'Gamma', '---', 'Alpha']);
    expect(badge('Beta')).toEqual('1');
    expect(badge('Gamma')).toEqual('2');
    expect(badge('Alpha')).toEqual('');
    expect(row('Alpha').querySelector('button.pick')!.getAttribute('aria-pressed')).toEqual('false');

    trySubmit(form());
    expect(ranks()).toEqual([
      ['ranks[0]', '22'],
      ['ranks[1]', '33'],
    ]);
  });

  it('arrows nudge within the ranked section only and are disabled at the ends', () => {
    tap('Alpha');
    tap('Beta');
    tap('Gamma');
    expect(up('Alpha').disabled).toBe(true);
    expect(down('Alpha').disabled).toBe(false);
    expect(down('Gamma').disabled).toBe(true);

    up('Gamma').click();
    expect(order()).toEqual(['Alpha', 'Gamma', 'Beta', '---']);
    down('Alpha').click();
    expect(order()).toEqual(['Gamma', 'Alpha', 'Beta', '---']);
    expect(badge('Gamma')).toEqual('1');
    expect(badge('Alpha')).toEqual('2');
    expect(badge('Beta')).toEqual('3');
    expect(up('Gamma').disabled).toBe(true);
    expect(down('Beta').disabled).toBe(true);

    // arrows never toggle the row
    expect(rows().filter(li => li.classList.contains('chosen'))).toHaveLength(3);

    trySubmit(form());
    expect(ranks()).toEqual([
      ['ranks[0]', '33'],
      ['ranks[1]', '11'],
      ['ranks[2]', '22'],
    ]);
  });

  it('says so when everything is ranked', () => {
    tap('Alpha');
    tap('Beta');
    tap('Gamma');
    expect(divider()).toMatch(/^All 3 ranked/);
  });

  it('re-submitting after changes never leaves stale rank inputs behind', () => {
    tap('Alpha');
    tap('Beta');
    trySubmit(form());
    expect(ranks()).toHaveLength(2);
    tap('Beta');
    trySubmit(form());
    expect(ranks()).toEqual([['ranks[0]', '11']]);
  });
});

describe('kano ballot (kano-cast)', () => {
  const poll = {
    poll_id: 5,
    kind: 'kano',
    open: true,
    title: 'Segments',
    options: [
      { option_id: 7, name: 'Music' },
      { option_id: 41, name: 'Q&A' },
    ],
  };
  const form = () => document.getElementById('submit-vote') as HTMLFormElement;
  const radio = (name: string, value: string) =>
    form().querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;

  beforeEach(async () => {
    await renderPage('kano-cast', { ...base, remaining: '1 hour', poll, scale: KANO_SCALE });
  });

  it('every question is required, so an empty or partial ballot fails form validation', () => {
    const radios = Array.from(form().querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(2 * 2 * KANO_SCALE.length);
    expect(radios.every(r => r.required)).toBe(true);

    // nothing answered
    expect(form().checkValidity()).toBe(false);
    // one item fully answered, the other not
    radio('answers[o7][f]', '1').click();
    radio('answers[o7][d]', '5').click();
    expect(form().checkValidity()).toBe(false);
    // one question of the second item still missing
    radio('answers[o41][f]', '3').click();
    expect(form().checkValidity()).toBe(false);
    // complete
    radio('answers[o41][d]', '2').click();
    expect(form().checkValidity()).toBe(true);
  });

  it('posts answers[o<id>][f|d] for every item', () => {
    radio('answers[o7][f]', '1').click();
    radio('answers[o7][d]', '5').click();
    radio('answers[o41][f]', '3').click();
    radio('answers[o41][d]', '2').click();

    expect(formEntries(form())).toEqual([
      ['csrf-token', 'csrf-token-value'],
      ['poll_id', '5'],
      ['answers[o7][f]', '1'],
      ['answers[o7][d]', '5'],
      ['answers[o41][f]', '3'],
      ['answers[o41][d]', '2'],
    ]);
  });
});

describe('create form (poll-create)', () => {
  const form = () => document.getElementById('option-form') as HTMLFormElement;
  const optionInputs = () => Array.from(form().querySelectorAll<HTMLInputElement>('input[name="option[]"]'));
  const title = () => document.getElementById('title') as HTMLInputElement;
  const pressEnter = (el: HTMLElement) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

  beforeEach(async () => {
    await renderPage('poll-create', base);
  });

  it('starts with one option row and defaults to a ranked vote', () => {
    expect(optionInputs()).toHaveLength(1);
    expect(formEntries(form())).toEqual([
      ['csrf-token', 'csrf-token-value'],
      ['kind', 'irv'],
      ['title', ''],
      ['option[]', ''],
    ]);
    expect(form().getAttribute('autocomplete')).toEqual('off');
  });

  it('Return moves to the next empty row, creating one when needed', () => {
    title().value = 'What next?';
    pressEnter(title());
    expect(document.activeElement).toBe(optionInputs()[0]);
    expect(optionInputs()).toHaveLength(1);

    optionInputs()[0]!.value = 'Celeste';
    pressEnter(optionInputs()[0]!);
    expect(optionInputs()).toHaveLength(2);
    expect(document.activeElement).toBe(optionInputs()[1]);
    expect(optionInputs()[1]!.value).toEqual('');

    // Return on an empty field does nothing (and never submits)
    pressEnter(optionInputs()[1]!);
    expect(optionInputs()).toHaveLength(2);

    expect(formEntries(form())).toEqual([
      ['csrf-token', 'csrf-token-value'],
      ['kind', 'irv'],
      ['title', 'What next?'],
      ['option[]', 'Celeste'],
      ['option[]', ''],
    ]);
  });

  it('New row and the remove buttons add and drop rows, never leaving zero', () => {
    (document.getElementById('new-row') as HTMLButtonElement).click();
    // first row is empty, so "new row" focuses it instead of adding
    expect(optionInputs()).toHaveLength(1);
    optionInputs()[0]!.value = 'A';
    (document.getElementById('new-row') as HTMLButtonElement).click();
    expect(optionInputs()).toHaveLength(2);

    form().querySelectorAll<HTMLButtonElement>('button.remove-row')[0]!.click();
    expect(optionInputs()).toHaveLength(1);
    expect(optionInputs()[0]!.value).toEqual('');
    form().querySelectorAll<HTMLButtonElement>('button.remove-row')[0]!.click();
    expect(optionInputs()).toHaveLength(1);
  });

  it('switching to a Kano poll changes the placeholders, help text and the posted kind', () => {
    const help = (kind: string) => form().querySelector<HTMLParagraphElement>(`.kind-help[data-kind="${kind}"]`)!;
    expect(help('irv').hidden).toBe(false);
    expect(help('kano').hidden).toBe(true);

    const kano = form().querySelector<HTMLInputElement>('input[name="kind"][value="kano"]')!;
    kano.click();
    kano.checked = true;
    kano.dispatchEvent(new Event('change', { bubbles: true }));
    expect(title().placeholder).toEqual(title().dataset.placeholderKano);
    expect(title().placeholder).not.toEqual(title().dataset.placeholderIrv);
    expect(optionInputs()[0]!.placeholder).toEqual(optionInputs()[0]!.dataset.placeholderKano);
    expect(formEntries(form())).toEqual(expect.arrayContaining([['kind', 'kano']]));
    expect(help('irv').hidden).toBe(true);
    expect(help('kano').hidden).toBe(false);
    expect(help('kano').textContent).toMatch(/Pineapple on pizza/);

    // a row added afterwards picks up the kano placeholder too
    optionInputs()[0]!.value = 'x';
    (document.getElementById('new-row') as HTMLButtonElement).click();
    expect(optionInputs()[1]!.placeholder).toEqual(optionInputs()[1]!.dataset.placeholderKano);
  });
});

describe('poll actions (poll-title)', () => {
  const poll = { poll_id: 9, kind: 'irv', open: true, title: 'p', options: [] };
  const render = (ctx: object) => renderPage('poll-show', { ...base, remaining: '1 hour', ranks: [], poll, ...ctx });

  it('shows Close poll only to admins while the poll is open, and keeps it out of the navbar', async () => {
    await render({ admin: true });
    const close = document.querySelector<HTMLFormElement>('form[action="/poll/9/close"]')!;
    expect(close).not.toBeNull();
    expect(formEntries(close)).toEqual([['csrf-token', 'csrf-token-value']]);
    expect(close.closest('nav')).toBeNull();
    expect(document.querySelector('nav #copy-link')).toBeNull();

    await render({ admin: false });
    expect(document.querySelector('form[action="/poll/9/close"]')).toBeNull();
    expect(document.getElementById('copy-link')).not.toBeNull();

    await render({ admin: true, poll: { ...poll, open: false }, remaining: null });
    expect(document.querySelector('form[action="/poll/9/close"]')).toBeNull();
    expect(document.getElementById('copy-link')).not.toBeNull();
  });

  it('copies the poll url and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderPage('poll-show', {
      ...base,
      remaining: '1 hour',
      ranks: [],
      poll: { poll_id: 9, kind: 'irv', open: true, title: 'p', options: [] },
    });

    const btn = document.getElementById('copy-link') as HTMLButtonElement;
    btn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/poll/9`);
    expect(btn.textContent).toEqual('Copied!');
    expect(btn.classList.contains('copied')).toBe(true);
  });
});
