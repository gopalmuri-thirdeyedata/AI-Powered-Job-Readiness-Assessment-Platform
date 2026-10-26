import React from 'react';
import { Building2 } from 'lucide-react';
import { provenanceLabels } from '../../utils/questionProvenance';

/** Company / times-asked / year chips for a question. Renders nothing unless the question has verified source info. */
export default function QuestionProvenance({ provenance, styleCompany = '', className = '' }) {
    const labels = provenanceLabels(provenance, undefined, styleCompany);
    if (!labels.length) return null;
    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-testid="question-provenance">
            {labels.map((label) => (
                <span
                    key={label.key}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-800 text-[10px] sm:text-xs font-bold break-words"
                >
                    {(label.key === 'company' || label.key === 'style') && <Building2 className="w-3 h-3 shrink-0" aria-hidden="true" />}
                    {label.text}
                </span>
            ))}
        </div>
    );
}
