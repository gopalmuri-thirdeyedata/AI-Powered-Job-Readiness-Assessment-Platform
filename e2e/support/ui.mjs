// Browser helpers shared by the e2e specs. Chrome runs with a fake camera/microphone (deterministic video, no hardware).
import { chromium } from 'playwright-core';
import { chromePath } from './stack.mjs';

export async function launch({ grantMedia = true, viewport = { width: 1366, height: 900 }, extraArgs = [] } = {}) {
  const exe = chromePath();
  if (!exe) throw new Error('No Chrome/Chromium found: set E2E_CHROME to a browser executable.');
  // Fake camera/microphone devices; permission is granted (and can be revoked) per context, never auto-accepted by a flag.
  const args = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--window-size=1366,900', ...extraArgs];
  const browser = await chromium.launch({ executablePath: exe, headless: !process.env.E2E_HEADED, args });
  const context = await browser.newContext({ viewport, permissions: grantMedia ? ['camera', 'microphone'] : [] });
  return { browser, context };
}

/** A page with the request/response/console telemetry the specs assert on. */
export async function newPage(context, apiBase) {
  const page = await context.newPage();
  const t = { requests: [], responses: [], console: [], errors: [] };
  page.on('request', (r) => { if (r.url().startsWith(apiBase)) t.requests.push(`${r.method()} ${r.url().slice(apiBase.length)}`); });
  page.on('response', (r) => { if (r.url().startsWith(apiBase)) t.responses.push({ method: r.request().method(), path: r.url().slice(apiBase.length), status: r.status() }); });
  page.on('console', (m) => t.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => t.errors.push(String(e)));
  const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const count = (re) => t.requests.filter((r) => re.test(r)).length;
  return { page, t, text, count };
}

/** Section timer and overall timer as shown in the workspace header: ["19:57", "59:52"] (null if not visible). */
export const timers = async (ui) => ((await ui.text()).match(/(\d\d:\d\d)\s+TOTAL\s+(\d\d:\d\d)/) || []).slice(1) || null;
export const toSeconds = (mmss) => { const [m, s] = mmss.split(':').map(Number); return m * 60 + s; };

// ------------------------------------------------------------------------------ recruitment candidate
/**
 * Opens the shared link and signs in with the student's own account (the invited-student workflow: no name / phone form).
 * Resolves with the student's email once the instructions page is showing; nothing has been started at that point.
 */
export async function registerCandidate(ui, web, shareToken, student) {
  const { page } = ui;
  await page.goto(`${web}/assessment/join/${shareToken}`);
  await page.getByPlaceholder('you@example.com').fill(student.email);
  await page.locator('input[autocomplete="current-password"]').fill(student.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/instructions/, { timeout: 20000 });
  return student.email;
}

