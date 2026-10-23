import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { copyText, ghostBtn, primaryBtn } from './adminUi';

export const fullShareUrl = (role) => (role.share_path ? `${window.location.origin}${role.share_path}` : role.share_url);

/** The single place a shared assessment link is displayed and copied (used by Overview and Shared Links). */
const SharedLinkField = ({ role, onCopy }) => {
    const [copied, setCopied] = useState(false);
    const url = fullShareUrl(role);
    const copy = async () => {
        const ok = await copyText(url);
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 2000);
        if (onCopy) onCopy(ok);
    };
    return (
        <div className="flex flex-col sm:flex-row gap-2">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={`Shared link for ${role.title}`}
                className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono px-3 py-2 text-slate-700 dark:text-slate-300" />
            <button type="button" className={primaryBtn} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}</button>
            <a className={ghostBtn} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Preview</a>
        </div>
    );
};

export default SharedLinkField;
