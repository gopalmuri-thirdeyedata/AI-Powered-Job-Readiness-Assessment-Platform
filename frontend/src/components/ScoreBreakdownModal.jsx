import React from 'react';
import { X, TrendingUp, MessageSquare, Lightbulb, BookOpen, Award } from 'lucide-react';

const ScoreBreakdownModal = ({ candidate, onClose, onViewTranscript }) => {
    if (!candidate) return null;

    const scores = candidate.analysis_data?.interview?.scores || {};
    const {
        technical_accuracy = 0,
        communication_clarity = 0,
        problem_solving = 0,
        depth_of_knowledge = 0,
        overall_score = 0,
        feedback = "No evaluation available"
    } = scores;

    const getScoreColor = (score) => {
        if (score >= 88) return 'text-green-700 bg-green-50 border-green-200';
        if (score >= 70) return 'text-green-600 bg-white border-green-200';
        if (score >= 60) return 'text-green-600 bg-white border-green-200';
        return 'text-red-600 bg-red-50 border-red-200';
    };

    const getProgressColor = (score) => {
        if (score >= 88) return 'bg-green-600';
        if (score >= 70) return 'bg-green-500';
        if (score >= 60) return 'bg-green-500';
        return 'bg-red-500';
    };

    const scoreItems = [
        { label: 'Technical Accuracy', value: technical_accuracy, icon: TrendingUp, desc: 'Correctness and depth of technical answers' },
        { label: 'Communication Clarity', value: communication_clarity, icon: MessageSquare, desc: 'Ability to explain concepts clearly' },
        { label: 'Problem-Solving Approach', value: problem_solving, icon: Lightbulb, desc: 'Logical thinking and methodology' },
        { label: 'Depth of Knowledge', value: depth_of_knowledge, icon: BookOpen, desc: 'Understanding beyond surface level' }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto transform scale-100 transition-all">

                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white">
                    <div>
                        <h3 className="font-bold text-gray-900 text-lg">{candidate.name}</h3>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mt-1">Interview Performance Breakdown</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/50 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Overall Score */}
                <div className="p-6 bg-white border-b border-gray-100">
                    <div className="flex items-center justify-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-white shadow-lg flex items-center justify-center border-4 border-green-100">
                            <Award className="w-8 h-8 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 font-bold uppercase tracking-wide">Overall Score</p>
                            <p className={`text-5xl font-extrabold ${getScoreColor(overall_score).split(' ')[0]}`}>
                                {overall_score.toFixed(1)}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Score Breakdown */}
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    {scoreItems.map((item, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                                        <item.icon className="w-4 h-4 text-gray-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-900 text-sm">{item.label}</p>
                                        <p className="text-xs text-gray-500">{item.desc}</p>
                                    </div>
                                </div>
                                <span className={`text-2xl font-extrabold ${getScoreColor(item.value).split(' ')[0]}`}>
                                    {item.value}
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div
                                    className={`h-full ${getProgressColor(item.value)} transition-all duration-500`}
                                    style={{ width: `${item.value}%` }}
                                />
                            </div>
                        </div>
                    ))}

                    {/* AI Feedback */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-6">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">AI Evaluator Feedback</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{feedback}</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-3">
                    {onViewTranscript && (
                        <button
                            onClick={onViewTranscript}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold shadow-md transition-all flex items-center gap-2"
                        >
                            <MessageSquare size={16} /> View Full Transcript
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-bold transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScoreBreakdownModal;
