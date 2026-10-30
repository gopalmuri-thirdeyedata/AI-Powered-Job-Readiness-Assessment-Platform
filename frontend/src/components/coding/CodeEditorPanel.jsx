import React, { useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import { EDITOR_OPTIONS, EditorStatusBar, EditorToolbar, Pane, useCursorPosition, useIsDark } from './workspaceParts';
import { monacoLanguage } from '../../utils/codingLanguages';

// The assessment editor has no right-click menu (its Paste entry) and takes no dropped text, unless protection is switched off for testing.
const PROTECTED_EDITOR_OPTIONS = { ...EDITOR_OPTIONS, contextmenu: false, dropIntoEditor: { enabled: false } };

/**
 * THE student code editor: toolbar (language, colour scheme, reset, expand), Monaco with the PrepWin editor options, and the
 * Ln / Col status bar. The Assessment coding round, the Coding page and the Practice page all render this one component, so the
 * editor looks and behaves the same everywhere. Everything around it (problem text, Run / Submit buttons, results, progress,
 * timers) stays with each feature; this only edits code and reports what happened:
 *
 *   code / onCodeChange          the controlled source text
 *   language                     'python' | 'java' | 'cpp' | 'c' (syntax highlighting + the label)
 *   languageOptions + onLanguageChange   two or more languages turn the static label into a dropdown
 *   path                         Monaco model name: a new path starts a fresh undo history (one per problem / language)
 *   onRun / onSubmit             Ctrl/Cmd + '  and  Ctrl/Cmd + Enter inside the editor (a shortcut is only bound when its callback is given)
 *   onReset                      the toolbar's reset button
 *   themeIsDark / onToggleTheme  the assessment keeps its own light/dark switch; everyone else follows the app theme
 *   expanded / onToggleExpand    the toolbar's expand button (only where the page can widen the editor)
 *   protectedInput               assessment integrity: no context menu, no dropped text
 *   saved                        status-bar text on the left ("Autosaved" where the page stores drafts, '' where it does not)
 *   className                    the page's layout classes for the panel (heights, mobile-tab visibility)
 */
const CodeEditorPanel = ({
    code, onCodeChange, language = 'python', languageOptions, onLanguageChange, languageDisabled, path,
    onRun, onSubmit, onReset, themeIsDark, onToggleTheme, expanded, onToggleExpand, protectedInput = false, saved = 'Autosaved', className = '',
}) => {
    const appDark = useIsDark();
    const dark = themeIsDark === undefined ? appDark : themeIsDark;
    const [cursor, trackCursor] = useCursorPosition();
    const runRef = useRef(onRun);
    const submitRef = useRef(onSubmit);
    runRef.current = onRun;
    submitRef.current = onSubmit;

    return (
        <Pane className={className}>
            <EditorToolbar onReset={onReset} onToggleTheme={onToggleTheme} themeIsDark={dark} expanded={expanded} onToggleExpand={onToggleExpand}
                language={language} languageOptions={languageOptions} onLanguageChange={onLanguageChange} languageDisabled={languageDisabled} />
            <div className="flex-1 min-h-0">
                <Editor
                    height="100%"
                    path={path}
                    language={monacoLanguage(language)}
                    theme={dark ? 'vs-dark' : 'light'}
                    value={code}
                    onChange={(v) => onCodeChange(v ?? '')}
                    onMount={(editor, monaco) => {
                        trackCursor(editor);
                        if (runRef.current) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Quote, () => runRef.current());
                        if (submitRef.current) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => submitRef.current());
                    }}
                    options={protectedInput ? PROTECTED_EDITOR_OPTIONS : EDITOR_OPTIONS}
                />
            </div>
            <EditorStatusBar saved={saved} position={cursor} />
        </Pane>
    );
};

export default CodeEditorPanel;
