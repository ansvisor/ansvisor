import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClampedText,
  ClampedTextPreview,
  ClampedTextTooltip,
  createClampedTextHandle,
  isTextCut,
  useTextCut,
  type ClampedTextHandle,
} from './clamped-text';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('isTextCut', () => {
  const box = (scroll: [number, number], client: [number, number]) => ({
    scrollWidth: scroll[0],
    scrollHeight: scroll[1],
    clientWidth: client[0],
    clientHeight: client[1],
  });

  it('reads a clamped block or a truncated line as cut', () => {
    expect(isTextCut(box([320, 60], [320, 40]))).toBe(true);
    expect(isTextCut(box([210, 16], [140, 16]))).toBe(true);
  });

  it('leaves text that fits, within a pixel of rounding', () => {
    expect(isTextCut(box([320, 40], [320, 40]))).toBe(false);
    expect(isTextCut(box([141, 17], [140, 16]))).toBe(false);
  });
});

describe('ClampedText', () => {
  let container: HTMLDivElement;
  let root: Root;
  const text = 'Which specialty coffee subscriptions ship internationally to Europe?';

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function hover(sizes: { scrollHeight: number; clientHeight: number }) {
    const handle = createClampedTextHandle();
    act(() => {
      root.render(
        <>
          <ClampedText
            handle={handle}
            text={text}
            render={<a href="#prompt" data-testid="cell" />}
          />
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    const cell = container.querySelector('[data-testid="cell"]') as HTMLElement;
    for (const [key, value] of Object.entries({ ...sizes, scrollWidth: 300, clientWidth: 300 })) {
      Object.defineProperty(cell, key, { configurable: true, value });
    }
    // jsdom has no PointerEvent; React and the tooltip read the event type.
    act(() => {
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
        cell.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith('enter') }));
      }
    });
    act(() => vi.advanceTimersByTime(400));
    return cell;
  }

  it('keeps the whole text in the element', () => {
    const cell = hover({ scrollHeight: 40, clientHeight: 40 });
    expect(cell.textContent).toBe(text);
  });

  it('shows the whole text on hover when the element cut it', () => {
    hover({ scrollHeight: 60, clientHeight: 40 });
    const popup = document.querySelector('[data-slot="tooltip-content"]');
    expect(popup?.textContent).toBe(text);
  });

  it('shows the whole text when a cut link gets keyboard focus', () => {
    const handle = createClampedTextHandle();
    act(() => {
      root.render(
        <>
          <ClampedText
            handle={handle}
            text={text}
            render={<a href="#prompt" data-testid="cell" />}
          />
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    const cell = container.querySelector('[data-testid="cell"]') as HTMLElement;
    Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 420 });
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 320 });
    act(() => cell.focus());
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(text);
  });

  it('shows nothing for text that fits', () => {
    hover({ scrollHeight: 40, clientHeight: 40 });
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
});

describe('ClampedText children', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('renders children in place of the plain text but tooltips the text', () => {
    const handle = createClampedTextHandle();
    const text = 'A long opportunity title that the one-line cell will cut';
    act(() => {
      root.render(
        <>
          <ClampedText handle={handle} text={text} render={<p data-testid="cell" />}>
            <span data-testid="badge">New</span>
            {text}
          </ClampedText>
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    const cell = container.querySelector('[data-testid="cell"]') as HTMLElement;
    expect(cell.querySelector('[data-testid="badge"]')).not.toBeNull();
    expect(cell.textContent).toBe('New' + text);
    Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 500 });
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 300 });
    act(() => {
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
        cell.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith('enter') }));
      }
    });
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(text);
  });
});

describe('ClampedText with a measured preview (the call-site composition)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const text = 'Which specialty coffee subscriptions ship internationally to Europe?';
  const realResizeObserver = globalThis.ResizeObserver;

  // jsdom has no ResizeObserver; this stub lets a test fire a resize after it
  // mocks the element's measurements.
  class StubResizeObserver {
    static instances: StubResizeObserver[] = [];
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      StubResizeObserver.instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    fire() {
      this.cb([], this as unknown as ResizeObserver);
    }
  }

  // Mirrors the call sites: the measuring ref goes on the rendered element
  // itself, and Base UI merges it with the trigger's own ref.
  function PreviewCell({ handle, text }: { handle: ClampedTextHandle; text: string }) {
    const [ref, cut] = useTextCut<HTMLAnchorElement>();
    return (
      <>
        <ClampedText
          handle={handle}
          text={text}
          render={<a ref={ref} href="#prompt" data-testid="cell" />}
        />
        {cut ? <ClampedTextPreview label="Show full text" heading={text} /> : null}
      </>
    );
  }

  beforeEach(() => {
    StubResizeObserver.instances = [];
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.ResizeObserver = realResizeObserver;
  });

  function renderCell() {
    const handle = createClampedTextHandle();
    act(() => {
      root.render(
        <>
          <PreviewCell handle={handle} text={text} />
          <ClampedTextTooltip handle={handle} />
        </>,
      );
    });
    return container.querySelector('[data-testid="cell"]') as HTMLElement;
  }

  function cut(cell: HTMLElement) {
    Object.defineProperty(cell, 'scrollWidth', { configurable: true, value: 420 });
    Object.defineProperty(cell, 'clientWidth', { configurable: true, value: 300 });
    act(() => StubResizeObserver.instances.forEach((observer) => observer.fire()));
  }

  it('offers the preview button only once the element cuts the text', () => {
    const cell = renderCell();
    expect(container.querySelector('[aria-label="Show full text"]')).toBeNull();
    cut(cell);
    expect(container.querySelector('[aria-label="Show full text"]')).not.toBeNull();
  });

  it('shows the full text in the preview popover on click', () => {
    const cell = renderCell();
    cut(cell);
    const button = container.querySelector('[aria-label="Show full text"]') as HTMLButtonElement;
    act(() => button.click());
    const popover = document.querySelector('[data-slot="popover-content"]');
    expect(popover?.textContent).toContain(text);
  });

  it('still shows the tooltip on keyboard focus when the text is cut', () => {
    vi.useFakeTimers();
    const cell = renderCell();
    cut(cell);
    act(() => cell.focus());
    act(() => vi.advanceTimersByTime(400));
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(text);
    vi.useRealTimers();
  });
});

describe('ClampedTextPreview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the heading and body in a popover', () => {
    act(() => {
      root.render(
        <ClampedTextPreview
          label="Show full text"
          heading="Full title"
          body="The full description."
        />,
      );
    });
    const button = container.querySelector('[aria-label="Show full text"]') as HTMLButtonElement;
    act(() => button.click());
    const popover = document.querySelector('[data-slot="popover-content"]');
    expect(popover?.textContent).toContain('Full title');
    expect(popover?.textContent).toContain('The full description.');
  });
});
