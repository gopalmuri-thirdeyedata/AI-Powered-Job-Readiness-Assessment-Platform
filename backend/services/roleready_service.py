"""
PrepWin — Core Orchestration Service
Governs Workflow A (Student Self-Assessment) and Workflow B (Admin Recruitment),
including the strict sequential state machine, dynamic JD/Resume synthesis,
proctoring telemetry, sandboxed execution, and dual-audience reporting.
"""
import os
import uuid
import re
import json
import hashlib
import concurrent.futures
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc, or_
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException

from models import (
    RoleReadySession, 
    RoleReadyRoundAttempt, 
    RoleReadySessionState, 
    RecruitmentBatch, 
    CandidateInvitation, 
    Candidate, 
    StudentProfile,
    StudentResume,
    Organization
)
from services.gemini_client import call_gemini
from services.company_prompt import style_note, jd_context_note, attach_provenance, sanitize_company, pick_top_tech_companies, style_block
from services import web_question_research
from services.readiness_service import refresh_profile_readiness
from services import piston_service
from services import vapi_service
from services import assessment_clock as clock
from services import assessment_engine as engine
from services import assessment_policy as policy
from services.interview_evaluation import evaluate_five_technical_questions

# ==============================================================================
# JD & RESUME SYNTHESIS LOGIC
# ==============================================================================

def extract_structured_jd(jd_text: str, default_role: str = "Software Engineer") -> Dict[str, Any]:
    """
    Deconstructs raw Job Description into structured competencies.
    Utilizes Gemini with robust deterministic fallback.
    """
    clean_text = (jd_text or "").strip()
    if not clean_text:
        return {
            "role_title": default_role,
            "seniority_level": "Mid-Level",
            "required_skills": ["Problem Solving", "Algorithms", "System Design", "Git"],
            "preferred_skills": ["Cloud", "CI/CD"],
            "responsibilities": ["Develop robust features", "Collaborate with cross-functional teams"],
            "aptitude_domains": ["Quantitative Analysis", "Logical Reasoning", "Data Interpretation"],
            "coding_topics": ["Arrays", "Hash Maps", "Strings", "Dynamic Programming"],
            "interview_focus_areas": ["Architecture", "Past Technical Challenges", "Collaboration"]
        }

    prompt = f"""
Analyze the following Job Description and extract structured competencies into clean JSON.
Job Description text:
\"\"\"{clean_text[:4000]}\"\"\"

Return a JSON object with EXACTLY this structure:
{{
  "role_title": "extracted or inferred job title",
  "seniority_level": "Entry / Mid / Senior / Lead",
  "required_skills": ["list", "of", "required", "skills"],
  "preferred_skills": ["list", "of", "preferred", "skills"],
  "responsibilities": ["key", "responsibilities"],
  "aptitude_domains": ["domain1", "domain2", "domain3"],
  "coding_topics": ["topic1", "topic2", "topic3"],
  "interview_focus_areas": ["area1", "area2", "area3"]
}}
"""
    try:
        result = call_gemini(prompt, system_prompt="You are an expert technical talent assessor. Output strictly valid JSON.")
        if result and isinstance(result, dict) and "role_title" in result:
            return result
    except Exception as e:
        print(f"[RoleReady] AI JD extraction fallback triggered: {e}")

    # Robust fallback based on text scanning
    skills = []
    for s in ["Python", "JavaScript", "React", "Node.js", "Java", "C++", "SQL", "Docker", "AWS", "Machine Learning", "FastAPI"]:
        if s.lower() in clean_text.lower():
            skills.append(s)
    if not skills:
        skills = ["Python", "Algorithms", "Problem Solving", "Data Structures"]

    return {
        "role_title": default_role or "Software Engineer",
        "seniority_level": "Mid-Level",
        "required_skills": skills,
        "preferred_skills": ["Git", "Testing"],
        "responsibilities": ["Software architecture", "Feature implementation", "Code review"],
        "aptitude_domains": ["Quantitative Ability", "Logical Deduction", "Critical Reasoning"],
        "coding_topics": ["Arrays", "Strings", "Algorithms"],
        "interview_focus_areas": ["Technical Problem Solving", "Project Experience", "Behavioral Scenarios"]
    }


# ==============================================================================
# QUESTION GENERATION ENGINES
# ==============================================================================

def _build_aptitude_payload(questions: Any, count: int):
    """
    Validates AI-generated aptitude questions. Returns (client_safe, server_keys) with exactly
    `count` questions (4 options keyed A-D, valid correct_key), renumbered 1..count; otherwise None.
    """
    if not isinstance(questions, list) or len(questions) < count:
        return None
    client_safe, server_keys = [], {}
    for idx, q in enumerate(questions[:count], start=1):
        if not isinstance(q, dict) or not str(q.get("question", "")).strip():
            return None
        options = q.get("options")
        if not isinstance(options, list) or len(options) != 4:
            return None
        keys = [str(o.get("key", "")).upper() if isinstance(o, dict) else "" for o in options]
        correct = str(q.get("correct_key", "")).strip().upper()
        if sorted(keys) != ["A", "B", "C", "D"] or correct not in keys:
            return None
        qid = str(idx)
        client_safe.append({
            "id": qid,
            "topic": q.get("topic", "General Reasoning"),
            "question": q["question"],
            "options": [{"key": k, "text": o.get("text", "")} for k, o in zip(keys, options)],
            **({"style_company": str(q["style_company"])[:60]} if isinstance(q.get("style_company"), str) else {}),
        })
        server_keys[qid] = {"correct_key": correct, "explanation": q.get("explanation", "")}
    return client_safe, server_keys


def _opts(a, b, c, d):
    return [{"key": "A", "text": a}, {"key": "B", "text": b}, {"key": "C", "text": c}, {"key": "D", "text": d}]


# Role-agnostic reasoning questions appended to each role bank to reach the required 10 questions.
_GENERAL_APTITUDE_SUPPLEMENT = [
    {
        "topic": "Quantitative Reasoning",
        "question": "A task takes 6 engineers 10 days. Assuming equal productivity, how many days will 5 engineers need?",
        "options": _opts("10", "11", "12", "15"),
        "correct_key": "C",
        "explanation": "Total effort is 60 engineer-days; 60 / 5 = 12 days."
    },
    {
        "topic": "Logical Deduction",
        "question": "All reviewed pull requests are merged. Some merged pull requests are reverted. Which statement must be true?",
        "options": _opts("All reverted pull requests were reviewed", "Some reverted pull requests may have been reviewed", "No reviewed pull request is reverted", "All merged pull requests are reviewed"),
        "correct_key": "B",
        "explanation": "The premises do not link reverted PRs to review status, so only a possibility can be concluded."
    },
    {
        "topic": "Number Series",
        "question": "What comes next in the series 2, 6, 12, 20, 30, ?",
        "options": _opts("38", "40", "42", "44"),
        "correct_key": "C",
        "explanation": "Differences are 4, 6, 8, 10, so the next difference is 12: 30 + 12 = 42."
    },
    {
        "topic": "Data Interpretation",
        "question": "A dashboard shows 1,200 requests with 90 failures. What is the failure rate?",
        "options": _opts("5.5%", "6.5%", "7.5%", "9%"),
        "correct_key": "C",
        "explanation": "90 / 1200 = 0.075 = 7.5%."
    },
    {
        "topic": "Probability",
        "question": "Two fair coins are tossed. What is the probability of getting exactly one head?",
        "options": _opts("1/4", "1/3", "1/2", "3/4"),
        "correct_key": "C",
        "explanation": "Outcomes HT and TH are favourable out of 4 equally likely outcomes: 2/4 = 1/2."
    },
]


def _generate_aptitude_core(jd_data: Dict[str, Any], count: int = 10, company: str = "", jd_text: str = "", style_companies: tuple = ()) -> tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Generates tailored aptitude questions based on JD requirements and target role.
    Returns: (client_safe_questions, server_private_keys)
    """
    role = (jd_data.get("role_title") or "Software Engineer").strip()
    role_lower = role.lower()
    skills = ", ".join(jd_data.get("required_skills", ["General Technical"]))

    prompt = f"""
Generate {count} high-quality aptitude questions for a candidate applying for the role '{role}' requiring skills in {skills}.
Include a mix of Quantitative Reasoning, Logical Deduction, and Role-specific Conceptual Logic.

