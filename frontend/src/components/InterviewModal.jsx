import React from 'react';
import { X, Clock, User, Bot, Calendar, FileText } from 'lucide-react';

const InterviewModal = ({ candidate, onClose }) => {
    if (!candidate) return null;

    // Extract interview data
    // Handles structure: candidate.analysis_data.interview = { transcript: [], duration_seconds: 123, ... }
    const interviewData = candidate.analysis_data?.interview || {};
    // Ensure transcript is an array before using map (Backwards compatibility for string legacy data if any)
    let transcript = interviewData.transcript || [];
    if (typeof transcript === 'string') {
        // If it somehow got saved as string (legacy bug), wrap it
        transcript = [{ speaker: 'system', text: transcript, timestamp: '' }];
    }
    const durationSeconds = interviewData.duration_seconds || 0;
    const completedAt = interviewData.completed_at || new Date().toISOString();

    const formatTime = (seconds) => {
        if (!seconds) return "0m 0s";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const formatDate = (dateString) => {
        try {
            return new Date(dateString).toLocaleString();
        } catch (e) {
            return dateString;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl h-[85vh] max-h-[85vh] flex flex-col overflow-hidden transform scale-100 transition-all">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg">{candidate.name}</h3>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mt-1">Technical Interview Result</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Stats Bar */}
                <div className="bg-white px-6 py-4 flex items-center gap-6 border-b border-gray-100 shadow-sm z-10">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                            <Clock size={16} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">Duration</p>
                            <p className="text-sm font-bold text-gray-900">{formatTime(durationSeconds)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                            <Calendar size={16} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 font-bold uppercase">Completed</p>
                            <p className="text-sm font-bold text-gray-900">{formatDate(completedAt)}</p>
                        </div>
                    </div>
                    <div className="flex-1 text-right">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                            Completed
                        </span>
                    </div>
                </div>

                {/* AI Scores Section */}
                {interviewData.scores && (
                    <div className="bg-white px-6 py-4 border-b border-gray-200">
                        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">AI Performance Evaluation</p>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div className="bg-white rounded-lg p-3 text-center shadow-sm border border-gray-200">
                                <p className="text-xs text-gray-500 font-medium mb-1">Technical</p>
                                <p className="text-xl font-bold text-green-600">{interviewData.scores.technical_accuracy || 0}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center shadow-sm border border-gray-200">
                                <p className="text-xs text-gray-500 font-medium mb-1">Communication</p>
                                <p className="text-xl font-bold text-green-600">{interviewData.scores.communication_clarity || 0}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center shadow-sm border border-gray-200">
                                <p className="text-xs text-gray-500 font-medium mb-1">Problem-Solving</p>
                                <p className="text-xl font-bold text-green-600">{interviewData.scores.problem_solving || 0}</p>
                            </div>
                            <div className="bg-white rounded-lg p-3 text-center shadow-sm border border-gray-200">
                                <p className="text-xs text-gray-500 font-medium mb-1">Depth</p>
                                <p className="text-xl font-bold text-green-600">{interviewData.scores.depth_of_knowledge || 0}</p>
                            </div>
                            <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg p-3 text-center shadow-md border-2 border-green-200">
                                <p className="text-xs text-white font-bold mb-1">Overall</p>
                                <p className="text-2xl font-extrabold text-white">{(interviewData.scores.overall_score || 0).toFixed(1)}</p>
                            </div>
                        </div>
                    </div>
                )}


                {/* Transcript Area */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                    {transcript.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <FileText size={24} />
                            </div>
                            <p>No transcript data available.</p>
                        </div>
                    ) : (
                        transcript.map((msg, idx) => (
                            <div key={idx} className={`flex items-start gap-3 ${msg.speaker === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.speaker === 'user' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                    {msg.speaker === 'user' ? <User size={14} /> : <Bot size={14} />}
                                </div>
                                <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${msg.speaker === 'user'
                                    ? 'bg-green-600 text-white rounded-tr-none'
                                    : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
                                    }`}>
                                    <p className="leading-relaxed">{msg.text}</p>
                                    <p className={`text-[10px] mt-2 font-medium ${msg.speaker === 'user' ? 'text-green-100' : 'text-gray-400'
                                        }`}>
                                        {msg.timestamp}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 bg-white flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-bold transition-colors"
                    >
                        Close Transcript
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InterviewModal;
