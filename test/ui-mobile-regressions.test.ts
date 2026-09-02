import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The Vitest config runs in a node environment without a DOM, so these guards
// read the source and assert the mobile/theme fixes are still in place.

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// globals.css declares the same media query several times; concatenate every
// block for that query so a rule can live in any of them.
function mediaBlock(css: string, query: string): string {
  const marker = `@media (${query})`;
  const blocks: string[] = [];
  let start = css.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThan(-1);
  while (start !== -1) {
    let depth = 0;
    let end = css.length;
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    blocks.push(css.slice(start, end));
    start = css.indexOf(marker, end);
  }
  return blocks.join('\n');
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
}

const TOAST_TABS = [
  'app/components/queue-tab.tsx',
  'app/components/settings-tab.tsx',
  'app/components/compose-tab.tsx',
  'app/components/autopilot-tab.tsx',
  'app/components/mentions-tab.tsx',
];

const OAUTH_START_COMPONENTS = [
  'app/components/setup-wizard.tsx',
  'app/components/settings-tab.tsx',
  'app/components/autopilot-tab.tsx',
];

describe('workspace toasts and theme leftovers', () => {
  it('renders every tab toast with the light .engage-toast class instead of a dark inline box', () => {
    for (const file of TOAST_TABS) {
      const source = read(file);
      expect(source, file).not.toContain('#1a1a1a');
      expect(source, file).toContain('className="engage-toast"');
    }
  });

  it('goes full-width for toasts on phones', () => {
    const css = read('app/globals.css');
    const phone = mediaBlock(css, 'max-width: 640px');
    expect(phone).toMatch(/\.engage-toast \{[^}]*left: 16px;[^}]*right: 16px;[^}]*max-width: none;/);
  });

  it('uses design tokens for the X-connection status, setup banner, and health alerts', () => {
    const settings = read('app/components/settings-tab.tsx');
    for (const literal of ['#86efac', '#c4b5fd', '#22c55e']) {
      expect(settings, literal).not.toContain(literal);
    }
    expect(read('app/components/agent-dashboard-client.tsx')).not.toContain('#f59e0b');

    const css = read('app/globals.css');
    expect(ruleBlock(css, ':root')).toContain('--warning: #c78528;');
    expect(ruleBlock(css, '.health-alert.error')).toContain('color: var(--red);');
    expect(ruleBlock(css, '.health-alert.warning')).toContain('color: var(--warning);');
    expect(css).not.toContain('#f87171');
  });
});

describe('mobile layout guards', () => {
  it('lets modal action rows wrap and stack inside the full-screen modal', () => {
    const css = read('app/globals.css');
    expect(ruleBlock(css, '.wizard-actions')).toContain('flex-wrap: wrap;');
    const modalPhone = mediaBlock(css, 'max-width: 520px');
    expect(modalPhone).toMatch(/\.wizard-actions \{[^}]*flex-direction: column-reverse;/);
    expect(modalPhone).toMatch(/\.wizard-actions \.btn \{[^}]*width: 100%;/);
    expect(modalPhone).toMatch(/\.modal \{[^}]*padding: 16px;/);
  });

  it('sizes the dashboard shell with dvh and pads the scroller for the safe area', () => {
    const css = read('app/globals.css');
    const shell = ruleBlock(css, '.dashboard-shell');
    expect(shell).toContain('height: 100vh;');
    expect(shell).toContain('height: 100dvh;');
    expect(ruleBlock(css, '.dashboard-content')).toContain('env(safe-area-inset-bottom');
    expect(mediaBlock(css, 'max-width: 768px')).toMatch(/\.dashboard-content \{[^}]*env\(safe-area-inset-bottom/);
  });

  it('allows pinch-zoom and bumps form controls to 16px on small screens', () => {
    const layout = read('app/layout.tsx');
    expect(layout).not.toContain('maximumScale');
    expect(layout).not.toContain('userScalable');

    const touch = mediaBlock(read('app/globals.css'), 'max-width: 768px');
    expect(touch).toMatch(/\.input, \.textarea, \.engage-input, \.engage-textarea, select\.input \{\s*font-size: 16px !important;/);
  });

  it('gives segmented controls, delete-reason chips, alert dismiss, and back link 44px targets', () => {
    const touch = mediaBlock(read('app/globals.css'), 'max-width: 768px');
    const touchRule = touch.match(/\.btn, \.tab-btn, \.tweet-action, \.wizard-tag-selectable,[^{]*\{[^}]*\}/);
    expect(touchRule).not.toBeNull();
    for (const selector of ['.workflow-view-btn', '.insights-view-btn', '.queue-feedback-reason', '.back-btn']) {
      expect(touchRule?.[0], selector).toContain(selector);
    }
    expect(touchRule?.[0]).toContain('min-height: 44px;');
    expect(touch).toMatch(/\.health-alert-dismiss \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  });

  it('keeps the marketing header CTAs reachable on phones', () => {
    const css = read('app/globals.css');
    expect(css).not.toMatch(/\.site-header-cta \{\s*display: none;/);
    expect(mediaBlock(css, 'max-width: 640px')).toMatch(/\.site-header-cta \{[^}]*min-height: 44px;/);
  });
});

describe('client flow guards', () => {
  it('resets OAuth-start loading flags when the page is restored from the back-forward cache', () => {
    for (const file of OAUTH_START_COMPONENTS) {
      const source = read(file);
      expect(source, file).toMatch(/addEventListener\('pageshow'/);
      expect(source, file).toMatch(/event\.persisted/);
    }
  });

  it('treats non-OK generate and queue responses as errors instead of drafts or successes', () => {
    const mentions = read('app/components/mentions-tab.tsx');
    expect(mentions).toMatch(/const tweet = await res\.json\(\);\s*if \(!res\.ok \|\| typeof tweet\?\.content !== 'string'\)/);
    expect(mentions).toMatch(/status: 'queued' \}\),\s*\}\);\s*const data = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!res\.ok\)/);

    const compose = read('app/components/compose-tab.tsx');
    expect(compose).toMatch(/status: 'queued' \}\),\s*\}\);\s*const data = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!res\.ok\)/);

    const queue = read('app/components/queue-tab.tsx');
    expect(queue).toMatch(/content: editContent \}\),\s*\}\);\s*const data = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!res\.ok\)/);
    expect(queue).toMatch(/status: 'posted' \}\),\s*\}\);\s*const data = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!res\.ok\)/);
    expect(queue).toContain('data.supersededParent && data.tweet');
  });

  it('sends the preview tweetId with first-batch ratings so the bandit can observe them', () => {
    const wizard = read('app/components/setup-wizard.tsx');
    expect(wizard).toMatch(/feedback: \{\s*tweetId,\s*tweetText: tweet\.content,/);
  });
});
