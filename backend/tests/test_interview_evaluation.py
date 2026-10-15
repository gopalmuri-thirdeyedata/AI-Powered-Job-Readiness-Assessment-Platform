import pytest
from services.interview_evaluation import (
    evaluate_five_technical_questions,
    fallback_evaluate_five_technical_questions
)

SAMPLE_QUESTIONS = [
    {
        "id": 1,
        "category": "System Architecture & Scalability",
        "question": "How would you design a distributed caching layer for high-throughput read-heavy APIs?",
        "evaluation_criteria": "Cache eviction (LRU/LFU), consistency models, Redis clustering, cache stampede prevention."
    },
    {
        "id": 2,
        "category": "Database & Query Optimization",
        "question": "How do you identify and resolve database deadlocks and slow queries in production?",
        "evaluation_criteria": "EXPLAIN plans, composite indexing, lock escalation, isolation levels."
    },
    {
        "id": 3,
        "category": "API Design & Resiliency",
        "question": "Explain how you implement idempotency and rate limiting in microservices.",
        "evaluation_criteria": "Idempotency keys, token bucket / leaky bucket algorithms, Redis distributed locks."
    },
    {
        "id": 4,
        "category": "Testing & Observability",
        "question": "Describe your strategy for distributed tracing, structured logging, and automated testing.",
        "evaluation_criteria": "OpenTelemetry, trace context propagation, unit/integration/contract test pyramids."
    },
    {
        "id": 5,
        "category": "Behavioral & Production Incident Defense",
        "question": "Tell me about a time you handled a critical production outage or major architectural trade-off.",
        "evaluation_criteria": "STAR methodology, incident triage, root cause analysis, cross-functional communication."
    }
]

def test_empty_interview_answers_score_zero_and_skip_ai(monkeypatch):
    def must_not_call(*a, **k):
        raise AssertionError("Gemini must never be called for empty interview answers")
    
    # We monkeypatch whatever client interview_evaluation uses
    from services import gemini_client
    monkeypatch.setattr(gemini_client, "call_gemini", must_not_call)

    empty_answers = [
        {"question_id": 1, "response": ""},
        {"question_id": 2, "response": "   "},
        {"question_id": 3, "response": ""},
        {"question_id": 4, "response": ""},
        {"question_id": 5, "response": ""}
    ]

    result = evaluate_five_technical_questions(
        questions=SAMPLE_QUESTIONS,
        answers=empty_answers,
        role="Backend Engineer",
        jd_summary="Python, FastAPI, Redis, MySQL",
        resume_summary="Software Engineer with 3 years experience"
    )

    assert result["score"] == 0.0
    assert result["overall_score"] == 0.0
    assert result["evaluation_source"] == "no_answers"
    assert len(result["question_evaluations"]) == 5
    for q_eval in result["question_evaluations"]:
        assert q_eval["score"] == 0.0
        assert q_eval["status"] == "unanswered"
        assert "did not provide" in q_eval["explanation"].lower() or "unanswered" in q_eval["explanation"].lower()


def test_ai_failure_uses_deterministic_fallback_and_flags_source(monkeypatch):
    from services import gemini_client
    def boom(*a, **k):
        raise RuntimeError("Gemini API connection error")
    monkeypatch.setattr(gemini_client, "call_gemini", boom)

    answers = [
        {
            "question_id": 1,
            "response": "I would use Redis cluster with LRU eviction and consistent hashing for partitioning. For cache stampede, I use mutex locks with probabilistic early expiration.",
            "follow_ups": [
                {"follow_up_question": "What happens if Redis master fails?", "response": "Redis Sentinel or multi-AZ cluster failover handles automatic election."}
            ]
        },
        {
            "question_id": 2,
            "response": "I inspect slow query logs and run EXPLAIN ANALYZE to verify index usage and check for filesort or temporary tables."
        },
        {
            "question_id": 3,
            "response": "We use unique idempotency keys stored in Redis with TTL alongside a token bucket filter for rate limiting."
        },
        {
            "question_id": 4,
            "response": "We emit OpenTelemetry trace IDs and correlation IDs in all structured JSON logs."
        },
        {
            "question_id": 5,
            "response": "During a black Friday checkout spike, database connection pool exhausted. I rolled out connection multiplexing with PgBouncer."
        }
    ]

    result = evaluate_five_technical_questions(
        questions=SAMPLE_QUESTIONS,
        answers=answers,
        role="Senior Backend Engineer",
        jd_summary="FastAPI, Redis, Scalability",
        resume_summary="Senior Engineer"
    )

    assert result["evaluation_source"] == "fallback_default"
    assert 0.0 <= result["score"] <= 100.0
    assert len(result["question_evaluations"]) == 5
    # Verify each of the 5 questions has structured feedback
    for q_eval in result["question_evaluations"]:
        assert "question_id" in q_eval
        assert "category" in q_eval
        assert "score" in q_eval
        assert "status" in q_eval
        assert "demonstrated_strengths" in q_eval
        assert "knowledge_gaps" in q_eval
        assert "actionable_advice" in q_eval


