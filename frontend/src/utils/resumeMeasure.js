// Text measuring with jsPDF's font metrics, so the preview and the PDF break lines at exactly the same places.
// jsPDF is loaded on demand (it is large), and one measuring document is reused.

let measurePromise = null;

export const getMeasure = () => {
    if (!measurePromise) {
        measurePromise = import('jspdf').then(({ jsPDF }) => {
            const doc = new jsPDF({ unit: 'pt', format: 'a4' });
            return (text, font, style, size) => {
                doc.setFont(font, style);
                doc.setFontSize(size);
                return doc.getTextWidth(text);
            };
        }).catch((err) => {
            measurePromise = null; // allow a retry after a failed chunk load
            throw err;
        });
    }
    return measurePromise;
};