Return valid JSON with a "questions" array where each item has:
- "id": integer 1 to {count}
- "topic": category name
- "question": clear question text
- "options": array of 4 objects [{{"key": "A", "text": "..."}}, {{"key": "B", "text": "..."}}]
- "correct_key": "A" or "B" or "C" or "D"
- "explanation": brief rationale
{jd_context_note(jd_text)}{style_block(company, style_companies)}"""
    try:
        res = call_gemini(prompt, system_prompt="You are a senior psychometric and technical assessment engineer. Output valid JSON.")
        built = _build_aptitude_payload(res.get("questions", []), count)
        if built:
            return built
        print(f"[RoleReady] AI Aptitude output did not contain {count} valid questions; using fallback bank.")
    except Exception as e:
        print(f"[RoleReady] AI Aptitude generation fallback: {e}")

    # Role-tailored deterministic fallback banks
    if "frontend" in role_lower:
        fallback_q = [
            {
                "id": "1",
                "topic": "JavaScript Runtime & Event Loop",
                "question": "In what order will console.log execute given a synchronous log, a Promise.resolve().then() callback, and a setTimeout(..., 0) callback?",
                "options": [
                    {"key": "A", "text": "Sync -> Timeout -> Promise"},
                    {"key": "B", "text": "Sync -> Promise (Microtask) -> Timeout (Macrotask)"},
                    {"key": "C", "text": "Promise -> Sync -> Timeout"},
                    {"key": "D", "text": "Timeout -> Promise -> Sync"}
                ],
                "correct_key": "B",
                "explanation": "Microtasks (Promises) execute immediately after synchronous code before the next macrotask (setTimeout) from the event loop."
            },
            {
                "id": "2",
                "topic": "CSS Specificity Calculation",
                "question": "Which CSS selector has the highest specificity weight when resolving conflicting styles on an element?",
                "options": [
                    {"key": "A", "text": "header.navbar ul li a"},
                    {"key": "B", "text": ".nav-item.active"},
                    {"key": "C", "text": "#main-nav .menu-link"},
                    {"key": "D", "text": "div > p.highlight"}
                ],
                "correct_key": "C",
                "explanation": "#main-nav .menu-link has 1 ID + 1 Class (specificity 1-1-0), outranking class-only and element-only selectors."
            },
            {
                "id": "3",
                "topic": "Browser Rendering & Layout",
                "question": "Which CSS property change triggers ONLY Compositing without triggering Reflow (Layout) or Repaint?",
                "options": [
                    {"key": "A", "text": "width and height"},
                    {"key": "B", "text": "transform and opacity"},
                    {"key": "C", "text": "top and left"},
                    {"key": "D", "text": "background-color"}
                ],
                "correct_key": "B",
                "explanation": "transform and opacity are handled directly on the GPU composite thread, avoiding layout and repaint cycles."
            },
            {
                "id": "4",
                "topic": "Network & Asset Optimization",
                "question": "If an unbundled web bundle of 2.4 MB is compressed with Gzip reducing size by 65%, what is the transmitted wire size?",
                "options": [
                    {"key": "A", "text": "0.84 MB"},
                    {"key": "B", "text": "1.20 MB"},
                    {"key": "C", "text": "1.56 MB"},
                    {"key": "D", "text": "0.48 MB"}
                ],
                "correct_key": "A",
                "explanation": "2.4 MB * (1 - 0.65) = 2.4 * 0.35 = 0.84 MB."
            },
            {
                "id": "5",
                "topic": "State Management & Reactivity",
                "question": "Why is mutating nested object state directly in React/Redux considered an anti-pattern?",
                "options": [
                    {"key": "A", "text": "It throws a runtime TypeError immediately in all JavaScript engines."},
                    {"key": "B", "text": "Shallow reference comparison fails to detect changes, preventing component re-renders."},
                    {"key": "C", "text": "It doubles browser memory consumption permanently."},
                    {"key": "D", "text": "It forces synchronous garbage collection."}
                ],
                "correct_key": "B",
                "explanation": "React checks referential equality (prevProps !== nextProps); mutating state in-place keeps the object reference identical."
            }
        ]
    elif "data" in role_lower:
        fallback_q = [
            {
                "id": "1",
                "topic": "SQL & Relational Aggregation",
                "question": "What is the key functional difference between a WHERE clause and a HAVING clause in SQL queries?",
                "options": [
                    {"key": "A", "text": "HAVING filters rows before grouping; WHERE filters aggregated results."},
                    {"key": "B", "text": "WHERE filters rows before aggregation; HAVING filters aggregated group results."},
                    {"key": "C", "text": "HAVING can only be used with primary key columns."},
                    {"key": "D", "text": "WHERE cannot use indexed columns."}
                ],
                "correct_key": "B",
                "explanation": "WHERE filters individual input rows before grouping/aggregation; HAVING filters the aggregated output groups."
            },
            {
                "id": "2",
                "topic": "Distributed Storage & Columnar Formats",
                "question": "Why is Apache Parquet significantly faster than CSV for analytical OLAP queries calculating average sales over 100M rows?",
                "options": [
                    {"key": "A", "text": "Parquet loads the entire file into RAM before executing queries."},
                    {"key": "B", "text": "Parquet uses columnar layout, reading only the necessary columns and applying dictionary encoding."},
                    {"key": "C", "text": "CSV files cannot be partitioned across nodes."},
                    {"key": "D", "text": "Parquet removes the need for database schemas."}
                ],
                "correct_key": "B",
                "explanation": "Columnar storage allows projection pushdown (reading only required columns) and efficient block compression."
            },
            {
                "id": "3",
                "topic": "ETL Throughput & Pipeline Math",
                "question": "An ETL worker node processes 50,000 records per minute. To process a 15,000,000 record daily batch in at most 1 hour, how many parallel worker nodes are needed?",
                "options": [
                    {"key": "A", "text": "3 nodes"},
                    {"key": "B", "text": "5 nodes"},
                    {"key": "C", "text": "6 nodes"},
                    {"key": "D", "text": "10 nodes"}
                ],
                "correct_key": "B",
                "explanation": "1 node processes 50,000 * 60 = 3,000,000 records/hour. 15,000,000 / 3,000,000 = 5 worker nodes."
            },
            {
                "id": "4",
                "topic": "Data Modeling & Normalization",
                "question": "Which normal form guarantees that non-key attributes are fully functionally dependent on the entire primary key, eliminating partial dependencies?",
                "options": [
                    {"key": "A", "text": "First Normal Form (1NF)"},
                    {"key": "B", "text": "Second Normal Form (2NF)"},
                    {"key": "C", "text": "Third Normal Form (3NF)"},
                    {"key": "D", "text": "Boyce-Codd Normal Form (BCNF)"}
                ],
                "correct_key": "B",
                "explanation": "2NF requires 1NF and that all non-key attributes depend on the complete composite primary key, removing partial dependencies."
            },
            {
                "id": "5",
                "topic": "Stream Processing & Watermarking",
                "question": "In stream processing (e.g. Apache Flink/Kafka Streams), what is the primary purpose of a 'Watermark'?",
                "options": [
                    {"key": "A", "text": "Encrypting the payload for compliance."},
                    {"key": "B", "text": "Tracking progress of event time to determine when out-of-order event windows can be closed."},
                    {"key": "C", "text": "Compressing message timestamps into 32-bit integers."},
                    {"key": "D", "text": "Measuring cluster network latency."}
                ],
                "correct_key": "B",
                "explanation": "Watermarks signal that no events with an earlier event timestamp are expected, allowing window computation to finalize."
            }
        ]
    elif "devops" in role_lower or "cloud" in role_lower:
        fallback_q = [
            {
                "id": "1",
                "topic": "Networking & Subnet Math",
                "question": "How many usable host IP addresses are available in a /28 IPv4 subnet?",
                "options": [
                    {"key": "A", "text": "16"},
                    {"key": "B", "text": "14"},
                    {"key": "C", "text": "30"},
                    {"key": "D", "text": "12"}
                ],
                "correct_key": "B",
                "explanation": "32 - 28 = 4 bits -> 2^4 = 16 total IPs. Subtracting network address and broadcast address yields 14 usable hosts."
            },
            {
                "id": "2",
                "topic": "Container Orchestration & High Availability",
                "question": "In Kubernetes, which controller is best suited for running a monitoring daemon (like Prometheus Node Exporter) on every cluster node?",
                "options": [
                    {"key": "A", "text": "Deployment"},
                    {"key": "B", "text": "StatefulSet"},
                    {"key": "C", "text": "DaemonSet"},
                    {"key": "D", "text": "Job"}
                ],
                "correct_key": "C",
                "explanation": "DaemonSet ensures that all (or some) nodes run an exact single replica of a Pod."
            },
            {
                "id": "3",
                "topic": "CI/CD & Deployment Strategies",
                "question": "Which deployment strategy routes a small percentage (e.g. 5%) of live production traffic to a new software version to verify stability before wider rollout?",
                "options": [
                    {"key": "A", "text": "Blue/Green Deployment"},
                    {"key": "B", "text": "Canary Deployment"},
                    {"key": "C", "text": "Recreate Deployment"},
                    {"key": "D", "text": "Shadow Deployment"}
                ],
                "correct_key": "B",
                "explanation": "Canary deployment routes a small percentage of user traffic to the new release to validate telemetry and error rates."
            },
            {
                "id": "4",
                "topic": "Cloud Security & Least Privilege",
                "question": "When granting an automated CI/CD pipeline access to deploy AWS cloud resources, what is the most secure modern authentication method?",
                "options": [
                    {"key": "A", "text": "Hardcoded long-lived root AWS Access Keys in repository secrets"},
                    {"key": "B", "text": "OpenID Connect (OIDC) federated role assumption with short-lived STS tokens"},
                    {"key": "C", "text": "Publicly accessible S3 bucket configuration policy"},
                    {"key": "D", "text": "Storing API keys in plain text within Dockerfile build args"}
                ],
                "correct_key": "B",
                "explanation": "OIDC allows GitHub Actions / GitLab CI to assume temporary IAM roles without storing static long-lived credentials."
            },
            {
                "id": "5",
                "topic": "Reliability & SLI/SLO Engineering",
                "question": "If an API guarantees 99.9% uptime (Three Nines) across a 30-day month (43,200 minutes), what is its maximum allowable downtime error budget?",
                "options": [
                    {"key": "A", "text": "4.32 minutes"},
                    {"key": "B", "text": "43.2 minutes"},
                    {"key": "C", "text": "432 minutes"},
                    {"key": "D", "text": "12.5 minutes"}
                ],
                "correct_key": "B",
                "explanation": "43,200 minutes * (1 - 0.999) = 43,200 * 0.001 = 43.2 minutes allowable monthly downtime."
            }
        ]
    elif "learning" in role_lower or "ml" in role_lower or "ai" in role_lower:
        fallback_q = [
            {
                "id": "1",
                "topic": "Machine Learning Metrics & Evaluation",
                "question": "In medical fraud or rare disease detection where missing a positive case is catastrophic, which metric should be prioritized over overall accuracy?",
                "options": [
                    {"key": "A", "text": "Precision"},
                    {"key": "B", "text": "Recall (Sensitivity)"},
                    {"key": "C", "text": "Specificity"},
                    {"key": "D", "text": "Mean Squared Error"}
                ],
                "correct_key": "B",
                "explanation": "Recall = TP / (TP + FN). Maximizing recall minimizes False Negatives (missed critical positive cases)."
            },
            {
                "id": "2",
                "topic": "Model Regularization & Overfitting",
                "question": "What is the primary operational effect of L1 regularization (Lasso) compared to L2 regularization (Ridge)?",
                "options": [
                    {"key": "A", "text": "L1 drives non-essential feature weights strictly to zero, producing sparse models."},
                    {"key": "B", "text": "L1 scales all weights uniformly without setting any to zero."},
                    {"key": "C", "text": "L1 increases training variance while L2 reduces bias."},
                    {"key": "D", "text": "L1 can only be applied to decision trees."}
                ],
                "correct_key": "A",
                "explanation": "L1 penalty |w| produces sharp corners at axes in optimization space, driving coefficients to absolute zero for feature selection."
            },
            {
                "id": "3",
                "topic": "Linear Algebra & Gradient Optimization",
                "question": "If a learning rate in Gradient Descent is set too large, what is the most likely failure mode during model training?",
                "options": [
                    {"key": "A", "text": "Training converges in exactly 1 epoch."},
                    {"key": "B", "text": "The loss function oscillates wildly and diverges without reaching the minimum."},
                    {"key": "C", "text": "The weights undergo vanishing gradient and freeze."},
                    {"key": "D", "text": "The training dataset gets corrupted."}
                ],
                "correct_key": "B",
                "explanation": "Excessively high learning rates overshoot the gradient valleys, causing divergence and exploding loss values."
            },
            {
                "id": "4",
                "topic": "Data Preprocessing & Leakage",
                "question": "Why must feature scaling (like StandardScaler) be fit ONLY on the training split and transformed on the test split?",
                "options": [
                    {"key": "A", "text": "To prevent data leakage of test set distribution statistics into the training process."},
                    {"key": "B", "text": "Because test sets cannot contain floating point values."},
                    {"key": "C", "text": "Scikit-Learn throws an error if fit is called twice."},
                    {"key": "D", "text": "StandardScaler requires identical row counts across splits."}
                ],
                "correct_key": "A",
                "explanation": "Fitting on the entire dataset leaks mean and standard deviation of the unseen test distribution into the training pipeline."
            },
            {
                "id": "5",
                "topic": "Deep Learning & Activation Functions",
                "question": "What primary problem does the ReLU activation function (max(0, x)) solve compared to the Sigmoid function in deep neural networks?",
                "options": [
                    {"key": "A", "text": "Vanishing gradient problem for positive input activations."},
                    {"key": "B", "text": "Exploding memory usage in Convolutional layers."},
                    {"key": "C", "text": "Eliminating the need for backpropagation."},
                    {"key": "D", "text": "Restricting output values strictly between 0 and 1."}
                ],
                "correct_key": "A",
                "explanation": "Sigmoid saturates for large inputs with near-zero derivatives; ReLU has a constant derivative of 1 for positive activations."
            }
        ]
    elif "backend" in role_lower:
        fallback_q = [
            {
                "id": "1",
                "topic": "Database Isolation Levels",
                "question": "Which SQL transaction isolation level prevents Dirty Reads, Non-Repeatable Reads, AND Phantom Reads?",
                "options": [
                    {"key": "A", "text": "Read Uncommitted"},
                    {"key": "B", "text": "Read Committed"},
                    {"key": "C", "text": "Repeatable Read"},
                    {"key": "D", "text": "Serializable"}
                ],
                "correct_key": "D",
                "explanation": "Serializable is the highest isolation level and guarantees complete transaction serial execution without phantom reads."
            },
            {
                "id": "2",
                "topic": "HTTP & REST Architecture",
                "question": "According to HTTP RFC specifications, which of the following HTTP methods is defined as Idempotent?",
                "options": [
                    {"key": "A", "text": "POST"},
                    {"key": "B", "text": "PUT"},
                    {"key": "C", "text": "PATCH (when appending elements to an array)"},
                    {"key": "D", "text": "CONNECT"}
                ],
                "correct_key": "B",
                "explanation": "PUT replaces the resource state; executing multiple identical PUT requests produces the same server state as a single request."
            },
            {
                "id": "3",
                "topic": "Concurrency & Distributed Systems",
                "question": "In high-throughput microservices, what problem is the 'Circuit Breaker' pattern designed to prevent?",
                "options": [
                    {"key": "A", "text": "Cascading failures across downstream services when a dependency becomes unresponsive."},
                    {"key": "B", "text": "SQL injection attacks against relational database schemas."},
                    {"key": "C", "text": "Cross-Site Scripting (XSS) in frontend templates."},
                    {"key": "D", "text": "Unauthorized JWT token tampering."}
                ],
                "correct_key": "A",
                "explanation": "Circuit Breakers fail fast after repeated errors, preventing thread starvation and cascading downtime across dependent services."
            },
            {
                "id": "4",
                "topic": "System Throughput & Rate Limiting",
                "question": "If a Redis sliding-window rate limiter allows 100 requests per 10-second window, what is the maximum theoretical request rate per minute under sustained load?",
                "options": [
                    {"key": "A", "text": "100 requests/min"},
                    {"key": "B", "text": "600 requests/min"},
                    {"key": "C", "text": "1000 requests/min"},
                    {"key": "D", "text": "60 requests/min"}
                ],
                "correct_key": "B",
                "explanation": "6 distinct 10-second windows per minute * 100 requests = 600 requests/minute."
            },
            {
                "id": "5",
                "topic": "API Security & Authorization",
                "question": "Which HTTP status code should an API return when an authenticated user attempts to modify a resource belonging to another tenant?",
                "options": [
                    {"key": "A", "text": "401 Unauthorized"},
                    {"key": "B", "text": "403 Forbidden"},
                    {"key": "C", "text": "404 Not Found"},
                    {"key": "D", "text": "422 Unprocessable Entity"}
                ],
                "correct_key": "B",
                "explanation": "401 means unauthenticated (missing/invalid token), whereas 403 means authenticated but unauthorized for that resource."
            }
        ]
    else:
        # Full Stack / General Software Engineering
        fallback_q = [
            {
                "id": "1",
                "topic": "Quantitative Reasoning & Capacity",
                "question": "If a pipeline processes 240 requests per minute with a 20% retry rate, how many total request attempts occur in 15 minutes?",
                "options": [{"key": "A", "text": "3600"}, {"key": "B", "text": "4320"}, {"key": "C", "text": "4500"}, {"key": "D", "text": "4800"}],
                "correct_key": "B",
                "explanation": "240 * 15 = 3600 base requests. With 20% retries, total attempts = 3600 * 1.2 = 4320."
            },
            {
                "id": "2",
                "topic": "Distributed Communication",
                "question": "All microservices in Cluster A use gRPC. Some services using gRPC support HTTP/2 streaming. Which conclusion is definitively true?",
                "options": [
                    {"key": "A", "text": "All services in Cluster A support HTTP/2 streaming."},
                    {"key": "B", "text": "Some microservices in Cluster A may support HTTP/2 streaming."},
                    {"key": "C", "text": "No services in Cluster A use JSON."},
                    {"key": "D", "text": "Cluster A cannot communicate with Cluster B."}
                ],
                "correct_key": "B",
                "explanation": "Because some gRPC services support HTTP/2 and all Cluster A services use gRPC, some Cluster A services may support it."
            },
            {
                "id": "3",
                "topic": "Algorithmic Efficiency",
                "question": "What is the worst-case time complexity of searching an element in a balanced Binary Search Tree containing N nodes?",
                "options": [{"key": "A", "text": "O(1)"}, {"key": "B", "text": "O(log N)"}, {"key": "C", "text": "O(N)"}, {"key": "D", "text": "O(N log N)"}],
                "correct_key": "B",
                "explanation": "Balanced BST search is bounded by the height of the tree, which is O(log N)."
            },
            {
                "id": "4",
                "topic": "Data Interpretation & Latency",
                "question": "A server's latency increases from 50ms to 75ms under double the concurrent load. What is the percentage increase in latency?",
                "options": [{"key": "A", "text": "25%"}, {"key": "B", "text": "33.3%"}, {"key": "C", "text": "50%"}, {"key": "D", "text": "100%"}],
                "correct_key": "C",
                "explanation": "(75 - 50) / 50 * 100% = 50% increase."
            },
            {
                "id": "5",
                "topic": "System Logic & Access Control",
                "question": "Which HTTP status code should an API return when an authenticated user attempts to modify a resource belonging to another tenant?",
                "options": [{"key": "A", "text": "401 Unauthorized"}, {"key": "B", "text": "403 Forbidden"}, {"key": "C", "text": "404 Not Found"}, {"key": "D", "text": "422 Unprocessable"}],
                "correct_key": "B",
                "explanation": "401 means unauthenticated, whereas 403 means authenticated but not authorized."
            }
        ]

    # Role bank + role-agnostic reasoning supplement so every role has a full 10-question bank.
    full_bank = list(fallback_q) + _GENERAL_APTITUDE_SUPPLEMENT
    client_safe = []
    server_keys = {}
    for idx, q in enumerate(full_bank[:max(1, count)], start=1):
        qid = str(idx)
        client_safe.append({
            "id": qid,
            "topic": q["topic"],
            "question": q["question"],
            "options": q["options"]
        })
        server_keys[qid] = {
            "correct_key": q["correct_key"],
            "explanation": q["explanation"]
        }
    return client_safe, server_keys


PYTHON_STARTER_DEFAULT = "def solve():\n    pass\n\nif __name__ == '__main__':\n    pass\n"
JAVA_STARTER_DEFAULT = "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write solution here\n    }\n}\n"


def _build_coding_payload(problems: Any, count: int):
    """
    Validates AI-generated coding problems: exactly `count` problems, Python and Java starter code,
    exactly 1 public sample test and 3-4 hidden tests. Returns (client_safe, server_keys) or None.
    """
    if not isinstance(problems, list) or len(problems) < count:
        return None
    client_safe, server_keys = [], {}
    for idx, prob in enumerate(problems[:count], start=1):
        if not isinstance(prob, dict):
            return None
        public = [t for t in (prob.get("public_test_cases") or []) if isinstance(t, dict) and "expected_output" in t]
        hidden = [t for t in (prob.get("hidden_test_cases") or []) if isinstance(t, dict) and "expected_output" in t]
        if not public or len(hidden) < 3:
            return None
        pid = str(idx)
        starter = prob.get("starter_code") if isinstance(prob.get("starter_code"), dict) else {}
        client_safe.append({
            "id": pid,
            "title": prob.get("title", f"Coding Challenge {pid}"),
            "difficulty": prob.get("difficulty", "Medium"),
            "description": prob.get("description", ""),
            "input_format": prob.get("input_format", ""),
            "output_format": prob.get("output_format", ""),
            "constraints": prob.get("constraints", ""),
            "starter_code": {
                "python": starter.get("python") or PYTHON_STARTER_DEFAULT,
                "java": starter.get("java") or JAVA_STARTER_DEFAULT
            },
            "public_test_cases": public[:1],
            **({"style_company": str(prob["style_company"])[:60]} if isinstance(prob.get("style_company"), str) else {}),
        })
        server_keys[pid] = {"hidden_test_cases": hidden[:4]}
    return client_safe, server_keys


def _generate_coding_core(jd_data: Dict[str, Any], count: int = 2, company: str = "", jd_text: str = "", style_companies: tuple = ()) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Generates coding problems configured specifically for the candidate's target role & JD technical requirements.
    Returns: (client_safe_problems, server_private_keys)
    """
    role = (jd_data.get("role_title") or "Software Engineer").strip()
    role_lower = role.lower()
    skills = jd_data.get("required_skills", ["Python", "Algorithms"])

    # Attempt AI generation with strict JSON schema validation
    prompt = f"""
Generate {count} coding assessment problems tailored specifically for the role '{role}' requiring skills in {', '.join(skills)}.
Each problem must be algorithmic and executable in a Python 3 sandbox via stdin and stdout. Python is the only supported language.
Each problem must be Medium difficulty, have exactly 1 public test case and 3 to 4 hidden test cases. The python starter_code must be only a skeleton (imports, function signature, stdin parsing, print) and must NOT contain the solution logic.

Return valid JSON:
{{
  "problems": [
    {{
      "id": "1",
      "title": "Problem Title",
      "difficulty": "Medium",
      "description": "Clear problem description...",
      "input_format": "Explanation of stdin format",
      "output_format": "Explanation of stdout format",
      "constraints": "Limits on input size",
      "starter_code": {{
        "python": "def solve():\\n    # write code\\n    pass\\n\\nif __name__ == '__main__':\\n    import sys\\n    # parse stdin and print answer\\n"
      }},
      "public_test_cases": [
        {{"input": "sample_input", "expected_output": "sample_output", "explanation": "why"}}
      ],
      "hidden_test_cases": [
        {{"input": "hidden_input_1", "expected_output": "hidden_output_1"}},
        {{"input": "hidden_input_2", "expected_output": "hidden_output_2"}}
      ]
    }}
  ]
}}
{jd_context_note(jd_text)}{style_block(company, style_companies)}"""
    try:
        res = call_gemini(prompt, system_prompt="You are a principal software engineer configuring algorithmic coding interview questions. Return strictly valid JSON.")
        built = _build_coding_payload(res.get("problems", []), count)
        if built:
            return built
        print(f"[RoleReady] AI Coding output did not contain {count} valid Python problems; using fallback bank.")
    except Exception as e:
        print(f"[RoleReady] AI Coding generation fallback: {e}")

    # Role-tailored deterministic fallback banks
    if "frontend" in role_lower:
        problem_bank = [
            {
                "id": "1",
                "title": "Longest Run of Unique CSS Classes",
                "difficulty": "Medium",
                "description": "A style auditor scans a stream of CSS class tokens and wants the longest contiguous run in which no class name repeats. Given one line of space-separated class names, print the length of the longest contiguous run with all distinct class names.",
                "input_format": "A single line of space-separated class names.",
                "output_format": "A single integer.",
                "constraints": "1 <= number of tokens <= 10^5",
                "starter_code": {
                    "python": "import sys\n\ndef longest_unique_run(tokens):\n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    print(longest_unique_run(sys.stdin.read().split()))\n"
                },
                "public_test_cases": [
                    {
                        "input": "btn card btn nav card",
                        "expected_output": "3",
                        "explanation": "'btn card' then 'card btn nav' ... longest distinct run is 'card btn nav' = 3"
                    }
                ],
                "hidden_test_cases": [
                    {
                        "input": "a b c d",
                        "expected_output": "4"
                    },
                    {
                        "input": "x x x x",
                        "expected_output": "1"
                    },
                    {
                        "input": "a b a c b d a",
                        "expected_output": "4"
                    },
                    {
                        "input": "p q r p s t u",
                        "expected_output": "6"
                    }
                ]
            },
            {
                "id": "2",
                "title": "HTML & JSX Component Tag Balancer",
                "difficulty": "Medium",
                "description": "Frontend template engines validate that opening and closing JSX/HTML tags match in proper nesting order. Given a single-line string consisting of space-separated tags (e.g. '<nav> <div> </div> </nav>'), return 'true' if the tag sequence is properly balanced and closed, or 'false' otherwise.",
                "input_format": "Single line string containing space-separated HTML/JSX tag tokens.",
                "output_format": "'true' or 'false'",
                "constraints": "Number of tag tokens <= 1000",
                "starter_code": {
                    "python": "import sys\n\ndef is_valid_jsx(tag_str: str) -> str:\n    # Return 'true' if every opening tag has a matching closing tag in proper order, else 'false'\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    print(is_valid_jsx(s))\n",
                },
                "public_test_cases": [
                    {"input": "<nav> <div> </div> </nav>", "expected_output": "true", "explanation": "Properly nested <nav> and <div> pairs."}
                ],
                "hidden_test_cases": [
                    {"input": "<nav> <div> </nav> </div>", "expected_output": "false"},
                    {"input": "<header> <nav> <h1> </h1> </nav> </header>", "expected_output": "true"},
                    {"input": "<section> <div> </section>", "expected_output": "false"}
                ]
            }
        ]
    elif "data" in role_lower:
        problem_bank = [
            {
                "id": "1",
                "title": "Top-K Frequent Categories",
                "difficulty": "Medium",
                "description": "Given K and a comma-separated list of category labels, print the K most frequent categories separated by single spaces. Order by descending frequency; break ties alphabetically.",
                "input_format": "Line 1: integer K. Line 2: comma-separated category labels.",
                "output_format": "K space-separated labels.",
                "constraints": "1 <= K <= number of distinct labels <= 10^4",
                "starter_code": {
                    "python": "import sys\n\ndef top_k_categories(k, labels):\n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    print(top_k_categories(int(lines[0]), lines[1].split(',')))\n"
                },
                "public_test_cases": [
                    {
                        "input": "2\nads,web,ads,mobile,web,ads",
                        "expected_output": "ads web",
                        "explanation": "ads appears 3 times, web 2 times, mobile once"
                    }
                ],
                "hidden_test_cases": [
                    {
                        "input": "1\nx,y,y,z",
                        "expected_output": "y"
                    },
                    {
                        "input": "3\nb,a,c,a,b,c",
                        "expected_output": "a b c"
                    },
                    {
                        "input": "2\nq,w,e,r,t,q",
                        "expected_output": "q e"
                    },
                    {
                        "input": "2\nm,m,n,n,o",
                        "expected_output": "m n"
                    }
                ]
            },
            {
                "id": "2",
                "title": "In-Memory Dataset Equi-Join by ID",
                "difficulty": "Medium",
                "description": "Data engineers frequently join normalized relational datasets in memory. Given two datasets formatted as comma-separated ID:Value pairs on Line 1 (Table A) and Line 2 (Table B), perform an INNER JOIN on ID. Output the matched records formatted as 'ID:ValA:ValB' sorted ascending by integer ID, separated by spaces.",
                "input_format": "Line 1: Dataset A (e.g. '1:Engineering,2:Sales,3:Finance'). Line 2: Dataset B (e.g. '2:Chicago,1:Boston,4:Austin').",
                "output_format": "Space-separated 'ID:ValA:ValB' sorted by integer ID, or 'EMPTY' if no matches.",
                "constraints": "Number of records <= 5000",
                "starter_code": {
                    "python": "import sys\n\ndef inner_join(line1: str, line2: str) -> str:\n    # Join the two 'id:value' lists on id; return 'id:left:right' items sorted by id, or 'EMPTY'\n    pass\n\nif __name__ == '__main__':\n    lines = [l.strip() for l in sys.stdin if l.strip()]\n    if len(lines) >= 2:\n        print(inner_join(lines[0], lines[1]))\n",
                },
                "public_test_cases": [
                    {"input": "1:Engineering,2:Sales,3:Finance\n2:Chicago,1:Boston,4:Austin", "expected_output": "1:Engineering:Boston 2:Sales:Chicago", "explanation": "Joins ID 1 and 2 in sorted order."}
                ],
                "hidden_test_cases": [
                    {"input": "10:Alpha,20:Beta\n20:100,10:200", "expected_output": "10:Alpha:200 20:Beta:100"},
                    {"input": "1:A,2:B\n3:C,4:D", "expected_output": "EMPTY"},
                    {"input": "5:Item5\n5:Stock50", "expected_output": "5:Item5:Stock50"}
                ]
            }
        ]
    elif "devops" in role_lower or "cloud" in role_lower:
        problem_bank = [
            {
                "id": "1",
                "title": "Merge Overlapping Maintenance Windows",
                "difficulty": "Medium",
                "description": "Maintenance windows are given as comma-separated 'start-end' integer pairs (in any order). Merge all overlapping or touching windows and print the merged windows in ascending order, formatted the same way.",
                "input_format": "A single line of comma-separated 'start-end' pairs.",
                "output_format": "Comma-separated merged 'start-end' pairs.",
                "constraints": "1 <= windows <= 10^4, 0 <= start <= end <= 10^9",
                "starter_code": {
                    "python": "import sys\n\ndef merge_windows(pairs):\n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    print(merge_windows(sys.stdin.read().strip()))\n"
                },
                "public_test_cases": [
                    {
                        "input": "1-3,2-6,8-10,15-18",
                        "expected_output": "1-6,8-10,15-18",
                        "explanation": "1-3 and 2-6 overlap into 1-6"
                    }
                ],
                "hidden_test_cases": [
                    {
                        "input": "1-4,4-5",
                        "expected_output": "1-5"
                    },
                    {
                        "input": "5-8,1-2,2-3",
                        "expected_output": "1-3,5-8"
                    },
                    {
                        "input": "1-10,2-3,4-5",
                        "expected_output": "1-10"
                    },
                    {
                        "input": "7-9",
                        "expected_output": "7-9"
                    }
                ]
            },
            {
                "id": "2",
                "title": "Server Log Status Code Frequency Aggregator",
                "difficulty": "Medium",
                "description": "Given a single line containing space-separated HTTP status codes from a web server access log (e.g. '200 200 404 500 500 200'), calculate the count of successful requests (2xx), client errors (4xx), and server errors (5xx). Output the counts formatted as '2XX:<count> 4XX:<count> 5XX:<count>'.",
                "input_format": "Single line of space-separated integer HTTP status codes.",
                "output_format": "'2XX:<n> 4XX:<n> 5XX:<n>'",
                "constraints": "Number of status codes <= 10^5",
                "starter_code": {
                    "python": "import sys\n\ndef aggregate_logs(codes_str: str) -> str:\n    # Count 2XX, 4XX and 5XX status codes and return them in the required output format\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    print(aggregate_logs(s))\n",
                },
                "public_test_cases": [
                    {"input": "200 200 404 500 500 200 401 503", "expected_output": "2XX:3 4XX:2 5XX:3", "explanation": "3 2xx codes, 2 4xx codes, 3 5xx codes."}
                ],
                "hidden_test_cases": [
                    {"input": "200 201 204", "expected_output": "2XX:3 4XX:0 5XX:0"},
                    {"input": "500 502 503 504", "expected_output": "2XX:0 4XX:0 5XX:4"},
                    {"input": "400 403 404 429 200", "expected_output": "2XX:1 4XX:4 5XX:0"}
                ]
            }
        ]
    elif "learning" in role_lower or "ml" in role_lower or "ai" in role_lower:
        problem_bank = [
            {
                "id": "1",
                "title": "Longest Improving Validation Streak",
                "difficulty": "Medium",
                "description": "During training, validation scores are logged per epoch. Find the length of the longest strictly increasing subsequence of the scores (elements need not be adjacent, but must keep their original order).",
                "input_format": "A single line of comma-separated integers.",
                "output_format": "A single integer.",
                "constraints": "1 <= scores <= 10^5, -10^9 <= score <= 10^9",
                "starter_code": {
                    "python": "import sys\n\ndef longest_increasing(scores):\n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    print(longest_increasing(list(map(int, sys.stdin.read().strip().split(',')))))\n"
                },
                "public_test_cases": [
                    {
                        "input": "10,9,2,5,3,7,101,18",
                        "expected_output": "4",
                        "explanation": "One longest subsequence is 2,3,7,101"
                    }
                ],
                "hidden_test_cases": [
                    {
                        "input": "0,1,0,3,2,3",
                        "expected_output": "4"
                    },
                    {
                        "input": "7,7,7,7",
                        "expected_output": "1"
                    },
                    {
                        "input": "5,4,3,2,1",
                        "expected_output": "1"
                    },
                    {
                        "input": "1,3,6,7,9,4,10,5,6",
                        "expected_output": "6"
                    }
                ]
            },
            {
                "id": "2",
                "title": "Feature Matrix Min-Max Normalizer",
                "difficulty": "Medium",
                "description": "Feature scaling scales numeric inputs into the [0.0, 1.0] interval using (x - min) / (max - min). Given a single line of comma-separated numeric features, normalize all features. If max equals min, output '0.00' for all elements. Output space-separated floats rounded to 2 decimal places.",
                "input_format": "Comma-separated numbers on a single line.",
                "output_format": "Space-separated normalized numbers rounded to 2 decimal places.",
                "constraints": "Array length <= 10^4",
                "starter_code": {
                    "python": "import sys\n\ndef min_max_normalize(nums: list) -> str:\n    # Scale values to [0, 1] and return them space-separated with two decimals\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    if s:\n        nums = [float(x) for x in s.split(',') if x.strip()]\n        print(min_max_normalize(nums))\n",
                },
                "public_test_cases": [
                    {"input": "10,20,30,40,50", "expected_output": "0.00 0.25 0.50 0.75 1.00", "explanation": "Normalizes 10 to 0.00 and 50 to 1.00."}
                ],
                "hidden_test_cases": [
                    {"input": "5,5,5", "expected_output": "0.00 0.00 0.00"},
                    {"input": "0,100", "expected_output": "0.00 1.00"},
                    {"input": "1,3,5,7", "expected_output": "0.00 0.33 0.67 1.00"}
                ]
            }
        ]
    else:
        # Full Stack / Backend / Default
        problem_bank = [
            {
                "id": "1",
                "title": "Subarray Sum Equals K",
                "difficulty": "Medium",
                "description": "Given an array of integers and an integer K, print the number of contiguous subarrays whose elements sum to exactly K. The array may contain negative numbers and zeros.",
                "input_format": "Line 1: Comma-separated integers. Line 2: Integer K.",
                "output_format": "A single integer count.",
                "constraints": "1 <= length <= 10^5, -1000 <= value <= 1000",
                "starter_code": {
                    "python": "import sys\n\ndef count_subarrays(nums, k):\n    # Your logic here\n    pass\n\nif __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    print(count_subarrays(list(map(int, lines[0].split(','))), int(lines[1])))\n"
                },
                "public_test_cases": [
                    {
                        "input": "1,1,1\n2",
                        "expected_output": "2",
                        "explanation": "[1,1] occurs twice"
                    }
                ],
                "hidden_test_cases": [
                    {
                        "input": "1,2,3\n3",
                        "expected_output": "2"
                    },
                    {
                        "input": "1,-1,0\n0",
                        "expected_output": "3"
                    },
                    {
                        "input": "3,4,7,2,-3,1,4,2\n7",
                        "expected_output": "4"
                    },
                    {
                        "input": "0,0,0\n0",
                        "expected_output": "6"
                    }
                ]
            },
            {
                "id": "2",
                "title": "Valid Parentheses and Brackets",
                "difficulty": "Medium",
                "description": "Given a string `s` containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid. Open brackets must be closed by the same type of brackets in the correct order.",
                "input_format": "Single line string `s`",
                "output_format": "'true' or 'false'",
                "constraints": "1 <= s.length <= 10^4",
                "starter_code": {
                    "python": "def is_valid(s):\n    # Return 'true' if all brackets are closed in the correct order, else 'false'\n    pass\n\nif __name__ == '__main__':\n    import sys\n    s = sys.stdin.read().strip()\n    print(is_valid(s))\n",
                },
                "public_test_cases": [
                    {"input": "()[]{}", "expected_output": "true", "explanation": "Properly nested pairs"}
                ],
                "hidden_test_cases": [
                    {"input": "(]", "expected_output": "false"},
                    {"input": "([)]", "expected_output": "false"},
                    {"input": "{[]}", "expected_output": "true"},
                    {"input": "(((((())))))", "expected_output": "true"}
                ]
            }
        ]

    selected = problem_bank[:max(1, min(count, len(problem_bank)))]
    client_safe = []
    server_keys = {}

    for prob in selected:
        pid = str(prob["id"])
        client_safe.append({
            "id": pid,
            "title": prob["title"],
            "difficulty": prob["difficulty"],
            "description": prob["description"],
            "input_format": prob["input_format"],
            "output_format": prob["output_format"],
            "constraints": prob["constraints"],
            "starter_code": prob["starter_code"],
            "public_test_cases": prob["public_test_cases"]
        })
        server_keys[pid] = {
            "hidden_test_cases": prob["hidden_test_cases"]
        }

    return client_safe, server_keys


