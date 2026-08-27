import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 48123);
const HOST = process.env.HOST || '127.0.0.1';
const STATE_PATH = path.join(__dirname, 'state.json');
const PROOFS_DIR = path.join(__dirname, 'proofs');
const POLL_INTERVAL_MS = 4000;
const BROWSER_LAUNCH_TIMEOUT_MS = 20000;
const BROWSER_TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS = 1500;
const HANDLE_DETECT_TIMEOUT_MS = 800;
const NETWORK_SETTLE_TIMEOUT_MS = 5000;
const PROFILE_BOOT_TIMEOUT_MS = 10000;
const CDP_POLL_INTERVAL_MS = 250;
const PROFILE_CACHE_SEGMENTS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  path.join('Service Worker', 'CacheStorage'),
];
const SYSTEM_CHROME_EXECUTABLE = process.env.COMPANION_CHROME_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SYSTEM_CHROME_USER_DATA_ROOT = process.env.COMPANION_CHROME_USER_DATA_ROOT
  || path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const SYSTEM_CHROME_PROFILE_DIR = process.env.COMPANION_CHROME_PROFILE_DIR || 'Default';
const SYSTEM_CHROME_DEBUG_PORT = Number(process.env.COMPANION_CHROME_DEBUG_PORT || 9333);

const state = {
  appUrl: null,
  pairingId: null,
  pairingToken: null,
  machineLabel: null,
  lastError: null,
};

let browser = null;
let page = null;
let runnerPromise = null;
let runningActionId = null;
let currentHandleCache = null;
let browserProcess = null;
let browserTempDir = null;
let browserCleanupPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, fallbackValue = null) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function shouldUseSystemChromeProfile() {
  return /^(1|true|yes)$/i.test(process.env.COMPANION_CHROME_USE_SYSTEM_PROFILE || '');
}

function isExcludedProfilePath(relativePath) {
  return PROFILE_CACHE_SEGMENTS.some((segment) => relativePath === segment || relativePath.startsWith(`${segment}${path.sep}`));
}

async function cloneChromeProfile() {
  const sourceRoot = SYSTEM_CHROME_USER_DATA_ROOT;
  const profileDir = SYSTEM_CHROME_PROFILE_DIR;
  const tempRoot = path.join(os.tmpdir(), `clawfable-companion-profile-${Date.now()}`);
  const sourceProfilePath = path.join(sourceRoot, profileDir);
  const destinationProfilePath = path.join(tempRoot, profileDir);

  await mkdir(tempRoot, { recursive: true });
  await mkdir(destinationProfilePath, { recursive: true });
  await cp(path.join(sourceRoot, 'Local State'), path.join(tempRoot, 'Local State'), {
    force: true,
  }).catch(() => {});
  await cp(sourceProfilePath, destinationProfilePath, {
    recursive: true,
    force: true,
    filter: (source) => {
      const relativePath = path.relative(sourceProfilePath, source);
      if (!relativePath) return true;
      if (relativePath.startsWith(`Singleton${path.sep}`) || relativePath === 'SingletonCookie' || relativePath === 'SingletonLock' || relativePath === 'SingletonSocket') {
        return false;
      }
      return !isExcludedProfilePath(relativePath);
    },
  });

  return tempRoot;
}

