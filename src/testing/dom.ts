import path from 'node:path';

import { Liquid } from 'liquidjs';

// Renders a real view (layout, partials and all) into the test DOM and runs
// its inline scripts, so page behavior can be tested end to end: simulate
// clicks, then inspect what the form would submit.
//
// Test files using this must opt into a DOM: `// @vitest-environment happy-dom`

const views = path.resolve(import.meta.dirname, '..', '..', 'views');

const engine = new Liquid({
  root: views,
  extname: '.liquid',
  layouts: path.join(views, 'layouts'),
  partials: path.join(views, 'partials'),
});

export const renderPage = async (name: string, ctx: object): Promise<void> => {
  const html = await engine.renderFile(name, ctx);

  // pull inline scripts out so they run exactly once, in document order,
  // after the markup is in place (innerHTML doesn't execute scripts)
  const scripts: string[] = [];
  const markup = html
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_m: string, body: string) => {
      scripts.push(body);
      return '';
    })
    // no stylesheets/icons either: happy-dom would try to fetch them
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/^\s*<!doctype html>\s*/i, '')
    .replace(/^\s*<html[^>]*>/i, '')
    .replace(/<\/html>\s*$/i, '');

  document.documentElement.innerHTML = markup;
  for (const body of scripts) {
    new Function(body)();
  }
};

export const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// what a plain HTML submission of this form would contain, as [name, value] pairs
export const formEntries = (form: HTMLFormElement): [string, string][] => {
  const out: [string, string][] = [];
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement>('input[name]'))) {
    if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
    if (el.disabled) continue;
    out.push([el.name, el.value]);
  }
  return out;
};

// dispatch a cancelable submit and report whether the page let it through
export const trySubmit = (form: HTMLFormElement): boolean => {
  const ev = new Event('submit', { cancelable: true, bubbles: true });
  form.dispatchEvent(ev);
  return !ev.defaultPrevented;
};