def test_ai_evaluation_produces_5_question_breakdown(monkeypatch):
    from services import gemini_client
    mock_ai_response = {
        "score": 85.0,
        "overall_score": 85.0,
        "technical_depth_score": 88.0,
        "communication_score": 82.0,
        "summary": "Demonstrated strong knowledge of caching architectures and database tuning.",
        "key_strengths": ["Clear understanding of Redis clustering", "Practical experience with EXPLAIN"],
        "key_areas_for_improvement": ["Could elaborate on cache stampede algorithms"],
        "question_evaluations": [
            {
                "question_id": 1,
                "category": "System Architecture & Scalability",
                "score": 90.0,
                "status": "correct",
                "explanation": "Correctly identified Redis cluster and LRU eviction.",
                "demonstrated_strengths": ["Redis clustering", "LRU eviction"],
                "knowledge_gaps": ["Did not mention XFetch algorithm"],
                "evidence": "I would use Redis cluster with LRU eviction",
                "actionable_advice": "Study probabilistic early expiration like XFetch."
            },
            {
                "question_id": 2,
                "category": "Database & Query Optimization",
                "score": 85.0,
                "status": "correct",
                "explanation": "Good command of EXPLAIN and query analysis.",
                "demonstrated_strengths": ["EXPLAIN ANALYZE"],
                "knowledge_gaps": ["Lock contention"],
                "evidence": "run EXPLAIN ANALYZE to verify index usage",
                "actionable_advice": "Review transaction isolation level deadlocks."
            },
            {
                "question_id": 3,
                "category": "API Design & Resiliency",
                "score": 80.0,
                "status": "partially_correct",
                "explanation": "Mentioned idempotency keys and token bucket.",
                "demonstrated_strengths": ["Token bucket", "Idempotency key"],
                "knowledge_gaps": ["Distributed rollback handling"],
                "evidence": "unique idempotency keys stored in Redis",
                "actionable_advice": "Explain two-phase commit or saga pattern."
            },
            {
                "question_id": 4,
                "category": "Testing & Observability",
                "score": 85.0,
                "status": "correct",
                "explanation": "Proper OpenTelemetry trace propagation.",
                "demonstrated_strengths": ["OpenTelemetry trace IDs"],
                "knowledge_gaps": ["Sampling rates"],
                "evidence": "emit OpenTelemetry trace IDs and correlation IDs",
                "actionable_advice": "Discuss head-based vs tail-based trace sampling."
            },
            {
                "question_id": 5,
                "category": "Behavioral & Production Incident Defense",
                "score": 85.0,
                "status": "correct",
                "explanation": "Followed STAR format describing PgBouncer incident.",
                "demonstrated_strengths": ["STAR structure", "Connection pooling"],
                "knowledge_gaps": ["Post-mortem documentation"],
                "evidence": "During a black Friday checkout spike, database connection pool exhausted",
                "actionable_advice": "Emphasize team blameless post-mortem follow-ups."
            }
        ]
    }
    monkeypatch.setattr(gemini_client, "call_gemini", lambda *a, **k: mock_ai_response)

    answers = [
        {"question_id": 1, "response": "I would use Redis cluster with LRU eviction"},
        {"question_id": 2, "response": "run EXPLAIN ANALYZE to verify index usage"},
        {"question_id": 3, "response": "unique idempotency keys stored in Redis"},
        {"question_id": 4, "response": "emit OpenTelemetry trace IDs and correlation IDs"},
        {"question_id": 5, "response": "During a black Friday checkout spike, database connection pool exhausted"}
    ]

    result = evaluate_five_technical_questions(
        questions=SAMPLE_QUESTIONS,
        answers=answers,
        role="Backend Engineer",
        jd_summary="FastAPI, Redis",
        resume_summary="Senior Engineer"
    )

    assert result["evaluation_source"] == "ai"
    assert result["score"] == 85.0
    assert len(result["question_evaluations"]) == 5
    assert result["question_evaluations"][0]["score"] == 90.0
    assert result["question_evaluations"][0]["status"] == "correct"
