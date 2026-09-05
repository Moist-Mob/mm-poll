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
    expect(divider()).toMatch(/Tap your favorite/);
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

describe('nomination page (nominate)', () => {
  const mine = [
    { twitch_category_id: '10', name: 'Celeste', nominated_on: 1, freshness: 'fresh' },
    { twitch_category_id: '20', name: 'Hades', nominated_on: 2, freshness: 'stale' },
  ];

  // the page hands its config to the vendored accessible-autocomplete; the
  // library is not under test: capture the config and drive it directly
  type AutocompleteConfig = {
    element: HTMLElement;
    minLength: number;
    source: (query: string, populate: (results: unknown[]) => void) => void;
    templates: { inputValue: (r?: { name: string }) => string; suggestion: (r?: object) => string };
    onConfirm: (r?: { id: string; name: string }) => void;
  };
  let config: AutocompleteConfig;

  beforeEach(async () => {
    const autocomplete = vi.fn((cfg: AutocompleteConfig) => {
      config = cfg;
      // the real library renders an input with the configured id; the page's
      // own code attaches a listener to it, so the stub provides one too
      const input = document.createElement('input');
      input.id = 'game-search';
      cfg.element.appendChild(input);
    });
    vi.stubGlobal('accessibleAutocomplete', autocomplete);
    await renderPage('nominate', { ...base, eligible: true, eligible_msg: '', follow_rule: '', mine });
    expect(autocomplete).toHaveBeenCalledTimes(1);
    expect(config.element).toBe(document.getElementById('autocomplete-container'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('the source debounces rapid typing into one query and returns its results', async () => {
    vi.useFakeTimers();
    const result = { id: '31', name: 'Ōkami HD', box_art: 'http://art/31' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [result] }) });
    vi.stubGlobal('fetch', fetchMock);

    const populate = vi.fn();
    config.source('oka', populate);
    config.source('okami', populate); // typed before the debounce fired
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/nominate/search?q=okami');
    expect(populate).toHaveBeenCalledWith([result]);
  });

  it('short queries clear the suggestions without hitting the server', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const populate = vi.fn();
    config.source('o', populate);
    expect(populate).toHaveBeenCalledWith([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed search degrades to no suggestions', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    const populate = vi.fn();
    config.source('okami', populate);
    await vi.advanceTimersByTimeAsync(300);
    expect(populate).toHaveBeenCalledWith([]);
  });

  it('clearing the input cancels a pending debounced search', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const populate = vi.fn();
    config.source('okami', populate);
    // everything is deleted before the debounce fires; the library will not
    // call source for an empty box, so the page cancels on its own
    const input = document.getElementById('game-search') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
  });

  it('confirming a suggestion submits its id; blurring confirms nothing', () => {
    const form = document.getElementById('nominate-form') as HTMLFormElement;
    const submit = vi.fn();
    form.submit = submit;

    config.onConfirm({ id: '31', name: 'Ōkami HD' });
    expect(formEntries(form)).toEqual([
      ['csrf-token', 'csrf-token-value'],
      ['category_id', '31'],
    ]);
    expect(submit).toHaveBeenCalledTimes(1);

    // confirmOnBlur is off, but the library still calls onConfirm(undefined)
    config.onConfirm(undefined);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('suggestion templates escape api-supplied text', () => {
    expect(config.templates.inputValue({ name: 'Ōkami HD' })).toBe('Ōkami HD');
    expect(config.templates.inputValue(undefined)).toBe('');

    const html = config.templates.suggestion({ id: '1', name: '<b>sneaky</b>', box_art: 'http://a/"x"' });
    expect(html).toContain('&lt;b&gt;sneaky&lt;/b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&quot;x&quot;');
    // and no art, no img tag
    expect(config.templates.suggestion({ id: '1', name: 'Plain' })).not.toContain('<img');
  });

  it('lists your nominations, each with a withdraw form', () => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[action="/nominate/remove"]'));
    expect(forms).toHaveLength(2);
    expect(formEntries(forms[0]!)).toEqual([
      ['csrf-token', 'csrf-token-value'],
      ['category_id', '10'],
    ]);
    expect(text(forms[0]!.closest('li')!.querySelector('span.grow'))).toEqual('Celeste');
    // the withdraw button uses the same circle-x icon as the create page
    expect(forms[0]!.querySelector('button svg')).not.toBeNull();
  });
});

describe('create form: fill from nominations', () => {
  const optionInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="option[]"]'));
  const fill = () => (document.getElementById('fill-nominations') as HTMLButtonElement).click();

  beforeEach(async () => {
    await renderPage('poll-create', base);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pulls the top list into option rows, reusing empties and skipping duplicates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nominations: [{ name: 'Celeste' }, { name: 'Hades' }, { name: 'Okami' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    optionInputs()[0]!.value = 'Hades'; // typed by hand already
    fill();
    await vi.waitFor(() => expect(optionInputs()).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledWith('/nominate/top?n=25');
    expect(optionInputs().map(i => i.value)).toEqual(['Hades', 'Celeste', 'Okami']);

    // filling twice adds nothing
    fill();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(optionInputs().map(i => i.value)).toEqual(['Hades', 'Celeste', 'Okami']);
  });

  it('respects the count box', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nominations: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    (document.getElementById('fill-count') as HTMLInputElement).value = '40';
    fill();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/nominate/top?n=40'));
  });
});

describe('index page (index)', () => {
  const open = [
    { poll_id: 1, kind: 'irv', open: true, title: 'Next game', remaining: '5 hours' },
    { poll_id: 2, kind: 'kano', open: true, title: 'Features', remaining: '1 day' },
  ];
  const ended = [{ poll_id: 3, kind: 'irv', open: false, title: 'Old vote', ago: '3 days' }];

  it('prompts logged-out visitors to log in and shows no polls', async () => {
    await renderPage('index', { title: 't' });
    // the navbar has its own login link; the prompt lives in the content area
    expect(document.querySelector('.content a[href="/auth/login"]')).not.toBeNull();
    expect(document.querySelector('a[href^="/poll/"]')).toBeNull();
  });

  it('lists open and recently ended polls for logged-in users', async () => {
    await renderPage('index', { ...base, open, ended });

    const openLink = document.querySelector('a[href="/poll/1"]')!;
    expect(text(openLink)).toContain('Next game');
    expect(text(openLink)).toContain('closes in 5 hours');
    expect(document.querySelector('a[href="/poll/2"]')).not.toBeNull();

    const endedLink = document.querySelector('a[href="/poll/3/results"]')!;
    expect(text(endedLink)).toContain('Old vote');
    expect(text(endedLink)).toContain('ended 3 days ago');

    expect(document.querySelector('.content a[href="/auth/login"]')).toBeNull();
  });

  it('shows empty states instead of bare sections', async () => {
    await renderPage('index', { ...base, open: [], ended: [] });
    expect(text(document.body)).toContain('No open polls right now');
    expect(text(document.body)).toContain('Nothing has ended recently');
    expect(document.querySelector('a[href^="/poll/"]')).toBeNull();
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
    // the navbar offers Nominate to everyone, Create only to admins, and the
    // site name links home
    expect(document.querySelector('nav a[href="/nominate"]')).not.toBeNull();
    expect(document.querySelector('nav a[href="/create"]')).toBeNull();
    expect(text(document.querySelector('nav a[href="/"]'))).toContain('Moist Polls');

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