export async function acknowledgeAndOpenDeviceCheck(ui) {
  const { page } = ui;
  await page.locator('#instructions-ack').check();
  await page.getByRole('button', { name: 'Continue to Device Check' }).click();
  await page.waitForURL(/assessment$/, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

export async function clickStart(ui) {
  const { page } = ui;
  await page.locator('input[type=checkbox]').last().check();
  await page.getByRole('button', { name: /Start Assessment/ }).click();
  await page.waitForSelector('text=Question 1 of 15', { timeout: 30000 });
}

// ------------------------------------------------------------------------------ shared workspace (both workflows)
const LETTERS = ['A', 'B', 'C', 'D'];
export const pickOption = (page, letter) => page.getByText(new RegExp(`^${letter}$`)).first().click();

/** Answer questions [from, to) with the pattern A,B,C,D,A,... and move on. Returns the chosen letters. */
export async function answerAptitude(ui, { count = 15, submit = true } = {}) {
  const { page } = ui;
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const letter = LETTERS[i % 4];
    chosen.push(letter);
    await pickOption(page, letter);
    if (i < count - 1) await page.getByRole('button', { name: /Next Question/ }).click();
    await page.waitForTimeout(100);
  }
  if (submit) await page.getByRole('button', { name: /Submit Aptitude/ }).click();
  return chosen;
}

/** Replace the Monaco editor content (insertText behaves like a paste; keep Python free of nested indentation). */
export async function setCode(ui, code) {
  const { page } = ui;
  await page.locator('.monaco-editor .view-lines').first().click();
  if (await page.evaluate((c) => { const m = window.monaco?.editor?.getModels?.() || []; if (!m.length) return false; m[0].setValue(c); return true; }, code)) {
    await page.waitForTimeout(700);
    return;
  }
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await page.waitForTimeout(700);
}

// Like a paste: sets the editor text exactly. Typing into Monaco re-applies auto-indent to every new line, which corrupts nested Python
// (students now write `class Solution` with an indented method). Falls back to typing when Monaco is not exposed on the page.
export async function setCodeExact(ui, code) {
  const { page } = ui;
  await page.locator('.monaco-editor .view-lines').first().click();
  const done = await page.evaluate((c) => {
    const models = window.monaco?.editor?.getModels?.() || [];
    if (!models.length) return false;
    models[0].setValue(c);
    return true;
  }, code);
  if (!done) return setCode(ui, code);
  await page.waitForTimeout(700);
}

export const editorText = (ui) => ui.page.locator('.monaco-editor .view-lines').first().innerText().then((t) => t.replace(/\s+/g, ' '));
// The student coding round is the LeetCode-style workspace: a Run button and a Result tab (recruitment keeps runPublicTests below).
export const runSample = async (ui, settleMs = 1500) => {
  await ui.page.getByRole('button', { name: /^Run\b/ }).click();
  await ui.page.waitForSelector('text=/Accepted|Wrong Answer|Compilation Error|Runtime Error|Time Limit Exceeded|Finished/', { timeout: 60000 });
  await ui.page.waitForTimeout(settleMs);
  return ui.text();
};

// The shared LeetCode-style workspace: the Run button, then the Result tab (kept under its old name for the specs that use it)
export const runPublicTests = (ui, settleMs = 1500) => runSample(ui, settleMs);

// Programs (stdin = one JSON value per line, stdout = JSON result) for the offline blueprint's problems:
// problem 1 "Sum Two Numbers" (solve(a, b)) and problem 2 "Reverse String" (solve(s)).
export const SOLUTIONS = {
  // LeetCode structure: students and shared-link candidates alike write only the method of `class Solution`
  sumPython: 'class Solution:\n    def sum_two_numbers(self, a, b):\n        return a + b\n',
  reversePython: 'class Solution:\n    def reverse_string(self, s):\n        return s[::-1]\n',
  pythonRuntimeError: 'class Solution:\n    def reverse_string(self, s):\n        return 1 // 0\n',
};

export const openCoding = async (ui) => { await ui.page.waitForSelector('text=Round 2', { timeout: 30000 }).catch(() => {}); await ui.page.waitForTimeout(1500); };

// ------------------------------------------------------------------------------ composite flows
/** Make every voice turn fail like an unreachable voice service, so a test reaches the connection-failed / written-answer path. */
export const stubVoiceApi = (page) => page.route('**/voice-turn', (route) => route.fulfill({
  status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'The voice service is unavailable right now. Please try again.' }),
}));

/** From the student's first screen to a started attempt (sign in -> instructions -> device check -> explicit start). `org` is a stack.newOrg() result. */
export async function startRecruitmentAttempt(ui, stack, org) {
  const student = await stack.newOrgStudent(org);
  const email = await registerCandidate(ui, stack.web, org.share_token, student);
  await acknowledgeAndOpenDeviceCheck(ui);
  await clickStart(ui);
  return email;
}