def generate_interview_questions(
    jd_data: Dict[str, Any],
    resume_data: Optional[Dict[str, Any]] = None,
    count: int = 5,
    resume_text: str = "",
    jd_text: str = "",
    company: str = ""
) -> List[Dict[str, Any]]:
    """
    Generates conversational technical & behavioral interview questions grounded in JD and resume.
    """
    role = jd_data.get("role_title", "Software Engineer")
    skills = ", ".join(jd_data.get("required_skills", ["Full Stack Development"]))
    candidate_skills = ", ".join(_skill_names(resume_data)) if resume_data else "General Engineering"

    jd_context = jd_text[:1200] if jd_text else f"Role: {role}\nRequired Skills: {skills}"
    resume_context = resume_text[:1200] if resume_text else f"Candidate Skills: {candidate_skills}"

    prompt = f"""
You are a senior hiring bar raiser conducting a rigorous, highly conversational 5-question voice interview.
Generate {count} technical and behavioral interview questions grounded specifically in the target Job Description and Candidate Resume.

TARGET JOB DESCRIPTION & REQUIREMENTS:
{jd_context}

CANDIDATE RESUME & EXPERIENCE:
{resume_context}

CRITICAL RULES FOR THE 5 QUESTIONS:
1. Question 1: Open with a welcoming question probing a specific project, technology, or accomplishment from their resume that directly relates to the {role} position.
2. Question 2: Architectural and technical defense testing their core design patterns against the required JD stack ({skills}).
3. Question 3: A realistic debugging or edge-case troubleshooting scenario in the required tech stack.
4. Question 4: System design or scalability challenge tailored to the role's responsibilities.
5. Question 5: Production resilience, trade-offs, and behavioral collaboration (STAR methodology).

Return strictly valid JSON with an array "questions" containing objects with:
- "id": integer (1 to {count})
- "type": "TECHNICAL" or "BEHAVIORAL" or "SYSTEM_DESIGN"
- "question": realistic, conversational question text suitable for a voice interview
- "evaluation_criteria": key technical competencies and STAR points a strong answer must demonstrate
{style_note(company)}"""
    try:
        res = call_gemini(prompt, system_prompt="You are an expert technical interviewer and hiring bar raiser. Output strictly valid JSON.")
        questions = res.get("questions", [])
        if len(questions) >= 3:
            return questions
    except Exception as e:
        print(f"[RoleReady] AI Interview generation fallback: {e}")

    return [
        {
            "id": 1,
            "type": "TECHNICAL",
            "question": f"Walk me through how you implement clean separation of concerns and robust error handling in your {skills.split(',')[0]} projects.",
            "evaluation_criteria": "Layered architecture, domain error boundaries, testability."
        },
        {
            "id": 2,
            "type": "SYSTEM_DESIGN",
            "question": "How would you design a rate limiter for an API endpoint experiencing high burst traffic? What data structures and caching mechanisms would you use?",
            "evaluation_criteria": "Token bucket / sliding window, Redis caching, atomicity, degradation handling."
        },
        {
            "id": 3,
            "type": "TECHNICAL",
            "question": "Can you explain the trade-offs between SQL relational schemas and NoSQL document stores for high-write telemetry logging?",
            "evaluation_criteria": "ACID guarantees vs. horizontal write throughput, indexing overhead."
        },
        {
            "id": 4,
            "type": "BEHAVIORAL",
            "question": "Describe a difficult bug you encountered in production or during a project. How did you isolate the root cause, and how did you prevent recurrence?",
            "evaluation_criteria": "STAR methodology, root cause depth, automated test additions."
        },
        {
            "id": 5,
            "type": "BEHAVIORAL",
            "question": f"How do you prioritize technical debt versus shipping features quickly when preparing an enterprise release for {role}?",
            "evaluation_criteria": "Pragmatic balance, stakeholder alignment, refactoring cadence."
        }
    ]


def _organization_name(db: Session, organization_id: Optional[int]) -> str:
    """Name of the hiring organization, used as the question-style company for recruiter invitations."""
    if not organization_id:
        return ""
    try:
        org = db.query(Organization).filter(Organization.id == organization_id).first()
    except SQLAlchemyError:
        return ""
    return (org.name or "").strip() if org else ""


def _session_company(db: Session, session: RoleReadySession) -> str:
    """Company for question style: the session's target company, else the recruiter's organization (never a placeholder)."""
    return (session.target_company or "").strip() or _organization_name(db, session.organization_id)


def _merge_with_web(kind: str, jd_data: Dict[str, Any], count: int, company: str, jd_text: str, core, builder):
    """
    Real questions found on the web first (each with its verified company / count / year when the source states them),
    then the normal generator fills whatever is missing. Any web failure simply means everything comes from the generator.
    """
    role = (jd_data.get("role_title") or "Software Engineer").strip()
    skills = ", ".join(str(sk) for sk in (jd_data.get("required_skills") or []))
    # Entered target company, else the top 10 tech companies ordered by JD relevance; every question carries its own style company.
    entered = sanitize_company(company)
    picked = () if entered else pick_top_tech_companies(role, skills, jd_text)
    search_target = entered or ", ".join(picked)
    try:
        found = web_question_research.research(kind, role, skills, search_target, jd_text, count)
    except Exception as e:
        print(f"[RoleReady] Web {kind} research skipped: {e}")
        found = []

    client_items, keys_by_item = [], []
    for raw in found:
        if len(client_items) >= count:
            break
        try:
            built = builder([raw], 1)
        except Exception:
            built = None
        if not built or not built[0]:
            continue  # invalid structure (e.g. missing options / tests): not usable
        item, keys = built[0][0], built[1].get("1")
        attach_provenance(item, raw.get("provenance"))
        client_items.append(item)
        keys_by_item.append(keys)

    if len(client_items) < count:
        rest_client, rest_keys = core(jd_data, count - len(client_items), entered, jd_text, picked)
        for item in rest_client:
            client_items.append(item)
            keys_by_item.append(rest_keys.get(str(item["id"])))

    merged_keys = {}
    for idx, (item, keys) in enumerate(zip(client_items, keys_by_item), start=1):
        item["id"] = str(idx)
        item["style_company"] = _style_company_for(item, entered, picked, idx - 1)
        merged_keys[str(idx)] = keys
    return client_items, merged_keys


def _style_company_for(item: Dict[str, Any], entered: str, picked: tuple, index: int) -> str:
    """The company shown on a question: the entered one, else the company the AI tagged (if on our list), else spread over the list."""
    if entered:
        return entered
    tagged = str(item.get("style_company") or "").strip()
    for name in picked:
        if tagged.lower() == name.lower():
            return name
    return picked[index % len(picked)]


def generate_aptitude_questions(jd_data: Dict[str, Any], count: int = 10, company: str = "", jd_text: str = "") -> tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Web-researched aptitude questions first, generated ones for the rest. Returns (client_safe_questions, server_private_keys)."""
    return _merge_with_web("aptitude", jd_data, count, company, jd_text, _generate_aptitude_core, _build_aptitude_payload)


def generate_coding_problems(jd_data: Dict[str, Any], count: int = 2, company: str = "", jd_text: str = "") -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Web-researched coding problems first, generated ones for the rest. Returns (client_safe_problems, server_private_keys)."""
    return _merge_with_web("coding", jd_data, count, company, jd_text, _generate_coding_core, _build_coding_payload)


