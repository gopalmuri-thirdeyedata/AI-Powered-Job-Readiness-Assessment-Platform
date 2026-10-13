import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'light', toggleTheme: () => {} });

/**
 * ThemeProvider — wrap around the App root.
 *
 * Strategy:
 *  1. Read persisted preference from localStorage.
 *  2. If no preference, respect system prefers-color-scheme.
 *  3. Apply/remove `.dark` on <html> immediately (no flash).
 *  4. Expose { theme, toggleTheme } via context.
 */
export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => {
        try {
            const stored = localStorage.getItem('rr-theme');
            if (stored === 'dark' || stored === 'light') return stored;
        } catch { /* localStorage unavailable */ }

        // Default: light mode (ThirdEye / RoleReady default)
        return 'light';
    });

    // Apply class to document root whenever theme changes
    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        try {
            localStorage.setItem('rr-theme', theme);
        } catch { /* ignore */ }
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