/** The session uuid of the sitting the page created (read from the page's own API traffic, not from the DOM). */
export const sessionUuid = (ui) => {
  const hit = ui.t.requests.map((r) => r.match(/\/public\/assessment\/session\/([0-9a-f-]{36})\//)).find(Boolean);
  return hit ? hit[1] : null;
};

/** Submit coding and wait for the interview screen. */
export async function submitCodingToInterview(ui) {
  await ui.page.getByRole('button', { name: /Submit All & Unlock Interview/ }).click();
  // The round-result screen holds until the candidate continues (it no longer advances on its own)
  const proceed = ui.page.getByRole('button', { name: /Continue to Interview/ });
  await proceed.waitFor({ state: 'visible', timeout: 60000 }).then(() => proceed.click()).catch(() => {});
  await ui.page.waitForSelector('text=/AI Video Interview|Written interview|Connecting to AI Interviewer|Connection Failed/', { timeout: 60000 });
  await ui.page.waitForTimeout(1500);
}

export async function answerWrittenInterview(ui, text = 'I would profile first, then fix the root cause, adding tests and monitoring for regressions.') {
  const { page } = ui;
  await page.getByRole('button', { name: 'Answer in writing instead' }).click();
  await page.waitForSelector('textarea');
  const areas = page.locator('textarea');
  for (let i = 0; i < await areas.count(); i++) await areas.nth(i).fill(`${text} (answer ${i + 1})`);
}

export async function finishInterview(ui) {
  const { page } = ui;
  // the written-answers overlay has its own Finish button (exact name); the call's red End Interview control is underneath it
  const written = page.getByRole('button', { name: 'Finish interview', exact: true });
  if (await written.count()) await written.click(); else await page.getByRole('button', { name: 'End Interview' }).click();
  await page.getByRole('button', { name: /Submit & Complete/ }).click();
}

/** Make getUserMedia reject for AUDIO once armed (what a blocked microphone looks like to the app). Call before the first navigation. */
export const armMicDenial = (context) => context.addInitScript(() => {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  window.__denyMic = false;
  md.getUserMedia = (constraints) => {
    if (window.__denyMic && constraints && constraints.audio) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    return original(constraints);
  };
});

// ------------------------------------------------------------------------------ Student Platform
// Real sign-in: POST /api/auth/login/ through the browser context's request client, so the HttpOnly session cookie lands in the SAME
// cookie jar the page uses. The app then validates it with /api/auth/me exactly as for a human login.
export const signIn = async (context, api, { email, password }) => {
  const res = await context.request.post(`${api}/api/auth/login/`, { data: { email, password } });
  if (!res.ok()) throw new Error(`e2e login failed for ${email}: HTTP ${res.status()}`);
  return res.json();
};
export const signInStudent = signIn;

/** What the vision service would say for a candidate who is simply sitting there (YOLO itself is tested in the backend suite). */
export const stubCleanProctoring = (page) => page.route('**/api/proctor/analyze-frame', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ status: 'ok', model_name: 'stub', violations: [], detections: [], person_count: 1, suspect_label: null, face_boxes: [] }),
}));