# ==============================================================================
# WORKFLOW A: STUDENT SELF-ASSESSMENT ORCHESTRATION
# ==============================================================================

def create_student_session(
    db: Session,
    student_profile: StudentProfile,
    target_role: Optional[str] = None,
    target_company: Optional[str] = None,
    custom_jd_text: Optional[str] = None,
    resume_file_path: Optional[str] = None,
    resume_snapshot: Optional[Dict[str, Any]] = None,
    resume_raw_text: Optional[str] = None
) -> RoleReadySession:
    """
    Initializes a new self-assessment session with synthesized JD and 3 pending rounds.
    """
    role = target_role or student_profile.target_role or "Software Engineer"
    # Only the company typed on the assessment page counts; a blank field means "no company" (top tech companies are used),
    # never the company saved on the student profile.
    company = (target_company or "").strip() or None

    # Extract JD
    jd_data = extract_structured_jd(custom_jd_text or "", default_role=role)

    # If no resume snapshot passed, fetch latest from student profile
    if not resume_snapshot:
        latest_res = db.query(StudentResume).filter(
            StudentResume.student_profile_id == student_profile.id
        ).order_by(desc(StudentResume.version)).first()
        if latest_res:
            resume_snapshot = latest_res.analysis_data or {"skills": student_profile.current_skills or []}
            resume_file_path = latest_res.file_path
        else:
            resume_snapshot = {"skills": student_profile.current_skills or []}

    session_uuid = str(uuid.uuid4())
    session = RoleReadySession(
        session_uuid=session_uuid,
        workflow_type="SELF_ASSESSMENT",
        organization_id=student_profile.organization_id,
        student_profile_id=student_profile.id,
        target_role=role,
        target_company=company,
        jd_title=jd_data.get("role_title", role),
        custom_jd_text=custom_jd_text,
        extracted_jd_data=jd_data,
        resume_snapshot=resume_snapshot,
        resume_file_path=resume_file_path,
        resume_raw_text=resume_raw_text,
        current_state=RoleReadySessionState.NOT_STARTED
    )
    db.add(session)
    db.flush()

    # Pre-generate questions for rounds concurrently
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        future_apt = executor.submit(generate_aptitude_questions, jd_data, 10, company or "", custom_jd_text or "")
        future_coding = executor.submit(generate_coding_problems, jd_data, 2, company or "", custom_jd_text or "")
        future_interview = executor.submit(generate_interview_questions, jd_data, resume_snapshot, 5, "", custom_jd_text or "", company or "")

        apt_client, apt_keys = future_apt.result()
        coding_client, coding_keys = future_coding.result()
        interview_questions = future_interview.result()

    # 1. Aptitude Round
    round1 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="APTITUDE",
        round_order=1,
        status="PENDING",
        time_limit_minutes=policy.SECTION_MINUTES,
        questions_payload=apt_client,
        server_keys_payload=apt_keys
    )
    # 2. Coding Round
    round2 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="CODING",
        round_order=2,
        status="PENDING",
        time_limit_minutes=policy.SECTION_MINUTES,
        questions_payload=coding_client,
        server_keys_payload=coding_keys
    )
    # 3. Interview Round
    round3 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="INTERVIEW",
        round_order=3,
        status="PENDING",
        time_limit_minutes=policy.SECTION_MINUTES,
        questions_payload=interview_questions,
        server_keys_payload={"questions": interview_questions}
    )

    db.add_all([round1, round2, round3])
    db.commit()
    db.refresh(session)
    return session


def get_session_by_uuid(db: Session, session_uuid: str) -> RoleReadySession:
    """Helper to locate session by UUID with 404 guard."""
    session = db.query(RoleReadySession).filter(RoleReadySession.session_uuid == session_uuid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Assessment session not found.")
    return session


# ─── ROUND LIFECYCLE HELPERS ──────────────────────────────────────────────────

PYTHON_ONLY_DETAIL = engine.UNSUPPORTED_LANGUAGE_DETAIL
# Max parallel sandbox calls per coding submission (kept modest to stay under the sandbox's rate limit)
CODING_TEST_CONCURRENCY = engine.CODING_TEST_CONCURRENCY
SUPPORTED_CODING_LANGUAGES = engine.SUPPORTED_LANGUAGES
UNSUPPORTED_LANGUAGE_DETAIL = engine.UNSUPPORTED_LANGUAGE_DETAIL
RUN_CODE_RATE_LIMIT = 5            # run-code requests per window, per student
RUN_CODE_WINDOW_SECONDS = 60
RUN_CODE_MAX_CONCURRENT = 2        # simultaneous sandbox executions per student
MAX_CODE_BYTES = engine.MAX_CODE_BYTES
MAX_OUTPUT_CHARS = engine.MAX_OUTPUT_CHARS
# Arrival window for a final submission dispatched before a deadline (shared with the recruitment workflow).
EXPIRY_GRACE_SECONDS = policy.TRANSIT_WINDOW_SECONDS

# States in which the assessment clock is running (an unlocked-but-unstarted round still counts against the overall deadline).
LIVE_STATES = (
    RoleReadySessionState.APTITUDE_IN_PROGRESS,
    RoleReadySessionState.CODING_UNLOCKED,
    RoleReadySessionState.CODING_IN_PROGRESS,
    RoleReadySessionState.INTERVIEW_UNLOCKED,
    RoleReadySessionState.INTERVIEW_IN_PROGRESS,
)
# States after which an attempt is closed for good (never reopened automatically).
TERMINAL_STATES = (
    RoleReadySessionState.COMPLETED,
    RoleReadySessionState.TIMED_OUT,
    RoleReadySessionState.ABANDONED,
)
_ACTIVE_ROUND_FOR_STATE = {
    RoleReadySessionState.APTITUDE_IN_PROGRESS: "APTITUDE",
    RoleReadySessionState.CODING_IN_PROGRESS: "CODING",
    RoleReadySessionState.INTERVIEW_IN_PROGRESS: "INTERVIEW",
}
_SECTION_STATE = {
    "APTITUDE": RoleReadySessionState.APTITUDE_IN_PROGRESS,
    "CODING": RoleReadySessionState.CODING_IN_PROGRESS,
    "INTERVIEW": RoleReadySessionState.INTERVIEW_IN_PROGRESS,
}

# NOTE: in-process limiter; with multiple workers the effective limit is per worker.
_run_code_lock = threading.Lock()
_run_code_calls: Dict[Any, deque] = defaultdict(deque)
_run_code_active: Dict[Any, int] = defaultdict(int)


def _commit_or_500(db: Session) -> None:
    """Commits; rolls back and reports a clean 500 so the round stays unchanged and can be retried."""
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error: submission was not saved. Please retry.")


def _refresh_student_readiness(db: Session, session: RoleReadySession) -> None:
    """After a self-assessment finishes, fold its score into the student's stored readiness."""
    if session.student_profile_id:
        refresh_profile_readiness(
            db, db.query(StudentProfile).filter(StudentProfile.id == session.student_profile_id).first()
        )


def _get_round(db: Session, session: RoleReadySession, round_type: str, label: str) -> RoleReadyRoundAttempt:
    rnd = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == round_type
    ).first()
    if not rnd:
        raise HTTPException(status_code=404, detail=f"{label} round not found.")
    return rnd


def _fingerprint(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _claim_round(db: Session, rnd: RoleReadyRoundAttempt) -> None:
    """
    Atomically marks the round EVALUATED. Only one concurrent submission can win; the loser
    gets HTTP 409 and cannot overwrite the first committed result.
    """
    claimed = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.id == rnd.id,
        RoleReadyRoundAttempt.status != "EVALUATED"
    ).update({"status": "EVALUATED"}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Another submission for this round was already committed.")


def _reject_resubmission(session: RoleReadySession, rnd: RoleReadyRoundAttempt, submitted: Any) -> bool:
    """
    For an already-evaluated round: returns True for an identical retry (caller replays the stored
    result, no re-scoring); raises HTTP 400 for a different/new submission (original result kept).
    """
    if _fingerprint(rnd.submission_payload) == _fingerprint(submitted):
        return True
    closed = session.current_state == RoleReadySessionState.COMPLETED
    raise HTTPException(
        status_code=400,
        detail="Assessment closed: this assessment is already completed." if closed
        else "Round completed: a result has already been recorded for this round."
    )


# Single source of truth for round time limits (minutes). Setup page, invitation email and portal show these same values.
ROUND_TIME_LIMITS_MINUTES = {"APTITUDE": 15, "CODING": 30, "INTERVIEW": 15}


def _db_now() -> datetime:
    """The authoritative server clock as the naive-UTC value the DateTime columns persist."""
    return clock.naive_utc(clock.now())


def _section_deadline(session: RoleReadySession, rnd: RoleReadyRoundAttempt) -> Optional[datetime]:
    """When this round must be over: its own limit, but never later than the overall deadline."""
    if not rnd.started_at:
        return None
    deadline = clock.aware(rnd.started_at) + timedelta(minutes=rnd.time_limit_minutes)
    overall = clock.aware(session.overall_deadline_at)
    return min(deadline, overall) if overall is not None else deadline


def _round_timing(rnd: RoleReadyRoundAttempt, session: Optional[RoleReadySession] = None) -> Dict[str, Any]:
    """Server-authoritative timer: the client hydrates its countdown from these values (display only)."""
    now = clock.now()
    overall = clock.aware(session.overall_deadline_at) if session is not None else None
    out: Dict[str, Any] = {"server_time": now.isoformat()}
    if overall is not None:
        out["overall_deadline_at"] = overall.isoformat()
        out["overall_remaining_seconds"] = max(0, int((overall - now).total_seconds()))
    if not rnd.started_at:
        remaining = rnd.time_limit_minutes * 60
        if overall is not None:
            remaining = min(remaining, out["overall_remaining_seconds"])
        return {"started_at": None, "deadline_at": None, "remaining_seconds": remaining, **out}
    deadline = _section_deadline(session, rnd) if session is not None else \
        clock.aware(rnd.started_at) + timedelta(minutes=rnd.time_limit_minutes)
    return {
        "started_at": clock.aware(rnd.started_at).isoformat(),
        "deadline_at": deadline.isoformat(),
        "remaining_seconds": max(0, int((deadline - now).total_seconds())),
        **out,
    }


def _server_time_spent(rnd: RoleReadyRoundAttempt, fallback: int = 0) -> int:
    """Seconds spent on a round measured by the server; the browser's figure is only a fallback."""
    if rnd.started_at:
        return max(0, int((clock.now() - clock.aware(rnd.started_at)).total_seconds()))
    return max(0, int(fallback or 0))


def _require_supported_language(language: Optional[str]) -> str:
    try:
        return engine.normalize_language(language)
    except ValueError:
        raise HTTPException(status_code=400, detail=UNSUPPORTED_LANGUAGE_DETAIL)


_require_python = _require_supported_language


def _acquire_run_slot(key: Any) -> None:
    now = time.monotonic()
    with _run_code_lock:
        calls = _run_code_calls[key]
        while calls and now - calls[0] > RUN_CODE_WINDOW_SECONDS:
            calls.popleft()
        if len(calls) >= RUN_CODE_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many run requests. Please wait a minute and try again.")
        if _run_code_active[key] >= RUN_CODE_MAX_CONCURRENT:
            raise HTTPException(status_code=429, detail="Too many simultaneous executions. Please wait for the current run to finish.")
        calls.append(now)
        _run_code_active[key] += 1


def _release_run_slot(key: Any) -> None:
    with _run_code_lock:
        _run_code_active[key] = max(0, _run_code_active[key] - 1)


def _sandbox_unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="Code execution sandbox is unavailable. Your code is preserved; please retry shortly."
    )


def _trim_output(text: Optional[str]) -> str:
    return (text or "")[:MAX_OUTPUT_CHARS]


def reported_overall(session: RoleReadySession) -> Optional[float]:
    """
    The overall score a report may show: only a COMPLETED attempt has one (a disqualified attempt reports its explicit 0).
    The column itself is NOT NULL and holds 0.0 for every other attempt, so every reader goes through here instead of
    treating that placeholder as a result.
    """
    if session.current_state != RoleReadySessionState.COMPLETED:
        return None
    return float(session.overall_readiness_score or 0.0)


def section_scores(session: RoleReadySession) -> Dict[str, Optional[float]]:
    """Section percentages for display. A timed-out attempt reports null for sections it never reached."""
    if session.current_state == RoleReadySessionState.TIMED_OUT:
        report = session.final_report_data or {}
        return {k: policy.display_pct(report.get(k)) for k in ("aptitude_score", "coding_score", "interview_score")}
    return {"aptitude_score": policy.display_pct(session.aptitude_score), "coding_score": policy.display_pct(session.coding_score),
            "interview_score": policy.display_pct(session.interview_score)}


def _assert_attempt_open(session: RoleReadySession) -> None:
    if session.current_state == RoleReadySessionState.TIMED_OUT:
        raise HTTPException(status_code=409, detail="The assessment time limit has expired. This attempt is closed.")
    if session.current_state == RoleReadySessionState.ABANDONED:
        raise HTTPException(status_code=409, detail="This assessment attempt has been closed.")


def _draft_of(rnd: Optional[RoleReadyRoundAttempt]) -> Optional[Dict[str, Any]]:
    """The autosaved (not yet submitted) work of an in-progress round, in canonical submission form."""
    payload = rnd.submission_payload if rnd is not None else None
    if isinstance(payload, dict) and isinstance(payload.get("_draft"), dict):
        return payload["_draft"]
    return None


