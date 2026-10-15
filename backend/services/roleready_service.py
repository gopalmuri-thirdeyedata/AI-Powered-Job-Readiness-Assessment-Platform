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
from sqlalchemy import desc
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException

import models
from models import (
    RoleReadySession, 
    RoleReadyRoundAttempt, 
    RoleReadySessionState, 
    RecruitmentBatch, 
    CandidateInvitation, 
    JobDescription, 
    Candidate,
    StudentProfile,
    StudentResume
)
from services.gemini_client import call_gemini
from services.readiness_service import refresh_profile_readiness
from services import piston_service
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


def generate_aptitude_questions(jd_data: Dict[str, Any], count: int = 10) -> tuple[List[Dict[str, Any]], Dict[str, str]]:
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
"""
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
        })
        server_keys[pid] = {"hidden_test_cases": hidden[:4]}
    return client_safe, server_keys


def generate_coding_problems(jd_data: Dict[str, Any], count: int = 2) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
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
"""
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
    jd_text: str = ""
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
"""
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
    company = target_company or student_profile.target_company

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
        future_apt = executor.submit(generate_aptitude_questions, jd_data, 10)
        future_coding = executor.submit(generate_coding_problems, jd_data, 2)
        future_interview = executor.submit(generate_interview_questions, jd_data, resume_snapshot, 5)

        apt_client, apt_keys = future_apt.result()
        coding_client, coding_keys = future_coding.result()
        interview_questions = future_interview.result()

    # 1. Aptitude Round
    round1 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="APTITUDE",
        round_order=1,
        status="PENDING",
        time_limit_minutes=20,
        questions_payload=apt_client,
        server_keys_payload=apt_keys
    )
    # 2. Coding Round
    round2 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="CODING",
        round_order=2,
        status="PENDING",
        time_limit_minutes=45,
        questions_payload=coding_client,
        server_keys_payload=coding_keys
    )
    # 3. Interview Round
    round3 = RoleReadyRoundAttempt(
        session_id=session.id,
        round_type="INTERVIEW",
        round_order=3,
        status="PENDING",
        time_limit_minutes=20,
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

PYTHON_ONLY_DETAIL = "Only Python and Java are supported for coding assessments."
# Max parallel sandbox calls per coding submission (kept modest to stay under the sandbox's rate limit)
CODING_TEST_CONCURRENCY = 4
SUPPORTED_CODING_LANGUAGES = {"python", "python3", "java"}
UNSUPPORTED_LANGUAGE_DETAIL = "Only Python and Java are supported for coding assessments."
RUN_CODE_RATE_LIMIT = 5            # run-code requests per window, per student
RUN_CODE_WINDOW_SECONDS = 60
RUN_CODE_MAX_CONCURRENT = 2        # simultaneous sandbox executions per student
MAX_CODE_BYTES = 64 * 1024
MAX_OUTPUT_CHARS = 10 * 1024
EXPIRY_GRACE_SECONDS = 60          # grace before an unsubmitted expired round is auto-finalized

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


def _round_timing(rnd: RoleReadyRoundAttempt) -> Dict[str, Any]:
    """Server-authoritative timer: the client hydrates its countdown from these values."""
    if not rnd.started_at:
        return {"started_at": None, "deadline_at": None, "remaining_seconds": rnd.time_limit_minutes * 60}
    started = rnd.started_at.replace(tzinfo=None)
    deadline = started + timedelta(minutes=rnd.time_limit_minutes)
    return {
        "started_at": started.isoformat(),
        "deadline_at": deadline.isoformat(),
        "remaining_seconds": max(0, int((deadline - datetime.utcnow()).total_seconds())),
    }


def _require_supported_language(language: Optional[str]) -> str:
    lang = (language or "python").strip().lower()
    if lang not in SUPPORTED_CODING_LANGUAGES:
        raise HTTPException(status_code=400, detail=UNSUPPORTED_LANGUAGE_DETAIL)
    if lang in ("python", "python3"):
        return "python"
    return "java"


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


def finalize_expired_round(db: Session, session: RoleReadySession) -> bool:
    """
    Server-side timer authority: if the active round's deadline (plus grace) has passed without a
    submission, finalize it with no answers (unanswered items score zero) and advance the session.
    Returns True when a round was finalized.
    """
    active = {
        RoleReadySessionState.APTITUDE_IN_PROGRESS: ("APTITUDE", lambda: submit_aptitude_round(db, session, {}, 0)),
        RoleReadySessionState.CODING_IN_PROGRESS: ("CODING", lambda: submit_coding_round(db, session, {}, 0)),
        RoleReadySessionState.INTERVIEW_IN_PROGRESS: ("INTERVIEW", lambda: submit_interview_round(db, session, {"answers": []}, 0)),
    }.get(session.current_state)
    if not active:
        return False
    rnd = db.query(RoleReadyRoundAttempt).filter(
        RoleReadyRoundAttempt.session_id == session.id,
        RoleReadyRoundAttempt.round_type == active[0]
    ).first()
    if not rnd or rnd.status in ("EVALUATED", "EVALUATING", "EVAL_FAILED") or not rnd.started_at:
        return False
    deadline = rnd.started_at.replace(tzinfo=None) + timedelta(minutes=rnd.time_limit_minutes)
    if (datetime.utcnow() - deadline).total_seconds() < EXPIRY_GRACE_SECONDS:
        return False
    try:
        active[1]()
        return True
    except HTTPException:
        db.rollback()
        return False


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


def readiness_tier(score: float) -> str:
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


def build_performance_dossier(db: Session, session: RoleReadySession, qualitative: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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
    overall = session.overall_readiness_score or 0.0

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
    Enforces state: NOT_STARTED or APTITUDE_IN_PROGRESS -> returns client-safe questions.
    """
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
        session.current_state = RoleReadySessionState.APTITUDE_IN_PROGRESS
        session.started_at = datetime.utcnow()
        apt_round.status = "IN_PROGRESS"
        apt_round.started_at = datetime.utcnow()
        _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "APTITUDE",
        "current_state": session.current_state,
        "time_limit_minutes": apt_round.time_limit_minutes,
        **_round_timing(apt_round),
        "questions": apt_round.questions_payload
    }