export async function dismissTour(page) {
  // The first-visit guided tour opens a moment after the page; it blocks every click until it is skipped.
  const dialog = page.locator('[role=dialog][aria-label="Guided tour"]');
  try { await dialog.waitFor({ state: 'visible', timeout: 6000 }); } catch { return; }
  await page.getByRole('button', { name: /skip/i }).first().click();
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

export const STUDENT_JD = 'We need a Full Stack Engineer with Python, FastAPI, React and SQL experience to build and run production services.';

/** Setup page -> POST initialize -> workspace instructions. Returns the session uuid. */
export async function createStudentAssessment(ui, web, { role = 'Full Stack Engineer', jd = STUDENT_JD } = {}) {
  const { page } = ui;
  await page.goto(`${web}/assessment/setup`);
  await dismissTour(page);
  await page.getByRole('button', { name: role, exact: true }).click();
  await page.getByPlaceholder(/Paste the job description text here/).fill(jd);
  await page.getByRole('button', { name: /Start Assessment/ }).click();
  await page.waitForURL(/\/assessment\/[0-9a-f-]{36}$/, { timeout: 120000 });
  return page.url().split('/').pop();
}

export async function studentDeviceCheckAndStart(ui) {
  const { page } = ui;
  await page.getByRole('button', { name: 'Continue to Device Check' }).click();
  await page.waitForTimeout(2500);
  await page.locator('input[type=checkbox]').last().check();
  await page.getByRole('button', { name: /Start Assessment/ }).click();
  await page.waitForSelector('text=/Question 1 of [0-9]+/', { timeout: 60000 });
}

export const aptitudeCount = async (ui) => Number(((await ui.text()).match(/Question 1 of (\d+)/) || [])[1]);

// One-expression Python / plain Java solutions for the two problems the offline student question set produces
// (longest run of distinct tokens; balanced tag sequence). Python stays free of nested indentation (Monaco auto-indents).
export const STUDENT_SOLUTIONS = {
  // Students write only the function inside `class Solution` (LeetCode structure); reading stdin and printing are added by the server.
  uniqueRunPython: "class Solution:\n    def longest_unique_run(self, tokens):\n        return max((j - i for i in range(len(tokens)) for j in range(i + 1, len(tokens) + 1) if len(set(tokens[i:j])) == j - i), default=0)\n",
  uniqueRunJava: [
    'import java.util.*;',
    'public class Main {',
    'public static void main(String[] args) {',
    'Scanner scanner = new Scanner(System.in);',
    'String line = scanner.hasNextLine() ? scanner.nextLine().trim() : "";',
    'String[] t = line.isEmpty() ? new String[0] : line.split(" +");',
    'int best = 0, left = 0; Map<String, Integer> last = new HashMap<>();',
    'for (int r = 0; r < t.length; r++) {',
    'if (last.containsKey(t[r]) && last.get(t[r]) >= left) left = last.get(t[r]) + 1;',
    'last.put(t[r], r); best = Math.max(best, r - left + 1);',
    '}',
    'System.out.println(best);',
    '}',
    '}',
  ].join('\n') + '\n',
  tagsPython: "import functools\n\nclass Solution:\n    def is_valid_jsx(self, tag_str):\n        return 'true' if functools.reduce(lambda st, t: None if st is None else ((st[:-1] if st and st[-1] == t[2:-1] else None) if t.startswith('</') else st + [t[1:-1]]), tag_str.split(), []) == [] else 'false'\n",
  pythonSyntaxError: "class Solution:\n    def is_valid_jsx(self, tag_str):\n        return (\n",
  tagsJava: [
    'import java.util.*;',
    'public class Main {',
    'public static void main(String[] args) {',
    'Scanner scanner = new Scanner(System.in);',
    'String line = scanner.hasNextLine() ? scanner.nextLine().trim() : "";',
    'Deque<String> st = new ArrayDeque<>(); boolean ok = true;',
    'for (String t : line.isEmpty() ? new String[0] : line.split(" +")) {',
    'if (t.startsWith("</")) { String name = t.substring(2, t.length() - 1); if (st.isEmpty() || !st.peek().equals(name)) { ok = false; break; } st.pop(); }',
    'else st.push(t.substring(1, t.length() - 1));',
    '}',
    'System.out.println(ok && st.isEmpty() ? "true" : "false");',
    '}',
    '}',
  ].join('\n') + '\n',
};

/** What the vision service reports when nobody is in front of the camera (deterministic stand-in for YOLO). */
export const stubNoPersonProctoring = (page) => page.route('**/api/proctor/analyze-frame', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ status: 'ok', model_name: 'stub', violations: ['no_person'], detections: [], person_count: 0, suspect_label: null, face_boxes: [] }),
}));