def save_draft(db: Session, session: RoleReadySession, section: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Autosave of in-progress work (a debounced call from the shared assessment UI) so the server can score what a
    candidate had if the section or the whole assessment ends before they submit. Hard stop at the deadline.
    """
    finalize_expired_round(db, session)
    section = (section or "").upper()
    if section not in _SECTION_STATE:
        raise HTTPException(status_code=400, detail="Unknown section.")
    _assert_attempt_open(session)
    if session.current_state != _SECTION_STATE[section]:
        raise HTTPException(status_code=403, detail="That section is not the active section.")
    rnd = _get_round(db, session, section, section.title())
    if rnd.status != "IN_PROGRESS":
        raise HTTPException(status_code=409, detail="This section has already been submitted.")
    now = clock.now()
    deadline = _section_deadline(session, rnd)
    if deadline is not None and now >= deadline:
        raise HTTPException(status_code=408, detail="Assessment round deadline reached. No further work permitted.")
    try:
        normalized = engine.normalize_submission(section, payload, rnd.questions_payload or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    rnd.submission_payload = {"_draft": normalized, "saved_at": now.isoformat()}
    _commit_or_500(db)
    return {"saved": True, "server_time": now.isoformat()}


def _begin_round(db: Session, session: RoleReadySession, rnd: RoleReadyRoundAttempt,
                 unlocked_state: RoleReadySessionState, running_state: RoleReadySessionState) -> None:
    """
    Unlocked -> in progress, atomically: only the request that wins the state change starts the clock, so repeated or
    concurrent start requests can never reset a deadline. The section limit is the canonical 20 minutes, capped by the
    overall deadline.
    """
    if session.current_state != unlocked_state:
        return
    now = clock.now()
    overall = clock.aware(session.overall_deadline_at)
    section_deadline = policy.section_deadline(now, overall)
    claimed = db.query(RoleReadySession).filter(
        RoleReadySession.id == session.id, RoleReadySession.current_state == unlocked_state
    ).update({"current_state": running_state.value, "current_section_deadline_at": clock.naive_utc(section_deadline)},
             synchronize_session=False)
    if claimed != 1:
        db.rollback()
        db.refresh(session)
        return
    started = clock.naive_utc(now)
    db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.id == rnd.id, RoleReadyRoundAttempt.started_at.is_(None)
    ).update({"status": "IN_PROGRESS", "started_at": started, "time_limit_minutes": policy.SECTION_MINUTES},
             synchronize_session=False)
    _commit_or_500(db)
    db.refresh(session)
    db.refresh(rnd)


def finalize_expired_round(db: Session, session: RoleReadySession) -> bool:
    """
    Server-side timer authority, evaluated on every request that touches an attempt:
      * overall deadline (+ arrival window) passed  -> the active section is scored from its autosaved work, every
        later section becomes UNATTEMPTED and the attempt is closed as TIMED_OUT (overall score stays null);
      * only the active section's deadline passed   -> the section is closed from its autosaved work and the attempt
        advances exactly as if the candidate had submitted it.
    Sessions that never recorded an overall deadline (started before the 60-minute limit existed) keep their original
    per-round limits. Returns True when something was finalized.
    """
    if session.current_state not in LIVE_STATES:
        return False
    now = clock.now()
    window = timedelta(seconds=policy.TRANSIT_WINDOW_SECONDS)
    overall = clock.aware(session.overall_deadline_at)
    active_type = _ACTIVE_ROUND_FOR_STATE.get(session.current_state)
    rnd = None
    if active_type:
        rnd = db.query(RoleReadyRoundAttempt).filter(
            RoleReadyRoundAttempt.session_id == session.id,
            RoleReadyRoundAttempt.round_type == active_type
        ).first()
        if rnd is None or rnd.status in ("EVALUATED", "EVALUATING", "EVAL_FAILED"):
            return False
    try:
        if overall is not None and now > overall + window:
            return _time_out_session(db, session, rnd)
        if rnd is None or not rnd.started_at:
            return False
        if now <= _section_deadline(session, rnd) + window:
            return False
        draft = _draft_of(rnd) or {}
        spent = _server_time_spent(rnd)
        if active_type == "APTITUDE":
            submit_aptitude_round(db, session, draft.get("answers") or {}, spent, None, _auto=True)
        elif active_type == "CODING":
            submit_coding_round(db, session, draft.get("solutions") or {}, spent, None, _auto=True)
        else:
            submit_interview_round(db, session, {"answers": draft.get("answers") or [], "transcript": draft.get("transcript") or []},
                                   spent, None, _auto=True)
        return True
    except HTTPException:
        db.rollback()
        return False


def _time_out_session(db: Session, session: RoleReadySession, active_round: Optional[RoleReadyRoundAttempt]) -> bool:
    """Overall deadline reached: keep every score earned so far, never turn a missing section into a zero."""
    now = clock.now()
    now_db = clock.naive_utc(now)
    if active_round is not None and active_round.status == "IN_PROGRESS":
        draft = _draft_of(active_round) or {}
        spent = _server_time_spent(active_round)
        if active_round.round_type == "APTITUDE":
            _score_aptitude(db, session, active_round, draft.get("answers") or {}, spent, None)
        elif active_round.round_type == "CODING":
            _score_coding(db, session, active_round, draft.get("solutions") or {}, spent, None)
        else:
            _score_interview(db, session, active_round,
                             {"answers": draft.get("answers") or [], "transcript": draft.get("transcript") or []}, spent, None)
    rounds = db.query(RoleReadyRoundAttempt).filter(RoleReadyRoundAttempt.session_id == session.id).all()
    for r in rounds:
        if r.status not in ("EVALUATED", "TERMINATED"):
            r.status = "UNATTEMPTED"
            r.score = 0.0
            r.evaluation_payload = {"status": "UNATTEMPTED", "score": None}
    by_type = {r.round_type: r for r in rounds}
    scores = {k: (by_type[k].score if k in by_type and by_type[k].status == "EVALUATED" else None) for k in ("APTITUDE", "CODING", "INTERVIEW")}
    session.current_state = RoleReadySessionState.TIMED_OUT
    session.finalized_at = now_db
    session.overall_readiness_score = 0.0   # NOT NULL placeholder; reported_overall() hides it
    session.final_report_data = {
        "session_uuid": session.session_uuid,
        "completion_status": "TIMED_OUT",
        "scoring_model": policy.SCORING_MODEL,
        "evaluated_at": now.isoformat(),
        "overall_readiness_score": None,
        "readiness_tier": "Incomplete",
        "aptitude_score": scores["APTITUDE"],
        "coding_score": scores["CODING"],
        "interview_score": scores["INTERVIEW"],
        "demonstrated_strengths": [],
        "areas_for_improvement": ["The 60-minute assessment limit was reached before every section was completed."],
    }
    _commit_or_500(db)
    return True


# ─── RESUME / JD MATCH & DOSSIER ──────────────────────────────────────────────

def _skill_names(snapshot: Optional[Dict[str, Any]]) -> List[str]:
    names = []
    for item in (snapshot or {}).get("skills", []) or []:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
    return names


def compute_resume_jd_match(session: RoleReadySession) -> float:
    """
    Contextual baseline only (REQ-10): keyword overlap between the JD's required skills and the
    resume. Independent of assessment scores.
    """
    required = [str(s) for s in ((session.extracted_jd_data or {}).get("required_skills") or []) if str(s).strip()]
    if not required:
        return 0.0
    haystack = " ".join(_skill_names(session.resume_snapshot) + [session.resume_raw_text or ""]).lower()
    matched = sum(1 for skill in required if skill.lower() in haystack)
    return round(matched / len(required) * 100, 1)


def readiness_tier(score: Optional[float]) -> str:
    if score is None:
        return "Incomplete"
    if score >= 90.0:
        return "Exceptional Placement Ready"
    if score >= 75.0:
        return "Direct Role Ready"
    if score >= 60.0:
        return "Foundation Strong"
    return "Building Foundation"


def _build_round_details(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """Per-round evidence for the student report: what was asked, how they did, time and proctoring."""
    rounds = {
        r.round_type: r for r in db.query(RoleReadyRoundAttempt).filter(
            RoleReadyRoundAttempt.session_id == session.id
        ).all()
    }

    def _meta(r):
        violations = r.proctoring_violations or []
        return {
            "status": r.status,
            "time_spent_seconds": r.time_spent_seconds or 0,
            "time_limit_minutes": r.time_limit_minutes,
            "violation_count": len(violations),
            "violations": [v.get("type") for v in violations if isinstance(v, dict)][:10],
        }

    details: Dict[str, Any] = {}

    apt = rounds.get("APTITUDE")
    if apt and apt.evaluation_payload:
        ev = apt.evaluation_payload
        questions = {str(q.get("id")): q for q in (apt.questions_payload or []) if isinstance(q, dict)}
        items = []
        for b in ev.get("breakdown", []):
            q = questions.get(str(b.get("question_id")), {})
            options = {str(o.get("key")).upper(): o.get("text") for o in q.get("options", []) if isinstance(o, dict)}
            choice = b.get("student_choice") or ""
            items.append({
                "question": q.get("question") or f"Question {b.get('question_id')}",
                "your_answer": f"{choice}. {options.get(choice, '')}".strip(". ") if choice else "Not answered",
                "is_correct": bool(b.get("is_correct")),
                "explanation": b.get("explanation", ""),
            })
        details["aptitude"] = {
            **_meta(apt),
            "correct_count": ev.get("correct_count", 0),
            "total_questions": ev.get("total_questions", len(items)),
            "questions": items,
        }

    coding = rounds.get("CODING")
    if coding and coding.evaluation_payload:
        ev = coding.evaluation_payload
        details["coding"] = {
            **_meta(coding),
            "passed_hidden_tests": ev.get("passed_hidden_tests", 0),
            "total_hidden_tests": ev.get("total_hidden_tests", 0),
            "problems": [
                {k: p.get(k) for k in ("title", "language", "passed_tests", "total_tests", "score")}
                for p in ev.get("problems", [])
            ],
        }

    interview = rounds.get("INTERVIEW")
    if interview and interview.status in ("EVALUATED", "TERMINATED"):
        details["interview"] = _meta(interview)

    return details


_FROM_SESSION = object()


def build_performance_dossier(db: Session, session: RoleReadySession, qualitative: Optional[Dict[str, Any]] = None,
                              overall: Any = _FROM_SESSION) -> Dict[str, Any]:
    """Deterministic 17-point student performance dossier (works with no AI available)."""
    qualitative = qualitative or {}
    jd = session.extracted_jd_data or {}
    required = [str(s) for s in (jd.get("required_skills") or [])]
    resume_text = (" ".join(_skill_names(session.resume_snapshot)) + " " + (session.resume_raw_text or "")).lower()

    student_name = None
    if session.student_profile_id:
        profile = db.query(StudentProfile).filter(StudentProfile.id == session.student_profile_id).first()
        student_name = profile.full_name if profile else None
    if not student_name and session.candidate_id:
        cand = db.query(Candidate).filter(Candidate.id == session.candidate_id).first()
        student_name = cand.name if cand else None

    apt, code, interview = session.aptitude_score or 0.0, session.coding_score or 0.0, session.interview_score or 0.0
    if overall is _FROM_SESSION:
        overall = reported_overall(session)

    coding_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id, RoleReadyRoundAttempt.round_type == "CODING").first()
    coding_eval = (coding_round.evaluation_payload or {}) if coding_round else {}
    passed, total = coding_eval.get("passed_hidden_tests", 0), coding_eval.get("total_hidden_tests", 0)

    interview_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id, RoleReadyRoundAttempt.round_type == "INTERVIEW").first()
    int_eval = (interview_round.evaluation_payload or {}) if interview_round else {}
    q_evals = qualitative.get("question_evaluations") or int_eval.get("question_evaluations") or []
    tech_depth = qualitative.get("technical_depth_score") or int_eval.get("technical_depth_score") or interview
    comm_score = qualitative.get("communication_score") or int_eval.get("communication_score") or interview

    strengths, improvements = [], []
    (strengths if apt >= 70 else improvements).append(
        f"Aptitude reasoning scored {apt:.0f}%" if apt >= 70 else "Strengthen quantitative and logical reasoning speed and accuracy")
    (strengths if code >= 70 else improvements).append(
        f"Python solutions passed {passed}/{total} hidden test cases" if code >= 70 else "Practice Python algorithmic problems, focusing on edge cases and complexity")
    (strengths if interview >= 70 else improvements).append(
        "Clear, structured interview responses" if interview >= 70 else "Structure interview answers using the STAR format with concrete outcomes")
    
    extra_strengths = (qualitative.get("key_strengths") or qualitative.get("strengths") or int_eval.get("key_strengths") or [])
    extra_improvements = (qualitative.get("key_areas_for_improvement") or qualitative.get("areas_for_improvement") or int_eval.get("key_areas_for_improvement") or [])
    strengths += [s for s in extra_strengths if isinstance(s, str) and s not in strengths][:2]
    improvements += [s for s in extra_improvements if isinstance(s, str) and s not in improvements][:2]

    skill_gap = []
    for skill in required[:8]:
        if skill.lower() in resume_text:
            skill_gap.append({"skill": skill, "status": "Demonstrated", "evidence": "Resume evidence"})
        else:
            skill_gap.append({"skill": skill, "status": "Gap", "recommendation": f"Build and showcase hands-on {skill} experience"})
    gaps = [g["skill"] for g in skill_gap if g["status"] == "Gap"]

    weakest = min([("aptitude", apt), ("coding", code), ("interview", interview)], key=lambda x: x[1])[0]
    return {
        "student_name": student_name or "Student",
        "company_name": session.target_company or "Target Company",
        "target_role": session.target_role,
        "jd_summary": (session.custom_jd_text or "").strip()[:300]
            or f"{jd.get('role_title', session.target_role)} role requiring {', '.join(required[:5]) or 'core engineering skills'}.",
        "overall_readiness_score": overall,
        "readiness_tier": readiness_tier(overall),
        "aptitude_score": apt,
        "coding_score": code,
        "interview_score": interview,
        "interview_breakdown": q_evals,
        "round_details": _build_round_details(db, session),
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "interview_technical_depth_score": tech_depth,
        "interview_communication_score": comm_score,
        "resume_to_jd_match_score": compute_resume_jd_match(session),
        "demonstrated_strengths": strengths or ["Completed all three assessment rounds"],
        "areas_for_improvement": improvements,
        "skill_gap_analysis": skill_gap,
        "technical_feedback": f"Aptitude {apt:.0f}%, Python coding {code:.0f}% ({passed}/{total} hidden tests passed).",
        "communication_feedback": qualitative.get("summary") or qualitative.get("qualitative_feedback")
            or "Interview communication was evaluated against structured STAR criteria.",
        "personalized_recommendations": [
            f"Focus next on your weakest area: {weakest}",
            "Use the Coding Practice and Mock Interview modules to rehearse before your next attempt",
        ] + ([f"Close skill gaps: {', '.join(gaps[:3])}"] if gaps else []),
        "suggested_learning_roadmap": {
            "week_1": f"Targeted practice on {weakest}",
            "week_2": f"Skill-gap study: {', '.join(gaps[:2]) or 'role-specific fundamentals'}",
            "week_3": "Timed Python problem solving and mock assessments",
            "week_4": "Behavioral STAR interview refinement",
        },
    }


# ─── ROUND 1: APTITUDE ────────────────────────────────────────────────────────

def start_aptitude_round(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    NOT_STARTED -> APTITUDE_IN_PROGRESS: the explicit start of the assessment. This is the ONLY place the overall
    60-minute deadline is established; registration, instructions and repeated start requests never move it.
    """
    finalize_expired_round(db, session)
    _assert_attempt_open(session)
    allowed = [RoleReadySessionState.NOT_STARTED, RoleReadySessionState.APTITUDE_IN_PROGRESS]
    if session.current_state not in allowed:
        raise HTTPException(status_code=400, detail=f"Cannot start Aptitude round from state '{session.current_state}'.")

    apt_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == "APTITUDE"
    ).first()

    if not apt_round:
        raise HTTPException(status_code=404, detail="Aptitude round configuration missing.")

    if session.current_state == RoleReadySessionState.NOT_STARTED:
        now = clock.now()
        overall = policy.overall_deadline(now)
        claimed = db.query(RoleReadySession).filter(
            RoleReadySession.id == session.id, RoleReadySession.current_state == RoleReadySessionState.NOT_STARTED
        ).update({
            "current_state": RoleReadySessionState.APTITUDE_IN_PROGRESS.value,
            "started_at": clock.naive_utc(now),
            "overall_deadline_at": clock.naive_utc(overall),
            "current_section_deadline_at": clock.naive_utc(policy.section_deadline(now, overall)),
        }, synchronize_session=False)
        if claimed == 1:
            db.query(RoleReadyRoundAttempt).filter(RoleReadyRoundAttempt.id == apt_round.id).update({
                "status": "IN_PROGRESS", "started_at": clock.naive_utc(now), "time_limit_minutes": policy.SECTION_MINUTES,
            }, synchronize_session=False)
            _commit_or_500(db)
        else:  # a concurrent request won the start; its deadline stands
            db.rollback()
        db.refresh(session)
        db.refresh(apt_round)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "APTITUDE",
        "current_state": session.current_state,
        "time_limit_minutes": apt_round.time_limit_minutes,
        **_round_timing(apt_round, session),
        "questions": apt_round.questions_payload
    }


def _score_aptitude(db: Session, session: RoleReadySession, apt_round: RoleReadyRoundAttempt, answers: Dict[str, Any],
                    time_spent_seconds: int, proctoring_violations: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Score and persist the aptitude round (no state transition): shared by a normal submit and by expiry."""
    result = engine.evaluate_aptitude(apt_round.server_keys_payload or {}, answers)
    _claim_round(db, apt_round)
    now_db = _db_now()
    apt_round.score = result["score"]
    apt_round.status = "EVALUATED"
    apt_round.time_spent_seconds = time_spent_seconds
    apt_round.submission_payload = answers
    apt_round.proctoring_violations = proctoring_violations or []
    apt_round.started_at = apt_round.started_at or now_db
    apt_round.submitted_at = now_db
    apt_round.evaluated_at = now_db
    apt_round.evaluation_payload = {
        "score": result["score"],
        "correct_count": result["correct_count"],
        "total_questions": result["total_questions"],
        "breakdown": result["breakdown"]
    }
    session.aptitude_score = result["score"]
    session.started_at = session.started_at or now_db
    return result


def submit_aptitude_round(
    db: Session,
    session: RoleReadySession,
    answers: Dict[str, str],
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None,
    _auto: bool = False
) -> Dict[str, Any]:
    """
    Server evaluates answers against secret keys, scores aptitude (unanswered = 0),
    transitions session to CODING_UNLOCKED regardless of score (zero-rejection), returns scorecard.
    """
    if not _auto:
        finalize_expired_round(db, session)
    apt_round = _get_round(db, session, "APTITUDE", "Aptitude")
    answers = answers or {}

    # Identical retry -> stored result (no re-scoring); different submission -> 400
    if apt_round.status == "EVALUATED":
        _reject_resubmission(session, apt_round, answers)
        stored = apt_round.evaluation_payload or {}
        return {
            "session_uuid": session.session_uuid,
            "status": "EVALUATED",
            "round_type": "APTITUDE",
            "score": policy.display_pct(apt_round.score),
            "correct_count": stored.get("correct_count"),
            "total_questions": stored.get("total_questions"),
            "current_state": session.current_state,
            "next_stage": session.current_state,
            "evaluation": apt_round.evaluation_payload,
            "next_round_unlocked": True,
            "idempotent_replay": True
        }

    _assert_attempt_open(session)
    if session.current_state not in (RoleReadySessionState.NOT_STARTED, RoleReadySessionState.APTITUDE_IN_PROGRESS):
        raise HTTPException(status_code=403, detail=f"Aptitude round is not open. Current state: '{session.current_state}'.")

    result = _score_aptitude(db, session, apt_round, answers, _server_time_spent(apt_round, time_spent_seconds), proctoring_violations)

    # State transition: any score (including 0%) unlocks the Coding round
    session.current_state = RoleReadySessionState.CODING_UNLOCKED
    _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "status": "success",
        "round_type": "APTITUDE",
        "score": policy.display_pct(result["score"]),
        "correct_count": result["correct_count"],
        "total_questions": result["total_questions"],
        "current_state": session.current_state,
        "next_stage": session.current_state,
        "next_round_unlocked": True,
        "message": "Aptitude assessment submitted successfully. Round 2 (Coding) is now unlocked.",
        "breakdown": result["breakdown"]
    }


# ─── ROUND 2: CODING ──────────────────────────────────────────────────────────

def start_coding_round(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    STRICT BACKEND GATING: Requires CODING_UNLOCKED or CODING_IN_PROGRESS.
    Direct API calls without completing Aptitude return HTTP 403!
    """
    finalize_expired_round(db, session)
    _assert_attempt_open(session)
    allowed = [RoleReadySessionState.CODING_UNLOCKED, RoleReadySessionState.CODING_IN_PROGRESS]
    if session.current_state not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Coding round is locked. You must complete and submit the Aptitude round first. Current state: '{session.current_state}'."
        )

    coding_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == "CODING"
    ).first()

    if not coding_round:
        raise HTTPException(status_code=404, detail="Coding round configuration missing.")

    _begin_round(db, session, coding_round, RoleReadySessionState.CODING_UNLOCKED, RoleReadySessionState.CODING_IN_PROGRESS)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "CODING",
        "current_state": session.current_state,
        "time_limit_minutes": coding_round.time_limit_minutes,
        **_round_timing(coding_round, session),
        "problems": coding_round.questions_payload
    }


