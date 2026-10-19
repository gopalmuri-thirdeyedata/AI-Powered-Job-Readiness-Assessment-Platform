import React, { useState, useEffect, useRef } from 'react';
import {
    Bot,
    User,
    Send,
    X,
    Sparkles,
    Trash2,
    ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import studentApi from '../../services/studentApi';

const EASE = [0.16, 1, 0.3, 1];

const CareerCopilotDrawer = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingHistory, setIsFetchingHistory] = useState(false);
    const messagesEndRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            scrollToBottom();
        }
    }, [messages, isOpen]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadHistory = async () => {
        setIsFetchingHistory(true);
        try {
            const data = await studentApi.getCopilotHistory();
            setMessages(data.messages || []);
            setSuggestions(data.suggestions || []);
        } catch (err) {
            console.error('Failed to load copilot history:', err);
        } finally {
            setIsFetchingHistory(false);
        }
    };

    const handleSendMessage = async (textToSend = null) => {
        const query = (textToSend || inputValue).trim();
        if (!query || isLoading) return;

        // Optimistically add user message
        const optimisticUserMsg = {
            id: Date.now(),
            role: 'USER',
            content: query,
            created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimisticUserMsg]);
        setInputValue('');
        setIsLoading(true);

        try {
            const assistantMsg = await studentApi.sendCopilotMessage(query);
            setMessages(prev => [...prev, assistantMsg]);
        } catch (err) {
            const errorMsg = {
                id: Date.now() + 1,
                role: 'ASSISTANT',
                content: 'Sorry, I encountered an issue while processing your request. Please try again.',
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearHistory = async () => {
        if (!window.confirm('Clear your Career Copilot chat history?')) return;
        try {
            await studentApi.clearCopilotHistory();
            setMessages([]);
        } catch (err) {
            console.error('Failed to clear history:', err);
        }
    };

    // Career Copilot disabled and removed from view
    return null;

    return (
        <>
            {/* Floating Copilot Launcher Button */}
            <AnimatePresence>
            {!isOpen && (
                <motion.button
                    key="copilot-launcher"
                    initial={{ opacity: 0, y: 20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.9 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 z-40 px-3.5 py-2.5 sm:px-4 sm:py-3 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-full shadow-lg shadow-emerald-950/40 border border-emerald-400/30 flex items-center gap-2 sm:gap-2.5 transition-colors hover:scale-105 group font-medium text-xs sm:text-sm cursor-pointer"
                    aria-label="Open Career Copilot"
                >
                    <span className="relative flex h-2.5 w-2.5 sm:h-3 sm:w-3">
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-3 sm:w-3 bg-emerald-400"></span>
                    </span>
                    <Bot className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-100 group-hover:rotate-12 transition-transform" />
                    <span className="tracking-wide">Career Copilot</span>
                </motion.button>
            )}
            </AnimatePresence>

            {/* Slide-out Drawer */}
            <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="copilot-drawer"
                    initial={{ x: '100%', opacity: 0.6 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: '100%', opacity: 0 }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="fixed inset-y-0 right-0 z-50 w-full sm:w-[450px] max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-l border-slate-200 dark:border-slate-700/80 shadow-2xl flex flex-col font-sans"
                >
                    {/* Header */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-500/30">
                                <Bot className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-1.5">
                                    Career Copilot
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20">
                                        Grounded AI
                                    </span>
                                </h3>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Contextual placement preparation assistant</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleClearHistory}
                                title="Clear Conversation"
                                className="p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                aria-label="Close Career Copilot"
                                className="p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                        {messages.length === 0 && !isFetchingHistory && (
                            <div className="py-8 text-center space-y-4">
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl w-12 h-12 mx-auto flex items-center justify-center border border-emerald-200 dark:border-emerald-500/20 animate-pw-float motion-reduce:animate-none">
                                    <Sparkles className="w-6 h-6" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">How can I assist your career prep today?</h4>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs max-w-xs mx-auto">
                                        I am grounded in your resume scores, missing skills, preparation roadmap, and simulation metrics.
                                    </p>
                                </div>

                                {/* Dynamic starter suggestions */}
                                {suggestions.length > 0 && (
                                    <div className="space-y-2 pt-2 text-left">
                                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                                            Recommended Questions:
                                        </p>
                                        {suggestions.map((s, idx) => (
                                            <motion.button
                                                key={idx}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.35, delay: 0.15 + idx * 0.07, ease: EASE }}
                                                whileTap={{ scale: 0.98 }}
                                                onClick={() => handleSendMessage(s)}
                                                className="w-full text-left p-3 min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/70 hover:border-emerald-400 dark:hover:border-emerald-500/40 text-slate-700 dark:text-slate-300 transition-all text-xs flex items-center justify-between group cursor-pointer"
                                            >
                                                <span>{s}</span>
                                                <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                                            </motion.button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {messages.map((m) => {
                            const isUser = m.role === 'USER';
                            return (
                                <motion.div
                                    key={m.id}
                                    initial={{ opacity: 0, y: 12, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.3, ease: EASE }}
                                    className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                                        isUser 
                                            ? 'bg-emerald-600 text-white' 
                                            : 'bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700'
                                    }`}>
                                        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                    </div>
                                    <div className={`p-3.5 rounded-2xl max-w-[85%] leading-relaxed break-words ${
                                        isUser
                                            ? 'bg-emerald-600 text-white rounded-tr-none shadow-xs'
                                            : 'bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 rounded-tl-none border border-slate-200 dark:border-slate-700/80 whitespace-pre-line shadow-xs'
                                    }`}>
                                        {m.content}
                                    </div>
                                </motion.div>
                            );
                        })}

                        {isLoading && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                                className="flex items-start gap-2.5"
                            >
                                <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 flex items-center justify-center flex-shrink-0">
                                    <Bot className="w-4 h-4" />
                                </div>
                                <div className="p-3 bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-2xl rounded-tl-none text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-bounce motion-reduce:animate-none"></span>
                                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-bounce motion-reduce:animate-none [animation-delay:0.2s]"></span>
                                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-bounce motion-reduce:animate-none [animation-delay:0.4s]"></span>
                                    <span className="text-[11px] ml-1">Analyzing your context...</span>
                                </div>
                            </motion.div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Footer */}
                    <form 
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSendMessage();
                        }}
                        className="p-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/80 flex items-center gap-2"
                    >
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="Ask about roadmap, interview tips, skill gaps..."
                            disabled={isLoading}
                            className="flex-1 min-w-0 px-4 py-2.5 min-h-[44px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !inputValue.trim()}
                            aria-label="Send message"
                            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-all shadow-xs active:scale-90 disabled:opacity-40 cursor-pointer"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </form>
                </motion.div>
            )}
            </AnimatePresence>
        </>
    );
};

export default CareerCopilotDrawer;