def submit_aptitude_round(
    db: Session,
    session: RoleReadySession,
    answers: Dict[str, str],
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Server evaluates answers against secret keys, scores aptitude (unanswered = 0),
    transitions session to CODING_UNLOCKED regardless of score (zero-rejection), returns scorecard.
    """
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
            "score": apt_round.score,
            "correct_count": stored.get("correct_count"),
            "total_questions": stored.get("total_questions"),
            "current_state": session.current_state,
            "next_stage": session.current_state,
            "evaluation": apt_round.evaluation_payload,
            "next_round_unlocked": True,
            "idempotent_replay": True
        }

    if session.current_state not in (RoleReadySessionState.NOT_STARTED, RoleReadySessionState.APTITUDE_IN_PROGRESS):
        raise HTTPException(status_code=403, detail=f"Aptitude round is not open. Current state: '{session.current_state}'.")

    keys = apt_round.server_keys_payload or {}
    total_questions = len(keys)
    correct_count = 0
    breakdown = []

    for qid, key_info in keys.items():
        correct_key = key_info.get("correct_key", "")
        student_ans = str(answers.get(qid, "")).strip().upper()
        is_correct = (student_ans == correct_key.upper())
        if is_correct:
            correct_count += 1
        breakdown.append({
            "question_id": qid,
            "student_choice": student_ans,
            "is_correct": is_correct,
            "explanation": key_info.get("explanation", "")
        })

    score = round((correct_count / total_questions * 100), 1) if total_questions > 0 else 0.0

    _claim_round(db, apt_round)
    apt_round.score = score
    apt_round.status = "EVALUATED"
    apt_round.time_spent_seconds = time_spent_seconds
    apt_round.submission_payload = answers
    apt_round.proctoring_violations = proctoring_violations or []
    apt_round.started_at = apt_round.started_at or datetime.utcnow()
    apt_round.submitted_at = datetime.utcnow()
    apt_round.evaluated_at = datetime.utcnow()
    apt_round.evaluation_payload = {
        "score": score,
        "correct_count": correct_count,
        "total_questions": total_questions,
        "breakdown": breakdown
    }

    # State transition: any score (including 0%) unlocks the Coding round
    session.aptitude_score = score
    session.started_at = session.started_at or datetime.utcnow()
    session.current_state = RoleReadySessionState.CODING_UNLOCKED
    _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "status": "success",
        "round_type": "APTITUDE",
        "score": score,
        "correct_count": correct_count,
        "total_questions": total_questions,
        "current_state": session.current_state,
        "next_stage": session.current_state,
        "next_round_unlocked": True,
        "message": "Aptitude assessment submitted successfully. Round 2 (Coding) is now unlocked.",
        "breakdown": breakdown
    }


# ─── ROUND 2: CODING ──────────────────────────────────────────────────────────

def start_coding_round(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    STRICT BACKEND GATING: Requires CODING_UNLOCKED or CODING_IN_PROGRESS.
    Direct API calls without completing Aptitude return HTTP 403!
    """
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

    if session.current_state == RoleReadySessionState.CODING_UNLOCKED:
        session.current_state = RoleReadySessionState.CODING_IN_PROGRESS
        coding_round.status = "IN_PROGRESS"
        coding_round.started_at = datetime.utcnow()
        _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "CODING",
        "current_state": session.current_state,
        "time_limit_minutes": coding_round.time_limit_minutes,
        **_round_timing(coding_round),
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
    Ephemeral run against the single public sample test case via the Judge0 sandbox.
    Supports Python and Java; no state is changed. Sandbox outage -> HTTP 503 (round stays open).
    """
    selected_lang = _require_supported_language(language)
    if len((code or "").encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(status_code=400, detail="Code exceeds the 64 KB submission limit.")

    coding_round = _get_round(db, session, "CODING", "Coding")
    if session.current_state != RoleReadySessionState.CODING_IN_PROGRESS:
        if coding_round.status == "EVALUATED" or session.current_state == RoleReadySessionState.COMPLETED:
            raise HTTPException(status_code=400, detail="Round completed: the coding round is closed.")
        raise HTTPException(status_code=403, detail="Coding round is locked or not started.")

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
        results = []
        for test in (problem.get("public_test_cases") or [])[:1]:
            inp = test.get("input", "")
            exp = test.get("expected_output", "").strip()
            exec_res = piston_service.execute_code(selected_lang, code, stdin=inp)
            if exec_res.get("status") == "service_error":
                raise _sandbox_unavailable()

            stdout = _trim_output(exec_res.get("stdout")).strip()
            compile_err = _trim_output(exec_res.get("compile_output"))
            runtime_err = _trim_output(exec_res.get("stderr"))
            error = compile_err or runtime_err or (exec_res.get("output") if exec_res.get("status") in ("error", "failed") else None)

            error_type = None
            if compile_err or exec_res.get("status") == "error":
                error_type = "Compilation Error"
            elif runtime_err or exec_res.get("status") == "failed":
                error_type = "Runtime Error" if not exec_res.get("timed_out") else "Time Limit Exceeded"

            results.append({
                "input": inp,
                "expected_output": exp,
                "actual_output": stdout,
                "error": error,
                "error_type": error_type,
                "timed_out": bool(exec_res.get("timed_out")),
                "execution_time_ms": exec_res.get("execution_time_ms"),
                "passed": piston_service.outputs_match(stdout, exp)
            })
    finally:
        _release_run_slot(limiter_key)

    all_passed = all(r["passed"] for r in results) if results else False
    first = results[0] if results else {}
    return {
        "status": "success",
        "problem_id": problem_id,
        "language": selected_lang,
        "all_passed": all_passed,
        "sample_test_passed": all_passed,
        "stdout": first.get("actual_output", ""),
        "stderr": first.get("error") or "",
        "error_type": first.get("error_type"),
        "execution_time_ms": first.get("execution_time_ms"),
        "expected_output": first.get("expected_output", ""),
        "actual_output": first.get("actual_output", ""),
        "test_results": results
    }


def submit_coding_round(
    db: Session,
    session: RoleReadySession,
    solutions: Dict[str, Dict[str, str]], # { "1": {"code": "...", "language": "python"|"java"} }
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Server evaluates code against hidden test cases (Python or Java), records score,
    transitions session to INTERVIEW_UNLOCKED regardless of score (zero-rejection).
    Sandbox outage -> HTTP 503 with nothing committed so the student can retry.
    """
    solutions = solutions or {}
    for sol in solutions.values():  # validate before any state change
        _require_supported_language((sol or {}).get("language"))
        if len(((sol or {}).get("code") or "").encode("utf-8")) > MAX_CODE_BYTES:
            raise HTTPException(status_code=400, detail="Code exceeds the 64 KB submission limit.")

    coding_round = _get_round(db, session, "CODING", "Coding")

    if coding_round.status == "EVALUATED":
        _reject_resubmission(session, coding_round, solutions)
        stored = coding_round.evaluation_payload or {}
        return {
            "session_uuid": session.session_uuid,
            "status": "EVALUATED",
            "round_type": "CODING",
            "score": coding_round.score,
            "current_state": session.current_state,
            "next_stage": session.current_state,
            "next_round_unlocked": True,
            "problem_evaluations": stored.get("problems", []),
            "idempotent_replay": True
        }

    if session.current_state not in (RoleReadySessionState.CODING_UNLOCKED, RoleReadySessionState.CODING_IN_PROGRESS):
        raise HTTPException(status_code=403, detail="Coding round is locked. Complete the previous round first.")

    hidden_keys = coding_round.server_keys_payload or {}
    total_hidden_tests = 0
    passed_hidden_tests = 0
    problem_evaluations = []

    # Every hidden test is an independent sandbox round-trip (~1.5s each), so run them concurrently
    # instead of one after another. Results are matched back to their test by index.
    jobs = []  # (problem_index, expected_output, language, code, stdin)
    plans = []
    for prob in coding_round.questions_payload or []:
        pid = str(prob.get("id"))
        sol_data = solutions.get(pid, {})
        code = sol_data.get("code", "")
        sol_lang = _require_supported_language(sol_data.get("language"))
        prob_hidden = hidden_keys.get(pid, {}).get("hidden_test_cases", [])
        plans.append((prob, pid, sol_lang, len(prob_hidden)))
        total_hidden_tests += len(prob_hidden)
        if code.strip():  # an empty/unanswered solution scores zero without a sandbox call
            for h_test in prob_hidden:
                jobs.append((len(plans) - 1, (h_test.get("expected_output", "") or "").strip(), sol_lang, code, h_test.get("input", "")))

    def _run_hidden_test(job):
        _, _, lang, code_, stdin_ = job
        res = piston_service.execute_code(lang, code_, stdin=stdin_)
        if res.get("status") == "service_error":  # one quick retry for a transient sandbox hiccup
            res = piston_service.execute_code(lang, code_, stdin=stdin_)
        return res

    passed_by_problem = defaultdict(int)
    if jobs:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(CODING_TEST_CONCURRENCY, len(jobs))) as pool:
            results = list(pool.map(_run_hidden_test, jobs))
        for job, res in zip(jobs, results):
            if res.get("status") == "service_error":
                raise _sandbox_unavailable()
            stdout = _trim_output(res.get("stdout")).strip()
            if piston_service.outputs_match(stdout, job[1]):
                passed_by_problem[job[0]] += 1
                passed_hidden_tests += 1

    for idx, (prob, pid, sol_lang, prob_total) in enumerate(plans):
        prob_passed = passed_by_problem[idx]
        prob_score = round((prob_passed / prob_total * 100), 1) if prob_total > 0 else 0.0
        problem_evaluations.append({
            "problem_id": pid,
            "title": prob.get("title"),
            "language": sol_lang,
            "passed_tests": prob_passed,
            "total_tests": prob_total,
            "score": prob_score
        })

    overall_coding_score = round((passed_hidden_tests / total_hidden_tests * 100), 1) if total_hidden_tests > 0 else 0.0

    _claim_round(db, coding_round)
    coding_round.score = overall_coding_score
    coding_round.status = "EVALUATED"
    coding_round.time_spent_seconds = time_spent_seconds
    coding_round.submission_payload = solutions
    coding_round.proctoring_violations = proctoring_violations or []
    coding_round.started_at = coding_round.started_at or datetime.utcnow()
    coding_round.submitted_at = datetime.utcnow()
    coding_round.evaluated_at = datetime.utcnow()
    coding_round.evaluation_payload = {
        "score": overall_coding_score,
        "problems": problem_evaluations,
        "total_hidden_tests": total_hidden_tests,
        "passed_hidden_tests": passed_hidden_tests
    }

    # State transition: any score (including 0%) unlocks the Interview round
    session.coding_score = overall_coding_score
    session.current_state = RoleReadySessionState.INTERVIEW_UNLOCKED
    _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "status": "success",
        "round_type": "CODING",
        "score": overall_coding_score,
        "problems_evaluated": len(problem_evaluations),
        "results": [
            {"problem_id": e["problem_id"], "passed_tests": e["passed_tests"], "total_tests": e["total_tests"]}
            for e in problem_evaluations
        ],
        "current_state": session.current_state,
        "next_stage": session.current_state,
        "next_round_unlocked": True,
        "message": "Coding assessment submitted. Round 3 (Interview) is now unlocked.",
        "problem_evaluations": problem_evaluations
    }