def run_coding_test(
    db: Session,
    session: RoleReadySession,
    problem_id: str,
    code: str,
    language: str = "python"
) -> Dict[str, Any]:
    """
    Ephemeral run against the public sample test case(s) via the Judge0 sandbox.
    Supports Python and Java; no state is changed. Sandbox outage -> HTTP 503 (round stays open).
    Rejected once the section (or the overall) deadline has passed: running code is never an arrival-window action.
    """
    selected_lang = _require_supported_language(language)
    if len((code or "").encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(status_code=400, detail="Code exceeds the 64 KB submission limit.")

    finalize_expired_round(db, session)
    coding_round = _get_round(db, session, "CODING", "Coding")
    if session.current_state != RoleReadySessionState.CODING_IN_PROGRESS:
        if coding_round.status == "EVALUATED" or session.current_state in TERMINAL_STATES:
            raise HTTPException(status_code=400, detail="Round completed: the coding round is closed.")
        raise HTTPException(status_code=403, detail="Coding round is locked or not started.")
    deadline = _section_deadline(session, coding_round)
    if deadline is not None and clock.now() >= deadline:
        raise HTTPException(status_code=408, detail="Assessment round deadline reached. No further work permitted.")

    # Locate public test cases for problem
    problem = None
    for p in coding_round.questions_payload or []:
        if str(p.get("id")) == str(problem_id):
            problem = p
            break

    if not problem:
        raise HTTPException(status_code=404, detail="Problem ID not found.")

    limiter_key = session.student_profile_id or session.id
    _acquire_run_slot(limiter_key)
    try:
        result = engine.run_sample_tests(problem, code, selected_lang)
    except engine.SandboxUnavailable:
        raise _sandbox_unavailable()
    finally:
        _release_run_slot(limiter_key)

    return {**result, "problem_id": problem_id}


def _score_coding(db: Session, session: RoleReadySession, coding_round: RoleReadyRoundAttempt, solutions: Dict[str, Any],
                  time_spent_seconds: int, proctoring_violations: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Evaluate against the hidden tests and persist the coding round (no state transition). Sandbox outage -> HTTP 503, nothing committed."""
    try:
        result = engine.evaluate_coding(coding_round.questions_payload or [], coding_round.server_keys_payload or {}, solutions)
    except engine.SandboxUnavailable:
        raise _sandbox_unavailable()
    _claim_round(db, coding_round)
    now_db = _db_now()
    coding_round.score = result["score"]
    coding_round.status = "EVALUATED"
    coding_round.time_spent_seconds = time_spent_seconds
    coding_round.submission_payload = solutions
    coding_round.proctoring_violations = proctoring_violations or []
    coding_round.started_at = coding_round.started_at or now_db
    coding_round.submitted_at = now_db
    coding_round.evaluated_at = now_db
    coding_round.evaluation_payload = {
        "score": result["score"],
        "problems": result["problems"],
        "total_hidden_tests": result["total_hidden_tests"],
        "passed_hidden_tests": result["passed_hidden_tests"]
    }
    session.coding_score = result["score"]
    return result


# ─── CODING: grading runs in the background ──────────────────────────────────
#
# Running every hidden test through the sandbox can take a minute or more (the public sandbox queues each job
# for ~30s). Doing that inside the request froze the student on a loading screen and, past the server's 180s
# limit, got the whole worker killed. So a submission is saved and the interview unlocked immediately, the
# grading runs on its own thread, and the request waits only a few seconds for the grade before answering.

CODING_EVAL_WAIT_SECONDS = 15      # how long a submit waits for the grade before saying "evaluating"
CODING_EVAL_STALE_SECONDS = 240    # an EVALUATING round this old has lost its worker (restart) and is graded again
CODING_FINAL_WAIT_SECONDS = 150    # the final report waits at most this long for a still-running grade
_coding_eval_events: Dict[int, threading.Event] = {}
_coding_eval_guard = threading.Lock()


def _grade_coding_submission(coding_round: RoleReadyRoundAttempt, solutions: Dict[str, Dict[str, str]]) -> Dict[str, Any]:
    """
    Runs every hidden test for the submitted code and returns the evaluation payload.
    Raises HTTP 503 (via _sandbox_unavailable) when the sandbox itself is down.
    """
    try:
        return engine.evaluate_coding(coding_round.questions_payload or [], coding_round.server_keys_payload or {}, solutions)
    except engine.SandboxUnavailable:
        raise _sandbox_unavailable()

def _store_coding_grade(db: Session, session: RoleReadySession, coding_round: RoleReadyRoundAttempt, payload: Dict[str, Any]) -> bool:
    """
    Saves a finished grade. The status change is atomic and only one writer can make it, so a second (re-)grade
    can never overwrite the first result.
    """
    claimed = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.id == coding_round.id,
        RoleReadyRoundAttempt.status.in_(("EVALUATING", "EVAL_FAILED"))
    ).update({"status": "EVALUATED"}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        return False
    coding_round.score = payload["score"]
    coding_round.evaluated_at = datetime.utcnow()
    coding_round.evaluation_payload = payload
    session.coding_score = payload["score"]
    db.commit()
    return True


def _mark_coding_eval_failed(db: Session, coding_round: RoleReadyRoundAttempt) -> None:
    db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.id == coding_round.id,
        RoleReadyRoundAttempt.status == "EVALUATING"
    ).update({"status": "EVAL_FAILED"}, synchronize_session=False)
    db.commit()


def _run_coding_evaluation(round_id: int, session_id: int) -> None:
    """Thread body: grades the stored submission with its own database session."""
    import database
    db = database.SessionLocal()
    try:
        coding_round = db.query(RoleReadyRoundAttempt).filter(RoleReadyRoundAttempt.id == round_id).first()
        session = db.query(RoleReadySession).filter(RoleReadySession.id == session_id).first()
        if not coding_round or not session or coding_round.status != "EVALUATING":
            return
        try:
            payload = _grade_coding_submission(coding_round, coding_round.submission_payload or {})
        except HTTPException:  # the sandbox is down: keep the submission, grade it again later
            print(f"[RoleReady] Coding grading deferred for round {round_id}: sandbox unavailable")
            _mark_coding_eval_failed(db, coding_round)
            return
        _store_coding_grade(db, session, coding_round, payload)
    except Exception as exc:  # never let a background failure vanish silently
        print(f"[RoleReady] Coding grading crashed for round {round_id}: {exc}")
        try:
            db.rollback()
            coding_round = db.query(RoleReadyRoundAttempt).filter(RoleReadyRoundAttempt.id == round_id).first()
            if coding_round:
                _mark_coding_eval_failed(db, coding_round)
        except Exception:  # noqa: BLE001
            db.rollback()
    finally:
        db.close()


def _start_coding_evaluation(round_id: int, session_id: int) -> threading.Event:
    """Starts grading on a background thread (once per round in this process); returns an event set when it ends."""
    with _coding_eval_guard:
        running = _coding_eval_events.get(round_id)
        if running is not None and not running.is_set():
            return running
        done = threading.Event()
        _coding_eval_events[round_id] = done

    def target():
        try:
            _run_coding_evaluation(round_id, session_id)
        finally:
            done.set()

    threading.Thread(target=target, name=f"coding-eval-{round_id}", daemon=True).start()
    return done


def _coding_eval_is_stale(coding_round: RoleReadyRoundAttempt) -> bool:
    """EVALUATING for too long with no live grading thread here: the worker that owned it was restarted."""
    if coding_round.status != "EVALUATING":
        return False
    running = _coding_eval_events.get(coding_round.id)
    if running is not None and not running.is_set():
        return False
    submitted = coding_round.submitted_at
    if not submitted:
        return True
    return (datetime.utcnow() - submitted.replace(tzinfo=None)).total_seconds() > CODING_EVAL_STALE_SECONDS


def _wait_for_coding_grade(db: Session, session: RoleReadySession, coding_round: RoleReadyRoundAttempt,
                           done: Optional[threading.Event], seconds: float) -> None:
    """Waits (bounded) until the round is graded or has failed, then reloads the rows."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if done is not None:
            done.wait(timeout=min(1.0, max(0.0, deadline - time.monotonic())))
        else:
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))
        db.commit()  # ends the read snapshot, otherwise MySQL keeps showing the state from before the grade finished
        db.refresh(coding_round)
        if coding_round.status in ("EVALUATED", "EVAL_FAILED"):
            break
    db.commit()
    db.refresh(coding_round)
    db.refresh(session)


def _coding_submission_response(session: RoleReadySession, coding_round: RoleReadyRoundAttempt, replay: bool = False) -> Dict[str, Any]:
    """The same payload as before once graded; a clear 'evaluating' answer while the grade is still running."""
    base = {
        "session_uuid": session.session_uuid,
        "round_type": "CODING",
        "current_state": session.current_state,
        "next_stage": session.current_state,
        "next_round_unlocked": True,
    }
    if replay:
        base["idempotent_replay"] = True
    if coding_round.status == "EVALUATED":
        stored = coding_round.evaluation_payload or {}
        problems = stored.get("problems", [])
        return {
            **base,
            "status": "success",
            "score": coding_round.score,
            "problems_evaluated": len(problems),
            "results": [
                {"problem_id": e["problem_id"], "passed_tests": e["passed_tests"], "total_tests": e["total_tests"]}
                for e in problems
            ],
            "message": "Coding assessment submitted. Round 3 (Interview) is now unlocked.",
            "problem_evaluations": problems,
        }
    return {
        **base,
        "status": "evaluating",
        "evaluation_pending": True,
        "score": None,
        "problems_evaluated": 0,
        "results": [],
        "problem_evaluations": [],
        "message": ("Coding assessment submitted. Round 3 (Interview) is now unlocked. Your code is being evaluated "
                    "in the background and the result will be in your final report."),
    }


def ensure_coding_evaluated(db: Session, session: RoleReadySession, wait_seconds: float = CODING_FINAL_WAIT_SECONDS) -> None:
    """
    Called before the final report is built: makes sure the coding grade exists, waiting (bounded) for a running
    grade, or grading again when the first attempt failed or its worker disappeared. If the sandbox stays down the
    round is recorded as unavailable instead of silently counting as a real zero.
    """
    coding_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id, RoleReadyRoundAttempt.round_type == "CODING").first()
    if not coding_round or coding_round.status not in ("EVALUATING", "EVAL_FAILED"):
        return

    done = None
    if coding_round.status == "EVAL_FAILED" or _coding_eval_is_stale(coding_round):
        db.query(RoleReadyRoundAttempt).filter(
            RoleReadyRoundAttempt.id == coding_round.id,
            RoleReadyRoundAttempt.status.in_(("EVAL_FAILED", "EVALUATING"))
        ).update({"status": "EVALUATING"}, synchronize_session=False)
        db.commit()
        db.refresh(coding_round)
        done = _start_coding_evaluation(coding_round.id, session.id)
    else:
        done = _coding_eval_events.get(coding_round.id)

    _wait_for_coding_grade(db, session, coding_round, done, wait_seconds)

    if coding_round.status != "EVALUATED":
        coding_round.evaluation_payload = {
            "score": None,
            "problems": [],
            "evaluation_status": "UNAVAILABLE",
            "message": "The code sandbox was unavailable, so the hidden tests could not be run for this round.",
        }
        if session.coding_score is None:
            session.coding_score = 0.0
        db.commit()


def submit_coding_round(
    db: Session,
    session: RoleReadySession,
    solutions: Dict[str, Dict[str, str]], # { "1": {"code": "...", "language": "python"|"java"} }
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Saves the submission and unlocks the Interview round straight away (any score unlocks it, zero-rejection).
    The hidden tests are graded on a background thread; this call waits at most CODING_EVAL_WAIT_SECONDS for
    the grade and otherwise answers status "evaluating", with the result attached to the final report later.
    """
    solutions = solutions or {}
    for sol in solutions.values():  # validate before any state change
        _require_supported_language((sol or {}).get("language"))
        if len(((sol or {}).get("code") or "").encode("utf-8")) > MAX_CODE_BYTES:
            raise HTTPException(status_code=400, detail="Code exceeds the 64 KB submission limit.")

    coding_round = _get_round(db, session, "CODING", "Coding")

    if coding_round.status == "EVALUATED":
        _reject_resubmission(session, coding_round, solutions)
        return _coding_submission_response(session, coding_round, replay=True)

    if coding_round.status in ("EVALUATING", "EVAL_FAILED"):
        # The same code sent again (a double click, a retry): never regrade different code, resume this grade
        _reject_resubmission(session, coding_round, solutions)
        done = None
        if coding_round.status == "EVAL_FAILED" or _coding_eval_is_stale(coding_round):
            db.query(RoleReadyRoundAttempt).filter(
                RoleReadyRoundAttempt.id == coding_round.id,
                RoleReadyRoundAttempt.status.in_(("EVAL_FAILED", "EVALUATING"))
            ).update({"status": "EVALUATING"}, synchronize_session=False)
            _commit_or_500(db)
            db.refresh(coding_round)
            done = _start_coding_evaluation(coding_round.id, session.id)
        else:
            done = _coding_eval_events.get(coding_round.id)
        _wait_for_coding_grade(db, session, coding_round, done, CODING_EVAL_WAIT_SECONDS)
        return _coding_submission_response(session, coding_round, replay=True)

    if session.current_state not in (RoleReadySessionState.CODING_UNLOCKED, RoleReadySessionState.CODING_IN_PROGRESS):
        raise HTTPException(status_code=403, detail="Coding round is locked. Complete the previous round first.")

    # Atomic claim: only one concurrent submission can move the round into grading
    claimed = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.id == coding_round.id,
        RoleReadyRoundAttempt.status.notin_(("EVALUATED", "EVALUATING", "EVAL_FAILED"))
    ).update({"status": "EVALUATING"}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Another submission for this round was already committed.")

    now = datetime.utcnow()
    coding_round.time_spent_seconds = time_spent_seconds
    coding_round.submission_payload = solutions
    coding_round.proctoring_violations = proctoring_violations or []
    coding_round.started_at = coding_round.started_at or now
    coding_round.submitted_at = now
    # Any outcome unlocks the Interview round, so the student never waits on the grader
    session.current_state = RoleReadySessionState.INTERVIEW_UNLOCKED
    _commit_or_500(db)
    db.refresh(coding_round)

    done = _start_coding_evaluation(coding_round.id, session.id)
    _wait_for_coding_grade(db, session, coding_round, done, CODING_EVAL_WAIT_SECONDS)
    return _coding_submission_response(session, coding_round)


# ─── ROUND 3: INTERVIEW ───────────────────────────────────────────────────────

def start_interview_round(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    STRICT BACKEND GATING: Requires INTERVIEW_UNLOCKED or INTERVIEW_IN_PROGRESS.
    Direct API calls without completing Coding return HTTP 403!
    """
    finalize_expired_round(db, session)
    _assert_attempt_open(session)
    allowed = [RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS]
    if session.current_state not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Interview round is locked. You must complete and submit the Coding round first. Current state: '{session.current_state}'."
        )

    int_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == "INTERVIEW"
    ).first()

    if not int_round:
        int_round = RoleReadyRoundAttempt(
            session_id=session.id,
            round_type="INTERVIEW",
            status="NOT_STARTED",
            time_limit_minutes=policy.SECTION_MINUTES
        )
        db.add(int_round)
        _commit_or_500(db)

    _begin_round(db, session, int_round, RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "INTERVIEW",
        "current_state": session.current_state,
        "time_limit_minutes": int_round.time_limit_minutes,
        **_round_timing(int_round, session),
        "questions": int_round.questions_payload
    }


def _build_resume_brief(snapshot: Optional[Dict[str, Any]], raw_text: str, skills_csv: str) -> str:
    """Compact, factual resume brief for the voice interviewer: real projects, roles and education."""
    snap = snapshot if isinstance(snapshot, dict) else {}
    parts: List[str] = []
    if skills_csv:
        parts.append(f"Skills: {skills_csv}.")
    for p in (snap.get("projects") or [])[:4]:
        if isinstance(p, dict) and (p.get("title") or p.get("description")):
            tech = ", ".join(str(t) for t in (p.get("technologies") or [])[:6])
            desc = str(p.get("description") or "")[:160]
            parts.append(f"Project '{p.get('title', 'Untitled')}'{f' ({tech})' if tech else ''}: {desc}".strip())
    for e in (snap.get("experience") or [])[:3]:
        if isinstance(e, dict) and (e.get("role") or e.get("company")):
            parts.append(f"Experience: {e.get('role', '')} at {e.get('company', '')} {e.get('duration', '') or ''}: {str(e.get('summary') or '')[:140]}".strip())
    for ed in (snap.get("education") or [])[:2]:
        if isinstance(ed, dict) and (ed.get("degree") or ed.get("institution")):
            parts.append(f"Education: {ed.get('degree', '')}, {ed.get('institution', '')}".strip(", "))
    brief = " ".join(parts).strip()
    if len(brief) < 120 and raw_text:  # structured data missing: fall back to the raw resume text
        brief = f"{brief} Resume excerpt: {raw_text[:700]}".strip()
    return brief[:1800] or "Not provided"


