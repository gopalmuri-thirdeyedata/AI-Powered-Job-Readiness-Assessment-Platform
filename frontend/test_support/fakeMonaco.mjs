// Test stand-in for @monaco-editor/react: a plain element that exposes the props a test may assert on.
import React from 'react';

export const Editor = ({ language, path, value }) => React.createElement('div', { 'data-monaco': '', 'data-language': language, 'data-path': path }, value);
export default Editor;