async function waitForCdpEndpoint(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(CDP_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for Chrome remote debugging on port ${port}.`);
}

async function cleanupExternalBrowser() {
  if (browserCleanupPromise) {
    await browserCleanupPromise;
    return;
  }

  browserCleanupPromise = (async () => {
    const processToKill = browserProcess;
    const tempDirToRemove = browserTempDir;
    browserProcess = null;
    browserTempDir = null;

    if (processToKill && !processToKill.killed) {
      processToKill.kill('SIGKILL');
      await sleep(250);
    }
    if (tempDirToRemove) {
      await rm(tempDirToRemove, { recursive: true, force: true }).catch(() => {});
    }
  })();

  try {
    await browserCleanupPromise;
  } finally {
    browserCleanupPromise = null;
  }
}

function jsonHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, jsonHeaders());
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    Object.assign(state, JSON.parse(raw));
  } catch {}
}

async function saveState() {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function ensureBrowser() {
  if (browser?.isConnected() && page && !page.isClosed()) {
    return page;
  }

  if (shouldUseSystemChromeProfile()) {
    try {
      browserTempDir = await cloneChromeProfile();
      browserProcess = spawn(
        SYSTEM_CHROME_EXECUTABLE,
        [
          `--remote-debugging-port=${SYSTEM_CHROME_DEBUG_PORT}`,
          `--user-data-dir=${browserTempDir}`,
          `--profile-directory=${SYSTEM_CHROME_PROFILE_DIR}`,
          '--no-first-run',
          '--no-default-browser-check',
          'about:blank',
        ],
        {
          stdio: 'ignore',
        }
      );

      await waitForCdpEndpoint(SYSTEM_CHROME_DEBUG_PORT, PROFILE_BOOT_TIMEOUT_MS);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${SYSTEM_CHROME_DEBUG_PORT}`);
      browser.on('disconnected', async () => {
        state.lastError = 'Visible browser closed';
        browser = null;
        page = null;
        currentHandleCache = null;
        await cleanupExternalBrowser();
        await saveState();
      });

      const context = browser.contexts()[0];
      if (!context) {
        throw new Error('Chrome launched from the selected profile, but no browser context was available.');
      }

      page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
      return page;
    } catch (error) {
      browser = null;
      page = null;
      currentHandleCache = null;
      await cleanupExternalBrowser();
      throw error;
    }
  }

  browser = await chromium.launch({
    headless: false,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
  });
  browser.on('disconnected', async () => {
    state.lastError = 'Visible browser closed';
    browser = null;
    page = null;
    currentHandleCache = null;
    await saveState();
  });

  page = await browser.newPage({
    viewport: { width: 1400, height: 960 },
  });
  page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
  return page;
}

function withAuth(init = {}) {
  const headers = new Headers(init.headers || {});
  if (state.pairingToken) {
    headers.set('Authorization', `Bearer ${state.pairingToken}`);
  }
  return {
    ...init,
    headers,
  };
}

async function fetchJson(url, init = {}) {
  const requestInit = withAuth(init);
  if (requestInit.body && typeof requestInit.body !== 'string') {
    requestInit.headers.set('Content-Type', 'application/json');
    requestInit.body = JSON.stringify(requestInit.body);
  }

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }

  return data;
}

