import React, { useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
    Brain, Code, Mic, Users, CheckCircle, ArrowRight,
    Layers, Shield, Zap, TrendingUp, ChevronRight
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ClerkAuthModal from '../components/ClerkAuthModal';
import InfiniteMarquee from '../components/InfiniteMarquee';
import AnimatedBackground from '../components/AnimatedBackground';
import AnimatedTimeline from '../components/AnimatedTimeline';
import ResumeScreeningDemo from '../components/demos/ResumeScreeningDemo';
import CodingTestPreview from '../components/demos/CodingTestPreview';
import AIInterviewSimulation from '../components/demos/AIInterviewSimulation';
import AnimatedHeroText from '../components/AnimatedHeroText';
import { useClerk } from '@clerk/clerk-react';

// Animation Utilities
const fadeInUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 1.2, ease: "easeOut" } }
};

const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.2 } }
};

const Home = () => {
    const navigate = useNavigate();
    const { user } = useClerk();
    const [isClerkOpen, setIsClerkOpen] = React.useState(false);

    // Auto-redirect to dashboard if user is signed in
    React.useEffect(() => {
        if (user) {
            navigate('/dashboard');
        }
    }, [user, navigate]);

    // Open Clerk sign-in modal
    const openClerkSignIn = () => {
        setIsClerkOpen(true);
    };

    return (
        <div className="min-h-screen bg-white text-black font-sans selection:bg-green-100 selection:text-green-900 overflow-x-hidden relative">
            {/* Clerk Auth Modal */}
            <ClerkAuthModal
                isOpen={isClerkOpen}
                onClose={() => setIsClerkOpen(false)}
            />

            {/* Navigation */}
            <nav className="fixed top-0 w-full bg-white/95 backdrop-blur-md z-50 border-b border-gray-100 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-10 w-auto object-contain" />
                        <div className="hidden sm:block w-[1.5px] h-10 bg-gray-300" />
                        <span className="text-2xl font-bold tracking-tight text-[#5d8c2c] mt-[1.25rem]">HiringAI</span>
                    </div>

                    {/* Navigation Links */}
                    <div className="hidden md:flex items-center gap-10">
                        <a href="#features" className="text-base font-semibold text-black hover:text-primary transition-colors">Features</a>
                        <a href="#demos" className="text-base font-semibold text-black hover:text-primary transition-colors">Demos</a>
                        <a href="#how-it-works" className="text-base font-semibold text-black hover:text-primary transition-colors">How It Works</a>
                    </div>

                    <div className="flex items-center gap-4">
                        <button onClick={openClerkSignIn} className="px-6 py-3 border border-black text-black text-base font-semibold rounded-none hover:bg-primary hover:text-white transition-all">Sign In</button>
                        <button onClick={openClerkSignIn} className="px-6 py-3 bg-primary text-white text-base font-medium rounded-none hover:bg-green-700 transition-all shadow-sm">
                            Access Portal
                        </button>
                    </div>
                </div>
            </nav>

            {/* 1. Hero Section */}
            <section className="relative pt-32 pb-16 lg:pt-48 lg:pb-32 px-6 overflow-hidden">
                {/* Blue Grid Pattern Backdrop - Restricted to Hero */}
                <div className="absolute inset-0 grid-pattern-blue z-0 opacity-[0.5]" />

                <div className="max-w-6xl mx-auto text-center relative z-10">
                    <motion.div
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        variants={staggerContainer}
                    >
                        <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-none bg-white border border-gray-200 text-green-700 text-sm font-normal mb-8 shadow-sm">
                            <span className="flex h-2 w-2 rounded-none bg-green-600 animate-pulse"></span>
                            The Future of Recruitment is Here
                        </motion.div>

                        <motion.h1 variants={fadeInUp} className="text-4xl lg:text-6xl font-semibold tracking-tight text-primary mb-8 leading-[1.1]">
                            Hire Top Talent <br />
                            <AnimatedHeroText text="10x Faster" />
                        </motion.h1>

                        <motion.p variants={fadeInUp} className="text-xl text-black font-semibold max-w-3xl mx-auto mb-10 leading-relaxed tracking-tight">
                            Screen 100+ resumes in minutes. Conduct AI interviews at scale. Make data-driven hiring decisions—all from one platform.
                        </motion.p>

                        <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <button onClick={openClerkSignIn} className="px-12 py-5 bg-[#00AEEF] text-white text-lg font-semibold rounded-lg hover:brightness-110 transition-all shadow-lg flex items-center justify-center gap-2 group">
                                Sign In to Organization <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </motion.div>
                    </motion.div>
                </div>
            </section>

            {/* 1.5 Trust Signals - Infinite Marquee */}
            <InfiniteMarquee />

            {/* 2. Who Is This For? (Audience) */}
            <section className="py-24 px-6 bg-white/50 backdrop-blur-sm relative">
                <div className="max-w-6xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.2 }}
                        className="text-center mb-20"
                    >
                        <h2 className="text-3xl lg:text-4xl font-medium text-black mb-6 leading-tight">Built for Modern Hiring Teams</h2>
                        <p className="text-lg text-black font-medium max-w-2xl mx-auto">Tailored tools for every stakeholder in the recruitment process.</p>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {[
                            { title: "HR Managers", icon: Users, desc: "Automate screening and focus on culture fit." },
                            { title: "Tech Recruiters", icon: Code, desc: "Assess coding skills without needing technical expertise." },
                            { title: "Enterprises", icon: Shield, desc: "Scale hiring with bias-free, secure AI workflows." }
                        ].map((card, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 1.2, delay: i * 0.2 }}
                                className="p-10 rounded-2xl bg-[#f4f8fb] border border-blue-50 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all duration-300 group text-center flex flex-col items-center"
                            >
                                <div className="w-20 h-20 bg-blue-50/50 rounded-xl flex items-center justify-center mb-8 text-[#00AEEF] group-hover:scale-110 transition-transform">
                                    <card.icon className="w-10 h-10" strokeWidth={1} />
                                </div>
                                <h3 className="text-xl font-semibold text-black mb-4 uppercase tracking-wide">{card.title}</h3>
                                <p className="text-black font-medium leading-relaxed">
                                    {card.desc}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* DEMO 1: Resume Screening */}
            <section id="demos" className="py-24 px-6 relative bg-slate-50/30">
                <ResumeScreeningDemo />
            </section>

            {/* 3. How It Works (Timeline) */}
            <section id="how-it-works" className="py-24">
                <div className="max-w-6xl mx-auto px-6">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.2 }}
                        className="text-center mb-16"
                    >
                        <h2 className="text-3xl lg:text-4xl font-medium text-black mb-6 leading-tight">How HiringAI Works</h2>
                        <p className="text-lg text-black font-medium">A seamless workflow to find your next top talent in minutes.</p>
                    </motion.div>

                    <AnimatedTimeline />
                </div>
            </section>

            {/* DEMO 2: Coding Test Preview */}
            <section className="py-24 px-6 bg-white relative">
                <CodingTestPreview />
            </section>

            {/* 4. Key Features */}
            <section id="features" className="py-24 px-6 relative overflow-hidden">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                        <motion.div
                            initial={{ opacity: 0, x: -30 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 1.2 }}
                        >
                            <h2 className="text-3xl lg:text-4xl font-medium text-black mb-8 leading-tight tracking-tight uppercase">Intelligence At <br /> Every Step</h2>
                            <p className="text-lg text-black font-medium mb-10 leading-relaxed">
                                Our platform leverages advanced LLMs to understand context, evaluate code correctness, and conduct human-like voice interviews without bias.
                            </p>

                            <div className="space-y-8">
                                {[
                                    { title: "Contextual Resume Parsing", desc: "Goes beyond keywords using RAG." },
                                    { title: "Secure Code Execution", desc: "Piston-powered sandboxed coding environment." },
                                    { title: "Real-time Voice Analytics", desc: "VAPI integration for lifelike technical discussions." }
                                ].map((item, i) => (
                                    <div key={i} className="flex gap-5">
                                        <div className="w-7 h-7 rounded-none bg-green-100 flex items-center justify-center flex-shrink-0 text-primary mt-1 shadow-sm">
                                            <CheckCircle className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-black text-lg">{item.title}</h4>
                                            <p className="text-black font-medium mt-1">{item.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 1.2 }}
                            className="grid grid-cols-2 gap-6"
                        >
                            <div className="space-y-6 mt-12">
                                <div className="bg-white p-8 rounded-none border border-gray-100 shadow-sm hover:shadow-xl transition-shadow flex flex-col items-center text-center">
                                    <Shield className="w-10 h-10 text-primary mb-6" strokeWidth={1} />
                                    <h3 className="text-lg font-semibold text-black mb-2 uppercase tracking-tight">Enterprise Secure</h3>
                                    <p className="text-xs text-black font-medium">Role-based access control and isolated company data.</p>
                                </div>
                                <div className="bg-primary p-8 rounded-none shadow-xl text-white transform hover:scale-[1.02] transition-transform text-center flex flex-col items-center">
                                    <Zap className="w-10 h-10 mb-6 text-white" strokeWidth={1.5} />
                                    <h3 className="text-lg font-semibold text-white mb-2 uppercase tracking-tight">Lightning Fast</h3>
                                    <p className="text-xs text-white/90 font-medium">Instant resume parsing and real-time execution.</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="bg-white p-8 rounded-none shadow-xl border border-gray-100 flex flex-col items-center text-center">
                                    <TrendingUp className="w-10 h-10 text-primary mb-6" strokeWidth={1} />
                                    <h3 className="text-lg font-semibold text-black mb-2 uppercase tracking-tight">Analytics Dashboard</h3>
                                    <p className="text-xs text-black font-medium">Visual insights into your recruitment pipeline efficiency.</p>
                                </div>
                                <div className="bg-white p-8 rounded-none border border-gray-100 shadow-sm flex flex-col items-center text-center">
                                    <Users className="w-10 h-10 text-primary mb-6" strokeWidth={1} />
                                    <h3 className="text-lg font-semibold text-black mb-2 uppercase tracking-tight">Collaborative</h3>
                                    <p className="text-sm text-black font-medium">Seamlessly share profiles with hiring managers.</p>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* DEMO 3: AI Interview Simulation */}
            <section className="py-24 px-6 relative bg-slate-50/40">
                <AIInterviewSimulation />
            </section>

            {/* 5. Powered By Section */}
            <section className="bg-white border-y border-gray-100 py-24 px-6 overflow-hidden relative">
                <div className="max-w-6xl mx-auto text-center relative z-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.2 }}
                    >
                        <h2 className="text-2xl lg:text-3xl font-medium text-black mb-8 uppercase tracking-tighter">Powered by Advanced AI</h2>
                        <p className="text-black font-medium max-w-2xl mx-auto mb-16 text-lg">
                            We combine the power of Vector Databases, Large Language Models, and Voice Synthesis to create a human-like hiring experience.
                        </p>
                    </motion.div>

                    <div className="flex flex-wrap justify-center gap-6 lg:gap-10">
                        {["Grok LLM", "ChromaDB", "VAPI Voice", "Monaco Editor", "FastAPI Scale"].map((tech, i) => (
                            <div key={i} className="px-6 py-2.5 rounded bg-[#00AEEF] text-white text-sm font-medium shadow-md hover:shadow-lg hover:brightness-110 transition-all uppercase tracking-wide cursor-default">
                                {tech}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 6. Main CTA */}
            <section className="py-32 px-6 text-center bg-white relative">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2 }}
                    className="max-w-4xl mx-auto relative z-10"
                >
                    <h2 className="text-3xl lg:text-4xl font-medium text-black mb-12 leading-tight uppercase tracking-tight">
                        Ready to transform your <br /> hiring process?
                    </h2>
                    <button onClick={openClerkSignIn} className="inline-flex items-center gap-2 px-8 py-3 bg-[#00AEEF] text-white text-lg font-semibold rounded-lg hover:brightness-110 transition-all shadow-xl transform hover:-translate-y-1">
                        Sign In to Organization <ChevronRight className="w-5 h-5" />
                    </button>
                    <p className="mt-8 text-sm text-black font-medium">
                    </p>
                </motion.div>
            </section>

            {/* Footer */}
            <footer className="bg-[#EEF9F1] text-black py-20 px-6 border-t border-primary relative overflow-hidden">
                {/* Blue Grid Pattern Backdrop - Cage Style */}
                <div className="grid-pattern-blue absolute inset-0 opacity-[0.4]" />

                <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 relative z-10">
                    <div className="col-span-1 md:col-span-1">
                        <div className="flex items-center gap-5 mb-8">
                            <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-10 w-auto object-contain" />
                            <div className="w-[1.5px] h-10 bg-gray-500" />
                            <span className="text-2xl font-bold tracking-tight text-[#5d8c2c] mt-[1.25rem]">HiringAI</span>
                        </div>
                        <p className="text-black text-sm leading-relaxed mb-6 font-medium">
                            The complete AI-powered hiring platform for modern enterprises. Screen, assess, and interview candidates 10x faster.
                        </p>
                    </div>
                    <div className="col-span-1">
                        <h4 className="font-semibold text-base mb-8 text-primary uppercase tracking-widest">Product</h4>
                        <ul className="space-y-4 text-black text-sm font-medium">
                            <li className="hover:text-primary cursor-pointer transition-colors">Resume Screening</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Coding Assessments</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">AI Video Interviews</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Candidate Dashboard</li>
                        </ul>
                    </div>

                    <div className="col-span-1">
                        <h4 className="font-semibold text-base mb-8 text-primary uppercase tracking-widest">Resources</h4>
                        <ul className="space-y-4 text-black text-sm font-medium">
                            <li className="hover:text-primary cursor-pointer transition-colors">For Enterprise</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">For Startups</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Staffing Agencies</li>
                        </ul>
                    </div>

                    <div className="col-span-1">
                        <h4 className="font-semibold text-base mb-8 text-primary uppercase tracking-widest">Company</h4>
                        <ul className="space-y-4 text-black text-sm font-medium">
                            <li className="hover:text-primary cursor-pointer transition-colors">About Us</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Careers</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Security</li>
                            <li className="hover:text-primary cursor-pointer transition-colors">Contact</li>
                        </ul>
                    </div>
                </div>

                <div className="max-w-7xl mx-auto pt-10 mt-16 border-t border-green-200 flex flex-col md:flex-row justify-between items-center text-xs text-black font-normal uppercase tracking-[0.2em] relative z-10">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>&copy; 2026 HiringAI Inc. All rights reserved.</span>
                        <span className="text-gray-400 font-light select-none">·</span>
                        <span className="normal-case tracking-normal text-[11px] text-gray-600 font-medium">Developed by Gopal Muri · ThirdEye Data</span>
                    </div>
                    <div className="flex gap-10 mt-6 md:mt-0">
                        <span className="hover:text-primary cursor-pointer transition-colors">Privacy Policy</span>
                        <span className="hover:text-primary cursor-pointer transition-colors">Terms of Service</span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Home;