def init_vapi_interview_session(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    STRICT BACKEND GATING: Requires INTERVIEW_UNLOCKED or INTERVIEW_IN_PROGRESS.
    Synthesizes custom questions grounded in BOTH the candidate's Resume and Job Description,
    provisions a dynamic Vapi assistant, and returns assistantId and structured questions.
    """
    finalize_expired_round(db, session)
    _assert_attempt_open(session)
    allowed = [RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS]
    if session.current_state not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Interview round is locked. You must complete and submit the Coding round first. Current state: '{session.current_state}'."
        )

    int_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == "INTERVIEW"
    ).first()

    if not int_round:
        int_round = RoleReadyRoundAttempt(
            session_id=session.id,
            round_type="INTERVIEW",
            status="NOT_STARTED",
            time_limit_minutes=policy.SECTION_MINUTES
        )
        db.add(int_round)
        _commit_or_500(db)

    _begin_round(db, session, int_round, RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS)

    # 1. Candidate Name Resolution (Strict Real Name - Prioritize Uploaded Resume)
    candidate_name = None
    profile = None
    if session.student_profile_id:
        profile = db.query(StudentProfile).filter(StudentProfile.id == session.student_profile_id).first()

    # PRIORITY 1: Extract candidate's real name directly from the session resume raw text
    from services.student_resume_analyzer import extract_candidate_name_from_resume
    resume_raw = (session.resume_raw_text or "").strip()
    if resume_raw:
        cand_name_from_resume = extract_candidate_name_from_resume(resume_raw)
        if cand_name_from_resume:
            candidate_name = cand_name_from_resume

    # PRIORITY 2: Check resume snapshot dictionary if present
    resume_snapshot = session.resume_snapshot or {}
    if not candidate_name and isinstance(resume_snapshot, dict):
        for key in ["candidate_name", "name", "full_name", "student_name"]:
            val = resume_snapshot.get(key)
            if val and isinstance(val, str) and "@" not in val and len(val.strip()) > 1:
                clean_val = re.sub(r"[^a-zA-Z\s]", " ", val).strip()
                if clean_val and clean_val.lower() not in ("candidate", "student", "unknown candidate"):
                    candidate_name = clean_val.title()
                    break

    # PRIORITY 3: If session resume text was empty, check student's stored resume in database (StudentResume)
    if not candidate_name and session.student_profile_id:
        latest_res = db.query(StudentResume).filter(
            StudentResume.student_profile_id == session.student_profile_id
        ).order_by(desc(StudentResume.created_at)).first()
        if latest_res:
            res_text = getattr(latest_res, "raw_text", None) or getattr(latest_res, "full_text", None) or ""
            if res_text:
                cand_name_from_sr = extract_candidate_name_from_resume(res_text)
                if cand_name_from_sr:
                    candidate_name = cand_name_from_sr

    # PRIORITY 4: Check profile full_name ONLY if it is an actual human name (no digits, no '@', not generic)
    if not candidate_name and profile and profile.full_name:
        fn = profile.full_name.strip()
        if "@" not in fn and not any(ch.isdigit() for ch in fn) and fn.lower() not in ("student", "candidate", "unknown"):
            candidate_name = fn

    if not candidate_name and session.candidate_id:
        cand = db.query(Candidate).filter(Candidate.id == session.candidate_id).first()
        if cand and cand.name:
            cn = cand.name.strip()
            if "@" not in cn and not any(ch.isdigit() for ch in cn) and cn.lower() not in ("candidate", "unknown candidate"):
                candidate_name = cn

    # PRIORITY 5: If still not found, convert email username to clean human name (strip numbers, e.g. gopalmuri1919 -> Gopalmuri)
    if not candidate_name:
        raw_email = (profile.email if profile else None) or (profile.full_name if profile and "@" in profile.full_name else None) or ""
        if "@" in raw_email:
            local = raw_email.split("@")[0]
            cleaned_local = re.sub(r"[^a-zA-Z\s]", " ", local).strip()
            words = [w for w in cleaned_local.split() if len(w) > 1]
            if words:
                candidate_name = " ".join(words).title()
            elif cleaned_local:
                candidate_name = cleaned_local.title()

    if not candidate_name:
        candidate_name = "Candidate"

    # Always persist the correct name back into profile.full_name if it was storing raw email or email handle with digits
    if profile and candidate_name != "Candidate":
        if "@" in str(profile.full_name) or any(ch.isdigit() for ch in str(profile.full_name)) or str(profile.full_name).strip().lower() in ("student", "candidate", ""):
            profile.full_name = candidate_name
            _commit_or_500(db)

    role = session.target_role or (session.extracted_jd_data or {}).get("role_title") or "Software Engineer"
    company = session.target_company or "Target Company"

    # 2. Extract Resume & JD Context
    resume_snapshot = session.resume_snapshot or {}
    resume_skills = ", ".join(_skill_names(resume_snapshot))
    resume_raw = (session.resume_raw_text or "").strip()
    resume_summary = _build_resume_brief(resume_snapshot, resume_raw, resume_skills)

    jd_data = session.extracted_jd_data or {}
    jd_req_skills = ", ".join(jd_data.get("required_skills", []) or [])
    jd_text = (session.custom_jd_text or "").strip()
    jd_summary = f"Target Role: {role}. Required Skills: {jd_req_skills}. JD Context: {jd_text[:600]}" if jd_text else f"Target Role: {role}. Required Skills: {jd_req_skills}"

    # 3. Retrieve or generate tailored 5 questions
    questions = int_round.questions_payload or []
    is_generic = False
    if questions and len(questions) > 0:
        first_q_text = (questions[0].get("question", "") if isinstance(questions[0], dict) else str(questions[0])).lower()
        if "clean separation of concerns" in first_q_text or "tell me about yourself and your experience" in first_q_text:
            is_generic = True

    if not questions or len(questions) < 3 or is_generic:
        raw_questions = generate_interview_questions(
            jd_data,
            resume_snapshot,
            count=5,
            resume_text=resume_raw,
            jd_text=jd_text,
            company=_session_company(db, session)
        )
        standardized = []
        for i, q in enumerate(raw_questions):
            q_id = q.get("id", i + 1)
            cat = q.get("type") or q.get("category") or "Technical Defense"
            text = q.get("question") or str(q)
            criteria = q.get("evaluation_criteria", "Depth, STAR structure, trade-offs.")
            standardized.append({
                "id": q_id,
                "category": cat,
                "question": text,
                "evaluation_criteria": criteria
            })
        questions = standardized
        int_round.questions_payload = questions
        _commit_or_500(db)
    else:
        standardized = []
        for i, q in enumerate(questions):
            q_id = q.get("id", i + 1)
            cat = q.get("category") or q.get("type") or "Technical Defense"
            text = q.get("question") or str(q)
            criteria = q.get("evaluation_criteria", "Depth, STAR structure, trade-offs.")
            standardized.append({
                "id": q_id,
                "category": cat,
                "question": text,
                "evaluation_criteria": criteria
            })
        questions = standardized

    # 4. Provision Ephemeral Vapi Assistant
    assistant_id = None
    assistant_config = None
    try:
        from services import vapi_service
        assistant_id, assistant_config = vapi_service.create_or_build_assistant(
            candidate_name=candidate_name,
            role=f"{role} at {company}" if company else role,
            resume_summary=resume_summary,
            custom_instructions=f"Conduct a rigorous, professional interview evaluating the candidate against: {jd_summary}. Focus on asking the 5 questions one by one.",
            questions=questions,
            jd_summary=jd_summary,
            # The voice call itself may not outlive the section: it ends at the server deadline.
            max_duration_seconds=max(1, _round_timing(int_round, session)["remaining_seconds"])
        )
    except Exception as e:
        print(f"[RoleReady] Ephemeral Vapi Assistant initialization failed: {e}")

    if assistant_id:
        try:
            vapi_service.swap_round_assistant(db, int_round, assistant_id)     # one live assistant per session
        except Exception as e:
            db.rollback()
            print(f"[RoleReady] Vapi assistant bookkeeping skipped: {type(e).__name__}")

    return {
        "session_uuid": session.session_uuid,
        "assistantId": assistant_id,
        "assistantConfig": assistant_config,
        "questions": questions,
        "role": role,
        "company": company,
        "candidateName": candidate_name,
        "duration": int_round.time_limit_minutes or policy.SECTION_MINUTES,
        **_round_timing(int_round, session)
    }


def _interview_context(session: RoleReadySession) -> Dict[str, str]:
    role = session.target_role or "Software Engineer"
    jd_data = session.extracted_jd_data or {}
    jd_skills = ", ".join(jd_data.get("required_skills", []) or [])
    jd_text = (session.custom_jd_text or "").strip()
    jd_summary = f"Role: {role}. Skills: {jd_skills}. Context: {jd_text[:400]}" if jd_text else f"Role: {role}. Skills: {jd_skills}"
    resume_raw = (session.resume_raw_text or "").strip()
    resume_skills = ", ".join(_skill_names(session.resume_snapshot))
    resume_summary = f"Skills: {resume_skills}. Experience: {resume_raw[:500]}" if resume_raw else f"Skills: {resume_skills}"
    return {"role": role, "jd_summary": jd_summary, "resume_summary": resume_summary}


def _score_interview(db: Session, session: RoleReadySession, int_round: RoleReadyRoundAttempt,
                     answers_or_transcript: Dict[str, Any], time_spent_seconds: int,
                     proctoring_violations: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Evaluate and persist the interview round (no state transition). The AI call happens before anything is written."""
    ctx = _interview_context(session)
    # Looked up here (not bound at import) so tests / alternative evaluators replacing the module globals are honoured.
    result = engine.evaluate_interview(
        int_round.questions_payload or [], answers_or_transcript.get("answers") or [],
        role=ctx["role"], jd_summary=ctx["jd_summary"], resume_summary=ctx["resume_summary"],
        transcript=answers_or_transcript.get("transcript") or [],
        evaluate_fn=lambda **kw: evaluate_five_technical_questions(**kw), call_gemini_fn=lambda *a, **kw: call_gemini(*a, **kw))
    _claim_round(db, int_round)
    now_db = _db_now()
    int_round.score = result["score"]
    int_round.status = "EVALUATED"
    int_round.time_spent_seconds = time_spent_seconds
    int_round.submission_payload = answers_or_transcript
    int_round.proctoring_violations = proctoring_violations or []
    int_round.started_at = int_round.started_at or now_db
    int_round.submitted_at = now_db
    int_round.evaluated_at = now_db
    int_round.evaluation_payload = {
        "score": result["score"],
        "qualitative_feedback": result["qualitative_feedback"],
        "evaluation_source": result["evaluation_source"],
        "technical_depth_score": result["technical_depth_score"],
        "communication_score": result["communication_score"],
        "key_strengths": result["key_strengths"],
        "key_areas_for_improvement": result["key_areas_for_improvement"],
        "question_evaluations": result["question_evaluations"],
    }
    session.interview_score = result["score"]
    return result


def submit_interview_round(
    db: Session,
    session: RoleReadySession,
    answers_or_transcript: Dict[str, Any], # { "answers": [{"question_id": 1, "response": "..."}] }
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None,
    _auto: bool = False
) -> Dict[str, Any]:
    """
    Evaluates interview responses with AI scoring (no answers = 0), synthesizes the 17-point
    final job-readiness dossier, and transitions session to COMPLETED regardless of score.
    The overall score is the canonical equal-weight formula (services.assessment_policy.overall_score).
    """
    if not _auto:
        finalize_expired_round(db, session)
    int_round = _get_round(db, session, "INTERVIEW", "Interview")

    if int_round.status == "EVALUATED":
        _reject_resubmission(session, int_round, answers_or_transcript)
        return {
            "session_uuid": session.session_uuid,
            "status": "COMPLETED",
            "round_type": "INTERVIEW",
            "score": policy.display_pct(int_round.score),
            "current_state": session.current_state,
            "session_status": session.current_state,
            "report_available": bool(session.final_report_data),
            "overall_readiness_score": reported_overall(session),
            "final_report": session.final_report_data,
            "idempotent_replay": True
        }

    _assert_attempt_open(session)
    if session.current_state not in (RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS):
        raise HTTPException(status_code=403, detail="Interview round is locked. Complete the previous round first.")

    spent = _server_time_spent(int_round, time_spent_seconds)
    result = _score_interview(db, session, int_round, answers_or_transcript, spent, proctoring_violations)
    qualitative = {**result}
    qualitative_feedback = result["qualitative_feedback"]
    interview_score = result["score"]

    # The coding grade runs in the background; make sure it is in before the final score is computed
    ensure_coding_evaluated(db, session)
    if session.coding_score is None:
        session.coding_score = 0.0

    # Final consolidated job-readiness index: equal weight, only now that all three sections are complete
    overall_readiness = policy.overall_score(session.aptitude_score, session.coding_score, session.interview_score)
    session.overall_readiness_score = overall_readiness if overall_readiness is not None else 0.0

    # Dossier is computed from stored scores, so it succeeds even when AI is unavailable.
    final_report = {
        "session_uuid": session.session_uuid,
        "skills_verified": (session.extracted_jd_data or {}).get("required_skills", [])[:4],
        "evaluated_at": datetime.utcnow().isoformat(),
        "completion_status": "COMPLETED",
        "scoring_model": policy.SCORING_MODEL,
        **build_performance_dossier(db, session, {**qualitative, "qualitative_feedback": qualitative_feedback},
                                    overall=overall_readiness),
    }
    final_report["strengths"] = final_report["demonstrated_strengths"]

    session.final_report_data = final_report
    session.current_state = RoleReadySessionState.COMPLETED
    session.completed_at = datetime.utcnow()
    session.finalized_at = _db_now()
    _commit_or_500(db)
    _refresh_student_readiness(db, session)
    vapi_service.release_round_assistant(db, int_round)        # the interview is over: delete its voice assistant

    return {
        "session_uuid": session.session_uuid,
        "status": "success",
        "round_type": "INTERVIEW",
        "score": policy.display_pct(interview_score),
        "current_state": session.current_state,
        "session_status": session.current_state,
        "report_available": True,
        "overall_readiness_score": overall_readiness,
        "final_report": final_report
    }


# ─── BACKGROUND INTERVIEW EVALUATION ──────────────────────────────────────────
# The interview is scored by one large AI call (all questions + the full transcript) that can take
# many seconds. The submit endpoint records the answers and returns immediately; the evaluation runs
# here, and the report page polls get_student_report() until it is ready.

# Set INTERVIEW_EVAL_BACKGROUND=0 to score the interview inside the submit request instead.
BACKGROUND_INTERVIEW_EVALUATION = os.getenv("INTERVIEW_EVAL_BACKGROUND", "1").strip().lower() not in ("0", "false", "no")
EVALUATION_STALE_SECONDS = 240  # a worker restart can kill the thread; after this we treat it as failed


def _run_interview_evaluation(session_id: int, payload: Dict[str, Any], time_spent_seconds: int,
                              violations: Optional[List[Dict[str, Any]]]) -> None:
    from database import SessionLocal
    db = SessionLocal()
    try:
        session = db.query(RoleReadySession).filter(RoleReadySession.id == session_id).first()
        if session is None:
            return
        submit_interview_round(db, session, payload, time_spent_seconds, violations)
    except Exception as e:  # leave a retryable marker instead of an endless "processing" state
        db.rollback()
        print(f"[RoleReady] Background interview evaluation failed for session {session_id}: {e}")
        try:
            rnd = db.query(RoleReadyRoundAttempt).filter(
                RoleReadyRoundAttempt.session_id == session_id,
                RoleReadyRoundAttempt.round_type == "INTERVIEW"
            ).first()
            if rnd is not None and rnd.status != "EVALUATED":
                rnd.status = "EVAL_FAILED"
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def _evaluation_is_stale(int_round: RoleReadyRoundAttempt) -> bool:
    started = int_round.submitted_at
    return bool(started and (datetime.utcnow() - started.replace(tzinfo=None)).total_seconds() > EVALUATION_STALE_SECONDS)


def _launch_interview_evaluation(session_id: int, payload: Dict[str, Any], time_spent_seconds: int,
                                 violations: Optional[List[Dict[str, Any]]]) -> None:
    threading.Thread(
        target=_run_interview_evaluation,
        args=(session_id, payload, time_spent_seconds, violations),
        daemon=True,
    ).start()


def start_interview_evaluation(
    db: Session,
    session: RoleReadySession,
    answers_or_transcript: Dict[str, Any],
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Records the interview submission and evaluates it in the background (returns immediately)."""
    if not BACKGROUND_INTERVIEW_EVALUATION:
        return submit_interview_round(db, session, answers_or_transcript, time_spent_seconds, proctoring_violations)
    finalize_expired_round(db, session)
    int_round = _get_round(db, session, "INTERVIEW", "Interview")
    processing = {"session_uuid": session.session_uuid, "status": "PROCESSING", "report_status": "PROCESSING",
                  "round_type": "INTERVIEW", "current_state": session.current_state}

    if int_round.status == "EVALUATED":  # already done: identical retry replays the stored result
        return submit_interview_round(db, session, answers_or_transcript, time_spent_seconds, proctoring_violations)

    if int_round.status == "EVALUATING" and not _evaluation_is_stale(int_round):
        return processing

    _assert_attempt_open(session)
    if session.current_state not in (RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS):
        raise HTTPException(status_code=403, detail="Interview round is locked. Complete the previous round first.")

    int_round.status = "EVALUATING"
    int_round.submitted_at = datetime.utcnow()
    int_round.submission_payload = answers_or_transcript
    int_round.time_spent_seconds = time_spent_seconds
    int_round.proctoring_violations = proctoring_violations or []
    _commit_or_500(db)

    _launch_interview_evaluation(session.id, answers_or_transcript, time_spent_seconds, proctoring_violations)
    return processing


def retry_interview_evaluation(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """Re-runs a failed or stalled interview evaluation from the stored submission."""
    int_round = _get_round(db, session, "INTERVIEW", "Interview")
    stored = int_round.submission_payload
    if int_round.status == "EVALUATED":
        return {"session_uuid": session.session_uuid, "report_status": "READY"}
    if not stored or int_round.status not in ("EVAL_FAILED", "EVALUATING"):
        raise HTTPException(status_code=400, detail="There is no interview submission to re-evaluate.")
    if int_round.status == "EVALUATING" and not _evaluation_is_stale(int_round):
        return {"session_uuid": session.session_uuid, "report_status": "PROCESSING"}
    int_round.status = "EVALUATING"
    int_round.submitted_at = datetime.utcnow()
    _commit_or_500(db)
    _launch_interview_evaluation(session.id, stored, int_round.time_spent_seconds or 0, int_round.proctoring_violations or [])
    return {"session_uuid": session.session_uuid, "report_status": "PROCESSING"}


def _report_status(session: RoleReadySession, int_round: Optional[RoleReadyRoundAttempt]) -> str:
    if session.current_state == RoleReadySessionState.COMPLETED:
        return "READY"
    if session.current_state == RoleReadySessionState.TIMED_OUT:
        return "INCOMPLETE"
    if int_round is not None:
        if int_round.status == "EVAL_FAILED" or (int_round.status == "EVALUATING" and _evaluation_is_stale(int_round)):
            return "FAILED"
        if int_round.status == "EVALUATING":
            return "PROCESSING"
    return "INCOMPLETE"


def terminate_malpractice_session(
    db: Session,
    session: RoleReadySession,
    reason: str = "3/3 Malpractice Violations Recorded",
    violations: Optional[List[Dict[str, Any]]] = None,
    round_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fast-path termination: Immediately locks and disqualifies an assessment due to malpractice.
    Bypasses all expensive AI (Gemini) and sandbox compiler (Piston) evaluations to return in < 50ms.
    """
    # A closed attempt (timed out / abandoned) is never reopened or rewritten by a late termination request.
    _assert_attempt_open(session)
    clean_reason = reason or "3/3 Malpractice Violations Recorded"
    all_violations = violations or []

    # Map currentStage string to round_type enum if present
    rt_map = {
        "aptitude": "APTITUDE",
        "coding": "CODING",
        "interview": "INTERVIEW"
    }
    target_round = rt_map.get((round_type or "").lower())

    if target_round:
        round_attempt = db.query(RoleReadyRoundAttempt).filter(
            RoleReadyRoundAttempt.session_id == session.id,
            RoleReadyRoundAttempt.round_type == target_round
        ).first()
        if round_attempt:
            _claim_round(db, round_attempt)
            round_attempt.score = 0.0
            round_attempt.status = "TERMINATED"
            round_attempt.proctoring_violations = all_violations
            round_attempt.submitted_at = datetime.utcnow()
            round_attempt.evaluated_at = datetime.utcnow()
            round_attempt.evaluation_payload = {
                "score": 0.0,
                "status": "TERMINATED",
                "disqualified": True,
                "reason": clean_reason
            }

    # Zero all scores and mark session completed/terminated
    session.overall_readiness_score = 0.0
    session.current_state = RoleReadySessionState.COMPLETED
    session.completed_at = datetime.utcnow()

    # Build concise disqualified dossier without external AI calls
    final_report = {
        "session_uuid": session.session_uuid,
        "completion_status": "TERMINATED",
        "scoring_model": policy.SCORING_MODEL,
        "is_disqualified": True,
        "termination_reason": clean_reason,
        "disqualification_note": f"Assessment terminated due to proctoring malpractice: {clean_reason}. All scores forfeited.",
        "evaluated_at": datetime.utcnow().isoformat(),
        "readiness_tier": "Disqualified",
        "overall_readiness_score": 0.0,
        "aptitude_score": session.aptitude_score or 0.0,
        "coding_score": session.coding_score or 0.0,
        "interview_score": session.interview_score or 0.0,
        "demonstrated_strengths": ["Assessment disqualified due to malpractice."],
        "areas_for_improvement": [f"Adhere strictly to assessment proctoring rules: {clean_reason}"],
        "proctoring_violations": all_violations
    }

    session.final_report_data = final_report
    _commit_or_500(db)
    _refresh_student_readiness(db, session)

    return {
        "session_uuid": session.session_uuid,
        "status": "TERMINATED",
        "is_disqualified": True,
        "reason": clean_reason,
        "current_state": session.current_state,
        "overall_readiness_score": 0.0,
        "final_report": final_report
    }


def get_student_report(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    Returns the student report dossier. Hides private server keys and other candidate data.
    Sessions completed before the 17-point dossier existed are completed from stored scores.
    """
    final_report = dict(session.final_report_data or {})
    if session.current_state == RoleReadySessionState.COMPLETED:
        final_report = {**build_performance_dossier(db, session), **final_report}
    scores = section_scores(session)   # unattempted sections of a timed-out attempt are null, never a fabricated zero
    int_round = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == "INTERVIEW"
    ).first()
    return {
        "report_status": _report_status(session, int_round),
        "session_uuid": session.session_uuid,
        "target_role": session.target_role,
        "target_company": session.target_company,
        "jd_title": session.jd_title,
        "current_state": session.current_state,
        "overall_readiness_score": reported_overall(session),
        "scoring_model": policy.scoring_model_of(session.final_report_data) if session.current_state == RoleReadySessionState.COMPLETED else None,
        **scores,
        "resume_to_jd_match_score": compute_resume_jd_match(session),
        "final_report": final_report,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "completed_at": session.completed_at.isoformat() if session.completed_at else None
    }


# ==============================================================================
# WORKFLOW B: ADMINISTRATOR-MANAGED RECRUITMENT
# ==============================================================================

def create_recruitment_batch(
    db: Session, 
    org_id: int, 
    batch_name: str, 
    jd_id: Optional[int] = None, 
    description: Optional[str] = None,
    created_by_user_id: Optional[int] = None
) -> RecruitmentBatch:
    """Creates a recruitment campaign/batch scoped to an organization."""
    batch = RecruitmentBatch(
        organization_id=org_id,
        job_description_id=jd_id,
        batch_name=batch_name,
        description=description,
        created_by=created_by_user_id
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def send_batch_invitations(
    db: Session, 
    org_id: int, 
    batch_id: int, 
    candidate_ids: List[int]
) -> List[CandidateInvitation]:
    """Generates cryptographic invitation tokens for candidates in batch."""
    batch = db.query(RecruitmentBatch).filter(
        RecruitmentBatch.id == batch_id,
        RecruitmentBatch.organization_id == org_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Recruitment batch not found.")

    created_invitations = []
    for cid in candidate_ids:
        # Check candidate ownership
        cand = db.query(Candidate).filter(Candidate.id == cid, Candidate.organization_id == org_id).first()
        if not cand:
            continue
        
        token = secrets.token_urlsafe(32)
        invitation = CandidateInvitation(
            organization_id=org_id,
            job_description_id=batch.job_description_id,
            candidate_id=cid,
            batch_id=batch.id,
            invitation_token=token,
            status="PENDING",
            expires_at=datetime.utcnow() + timedelta(days=7)
        )
        db.add(invitation)
        created_invitations.append(invitation)

    batch.total_candidates = len(created_invitations)
    db.commit()
    return created_invitations


def verify_and_start_invitation(db: Session, token: str) -> Dict[str, Any]:
    """
    Verifies invitation token and creates/retrieves candidate assessment session.
    """
    inv = db.query(CandidateInvitation).filter(CandidateInvitation.invitation_token == token).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invalid invitation token.")

    if inv.expires_at < datetime.utcnow():
        inv.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This assessment invitation has expired.")

    # Check if session already exists for this invitation
    session = db.query(RoleReadySession).filter(RoleReadySession.invitation_id == inv.id).first()
    if not session:
        cand = inv.candidate
        jd = inv.job_description
        jd_text = jd.description if jd else ""
        jd_data = extract_structured_jd(jd_text, default_role=cand.role or "Software Engineer")
        
        session_uuid = str(uuid.uuid4())
        session = RoleReadySession(
            session_uuid=session_uuid,
            workflow_type="RECRUITER_INVITATION",
            organization_id=inv.organization_id,
            candidate_id=cand.id,
            invitation_id=inv.id,
            job_description_id=inv.job_description_id,
            target_role=cand.role or "Software Engineer",
            jd_title=jd.title if jd else cand.role,
            custom_jd_text=jd_text,
            extracted_jd_data=jd_data,
            resume_snapshot={"name": cand.name, "email": cand.email, "role": cand.role},
            current_state=RoleReadySessionState.NOT_STARTED
        )
        db.add(session)
        db.flush()

        invite_company = _organization_name(db, inv.organization_id)

        # Pre-generate rounds concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_apt = executor.submit(generate_aptitude_questions, jd_data, 10, invite_company, jd_text or "")
            future_coding = executor.submit(generate_coding_problems, jd_data, 2, invite_company, jd_text or "")
            future_interview = executor.submit(generate_interview_questions, jd_data, None, 5, "", jd_text or "", invite_company)

            apt_client, apt_keys = future_apt.result()
            coding_client, coding_keys = future_coding.result()
            interview_questions = future_interview.result()

        limit = policy.SECTION_MINUTES
        r1 = RoleReadyRoundAttempt(session_id=session.id, round_type="APTITUDE", round_order=1, time_limit_minutes=limit, questions_payload=apt_client, server_keys_payload=apt_keys)
        r2 = RoleReadyRoundAttempt(session_id=session.id, round_type="CODING", round_order=2, time_limit_minutes=limit, questions_payload=coding_client, server_keys_payload=coding_keys)
        r3 = RoleReadyRoundAttempt(session_id=session.id, round_type="INTERVIEW", round_order=3, time_limit_minutes=limit, questions_payload=interview_questions, server_keys_payload={"questions": interview_questions})
        
        db.add_all([r1, r2, r3])
        inv.status = "ACCEPTED"
        inv.accepted_at = datetime.utcnow()
        db.commit()
        db.refresh(session)

    return {
        "session_uuid": session.session_uuid,
        "candidate_name": inv.candidate.name if inv.candidate else "Candidate",
        "target_role": session.target_role,
        "current_state": session.current_state,
        "status": inv.status
    }


def get_admin_batch_report(db: Session, org_id: int, batch_id: int) -> Dict[str, Any]:
    """
    Generates consolidated recruitment report for the administrator with candidate comparison matrix.
    Enforces strict organization tenancy!
    """
    batch = db.query(RecruitmentBatch).filter(
        RecruitmentBatch.id == batch_id,
        RecruitmentBatch.organization_id == org_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Recruitment batch not found.")

    invitations = db.query(CandidateInvitation).filter(CandidateInvitation.batch_id == batch.id).all()
    candidate_reports = []

    for inv in invitations:
        session = db.query(RoleReadySession).filter(RoleReadySession.invitation_id == inv.id).first()
        cand = inv.candidate
        if not cand:
            continue
        
        candidate_reports.append({
            "candidate_id": cand.id,
            "name": cand.name,
            "email": cand.email,
            "invitation_status": inv.status,
            "assessment_state": session.current_state if session else "NOT_STARTED",
            "overall_score": reported_overall(session) if session else None,
            "aptitude_score": session.aptitude_score if session else 0.0,
            "coding_score": session.coding_score if session else 0.0,
            "interview_score": session.interview_score if session else 0.0,
            "completed_at": session.completed_at.isoformat() if session and session.completed_at else None
        })

    # Sort candidates by overall score descending
    candidate_reports.sort(key=lambda x: (x["overall_score"] is not None, x["overall_score"] or 0.0), reverse=True)

    completed_count = sum(1 for c in candidate_reports if c["assessment_state"] == "COMPLETED")
    return {
        "batch_id": batch.id,
        "batch_name": batch.batch_name,
        "total_candidates": len(candidate_reports),
        "completed_assessments": completed_count,
        "completion_rate": round((completed_count / len(candidate_reports) * 100), 1) if candidate_reports else 0.0,
        "candidates": candidate_reports
    }


def get_admin_tracking_data(db: Session, org_id: int) -> List[Dict[str, Any]]:
    """
    Returns unified tracking data for all candidates in the organization's assessment workflows.
    Maps actual database state machine to human-readable statuses.
    """
    invitations = db.query(CandidateInvitation).filter(
        CandidateInvitation.organization_id == org_id
    ).order_by(CandidateInvitation.created_at.desc()).all()

    tracking_list = []
    seen_session_ids = set()

    for inv in invitations:
        cand = inv.candidate
        if not cand:
            continue

        session = db.query(RoleReadySession).filter(RoleReadySession.invitation_id == inv.id).first()
        if session:
            seen_session_ids.add(session.id)

        readable_status = "Invitation Pending"
        if inv.status == "PENDING":
            readable_status = "Invitation Sent"
        elif inv.status == "FAILED":
            readable_status = "Invitation Failed"
        elif inv.status == "EXPIRED":
            readable_status = "Invitation Expired"

        if session:
            st = session.current_state
            if st == RoleReadySessionState.NOT_STARTED:
                readable_status = "Assessment Started"
            elif st == RoleReadySessionState.APTITUDE_IN_PROGRESS:
                readable_status = "Aptitude In Progress"
            elif st in [RoleReadySessionState.APTITUDE_SUBMITTED, RoleReadySessionState.APTITUDE_EVALUATED, RoleReadySessionState.CODING_UNLOCKED]:
                readable_status = "Aptitude Completed"
            elif st == RoleReadySessionState.CODING_IN_PROGRESS:
                readable_status = "Coding In Progress"
            elif st in [RoleReadySessionState.CODING_SUBMITTED, RoleReadySessionState.CODING_EVALUATED, RoleReadySessionState.INTERVIEW_UNLOCKED]:
                readable_status = "Coding Completed"
            elif st == RoleReadySessionState.INTERVIEW_IN_PROGRESS:
                readable_status = "Interview In Progress"
            elif st in [RoleReadySessionState.INTERVIEW_SUBMITTED, RoleReadySessionState.INTERVIEW_EVALUATED]:
                readable_status = "Interview Completed"
            elif st == RoleReadySessionState.COMPLETED:
                readable_status = "Assessment Completed"
            elif st == RoleReadySessionState.TIMED_OUT:
                readable_status = "Timed Out"

        tracking_list.append({
            "id": inv.id,
            "candidate_id": cand.id,
            "name": cand.name,
            "email": cand.email,
            "target_role": (session.target_role if session else (cand.role or "Software Engineer")),
            "batch_id": inv.batch_id,
            "batch_name": inv.batch.batch_name if inv.batch else "Standard Assessment",
            "invitation_status": inv.status,
            "readable_status": readable_status,
            "assessment_state": session.current_state if session else "NOT_STARTED",
            "aptitude_score": session.aptitude_score if session and session.aptitude_score is not None and session.current_state not in [RoleReadySessionState.NOT_STARTED, RoleReadySessionState.APTITUDE_IN_PROGRESS] else None,
            "coding_score": session.coding_score if session and session.coding_score is not None and session.current_state in [RoleReadySessionState.CODING_EVALUATED, RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS, RoleReadySessionState.INTERVIEW_SUBMITTED, RoleReadySessionState.INTERVIEW_EVALUATED, RoleReadySessionState.COMPLETED] else None,
            "interview_score": session.interview_score if session and session.interview_score is not None and session.current_state in [RoleReadySessionState.INTERVIEW_EVALUATED, RoleReadySessionState.COMPLETED] else None,
            "overall_score": session.overall_readiness_score if session and session.current_state == RoleReadySessionState.COMPLETED else None,
            "session_uuid": session.session_uuid if session else None,
            "invitation_token": inv.invitation_token,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
            "completed_at": session.completed_at.isoformat() if session and session.completed_at else None
        })

    # Also include direct student sessions (Self-Assessment or portal sessions not initiated via batch invitation)
    # A session with no organization of its own belongs to this tenant only through its student/candidate owner;
    # counting every org-less session would leak other tenants' student practice sessions into this list.
    direct_query = db.query(RoleReadySession).filter(
        or_(
            RoleReadySession.organization_id == org_id,
            and_(
                RoleReadySession.organization_id.is_(None),
                or_(
                    RoleReadySession.student_profile_id.in_(db.query(StudentProfile.id).filter(StudentProfile.organization_id == org_id)),
                    RoleReadySession.candidate_id.in_(db.query(Candidate.id).filter(Candidate.organization_id == org_id)),
                ),
            ),
        ),
        # Shared-link recruitment attempts have their own roster (admin recruitment API); keep them out of this legacy view
        RoleReadySession.workflow_type != "RECRUITMENT_ASSESSMENT",
    )
    if seen_session_ids:
        direct_query = direct_query.filter(RoleReadySession.id.notin_(seen_session_ids))
    direct_sessions = direct_query.order_by(RoleReadySession.created_at.desc()).all()

    for sess in direct_sessions:
        student_name = "Student Candidate"
        student_email = "student@prepwin.ai"
        if sess.student_profile:
            student_name = sess.student_profile.full_name or sess.student_profile.name or student_name
            student_email = sess.student_profile.email or student_email
        elif sess.candidate:
            student_name = sess.candidate.name or student_name
            student_email = sess.candidate.email or student_email

        st = sess.current_state
        readable_status = "Assessment Started"
        if st == RoleReadySessionState.NOT_STARTED:
            readable_status = "Ready to Start"
        elif st == RoleReadySessionState.APTITUDE_IN_PROGRESS:
            readable_status = "Aptitude In Progress"
        elif st in [RoleReadySessionState.APTITUDE_SUBMITTED, RoleReadySessionState.APTITUDE_EVALUATED, RoleReadySessionState.CODING_UNLOCKED]:
            readable_status = "Aptitude Completed"
        elif st == RoleReadySessionState.CODING_IN_PROGRESS:
            readable_status = "Coding In Progress"
        elif st in [RoleReadySessionState.CODING_SUBMITTED, RoleReadySessionState.CODING_EVALUATED, RoleReadySessionState.INTERVIEW_UNLOCKED]:
            readable_status = "Coding Completed"
        elif st == RoleReadySessionState.INTERVIEW_IN_PROGRESS:
            readable_status = "Interview In Progress"
        elif st in [RoleReadySessionState.INTERVIEW_SUBMITTED, RoleReadySessionState.INTERVIEW_EVALUATED]:
            readable_status = "Interview Completed"
        elif st == RoleReadySessionState.COMPLETED:
            readable_status = "Assessment Completed"
        elif st == RoleReadySessionState.TIMED_OUT:
            readable_status = "Timed Out"

        tracking_list.append({
            "id": f"sess-{sess.id}",
            "candidate_id": sess.candidate_id or (sess.student_profile.id if sess.student_profile else sess.id),
            "name": student_name,
            "email": student_email,
            "target_role": sess.target_role or "Software Engineer",
            "batch_id": None,
            "batch_name": "Direct Student Assessment",
            "invitation_status": "COMPLETED" if sess.current_state == RoleReadySessionState.COMPLETED else "IN_PROGRESS",
            "readable_status": readable_status,
            "assessment_state": sess.current_state,
            "aptitude_score": sess.aptitude_score if sess.aptitude_score is not None and sess.current_state not in [RoleReadySessionState.NOT_STARTED, RoleReadySessionState.APTITUDE_IN_PROGRESS] else None,
            "coding_score": sess.coding_score if sess.coding_score is not None and sess.current_state in [RoleReadySessionState.CODING_EVALUATED, RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS, RoleReadySessionState.INTERVIEW_SUBMITTED, RoleReadySessionState.INTERVIEW_EVALUATED, RoleReadySessionState.COMPLETED] else None,
            "interview_score": sess.interview_score if sess.interview_score is not None and sess.current_state in [RoleReadySessionState.INTERVIEW_EVALUATED, RoleReadySessionState.COMPLETED] else None,
            "overall_score": sess.overall_readiness_score if sess.current_state == RoleReadySessionState.COMPLETED else None,
            "session_uuid": sess.session_uuid,
            "invitation_token": None,
            "created_at": sess.created_at.isoformat() if sess.created_at else None,
            "completed_at": sess.completed_at.isoformat() if sess.completed_at else None
        })

    return tracking_list

