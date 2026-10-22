// Form rules for portfolio projects. They mirror the server's rules, so a student sees the problem next to the
// field before anything is sent; the server still checks everything again.

export const MIN_TITLE_CHARS = 3;
export const MAX_TITLE_CHARS = 120;
export const MIN_DESCRIPTION_WORDS = 20;
export const MIN_DESCRIPTION_CHARS = 100;
export const MAX_DESCRIPTION_CHARS = 4000;
export const MAX_TECH_ITEMS = 20;

const RESERVED_OWNERS = new Set([
    'orgs', 'settings', 'topics', 'features', 'marketplace', 'sponsors', 'about', 'pricing', 'login', 'join',
    'explore', 'notifications', 'pulls', 'issues', 'new', 'apps', 'enterprise', 'collections', 'trending',
    'search', 'security', 'customer-stories', 'readme', 'site', 'contact', 'gist',
]);
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export const EMPTY_PROJECT_FORM = { title: '', description: '', techStack: '', githubUrl: '', liveUrl: '' };

export const countWords = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

/** {ok: true, owner, repo, url} for a usable repository link, or {ok: false, error} saying what to fix. */
export const parseGithubRepoUrl = (input) => {
    const text = String(input ?? '').trim();
    if (!text) return { ok: false, error: 'Add your GitHub repository link. We use it to check and review your real code.' };
    if (/\s/.test(text)) return { ok: false, error: 'The GitHub link must not contain spaces.' };

    let parsed;
    try {
        parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return { ok: false, error: 'That is not a valid link. Copy it from the repository page on GitHub.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
        return { ok: false, error: 'Use a GitHub repository link, for example https://github.com/your-name/your-project.' };
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return { ok: false, error: 'Add the full repository link, for example https://github.com/your-name/your-project.' };
    if (parts.length === 1) {
        return { ok: false, error: 'That link points to a GitHub profile, not a repository. Open the project and copy its link, for example https://github.com/your-name/your-project.' };
    }
    const owner = parts[0];
    let repo = parts[1];
    if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
    if (RESERVED_OWNERS.has(owner.toLowerCase()) || !OWNER_RE.test(owner)) {
        return { ok: false, error: 'That does not look like a repository link. Copy it from the repository page on GitHub.' };
    }
    if (repo === '.' || repo === '..' || !REPO_RE.test(repo)) {
        return { ok: false, error: 'The repository name in that link is not valid. Copy the link from the repository page on GitHub.' };
    }
    return { ok: true, owner, repo, url: `https://github.com/${owner}/${repo}` };
};

/** Normalises an optional live demo address; returns {ok, url} (url is null when left empty). */
export const parseLiveUrl = (input) => {
    const text = String(input ?? '').trim();
    if (!text) return { ok: true, url: null };
    if (/\s/.test(text) || text.length > 500) return { ok: false, error: 'The live demo link is not a valid web address.' };
    try {
        const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        if (!parsed.hostname.includes('.')) throw new Error('no dot');
        let normalized = parsed.toString();
        if (parsed.pathname === '/' && !parsed.search && !parsed.hash) normalized = normalized.replace(/\/$/, ''); // https://app.dev, not https://app.dev/
        return { ok: true, url: normalized };
    } catch {
        return { ok: false, error: 'The live demo link is not a valid web address. Use something like https://my-project.vercel.app.' };
    }
};

export const splitTechStack = (input) => {
    const seen = new Set();
    const items = [];
    String(input ?? '').split(',').forEach((raw) => {
        const item = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (item && !seen.has(item.toLowerCase())) {
            seen.add(item.toLowerCase());
            items.push(item);
        }
    });
    return items.slice(0, MAX_TECH_ITEMS);
};

/** What the description counter should say. */
export const descriptionProgress = (description) => {
    const words = countWords(description);
    const chars = String(description ?? '').trim().length;
    const enough = words >= MIN_DESCRIPTION_WORDS && chars >= MIN_DESCRIPTION_CHARS;
    return { words, chars, enough, remainingWords: Math.max(0, MIN_DESCRIPTION_WORDS - words) };
};

/** Field problems keyed title / description / githubUrl / liveUrl; empty when the form can be saved. */
export const validateProjectForm = (form) => {
    const errors = {};
    const title = form.title.trim().replace(/\s+/g, ' ');
    if (title.length < MIN_TITLE_CHARS) errors.title = `Give your project a title of at least ${MIN_TITLE_CHARS} characters.`;
    else if (title.length > MAX_TITLE_CHARS) errors.title = `Keep the title under ${MAX_TITLE_CHARS} characters.`;

    const description = form.description.trim();
    const progress = descriptionProgress(description);
    if (description.length > MAX_DESCRIPTION_CHARS) {
        errors.description = `Keep the description under ${MAX_DESCRIPTION_CHARS} characters.`;
    } else if (!progress.enough) {
        errors.description = `Describe the project properly: at least ${MIN_DESCRIPTION_WORDS} words (${progress.words} so far). Say what it does, how it is built and what the result was.`;
    } else {
        const distinct = new Set(description.split(/\s+/).map((w) => w.toLowerCase().replace(/^[.,;:!?()"']+|[.,;:!?()"']+$/g, '')));
        if (distinct.size < 10) errors.description = 'The description repeats the same words. Describe what the project does and how you built it.';
    }

    // The repository link is optional; when one is typed it must be a real repository link
    if (form.githubUrl.trim()) {
        const github = parseGithubRepoUrl(form.githubUrl);
        if (!github.ok) errors.githubUrl = github.error;
    }
    const live = parseLiveUrl(form.liveUrl);
    if (!live.ok) errors.liveUrl = live.error;
    return errors;
};

/** Form values -> request body, with the repository link in its canonical form. */
export const buildProjectPayload = (form) => ({
    title: form.title.trim().replace(/\s+/g, ' '),
    description: form.description.trim(),
    tech_stack: splitTechStack(form.techStack),
    github_url: form.githubUrl.trim() ? (parseGithubRepoUrl(form.githubUrl).url || form.githubUrl.trim()) : null,
    live_url: parseLiveUrl(form.liveUrl).url,
});

export const formFromProject = (project) => ({
    title: project?.title || '',
    description: project?.description || '',
    techStack: (project?.tech_stack || []).join(', '),
    githubUrl: project?.github_url || '',
    liveUrl: project?.live_url || '',
});

/**
 * Splits a review into paragraphs and bold runs (the server marks headings as **bold**), so the page can show
 * real bold text instead of literal asterisks.
 */
export const formatReview = (text) => String(text ?? '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => (
        part.startsWith('**') && part.endsWith('**') && part.length > 4
            ? { text: part.slice(2, -2), bold: true }
            : { text: part, bold: false }
    )));
