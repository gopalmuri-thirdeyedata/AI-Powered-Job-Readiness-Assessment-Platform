// Client-side checks for the job-description file upload. The server repeats every check (and also verifies the real content).

export const JD_MAX_BYTES = 10 * 1024 * 1024;
export const JD_EXTENSIONS = ['.pdf', '.docx', '.txt'];

export const formatBytes = (n) => {
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** Returns a user-facing problem, or null when the file may be sent to the server. */
export const validateJdFile = (file) => {
    if (!file) return 'Choose a file to upload.';
    const name = file.name || '';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    if (ext === '.doc') return 'Legacy .doc files are not supported. Save the document as .docx or .pdf and upload it again.';
    if (!JD_EXTENSIONS.includes(ext)) return 'Unsupported file type. Upload a .pdf, .docx or .txt file.';
    if (!file.size) return 'The selected file is empty.';
    if (file.size > JD_MAX_BYTES) return `The file is ${formatBytes(file.size)}; the limit is ${JD_MAX_BYTES / (1024 * 1024)} MB.`;
    return null;
};
