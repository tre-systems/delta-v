// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { byId, el, hide, show, visible } from './dom';

describe('el', () => {
  it('creates an element with the given tag', () => {
    const div = el('div');
    expect(div.tagName).toBe('DIV');
  });

  it('creates different tag types', () => {
    expect(el('span').tagName).toBe('SPAN');
    expect(el('button').tagName).toBe('BUTTON');
    expect(el('input').tagName).toBe('INPUT');
  });

  it('sets className from class prop', () => {
    const div = el('div', { class: 'card highlight' });
    expect(div.className).toBe('card highlight');
  });

  it('toggles classes from classList prop', () => {
    const div = el('div', { class: 'base', classList: { active: true, disabled: false } });
    expect(div.classList.contains('base')).toBe(true);
    expect(div.classList.contains('active')).toBe(true);
    expect(div.classList.contains('disabled')).toBe(false);
  });

  it('sets textContent from text prop', () => {
    const span = el('span', { text: 'hello' });
    expect(span.textContent).toBe('hello');
  });

  it('sets innerHTML from html prop', () => {
    const div = el('div', { html: '<b>bold</b>' });
    expect(div.innerHTML).toBe('<b>bold</b>');
  });

  it('sets inline styles from style prop', () => {
    const div = el('div', { style: { color: 'red', fontSize: '14px' } });
    expect(div.style.color).toBe('red');
    expect(div.style.fontSize).toBe('14px');
  });

  it('sets disabled on button elements', () => {
    const btn = el('button', { disabled: true }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const enabled = el('button', { disabled: false }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
  });

  it('sets title attribute', () => {
    const div = el('div', { title: 'tooltip text' });
    expect(div.title).toBe('tooltip text');
  });

  it('sets data-* attributes from data prop', () => {
    const div = el('div', { data: { scenario: 'escape', difficulty: 'hard' } });
    expect(div.dataset.scenario).toBe('escape');
    expect(div.dataset.difficulty).toBe('hard');
  });

  it('wires onClick handler', () => {
    let clicked = false;
    const btn = el('button', {
      onClick: () => {
        clicked = true;
      },
    });
    btn.click();
    expect(clicked).toBe(true);
  });

  it('wires onKeydown handler', () => {
    let key = '';
    const input = el('input', {
      onKeydown: (e) => {
        key = e.key;
      },
    });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(key).toBe('Enter');
  });

  it('wires onInput handler', () => {
    let fired = false;
    const input = el('input', {
      onInput: () => {
        fired = true;
      },
    });
    input.dispatchEvent(new Event('input'));
    expect(fired).toBe(true);
  });

  it('wires onChange handler', () => {
    let fired = false;
    const select = el('select', {
      onChange: () => {
        fired = true;
      },
    });
    select.dispatchEvent(new Event('change'));
    expect(fired).toBe(true);
  });

  it('appends HTMLElement children', () => {
    const parent = el('div', undefined, el('span', { text: 'first' }), el('span', { text: 'second' }));
    expect(parent.children.length).toBe(2);
    expect(parent.children[0].textContent).toBe('first');
    expect(parent.children[1].textContent).toBe('second');
  });

  it('appends string children as text nodes', () => {
    const parent = el('div', undefined, 'hello ', 'world');
    expect(parent.textContent).toBe('hello world');
    expect(parent.childNodes.length).toBe(2);
    expect(parent.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('mixes element and string children', () => {
    const parent = el('div', undefined, 'text before ', el('b', { text: 'bold' }), ' text after');
    expect(parent.textContent).toBe('text before bold text after');
    expect(parent.childNodes.length).toBe(3);
  });

  it('works with no props and no children', () => {
    const div = el('div');
    expect(div.tagName).toBe('DIV');
    expect(div.children.length).toBe(0);
    expect(div.textContent).toBe('');
  });

  it('supports nested element trees', () => {
    const tree = el(
      'div',
      { class: 'container' },
      el('div', { class: 'header' }, el('h1', { text: 'Title' })),
      el('div', { class: 'body' }, el('p', { text: 'Content' })),
    );
    expect(tree.querySelector('.header h1')?.textContent).toBe('Title');
    expect(tree.querySelector('.body p')?.textContent).toBe('Content');
  });
});

describe('show', () => {
  it('restores display to empty string by default', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    show(div);
    expect(div.style.display).toBe('');
  });

  it('sets display to specified value', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    show(div, 'inline-block');
    expect(div.style.display).toBe('inline-block');
  });
});

describe('hide', () => {
  it('sets display to none', () => {
    const div = document.createElement('div');
    hide(div);
    expect(div.style.display).toBe('none');
  });
});

describe('visible', () => {
  it('shows element when condition is true', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    visible(div, true);
    expect(div.style.display).toBe('');
  });

  it('hides element when condition is false', () => {
    const div = document.createElement('div');
    visible(div, false);
    expect(div.style.display).toBe('none');
  });

  it('uses custom display value when showing', () => {
    const div = document.createElement('div');
    visible(div, true, 'inline-block');
    expect(div.style.display).toBe('inline-block');
  });

  it('toggles based on changing condition', () => {
    const div = document.createElement('div');
    visible(div, true);
    expect(div.style.display).toBe('');
    visible(div, false);
    expect(div.style.display).toBe('none');
    visible(div, true, 'flex');
    expect(div.style.display).toBe('flex');
  });
});

describe('byId', () => {
  it('returns element by id', () => {
    const div = document.createElement('div');
    div.id = 'test-element';
    document.body.appendChild(div);

    const found = byId('test-element');
    expect(found).toBe(div);

    document.body.removeChild(div);
  });

  it('throws when element does not exist', () => {
    expect(() => byId('nonexistent')).toThrow('Element #nonexistent not found');
  });

  it('supports generic type parameter', () => {
    const input = document.createElement('input');
    input.id = 'test-input';
    input.type = 'text';
    document.body.appendChild(input);

    const found = byId<HTMLInputElement>('test-input');
    expect(found.type).toBe('text');

    document.body.removeChild(input);
  });
});