async function captureProof(currentPage, label) {
  await mkdir(PROOFS_DIR, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const filePath = path.join(PROOFS_DIR, `${Date.now()}-${safeLabel}.png`);
  await currentPage.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function detectCurrentHandle(currentPage) {
  if (!currentPage || currentPage.isClosed()) return null;

  const candidates = [
    async () => currentPage.locator('a[data-testid="AppTabBar_Profile_Link"]').first().getAttribute('href', {
      timeout: HANDLE_DETECT_TIMEOUT_MS,
    }),
    async () => currentPage.locator('a[href*="/status/"]').first().getAttribute('href', {
      timeout: HANDLE_DETECT_TIMEOUT_MS,
    }),
    async () => currentPage.locator('meta[property="og:url"]').first().getAttribute('content', {
      timeout: HANDLE_DETECT_TIMEOUT_MS,
    }),
  ];

  for (const read of candidates) {
    try {
      const value = await read();
      if (!value) continue;
      const match = value.match(/x\.com\/([^/]+)/i) || value.match(/^\/([^/]+)/);
      if (match?.[1] && !['i', 'home', 'compose'].includes(match[1])) {
        return match[1].replace(/^@/, '');
      }
    } catch {}
  }

  return null;
}

async function detectCaptcha(currentPage) {
  const text = (await currentPage.textContent('body').catch(() => '')) || '';
  return /captcha|arkose|verify you are human/i.test(text);
}

async function ensureExpectedAccount(currentPage, expectedHandle) {
  await currentPage.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await currentPage.waitForLoadState('networkidle', { timeout: NETWORK_SETTLE_TIMEOUT_MS }).catch(() => {});
  const currentHandle = await detectCurrentHandle(currentPage);
  currentHandleCache = currentHandle;

  if (!currentHandle) {
    return {
      ok: false,
      currentHandle: null,
      reason: 'Login missing or profile handle could not be detected in the visible browser.',
    };
  }

  if (currentHandle.toLowerCase() !== expectedHandle.toLowerCase()) {
    return {
      ok: false,
      currentHandle,
      reason: `Account mismatch: visible browser is @${currentHandle}, but this session requires @${expectedHandle}. Switch accounts in X, then approve a fresh session.`,
    };
  }

  return {
    ok: true,
    currentHandle,
    reason: null,
  };
}

async function reportAction(actionId, payload) {
  return fetchJson(`${state.appUrl}/api/browser-companion/actions/${actionId}/report`, {
    method: 'POST',
    body: payload,
  });
}

async function failAction(task, reason, extras = {}) {
  state.lastError = reason;
  await saveState();
  await reportAction(task.action.id, {
    sessionId: task.sessionId,
    status: 'failed',
    failureReason: reason,
    ...extras,
  });
}

async function skipAction(task, reason, extras = {}) {
  await reportAction(task.action.id, {
    sessionId: task.sessionId,
    status: 'skipped',
    failureReason: reason,
    ...extras,
  });
}

async function succeedAction(task, extras = {}) {
  state.lastError = null;
  await saveState();
  await reportAction(task.action.id, {
    sessionId: task.sessionId,
    status: 'succeeded',
    ...extras,
  });
}

async function verifyTweetVisible(currentPage) {
  const tweet = currentPage.locator('article[data-testid="tweet"]').first();
  await tweet.waitFor({ state: 'visible', timeout: 8000 });
  return tweet;
}

async function executeLike(task) {
  const currentPage = await ensureBrowser();
  const account = await ensureExpectedAccount(currentPage, task.agent.handle);
  if (!account.ok) {
    return failAction(task, account.reason, { currentHandle: account.currentHandle });
  }

  await currentPage.goto(task.action.candidate.tweetUrl, { waitUntil: 'domcontentloaded' });
  await currentPage.waitForLoadState('networkidle', { timeout: NETWORK_SETTLE_TIMEOUT_MS }).catch(() => {});

  if (await detectCaptcha(currentPage)) {
    return failAction(task, 'X requested CAPTCHA or human verification before the action could continue.');
  }

  try {
    await verifyTweetVisible(currentPage);
  } catch {
    return failAction(task, 'Target tweet is missing or no longer visible in the X UI.');
  }

  const unlikeButton = currentPage.locator('button[data-testid="unlike"]').first();
  if (await unlikeButton.isVisible().catch(() => false)) {
    const proofPath = await captureProof(currentPage, `already-liked-${task.action.candidate.tweetId}`);
    return skipAction(task, 'Tweet was already liked from this account.', {
      proof: {
        type: 'screenshot',
        localPath: proofPath,
        note: 'Existing unlike state confirms the tweet was already liked.',
      },
    });
  }

  const likeButton = currentPage.locator('button[data-testid="like"]').first();
  if (!await likeButton.isVisible().catch(() => false)) {
    return failAction(task, 'X like control could not be found in the current UI.');
  }

  await likeButton.click();

  try {
    await unlikeButton.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return failAction(task, 'Like click did not transition into the liked state.');
  }

  const proofPath = await captureProof(currentPage, `liked-${task.action.candidate.tweetId}`);
  await succeedAction(task, {
    proof: {
      type: 'screenshot',
      localPath: proofPath,
      note: 'Liked state verified in the DOM.',
    },
  });
}

async function executeReply(task) {
  const currentPage = await ensureBrowser();
  const account = await ensureExpectedAccount(currentPage, task.agent.handle);
  if (!account.ok) {
    return failAction(task, account.reason, { currentHandle: account.currentHandle });
  }

  if (!task.action.draft?.content) {
    return failAction(task, 'Reply action is missing approved draft content.');
  }

  await currentPage.goto(task.action.candidate.tweetUrl, { waitUntil: 'domcontentloaded' });
  await currentPage.waitForLoadState('networkidle', { timeout: NETWORK_SETTLE_TIMEOUT_MS }).catch(() => {});

  if (await detectCaptcha(currentPage)) {
    return failAction(task, 'X requested CAPTCHA or human verification before the reply could continue.');
  }

  try {
    await verifyTweetVisible(currentPage);
  } catch {
    return failAction(task, 'Target tweet is missing or no longer visible in the X UI.');
  }

  const replyButton = currentPage.locator('button[data-testid="reply"]').first();
  if (!await replyButton.isVisible().catch(() => false)) {
    return failAction(task, 'X reply control could not be found in the current UI.');
  }

  await replyButton.click();

  const composer = currentPage.locator('div[data-testid="tweetTextarea_0"]').first();
  if (!await composer.isVisible().catch(() => false)) {
    return failAction(task, 'Reply composer did not open.');
  }

  await composer.click();
  await currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await currentPage.keyboard.press('Backspace').catch(() => {});
  await currentPage.keyboard.insertText(task.action.draft.content);

  const submitButton = currentPage.locator('button[data-testid="tweetButton"]').first();
  if (!await submitButton.isEnabled().catch(() => false)) {
    return failAction(task, 'Reply submit button is disabled in the current UI.');
  }

  await submitButton.click();

  let success = false;
  try {
    await composer.waitFor({ state: 'hidden', timeout: 7000 });
    success = true;
  } catch {}

  if (!success) {
    const toastText = await currentPage.textContent('body').catch(() => '');
    success = /your post was sent|replying to|posted/i.test(toastText || '');
  }

  if (!success) {
    return failAction(task, 'Reply submit did not produce a clear success state in the X UI.');
  }

  const proofPath = await captureProof(currentPage, `reply-${task.action.candidate.tweetId}`);
  await succeedAction(task, {
    proof: {
      type: 'screenshot',
      localPath: proofPath,
      note: 'Reply composer closed after submit.',
    },
  });
}

async function executeTask(task) {
  try {
    if (task.action.type === 'like') {
      await executeLike(task);
      return;
    }
    await executeReply(task);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser execution failed unexpectedly.';
    await failAction(task, message);
  }
}

async function runLoop() {
  while (state.appUrl && state.pairingToken) {
    try {
      const next = await fetchJson(`${state.appUrl}/api/browser-companion/actions/next`);
      if (!next?.action) {
        runningActionId = null;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      runningActionId = next.action.id;
      await saveState();
      await executeTask(next);
      runningActionId = null;
      await saveState();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : 'Failed to poll browser actions.';
      runningActionId = null;
      await saveState();
      await sleep(POLL_INTERVAL_MS);
    }
  }
  runnerPromise = null;
}

function ensureRunner() {
  if (!state.appUrl || !state.pairingToken || runnerPromise) return;
  runnerPromise = runLoop();
}

async function pairCompanion(payload) {
  const appUrl = typeof payload?.appUrl === 'string' ? payload.appUrl.trim().replace(/\/$/, '') : '';
  const challenge = typeof payload?.challenge === 'string' ? payload.challenge.trim() : '';
  const machineLabel = typeof payload?.machineLabel === 'string' && payload.machineLabel.trim()
    ? payload.machineLabel.trim()
    : 'Desktop browser';

  if (!appUrl || !challenge) {
    throw new Error('appUrl and challenge are required');
  }

  const data = await fetchJson(`${appUrl}/api/browser-companion/pairings/complete`, {
    method: 'POST',
    body: {
      challenge,
      machineLabel,
    },
  });

  state.appUrl = appUrl;
  state.machineLabel = data?.pairing?.machineLabel || machineLabel;
  state.pairingId = data?.pairing?.id || null;
  state.pairingToken = data?.token || null;
  state.lastError = null;
  await saveState();
  ensureRunner();
  return data;
}

async function readHealth() {
  let currentHandle = currentHandleCache;
  try {
    if (!runningActionId) {
      currentHandle = await withTimeout(detectCurrentHandle(page), HEALTH_TIMEOUT_MS, currentHandleCache);
      currentHandleCache = currentHandle;
    }
  } catch {}

  return {
    ok: true,
    paired: !!state.pairingToken,
    pairingId: state.pairingId,
    machineLabel: state.machineLabel,
    currentHandle,
    runningActionId,
    lastError: state.lastError,
  };
}

async function start() {
  await loadState();
  await mkdir(PROOFS_DIR, { recursive: true });
  ensureRunner();

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      return sendJson(response, 404, { error: 'Not found' });
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, jsonHeaders());
      response.end();
      return;
    }

    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, await readHealth());
      }

      if (request.method === 'POST' && request.url === '/pair') {
        const payload = await readJson(request);
        const data = await pairCompanion(payload);
        return sendJson(response, 200, {
          paired: true,
          pairingId: data?.pairing?.id || null,
          machineLabel: state.machineLabel,
        });
      }

      return sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local companion request failed';
      state.lastError = message;
      await saveState();
      return sendJson(response, 500, { error: message });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[clawfable companion] http://${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  console.error('[clawfable companion] fatal', error);
  process.exitCode = 1;
});