# ─── ROUND 3: INTERVIEW ───────────────────────────────────────────────────────

def start_interview_round(db: Session, session: RoleReadySession) -> Dict[str, Any]:
    """
    STRICT BACKEND GATING: Requires INTERVIEW_UNLOCKED or INTERVIEW_IN_PROGRESS.
    Direct API calls without completing Coding return HTTP 403!
    """
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
            time_limit_minutes=15
        )
        db.add(int_round)
        _commit_or_500(db)

    if session.current_state == RoleReadySessionState.INTERVIEW_UNLOCKED:
        session.current_state = RoleReadySessionState.INTERVIEW_IN_PROGRESS
        int_round.status = "IN_PROGRESS"
        int_round.started_at = datetime.utcnow()
        _commit_or_500(db)

    return {
        "session_uuid": session.session_uuid,
        "round_type": "INTERVIEW",
        "current_state": session.current_state,
        "time_limit_minutes": int_round.time_limit_minutes,
        **_round_timing(int_round),
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
            time_limit_minutes=15
        )
        db.add(int_round)
        _commit_or_500(db)

    if session.current_state == RoleReadySessionState.INTERVIEW_UNLOCKED:
        session.current_state = RoleReadySessionState.INTERVIEW_IN_PROGRESS
        int_round.status = "IN_PROGRESS"
        int_round.started_at = datetime.utcnow()
        _commit_or_500(db)

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
            jd_text=jd_text
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
            jd_summary=jd_summary
        )
    except Exception as e:
        print(f"[RoleReady] Ephemeral Vapi Assistant initialization failed: {e}")

    return {
        "session_uuid": session.session_uuid,
        "assistantId": assistant_id,
        "assistantConfig": assistant_config,
        "questions": questions,
        "role": role,
        "company": company,
        "candidateName": candidate_name,
        "duration": int_round.time_limit_minutes or 20,
        **_round_timing(int_round)
    }


