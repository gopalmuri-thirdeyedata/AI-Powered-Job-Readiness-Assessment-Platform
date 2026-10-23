// Pure validation/normalisation for the 3-field candidate registration popup.
// Exactly three inputs exist: Full Name, Phone Number (with country code) and Email Address.
// No OTP, no password, no verification, no candidate account.

export const COUNTRY_CODES = [
    { code: '+1', label: 'United States / Canada (+1)' },
    { code: '+44', label: 'United Kingdom (+44)' },
    { code: '+91', label: 'India (+91)' },
    { code: '+61', label: 'Australia (+61)' },
    { code: '+49', label: 'Germany (+49)' },
    { code: '+33', label: 'France (+33)' },
    { code: '+34', label: 'Spain (+34)' },
    { code: '+39', label: 'Italy (+39)' },
    { code: '+31', label: 'Netherlands (+31)' },
    { code: '+46', label: 'Sweden (+46)' },
    { code: '+47', label: 'Norway (+47)' },
    { code: '+65', label: 'Singapore (+65)' },
    { code: '+60', label: 'Malaysia (+60)' },
    { code: '+62', label: 'Indonesia (+62)' },
    { code: '+63', label: 'Philippines (+63)' },
    { code: '+66', label: 'Thailand (+66)' },
    { code: '+81', label: 'Japan (+81)' },
    { code: '+82', label: 'South Korea (+82)' },
    { code: '+86', label: 'China (+86)' },
    { code: '+852', label: 'Hong Kong (+852)' },
    { code: '+971', label: 'United Arab Emirates (+971)' },
    { code: '+966', label: 'Saudi Arabia (+966)' },
    { code: '+92', label: 'Pakistan (+92)' },
    { code: '+880', label: 'Bangladesh (+880)' },
    { code: '+94', label: 'Sri Lanka (+94)' },
    { code: '+977', label: 'Nepal (+977)' },
    { code: '+27', label: 'South Africa (+27)' },
    { code: '+234', label: 'Nigeria (+234)' },
    { code: '+254', label: 'Kenya (+254)' },
    { code: '+20', label: 'Egypt (+20)' },
    { code: '+55', label: 'Brazil (+55)' },
    { code: '+52', label: 'Mexico (+52)' },
    { code: '+54', label: 'Argentina (+54)' },
    { code: '+64', label: 'New Zealand (+64)' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (email) => (email || '').normalize('NFKC').trim().toLowerCase();

export const buildPhone = (countryCode, nationalNumber) => {
    const digits = (nationalNumber || '').replace(/[\s\-().]/g, '').replace(/^0+/, '');
    return `${countryCode || ''}${digits}`;
};

export const validateRegistration = ({ name, countryCode, phone, email }) => {
    const errors = {};
    const cleanName = (name || '').trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2) errors.name = 'Enter your full name (at least 2 characters).';
    else if (cleanName.length > 150) errors.name = 'Name is too long.';

    const nationalDigits = (phone || '').replace(/[\s\-().]/g, '');
    const fullPhone = buildPhone(countryCode, phone);
    if (!/^\d+$/.test(nationalDigits)) errors.phone = 'Enter digits only for your phone number.';
    else if (!/^\+[1-9]\d{6,14}$/.test(fullPhone)) errors.phone = 'Enter a valid phone number for the selected country code.';

    const cleanEmail = normalizeEmail(email);
    if (!EMAIL_RE.test(cleanEmail)) errors.email = 'Enter a valid email address.';
    else if (cleanEmail.length > 150) errors.email = 'Email address is too long.';

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        payload: { name: cleanName, phone: fullPhone, email: cleanEmail },
    };
};
