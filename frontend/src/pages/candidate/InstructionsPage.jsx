import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, AlertTriangle, Play, FileText } from 'lucide-react';
import API_URL from '../../apiConfig';

const InstructionsPage = () => {
    const navigate = useNavigate();

    // Prevent completed candidates from accessing instructions page
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        if (!token) return;

        fetch(`${API_URL}/api/assessments/my-status/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (!res.ok) throw new Error();
            return res.json();
        })
        .then(latest => {
            if (latest && latest.status === 'completed') {
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                navigate('/portal/login');
            }
        })
        .catch(() => {});
    }, [navigate]);

    const [accepted, setAccepted] = useState(false);

    const candidateName = localStorage.getItem('candidateName') || 'Candidate';
    const assessmentData = localStorage.getItem('currentAssessment');
    const assessment = assessmentData ? JSON.parse(assessmentData) : null;

    // Debug: Log assessment type

    // Pre-generate questions when page loads (for aptitude assessments)
    useEffect(() => {
        if (assessment && assessment.type === 'aptitude') {
            // Check if questions are already generated
            const storedQuestions = localStorage.getItem('aptitudeQuestions');
            if (!storedQuestions) {
                // Generate questions now so they're ready when user clicks Start
                const config = assessment.config || {};
                const description = config.description || config.aiDescription || "General Aptitude";
                const questionCount = config.qCount || 10;

                // Question templates for variety
                const questionTemplates = [
                    {
                        question: `Based on '${description}', which of the following is most critical?`,
                        options: ["Efficiency", "Accuracy", "Speed", "Collaboration"],
                        correct: 0
                    },
                    {
                        question: "Complete the series: 2, 6, 12, 20, ?",
                        options: ["28", "30", "32", "42"],
                        correct: 1
                    },
                    {
                        question: "If A is the brother of B; B is the sister of C; and C is the father of D, how is D related to A?",
                        options: ["Brother", "Sister", "Nephew/Niece", "Uncle"],
                        correct: 2
                    },
                    {
                        question: "Identify the next logical shape in the sequence (Abstract Reasoning).",
                        options: ["Shape A", "Shape B", "Shape C", "Shape D"],
                        correct: 0
                    },
                    {
                        question: "Verbal Ability: Choose the synonym for 'Ephemeral'.",
                        options: ["Lasting", "Short-lived", "Eternal", "Heavy"],
                        correct: 1
                    },
                    {
                        question: "What is 15% of 200?",
                        options: ["25", "30", "35", "40"],
                        correct: 1
                    },
                    {
                        question: "Which word does NOT belong: Apple, Banana, Carrot, Orange?",
                        options: ["Apple", "Banana", "Carrot", "Orange"],
                        correct: 2
                    },
                    {
                        question: "If all Bloops are Razzies and all Razzies are Lazzies, then all Bloops are definitely Lazzies.",
                        options: ["True", "False", "Cannot be determined", "Insufficient data"],
                        correct: 0
                    },
                    {
                        question: "Complete: 3, 9, 27, 81, ?",
                        options: ["162", "243", "324", "405"],
                        correct: 1
                    },
                    {
                        question: "Choose the antonym for 'Abundant'.",
                        options: ["Plentiful", "Scarce", "Sufficient", "Ample"],
                        correct: 1
                    },
                    {
                        question: "If today is Wednesday, what day will it be 100 days from now?",
                        options: ["Monday", "Tuesday", "Wednesday", "Thursday"],
                        correct: 3
                    },
                    {
                        question: "What is the next number: 1, 1, 2, 3, 5, 8, ?",
                        options: ["11", "13", "15", "17"],
                        correct: 1
                    },
                    {
                        question: "Logical Reasoning: All roses are flowers. Some flowers fade quickly. Therefore, some roses fade quickly.",
                        options: ["True", "False", "Cannot be determined", "Partially true"],
                        correct: 2
                    },
                    {
                        question: "If 5 workers can complete a task in 10 days, how many days will 10 workers take?",
                        options: ["5 days", "10 days", "15 days", "20 days"],
                        correct: 0
                    },
                    {
                        question: "Choose the correct analogy: Book is to Reading as Fork is to ?",
                        options: ["Drawing", "Eating", "Writing", "Cooking"],
                        correct: 1
                    }
                ];

                // Generate the exact number of questions requested
                const generatedQuestions = [];
                for (let i = 0; i < questionCount; i++) {
                    const template = questionTemplates[i % questionTemplates.length];
                    generatedQuestions.push({
                        id: i + 1,
                        question: `Q${i + 1}: ${template.question}`,
                        options: template.options,
                        correct: template.correct
                    });
                }

                // Store questions in localStorage
                localStorage.setItem('aptitudeQuestions', JSON.stringify(generatedQuestions));
            }
        }
    }, [assessment]);

    // Determine round details dynamically from actual config
    let roundDetails = {
        type: 'Assessment Round',
        duration: 'N/A',
        questions: 'N/A',
        topic: 'General'
    };

    if (assessment) {
        const config = assessment.config || {};

        if (assessment.type === 'aptitude') {
            roundDetails = {
                type: 'AI Aptitude Assessment',
                duration: `${config.duration || 30} Minutes`,
                questions: `${config.qCount || 10} Questions`,
                topic: config.description || 'General Intelligence & Logic'
            };
        } else if (assessment.type === 'coding') {
            roundDetails = {
                type: 'Coding Challenge',
                duration: `${config.timeLimit || 60} Minutes`,
                questions: config.problemCount ? `${config.problemCount} Problems` : '2 Problems',
                topic: config.description || 'Data Structures & Algorithms'
            };
        } else if (assessment.type === 'interview') {
            roundDetails = {
                type: 'AI Video Interview',
                duration: `${config.duration || 20} Minutes`,
                questions: 'Variable',
                topic: config.focus || 'Behavioral & Technical'
            };
        }
    }

    const handleStart = async () => {
        if (accepted && assessment) {
            // MARK AS STARTED ON BACKEND
            try {
                const token = localStorage.getItem('candidateToken');
                await fetch(`${API_URL}/api/assessments/start/${assessment.id}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (err) {
                console.error("Failed to mark assessment as started", err);
            }

            // Enter fullscreen — must be called inside a user gesture (this click handler)
            try {
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                }
            } catch (err) {
                console.warn('[Fullscreen] requestFullscreen failed:', err.message);
            }

            if (assessment.type === 'aptitude') {
                navigate('/portal/assessment/aptitude');
            } else if (assessment.type === 'coding') {
                navigate('/portal/assessment/coding');
            } else if (assessment.type === 'interview') {
                navigate('/portal/assessment/interview');
            }
        }
    };

    return (
        <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-8 text-white">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                                Welcome, {candidateName}
                            </h1>
                            <button
                                onClick={() => { localStorage.clear(); navigate('/portal/login'); }}
                                className="text-xs text-blue-200 hover:text-white mt-1 underline"
                            >
                                Not you? Log out
                            </button>
                            <p className="text-blue-100 mt-2 text-sm opacity-90 max-w-lg">
                                You have been invited to participate in the following assessment round. Please review the details below.
                            </p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-xl text-center self-start sm:self-auto">
                            <p className="text-xs text-blue-100 uppercase font-bold tracking-wider">Current Stage</p>
                            <p className="text-lg sm:text-xl font-bold text-white mt-1">{roundDetails.type}</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
                    {/* Round Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                            <Clock className="text-blue-600 mx-auto mb-2" size={24} />
                            <p className="text-xs text-gray-500 uppercase font-bold">Duration</p>
                            <p className="text-lg font-bold text-gray-900">{roundDetails.duration}</p>
                        </div>



                        <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                            <AlertTriangle className="text-green-600 mx-auto mb-2" size={24} />
                            <p className="text-xs text-gray-500 uppercase font-bold">Proctoring</p>
                            <p className="text-lg font-bold text-gray-900">Enabled</p>
                        </div>
                    </div>

                    {/* Rules List */}
                    <div className="space-y-4">
                        <h3 className="font-bold text-gray-900 text-lg">Guidelines & Rules</h3>
                        <ul className="space-y-3 text-sm text-gray-600">
                            {[
                                "Ensure you have a stable internet connection.",
                                "WARNING: Do NOT close or refresh the tab. This will auto-submit your test immediately.",
                                "If the time runs out, the test will be submitted automatically.",
                                "Once submitted, you cannot participate in this round again.",
                                "Malpractice of any kind will lead to immediate disqualification."
                            ].map((rule, idx) => (
                                <li key={idx} className="flex items-start gap-3 bg-gray-50 p-3 rounded-lg">
                                    <div className="mt-0.5 min-w-[20px]">
                                        <div className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold">
                                            {idx + 1}
                                        </div>
                                    </div>
                                    <span>{rule}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Agreement */}
                    <div className="pt-6 border-t border-gray-100">
                        <label className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors group">
                            <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${accepted ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'}`}>
                                {accepted && <CheckCircle size={16} className="text-white" />}
                            </div>
                            <input
                                type="checkbox"
                                className="hidden"
                                checked={accepted}
                                onChange={(e) => setAccepted(e.target.checked)}
                            />
                            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 select-none">
                                I have read and understood the instructions. I am ready to begin.
                            </span>
                        </label>
                    </div>

                    {/* Start Button */}
                    <button
                        onClick={handleStart}
                        disabled={!accepted}
                        className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-3 transition-all ${accepted
                            ? 'bg-green-600 hover:bg-green-700 text-white hover:scale-[1.01]'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        {assessment?.type === 'interview' ? 'Start Interview' : 'Start Assessment'} <Play size={20} fill="currentColor" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InstructionsPage;