def submit_interview_round(
    db: Session,
    session: RoleReadySession,
    answers_or_transcript: Dict[str, Any], # { "answers": [{"question_id": 1, "response": "..."}] }
    time_spent_seconds: int = 0,
    proctoring_violations: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Evaluates interview responses with AI scoring (no answers = 0), synthesizes the 17-point
    final job-readiness dossier, and transitions session to COMPLETED regardless of score.
    """
    int_round = _get_round(db, session, "INTERVIEW", "Interview")

    if int_round.status == "EVALUATED":
        _reject_resubmission(session, int_round, answers_or_transcript)
        return {
            "session_uuid": session.session_uuid,
            "status": "COMPLETED",
            "round_type": "INTERVIEW",
            "score": int_round.score,
            "current_state": session.current_state,
            "session_status": session.current_state,
            "report_available": bool(session.final_report_data),
            "overall_readiness_score": session.overall_readiness_score,
            "final_report": session.final_report_data,
            "idempotent_replay": True
        }

    if session.current_state not in (RoleReadySessionState.INTERVIEW_UNLOCKED, RoleReadySessionState.INTERVIEW_IN_PROGRESS):
        raise HTTPException(status_code=403, detail="Interview round is locked. Complete the previous round first.")

    interview_answers = answers_or_transcript.get("answers") or []
    raw_transcript = answers_or_transcript.get("transcript") or []
    qualitative = {}
    evaluation_source = "ai"

    questions = int_round.questions_payload or []
    role = session.target_role or "Software Engineer"
    jd_data = session.extracted_jd_data or {}
    jd_skills = ", ".join(jd_data.get("required_skills", []) or [])
    jd_text = (session.custom_jd_text or "").strip()
    jd_summary = f"Role: {role}. Skills: {jd_skills}. Context: {jd_text[:400]}" if jd_text else f"Role: {role}. Skills: {jd_skills}"

    resume_raw = (session.resume_raw_text or "").strip()
    resume_skills = ", ".join(_skill_names(session.resume_snapshot))
    resume_summary = f"Skills: {resume_skills}. Experience: {resume_raw[:500]}" if resume_raw else f"Skills: {resume_skills}"

    if not interview_answers:
        interview_score = 0.0  # unanswered interview scores zero
        qualitative_feedback = "No interview responses were submitted."
        evaluation_source = "no_answers"
        qualitative = {
            "score": 0.0,
            "overall_score": 0.0,
            "summary": qualitative_feedback,
            "evaluation_source": "no_answers",
            "question_evaluations": []
        }
    else:
        eval_res = evaluate_five_technical_questions(
            questions=questions,
            answers=interview_answers,
            role=role,
            jd_summary=jd_summary,
            resume_summary=resume_summary,
            transcript=raw_transcript,
            call_gemini_fn=call_gemini
        )
        interview_score = max(0.0, min(100.0, float(eval_res.get("score", 0.0))))
        qualitative_feedback = eval_res.get("summary") or eval_res.get("qualitative_feedback") or "Evaluation completed."
        evaluation_source = eval_res.get("evaluation_source", "ai")
        qualitative = eval_res

    _claim_round(db, int_round)
    int_round.score = interview_score
    int_round.status = "EVALUATED"
    int_round.time_spent_seconds = time_spent_seconds
    int_round.submission_payload = answers_or_transcript
    int_round.proctoring_violations = proctoring_violations or []
    int_round.started_at = int_round.started_at or datetime.utcnow()
    int_round.submitted_at = datetime.utcnow()
    int_round.evaluated_at = datetime.utcnow()
    int_round.evaluation_payload = {
        "score": interview_score,
        "qualitative_feedback": qualitative_feedback,
        "evaluation_source": evaluation_source,
        "technical_depth_score": qualitative.get("technical_depth_score", interview_score),
        "communication_score": qualitative.get("communication_score", interview_score),
        "key_strengths": qualitative.get("key_strengths", []),
        "key_areas_for_improvement": qualitative.get("key_areas_for_improvement", []),
        "question_evaluations": qualitative.get("question_evaluations", [])
    }

    session.interview_score = interview_score

    # Final Consolidated Job Readiness Index (Weighted: Aptitude 25%, Coding 40%, Interview 35%)
    overall_readiness = round(
        (session.aptitude_score * 0.25) +
        (session.coding_score * 0.40) +
        (session.interview_score * 0.35),
        1
    )
    session.overall_readiness_score = overall_readiness

    # Dossier is computed from stored scores, so it succeeds even when AI is unavailable.
    final_report = {
        "session_uuid": session.session_uuid,
        "skills_verified": (session.extracted_jd_data or {}).get("required_skills", [])[:4],
        "evaluated_at": datetime.utcnow().isoformat(),
        "completion_status": "COMPLETED",
        **build_performance_dossier(db, session, {**qualitative, "qualitative_feedback": qualitative_feedback}),
    }
    final_report["strengths"] = final_report["demonstrated_strengths"]

    session.final_report_data = final_report
    session.current_state = RoleReadySessionState.COMPLETED
    session.completed_at = datetime.utcnow()
    _commit_or_500(db)
    _refresh_student_readiness(db, session)

    return {
        "session_uuid": session.session_uuid,
        "status": "success",
        "round_type": "INTERVIEW",
        "score": interview_score,
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
    int_round = _get_round(db, session, "INTERVIEW", "Interview")
    processing = {"session_uuid": session.session_uuid, "status": "PROCESSING", "report_status": "PROCESSING",
                  "round_type": "INTERVIEW", "current_state": session.current_state}

    if int_round.status == "EVALUATED":  # already done: identical retry replays the stored result
        return submit_interview_round(db, session, answers_or_transcript, time_spent_seconds, proctoring_violations)

    if int_round.status == "EVALUATING" and not _evaluation_is_stale(int_round):
        return processing

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
        "overall_readiness_score": session.overall_readiness_score,
        "aptitude_score": session.aptitude_score,
        "coding_score": session.coding_score,
        "interview_score": session.interview_score,
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

        # Pre-generate rounds concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_apt = executor.submit(generate_aptitude_questions, jd_data, 10)
            future_coding = executor.submit(generate_coding_problems, jd_data, 2)
            future_interview = executor.submit(generate_interview_questions, jd_data, None, 5)

            apt_client, apt_keys = future_apt.result()
            coding_client, coding_keys = future_coding.result()
            interview_questions = future_interview.result()

        r1 = RoleReadyRoundAttempt(session_id=session.id, round_type="APTITUDE", round_order=1, questions_payload=apt_client, server_keys_payload=apt_keys)
        r2 = RoleReadyRoundAttempt(session_id=session.id, round_type="CODING", round_order=2, questions_payload=coding_client, server_keys_payload=coding_keys)
        r3 = RoleReadyRoundAttempt(session_id=session.id, round_type="INTERVIEW", round_order=3, questions_payload=interview_questions, server_keys_payload={"questions": interview_questions})
        
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
            "overall_score": session.overall_readiness_score if session else 0.0,
            "aptitude_score": session.aptitude_score if session else 0.0,
            "coding_score": session.coding_score if session else 0.0,
            "interview_score": session.interview_score if session else 0.0,
            "completed_at": session.completed_at.isoformat() if session and session.completed_at else None
        })

    # Sort candidates by overall score descending
    candidate_reports.sort(key=lambda x: x["overall_score"], reverse=True)

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
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
            "completed_at": session.completed_at.isoformat() if session and session.completed_at else None
        })

    return tracking_list

