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
                className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/70 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none text-[13px] font-mono px-3 py-2 text-slate-600 dark:text-slate-300 truncate focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/25 dark:focus:ring-emerald-500/30 focus:border-[#5d8c2c] dark:focus:border-emerald-500 transition-colors" />
            <div className="flex gap-2 shrink-0">
                <button type="button" className={`${primaryBtn} flex-1 sm:flex-none`} onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy link'}</button>
                <a className={`${ghostBtn} flex-1 sm:flex-none`} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Preview</a>
            </div>
        </div>
    );
};

export default SharedLinkField;
