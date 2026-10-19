"""
Student Performance & Analytics Service.
Aggregates, normalizes, and analyzes student assessment performance across:
1. RoleReady Core Assessments (Aptitude, Coding, Interview)
2. Student Placement Simulations (4-round campus drives)
3. Student AI Mock Interviews (Technical, HR, Mixed)
4. Recruiter Assigned Assessments
5. DSA & Aptitude Practice Submissions

Strictly enforces student data privacy, tenant isolation, and server-side authorization.
Never fabricates results, fakes scores, or leaks confidential evaluation keys.
"""

from typing import List, Dict, Any, Optional, Union
from datetime import datetime
from sqlalchemy.orm import Session, selectinload
import math

import models
import schemas


def _format_datetime_friendly(dt: Optional[datetime]) -> str:
    """Formats datetime into human-friendly format (e.g. 'Oct 13, 2026')."""
    if not dt:
        return "N/A"
    try:
        return dt.strftime("%b %d, %Y")
    except Exception:
        return str(dt)[:10]


def _format_time_ago(dt: Optional[datetime]) -> str:
    """Returns friendly relative time string (e.g. '2 hours ago')."""
    if not dt:
        return "Recently"
    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.utcnow()
    diff = now - dt
    seconds = diff.total_seconds()
    if seconds < 60:
        return "Just now"
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} min{'s' if minutes != 1 else ''} ago"
    hours = int(minutes // 60)
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = int(hours // 24)
    if days < 7:
        return f"{days} day{'s' if days != 1 else ''} ago"
    return dt.strftime("%b %d, %Y")


def _gather_raw_student_assessments(
    db: Session,
    profile: models.StudentProfile,
    current_user: Optional[models.User] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetches all assessment records belonging strictly to the authenticated student.
    Returns categorized raw normalized dictionaries.
    """
    records: List[Dict[str, Any]] = []

    # 1. RoleReady Sessions
    rr_sessions = db.query(models.RoleReadySession).options(
        selectinload(models.RoleReadySession.round_attempts)
    ).filter(
        models.RoleReadySession.student_profile_id == profile.id
    ).all()

    for s in rr_sessions:
        is_completed = s.current_state == models.RoleReadySessionState.COMPLETED or (
            s.overall_readiness_score > 0 and s.current_state not in (
                models.RoleReadySessionState.NOT_STARTED,
                models.RoleReadySessionState.ABANDONED
            )
        )
        is_in_progress = s.current_state not in (
            models.RoleReadySessionState.COMPLETED,
            models.RoleReadySessionState.ABANDONED,
            models.RoleReadySessionState.NOT_STARTED
        )
        status_label = "COMPLETED" if is_completed else ("IN_PROGRESS" if is_in_progress else "ABANDONED")
        
        # Build round summaries
        rounds_summary = []
        if s.round_attempts:
            for r in s.round_attempts:
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=r.round_order,
                    round_name=f"Round {r.round_order}: {r.round_type.title()}",
                    round_type=r.round_type,
                    score=round(float(r.score or 0.0), 1),
                    max_score=100.0,
                    status=r.status,
                    feedback=f"Time spent: {r.time_spent_seconds // 60} mins" if r.time_spent_seconds else None
                ))

        score_val = round(float(s.overall_readiness_score or 0.0), 1) if is_completed else None
        completed_date = s.completed_at or (s.updated_at if is_completed else None)

        duration = None
        if s.started_at and s.completed_at:
            duration = max(1, int((s.completed_at - s.started_at).total_seconds() // 60))

        records.append({
            "id": f"roleready_{s.session_uuid}",
            "raw_id": s.session_uuid,
            "internal_id": s.id,
            "test_name": f"{s.target_role or 'RoleReady'} Assessment",
            "category": "RoleReady Assessment",
            "category_key": "ROLEREADY",
            "status": status_label,
            "score": score_val,
            "max_score": 100.0,
            "percentage": score_val,
            "duration_minutes": duration,
            "started_at": s.started_at,
            "completed_at": completed_date,
            "created_at": s.created_at or datetime.utcnow(),
            "formatted_date": _format_datetime_friendly(completed_date or s.created_at),
            "rounds_summary": rounds_summary,
            "details_available": True,
            "view_url": f"/assessment/{s.session_uuid}/report" if is_completed else f"/assessment/{s.session_uuid}",
            "strengths": (s.final_report_data or {}).get("top_strengths", []),
            "weaknesses": (s.final_report_data or {}).get("critical_gaps", []),
            "recommendations": (s.final_report_data or {}).get("roadmap_focus", []),
            "report_url": f"/assessment/{s.session_uuid}/report" if is_completed else None,
            "raw_obj": s
        })

    # 2. Student Placement Simulations
    simulations = db.query(models.StudentPlacementSimulation).options(
        selectinload(models.StudentPlacementSimulation.rounds)
    ).filter(
        models.StudentPlacementSimulation.student_profile_id == profile.id
    ).all()

    for sim in simulations:
        is_completed = sim.status == "COMPLETED"
        is_in_progress = sim.status == "IN_PROGRESS"
        status_label = "COMPLETED" if is_completed else ("IN_PROGRESS" if is_in_progress else "ABANDONED")

        rounds_summary = []
        if sim.rounds:
            for r in sorted(sim.rounds, key=lambda x: x.round_number):
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=r.round_number,
                    round_name=f"Round {r.round_number}: {r.round_type.replace('_', ' ').title()}",
                    round_type=r.round_type,
                    score=round(float(r.score or 0.0), 1),
                    max_score=100.0,
                    status=r.status,
                    feedback=r.feedback
                ))
        else:
            # Fallback to column scores if rounds table is empty
            if sim.aptitude_score > 0:
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=1, round_name="Round 1: Aptitude", round_type="APTITUDE",
                    score=round(float(sim.aptitude_score), 1), status="COMPLETED"
                ))
            if sim.coding_score > 0:
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=2, round_name="Round 2: Coding", round_type="CODING",
                    score=round(float(sim.coding_score), 1), status="COMPLETED"
                ))
            if sim.technical_interview_score > 0:
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=3, round_name="Round 3: Tech Interview", round_type="TECHNICAL_INTERVIEW",
                    score=round(float(sim.technical_interview_score), 1), status="COMPLETED"
                ))
            if sim.hr_interview_score > 0:
                rounds_summary.append(schemas.AssessmentRoundSummary(
                    round_number=4, round_name="Round 4: HR Interview", round_type="HR_INTERVIEW",
                    score=round(float(sim.hr_interview_score), 1), status="COMPLETED"
                ))

        score_val = round(float(sim.overall_score or 0.0), 1) if is_completed else None
        completed_date = sim.completed_at or (sim.created_at if is_completed else None)

        records.append({
            "id": f"sim_{sim.id}",
            "raw_id": sim.id,
            "internal_id": sim.id,
            "test_name": f"{sim.target_role or 'Campus'} Placement Simulation",
            "category": "Placement Simulation",
            "category_key": "SIMULATION",
            "status": status_label,
            "score": score_val,
            "max_score": 100.0,
            "percentage": score_val,
            "duration_minutes": 90 if is_completed else None,
            "started_at": sim.created_at,
            "completed_at": completed_date,
            "created_at": sim.created_at or datetime.utcnow(),
            "formatted_date": _format_datetime_friendly(completed_date or sim.created_at),
            "rounds_summary": rounds_summary,
            "details_available": True,
            "view_url": "/student/simulation",
            "strengths": sim.strengths or [],
            "weaknesses": sim.weaknesses or [],
            "recommendations": sim.recommendations or [],
            "report_summary": sim.report_summary,
            "raw_obj": sim
        })

    # 3. Student Mock Interviews
    interviews = db.query(models.StudentMockInterview).filter(
        models.StudentMockInterview.student_profile_id == profile.id
    ).all()

    for inter in interviews:
        is_completed = inter.status == "COMPLETED"
        is_in_progress = inter.status == "IN_PROGRESS"
        status_label = "COMPLETED" if is_completed else ("IN_PROGRESS" if is_in_progress else "ABANDONED")

        score_val = round(float(inter.overall_score or 0.0), 1) if is_completed else None
        completed_date = inter.completed_at or (inter.created_at if is_completed else None)

        rounds_summary = []
        if inter.technical_accuracy_score > 0:
            rounds_summary.append(schemas.AssessmentRoundSummary(
                round_number=1,
                round_name="Technical Accuracy",
                round_type="TECHNICAL",
                score=round(float(inter.technical_accuracy_score), 1),
                status="COMPLETED"
            ))
        if inter.star_structure_score > 0:
            rounds_summary.append(schemas.AssessmentRoundSummary(
                round_number=2,
                round_name="STAR Communication Structure",
                round_type="COMMUNICATION",
                score=round(float(inter.star_structure_score), 1),
                status="COMPLETED"
            ))

        records.append({
            "id": f"interview_{inter.id}",
            "raw_id": inter.id,
            "internal_id": inter.id,
            "test_name": f"{inter.interview_type.title()} AI Mock Interview",
            "category": "AI Mock Interview",
            "category_key": "MOCK_INTERVIEW",
            "status": status_label,
            "score": score_val,
            "max_score": 100.0,
            "percentage": score_val,
            "duration_minutes": 25 if is_completed else None,
            "started_at": inter.created_at,
            "completed_at": completed_date,
            "created_at": inter.created_at or datetime.utcnow(),
            "formatted_date": _format_datetime_friendly(completed_date or inter.created_at),
            "rounds_summary": rounds_summary,
            "details_available": True,
            "view_url": "/student/interview",
            "strengths": inter.strengths or [],
            "weaknesses": inter.areas_to_improve or [],
            "recommendations": [inter.feedback_summary] if inter.feedback_summary else [],
            "report_summary": inter.feedback_summary,
            "raw_obj": inter
        })

    # 4. Assigned Assessments (models.Assessment)
    assigned_query = db.query(models.Assessment).filter(
        models.Assessment.candidate_email == profile.email
    )
    if profile.user_id:
        assigned_query = db.query(models.Assessment).filter(
            (models.Assessment.candidate_email == profile.email) |
            (models.Assessment.user_id == profile.user_id)
        )
    assigned = assigned_query.all()

    for a in assigned:
        is_completed = a.status == "completed"
        is_in_progress = a.status in ("in_progress", "pending")
        status_label = "COMPLETED" if is_completed else ("IN_PROGRESS" if is_in_progress else "FAILED")

        score_val = round(float(a.score or 0.0), 1) if is_completed else None
        completed_date = a.updated_at if is_completed else None

        records.append({
            "id": f"assigned_{a.id}",
            "raw_id": a.id,
            "internal_id": a.id,
            "test_name": f"Campus Recruiter {a.type.title()} Assessment",
            "category": "Assigned Assessment",
            "category_key": "ASSIGNED",
            "status": status_label,
            "score": score_val,
            "max_score": 100.0,
            "percentage": score_val,
            "duration_minutes": 45 if is_completed else None,
            "started_at": a.started_at or a.created_at,
            "completed_at": completed_date,
            "created_at": a.created_at or datetime.utcnow(),
            "formatted_date": _format_datetime_friendly(completed_date or a.created_at),
            "rounds_summary": [
                schemas.AssessmentRoundSummary(
                    round_number=1,
                    round_name=f"{a.type.title()} Round",
                    round_type=a.type.upper(),
                    score=score_val or 0.0,
                    status="COMPLETED" if is_completed else "PENDING"
                )
            ],
            "details_available": is_completed,
            "view_url": f"/assessment/{a.id}" if is_in_progress else None,
            "strengths": (a.analysis_data or {}).get("strengths", []),
            "weaknesses": (a.analysis_data or {}).get("weaknesses", []),
            "recommendations": (a.analysis_data or {}).get("recommendations", []),
            "raw_obj": a
        })

    return {"all_records": records}


def get_student_performance_dashboard(
    db: Session,
    profile: models.StudentProfile,
    current_user: Optional[models.User] = None
) -> schemas.StudentPerformanceDashboardResponse:
    """
    Computes complete dashboard analytics for the authenticated student:
    - Overview & Activity Status
    - Summary Cards (Total Completed, True Average, Best Performance with context, In Progress)
    - Chronological Performance Trends (Recharts ready)
    - Evaluated Skills Proficiency vs Resume Estimates
    - Actionable Recommended Next Steps
    - Real Activity Stream
    """
    data = _gather_raw_student_assessments(db, profile, current_user)
    all_records = data["all_records"]

    completed = [r for r in all_records if r["status"] == "COMPLETED" and r["score"] is not None]
    in_progress = [r for r in all_records if r["status"] == "IN_PROGRESS"]

    # --- 1. SUMMARY CARDS ---
    total_completed = len(completed)
    avg_score = None
    if total_completed > 0:
        avg_score = round(sum(r["score"] for r in completed) / total_completed, 1)

    best_perf = None
    if total_completed > 0:
        best_item = max(
            completed,
            key=lambda x: (x["score"], x["completed_at"] or x["created_at"])
        )
        best_perf = schemas.BestPerformanceInfo(
            score=best_item["score"],
            max_score=100.0,
            percentage=best_item["score"],
            test_name=best_item["test_name"],
            category=best_item["category"],
            category_key=best_item["category_key"],
            completed_at=best_item["completed_at"],
            formatted_date=best_item["formatted_date"],
            id=best_item["id"]
        )

    # Improvement rate calculation (chronological split)
    improvement_rate = None
    if total_completed >= 2:
        chronological_tests = sorted(
            completed,
            key=lambda x: x["completed_at"] or x["created_at"]
        )
        mid = len(chronological_tests) // 2
        earlier_half = chronological_tests[:mid]
        recent_half = chronological_tests[mid:]
        
        avg_earlier = sum(t["score"] for t in earlier_half) / len(earlier_half)
        avg_recent = sum(t["score"] for t in recent_half) / len(recent_half)
        improvement_rate = round(avg_recent - avg_earlier, 1)

    summary = schemas.StudentPerformanceSummary(
        total_tests_completed=total_completed,
        average_score=avg_score,
        best_performance=best_perf,
        tests_in_progress=len(in_progress),
        improvement_rate=improvement_rate
    )

    # --- 2. PERFORMANCE TRENDS ---
    chronological = sorted(
        completed,
        key=lambda x: x["completed_at"] or x["created_at"]
    )
    trend_points: List[schemas.StudentPerformanceTrendPoint] = []
    for t in chronological:
        trend_points.append(schemas.StudentPerformanceTrendPoint(
            id=t["id"],
            test_name=t["test_name"],
            category=t["category"],
            category_key=t["category_key"],
            score=t["score"],
            max_score=100.0,
            percentage=t["score"],
            date=t["completed_at"] or t["created_at"],
            formatted_date=t["formatted_date"]
        ))

    if total_completed == 0:
        trend_status = "insufficient_data"
        trend_message = "No completed assessments yet. Complete a test or simulation to establish your performance trajectory."
    elif total_completed == 1:
        trend_status = "insufficient_data"
        trend_message = f"1 assessment completed with a score of {completed[0]['score']}%. Complete additional tests to track your progress trend."
    else:
        if improvement_rate is not None and improvement_rate > 2.0:
            trend_status = "improving"
            trend_message = f"+{improvement_rate}% improvement across recent assessments. Your preparation is yielding higher benchmark scores."
        elif improvement_rate is not None and improvement_rate < -2.0:
            trend_status = "declining"
            trend_message = f"{improvement_rate}% score delta in recent attempts. Target identified weak skills to regain momentum."
        else:
            trend_status = "stable"
            trend_message = "Consistent score trajectory across your assessment history."

    trends = schemas.StudentPerformanceTrends(
        trend_status=trend_status,
        trend_message=trend_message,
        data_points=trend_points
    )

    # --- 3. SKILLS & STRENGTHS ANALYSIS ---
    # Aggregate skill performance from test rounds and practice attempts
    skill_scores_map: Dict[str, List[float]] = {}

    for t in completed:
        for r in t["rounds_summary"]:
            if r.score > 0:
                skill_name = r.round_type.replace('_', ' ').title()
                if "Aptitude" in skill_name:
                    skill_name = "Quantitative Aptitude"
                elif "Coding" in skill_name:
                    skill_name = "Data Structures & Algorithms"
                elif "Technical" in skill_name:
                    skill_name = "System Architecture & Core CS"
                elif "Communication" in skill_name or "Hr" in skill_name:
                    skill_name = "Technical Communication"
                
                skill_scores_map.setdefault(skill_name, []).append(r.score)

    # Add practice attempt metrics
    practice_attempts = db.query(models.StudentPracticeAttempt).filter(
        models.StudentPracticeAttempt.student_profile_id == profile.id
    ).all()

    for p in practice_attempts:
        if p.topic:
            topic_clean = p.topic.title()
            p_score = 100.0 if p.is_correct else (
                (p.tests_passed / p.total_tests * 100.0) if p.total_tests and p.total_tests > 0 else 0.0
            )
            skill_scores_map.setdefault(topic_clean, []).append(p_score)

    assessment_skills: List[schemas.StudentPerformanceSkill] = []
    for skill_name, scores in skill_scores_map.items():
        if scores:
            avg_skill_score = round(sum(scores) / len(scores), 1)
            level = "Proficient" if avg_skill_score >= 75.0 else ("Developing" if avg_skill_score >= 50.0 else "Needs Focus")
            assessment_skills.append(schemas.StudentPerformanceSkill(
                skill=skill_name,
                score=avg_skill_score,
                tests_count=len(scores),
                level=level,
                source="assessment"
            ))

    assessment_skills.sort(key=lambda s: s.score, reverse=True)
    strongest = [s for s in assessment_skills if s.score >= 50.0][:4]
    needing_improvement = [s for s in assessment_skills if s.score < 65.0][:4]
    if not needing_improvement and len(assessment_skills) > 1:
        needing_improvement = assessment_skills[-2:]

    skills_analysis = schemas.StudentPerformanceSkillsAnalysis(
        assessment_skills=assessment_skills,
        resume_skills=profile.current_skills or [],
        strongest_skills=strongest,
        areas_needing_improvement=needing_improvement,
        has_evaluation_data=len(assessment_skills) > 0
    )

    # --- 4. RECOMMENDED NEXT STEPS ---
    next_steps: List[schemas.StudentPerformanceNextStep] = []

    # Priority 1: In-progress assessment
    if in_progress:
        first_ip = in_progress[0]
        next_steps.append(schemas.StudentPerformanceNextStep(
            id="step_resume_active",
            title=f"Complete Active {first_ip['category']}",
            description=f"You have an ongoing {first_ip['test_name']}. Finish all rounds to finalize your scorecard and readiness analytics.",
            category="assessment",
            action_url=first_ip["view_url"] or "/student/simulation",
            action_label="Resume Test",
            priority="high"
        ))

    # Priority 2: Weak skill practice
    if needing_improvement:
        weakest = needing_improvement[0]
        next_steps.append(schemas.StudentPerformanceNextStep(
            id=f"step_practice_{weakest.skill.lower().replace(' ', '_')}",
            title=f"Practice {weakest.skill}",
            description=f"Your evaluated performance in {weakest.skill} is {weakest.score}%. Solve targeted practice questions to boost this dimension.",
            category="practice",
            action_url="/student/practice",
            action_label="Solve Problems",
            priority="high"
        ))

    # Priority 3: Roadmap tasks
    pending_tasks_count = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.student_profile_id == profile.id,
        models.StudentDailyTask.status == "PENDING"
    ).count()

    if pending_tasks_count > 0:
        next_steps.append(schemas.StudentPerformanceNextStep(
            id="step_continue_roadmap",
            title="Advance Daily Preparation Plan",
            description=f"You have {pending_tasks_count} pending roadmap task{'s' if pending_tasks_count != 1 else ''} scheduled for your target role.",
            category="roadmap",
            action_url="/student/roadmap",
            action_label="Open Roadmap",
            priority="medium"
        ))

    # Priority 4: Mock interview
    has_interview = any(r["category_key"] == "MOCK_INTERVIEW" for r in completed)
    if not has_interview:
        next_steps.append(schemas.StudentPerformanceNextStep(
            id="step_take_interview",
            title="Conduct Technical AI Mock Interview",
            description="Practice STAR-method answering and technical architecture defense with instant automated grading.",
            category="interview",
            action_url="/student/interview",
            action_label="Start Interview",
            priority="medium"
        ))

    # Priority 5: Placement simulation
    has_simulation = any(r["category_key"] == "SIMULATION" for r in completed)
    if not has_simulation:
        next_steps.append(schemas.StudentPerformanceNextStep(
            id="step_take_simulation",
            title="Simulate 4-Round Campus Drive",
            description="Test your readiness end-to-end across Aptitude, Coding, Technical, and HR rounds under timed conditions.",
            category="simulation",
            action_url="/student/simulation",
            action_label="Simulate Drive",
            priority="medium"
        ))

    # --- 5. RECENT ACTIVITY ---
    activities: List[Dict[str, Any]] = []

    # Test completions and starts
    for r in all_records[:8]:
        act_status = "Completed" if r["status"] == "COMPLETED" else "In Progress"
        activities.append({
            "id": f"act_test_{r['id']}",
            "type": "assessment",
            "title": f"{r['test_name']} {act_status}",
            "description": f"Score: {r['score']}% • {r['category']}" if r['score'] is not None else f"{r['category']} in progress",
            "score": r["score"],
            "status": r["status"],
            "timestamp": r["completed_at"] or r["created_at"],
            "formatted_time": _format_time_ago(r["completed_at"] or r["created_at"])
        })

    # Practice submissions
    recent_practice = db.query(models.StudentPracticeAttempt).filter(
        models.StudentPracticeAttempt.student_profile_id == profile.id
    ).order_by(models.StudentPracticeAttempt.created_at.desc()).limit(5).all()

    for p in recent_practice:
        activities.append({
            "id": f"act_prac_{p.id}",
            "type": "practice",
            "title": f"Practice Problem: {p.topic.title() if p.topic else 'Exercise'}",
            "description": f"{'Correctly Solved' if p.is_correct else 'Attempted'} • {p.category}",
            "score": 100.0 if p.is_correct else 0.0,
            "status": "COMPLETED" if p.is_correct else "ATTEMPTED",
            "timestamp": p.created_at,
            "formatted_time": _format_time_ago(p.created_at)
        })

    # Roadmap task completions
    recent_tasks = db.query(models.StudentDailyTask).filter(
        models.StudentDailyTask.student_profile_id == profile.id,
        models.StudentDailyTask.status == "COMPLETED"
    ).order_by(models.StudentDailyTask.completed_at.desc()).limit(3).all()

    for t in recent_tasks:
        activities.append({
            "id": f"act_task_{t.id}",
            "type": "roadmap",
            "title": f"Roadmap Task: {t.title}",
            "description": f"Completed {t.category.replace('_', ' ').title()} milestone",
            "score": None,
            "status": "COMPLETED",
            "timestamp": t.completed_at or t.updated_at or t.created_at,
            "formatted_time": _format_time_ago(t.completed_at or t.updated_at or t.created_at)
        })

    # Sort all activity items descending by timestamp
    activities.sort(key=lambda x: x["timestamp"] or datetime.min, reverse=True)
    activity_items = [
        schemas.StudentPerformanceActivity(
            id=a["id"],
            type=a["type"],
            title=a["title"],
            description=a["description"],
            score=a["score"],
            status=a["status"],
            timestamp=a["timestamp"] or datetime.utcnow(),
            formatted_time=a["formatted_time"]
        ) for a in activities[:10]
    ]

    # --- 6. OVERVIEW ---
    active_test_msg = None
    if in_progress:
        first_ip = in_progress[0]
        active_test_msg = f"You have 1 active assessment in progress ({first_ip['test_name']})."

    overview = schemas.StudentPerformanceOverview(
        student_name=profile.full_name or "Student",
        email=profile.email,
        target_role=profile.target_role,
        target_company=profile.target_company,
        readiness_score=round(float(profile.readiness_score or 0.0), 1),
        pending_tests_count=len(in_progress),
        completed_tests_count=total_completed,
        has_active_test=len(in_progress) > 0,
        active_test_message=active_test_msg
    )

    return schemas.StudentPerformanceDashboardResponse(
        overview=overview,
        summary=summary,
        trends=trends,
        skills_analysis=skills_analysis,
        recommended_next_steps=next_steps,
        recent_activity=activity_items
    )


def get_student_assessment_history(
    db: Session,
    profile: models.StudentProfile,
    current_user: Optional[models.User] = None,
    category: Optional[str] = "ALL",
    status: Optional[str] = "ALL",
    sort_by: Optional[str] = "date_desc",
    page: int = 1,
    page_size: int = 10
) -> schemas.StudentAssessmentHistoryResponse:
    """
    Returns filtered, sorted, paginated assessment history for the student.
    Enforces student-level ownership.
    """
    data = _gather_raw_student_assessments(db, profile, current_user)
    items = data["all_records"]

    # Filter by category
    if category and category.upper() != "ALL":
        cat_upper = category.upper()
        items = [i for i in items if i["category_key"] == cat_upper]

    # Filter by status
    if status and status.upper() != "ALL":
        status_upper = status.upper()
        items = [i for i in items if i["status"] == status_upper]

    # Sorting
    if sort_by == "date_asc":
        items.sort(key=lambda x: x["completed_at"] or x["created_at"] or datetime.min)
    elif sort_by == "score_desc":
        items.sort(key=lambda x: (x["score"] is not None, x["score"] or 0.0), reverse=True)
    elif sort_by == "score_asc":
        items.sort(key=lambda x: (x["score"] is None, x["score"] or 0.0))
    else:  # date_desc default
        items.sort(key=lambda x: x["completed_at"] or x["created_at"] or datetime.min, reverse=True)

    total_count = len(items)
    total_pages = max(1, math.ceil(total_count / page_size)) if total_count > 0 else 1
    safe_page = max(1, min(page, total_pages))

    start_idx = (safe_page - 1) * page_size
    end_idx = start_idx + page_size
    paged_items = items[start_idx:end_idx]

    history_items = [
        schemas.StudentAssessmentHistoryItem(
            id=i["id"],
            raw_id=i["raw_id"],
            test_name=i["test_name"],
            category=i["category"],
            category_key=i["category_key"],
            status=i["status"],
            score=i["score"],
            max_score=i["max_score"],
            percentage=i["percentage"],
            duration_minutes=i["duration_minutes"],
            completed_at=i["completed_at"],
            formatted_date=i["formatted_date"],
            created_at=i["created_at"],
            rounds_summary=i["rounds_summary"],
            details_available=i["details_available"],
            view_url=i["view_url"]
        ) for i in paged_items
    ]

    return schemas.StudentAssessmentHistoryResponse(
        total_count=total_count,
        page=safe_page,
        page_size=page_size,
        total_pages=total_pages,
        items=history_items
    )


def get_student_assessment_detail(
    db: Session,
    profile: models.StudentProfile,
    assessment_type: str,
    assessment_id: Union[int, str]
) -> schemas.StudentAssessmentDetailResponse:
    """
    Returns sanitized, detailed assessment results for an authorized student.
    Hides internal test keys, raw prompts, and private evaluation data.
    """
    type_upper = assessment_type.upper()

    if type_upper in ("ROLEREADY", "ROLE_READY"):
        session = db.query(models.RoleReadySession).filter(
            models.RoleReadySession.session_uuid == str(assessment_id),
            models.RoleReadySession.student_profile_id == profile.id
        ).first()

        if not session:
            raise KeyError("RoleReady assessment not found or unauthorized access.")

        is_completed = session.current_state == models.RoleReadySessionState.COMPLETED
        round_details = []
        for r in session.round_attempts:
            round_details.append(schemas.AssessmentRoundSummary(
                round_number=r.round_order,
                round_name=f"Round {r.round_order}: {r.round_type.title()}",
                round_type=r.round_type,
                score=round(float(r.score or 0.0), 1),
                max_score=100.0,
                status=r.status,
                feedback=(r.evaluation_payload or {}).get("feedback") if r.evaluation_payload else None
            ))

        final_data = session.final_report_data or {}
        duration = None
        if session.started_at and session.completed_at:
            duration = max(1, int((session.completed_at - session.started_at).total_seconds() // 60))

        return schemas.StudentAssessmentDetailResponse(
            id=f"roleready_{session.session_uuid}",
            raw_id=session.session_uuid,
            test_name=f"{session.target_role or 'RoleReady'} Assessment",
            category="RoleReady Assessment",
            category_key="ROLEREADY",
            status="COMPLETED" if is_completed else "IN_PROGRESS",
            overall_score=round(float(session.overall_readiness_score or 0.0), 1) if is_completed else None,
            max_score=100.0,
            percentage=round(float(session.overall_readiness_score or 0.0), 1) if is_completed else None,
            duration_minutes=duration,
            started_at=session.started_at,
            completed_at=session.completed_at,
            formatted_date=_format_datetime_friendly(session.completed_at or session.created_at),
            round_details=round_details,
            strengths=final_data.get("top_strengths", []),
            weaknesses=final_data.get("critical_gaps", []),
            recommendations=final_data.get("roadmap_focus", []),
            evaluation_summary=final_data.get("executive_summary"),
            report_url=f"/assessment/{session.session_uuid}/report" if is_completed else None
        )

    elif type_upper == "SIMULATION":
        sim = db.query(models.StudentPlacementSimulation).filter(
            models.StudentPlacementSimulation.id == int(assessment_id),
            models.StudentPlacementSimulation.student_profile_id == profile.id
        ).first()

        if not sim:
            raise KeyError("Placement simulation not found or unauthorized access.")

        round_details = []
        if sim.rounds:
            for r in sorted(sim.rounds, key=lambda x: x.round_number):
                round_details.append(schemas.AssessmentRoundSummary(
                    round_number=r.round_number,
                    round_name=f"Round {r.round_number}: {r.round_type.replace('_', ' ').title()}",
                    round_type=r.round_type,
                    score=round(float(r.score or 0.0), 1),
                    max_score=100.0,
                    status=r.status,
                    feedback=r.feedback
                ))

        is_completed = sim.status == "COMPLETED"
        return schemas.StudentAssessmentDetailResponse(
            id=f"sim_{sim.id}",
            raw_id=sim.id,
            test_name=f"{sim.target_role or 'Campus'} Placement Simulation",
            category="Placement Simulation",
            category_key="SIMULATION",
            status=sim.status,
            overall_score=round(float(sim.overall_score or 0.0), 1) if is_completed else None,
            max_score=100.0,
            percentage=round(float(sim.overall_score or 0.0), 1) if is_completed else None,
            duration_minutes=90 if is_completed else None,
            started_at=sim.created_at,
            completed_at=sim.completed_at,
            formatted_date=_format_datetime_friendly(sim.completed_at or sim.created_at),
            round_details=round_details,
            strengths=sim.strengths or [],
            weaknesses=sim.weaknesses or [],
            recommendations=sim.recommendations or [],
            evaluation_summary=sim.report_summary
        )

    elif type_upper in ("MOCK_INTERVIEW", "INTERVIEW"):
        interview = db.query(models.StudentMockInterview).filter(
            models.StudentMockInterview.id == int(assessment_id),
            models.StudentMockInterview.student_profile_id == profile.id
        ).first()

        if not interview:
            raise KeyError("Mock interview not found or unauthorized access.")

        is_completed = interview.status == "COMPLETED"
        round_details = [
            schemas.AssessmentRoundSummary(
                round_number=1,
                round_name="Technical Accuracy",
                round_type="TECHNICAL",
                score=round(float(interview.technical_accuracy_score or 0.0), 1),
                status="COMPLETED"
            ),
            schemas.AssessmentRoundSummary(
                round_number=2,
                round_name="STAR Communication Structure",
                round_type="COMMUNICATION",
                score=round(float(interview.star_structure_score or 0.0), 1),
                status="COMPLETED"
            )
        ]

        return schemas.StudentAssessmentDetailResponse(
            id=f"interview_{interview.id}",
            raw_id=interview.id,
            test_name=f"{interview.interview_type.title()} AI Mock Interview",
            category="AI Mock Interview",
            category_key="MOCK_INTERVIEW",
            status=interview.status,
            overall_score=round(float(interview.overall_score or 0.0), 1) if is_completed else None,
            max_score=100.0,
            percentage=round(float(interview.overall_score or 0.0), 1) if is_completed else None,
            duration_minutes=25 if is_completed else None,
            started_at=interview.created_at,
            completed_at=interview.completed_at,
            formatted_date=_format_datetime_friendly(interview.completed_at or interview.created_at),
            round_details=round_details,
            strengths=interview.strengths or [],
            weaknesses=interview.areas_to_improve or [],
            recommendations=[interview.feedback_summary] if interview.feedback_summary else [],
            evaluation_summary=interview.feedback_summary
        )

    else:
        raise ValueError(f"Unsupported assessment type: {assessment_type}")
