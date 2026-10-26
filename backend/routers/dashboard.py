from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import schemas, models, database
from routers.auth import get_current_user

router = APIRouter(
    prefix="/api/dashboard",
    tags=["dashboard"]
)

def _get_tenant_org_id(current_user: models.User, db: Session) -> Optional[int]:
    if getattr(current_user, "organization_id", None):
        return current_user.organization_id
    
    member = None
    if hasattr(current_user, "id") and current_user.id:
        member = db.query(models.OrganizationMember).filter(
            models.OrganizationMember.user_id == current_user.id,
            models.OrganizationMember.status == "active"
        ).first()

    if member:
        return member.organization_id

    return None

@router.get("/activity/", response_model=List[schemas.ActivityLogResponse])
def get_activity_log(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.ActivityLog)
    if org_id:
        query = query.filter(models.ActivityLog.organization_id == org_id)
    else:
        query = query.filter(models.ActivityLog.user_id == current_user.id)
    return query.order_by(models.ActivityLog.timestamp.desc()).limit(20).all()

@router.get("/insights/")
def get_insights(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    else:
        query = query.filter(models.Candidate.created_by == current_user.id)
    candidates = query.all()

    high_score_count = sum(1 for c in candidates if c.score > 80)

    alerts = []
    if high_score_count > 0:
        alerts.append({
            "id": 1,
            "type": "success",
            "message": f"{high_score_count} Top Candidates identified with score > 80."
        })

    return alerts

@router.get("/notifications/")
def get_notifications(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Return unread activity logs belonging to user or organization
    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.ActivityLog).filter(models.ActivityLog.is_read == False)
    if org_id:
        query = query.filter(
            (models.ActivityLog.organization_id == org_id) | (models.ActivityLog.user_id == current_user.id)
        )
    else:
        query = query.filter(models.ActivityLog.user_id == current_user.id)
    return query.order_by(models.ActivityLog.timestamp.desc()).all()

@router.put("/notifications/{id}/read")
def mark_notification_read(
    id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    note = db.query(models.ActivityLog).filter(
        models.ActivityLog.id == id
    ).first()
    if note:
        note.is_read = True
        db.commit()
    return {"status": "success"}

# --- Comprehensive Analytics Endpoint ---

@router.get("/analytics/", response_model=schemas.AnalyticsDashboardResponse)
def get_analytics(
    role: Optional[str] = None,
    days: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Recruitment Intelligence aggregated analytics derived strictly from real database records.
    Scoped strictly to the authenticated tenant organization.
    """
    from datetime import datetime, timezone, timedelta
    import statistics

    org_id = _get_tenant_org_id(current_user, db)
    query = db.query(models.Candidate)
    if org_id:
        query = query.filter(models.Candidate.organization_id == org_id)
    elif getattr(current_user, "role", None) != models.UserRole.PLATFORM_ADMIN:
        query = query.filter(models.Candidate.created_by == current_user.id)

    # 1. Role Filter
    if role and role.strip() and role != "All Roles":
        query = query.filter(models.Candidate.role == role.strip())

    # 2. Date Filter
    now = datetime.now(timezone.utc)
    date_label = "All Time"

    if days and days > 0:
        cutoff = now - timedelta(days=days)
        query = query.filter(models.Candidate.created_at >= cutoff)
        date_label = f"Last {days} Days" if days > 1 else "Today"
    elif start_date:
        try:
            s_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            query = query.filter(models.Candidate.created_at >= s_dt)
            date_label = f"From {start_date[:10]}"
        except Exception:
            pass
        if end_date:
            try:
                e_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
                query = query.filter(models.Candidate.created_at <= e_dt)
                date_label += f" to {end_date[:10]}"
            except Exception:
                pass

    candidates = query.all()
    total_applicants = len(candidates)

    # Helper: calculate effective candidate score
    def compute_effective_score(cand):
        scores = []
        if cand.score is not None and cand.score > 0:
            scores.append(cand.score)
        
        adata = cand.analysis_data or {}
        if isinstance(adata, dict):
            # Aptitude score
            if "score_percentage" in adata and adata["score_percentage"] is not None:
                scores.append(float(adata["score_percentage"]))
            elif "correct" in adata and "total" in adata and adata.get("total", 0) > 0:
                scores.append((float(adata["correct"]) / float(adata["total"])) * 100.0)
            
            # Coding score
            if "passed" in adata and "total" in adata and adata.get("total", 0) > 0:
                scores.append((float(adata["passed"]) / float(adata["total"])) * 100.0)
            elif "score" in adata and adata["score"] is not None and float(adata["score"]) > 0:
                scores.append(float(adata["score"]))
                
            # Interview score
            if "interview" in adata and isinstance(adata["interview"], dict):
                int_score = adata["interview"].get("score")
                if int_score is not None and float(int_score) > 0:
                    scores.append(float(int_score))

        if not scores:
            return float(cand.score or 0.0)
        return round(sum(scores) / len(scores), 1)

    # Scores list
    candidate_effective_scores = [
        {"cand": c, "score": compute_effective_score(c)} for c in candidates
    ]
    all_scores = [item["score"] for item in candidate_effective_scores if item["score"] > 0]
    avg_talent_score = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0.0

    # Active pipeline & Hired counts
    active_stages = [
        models.CandidateStage.Resume_Screening.value,
        "Screened Candidates",
        models.CandidateStage.Aptitude_Round.value,
        models.CandidateStage.Coding_Round.value,
        models.CandidateStage.Technical_Interview.value,
        models.CandidateStage.HR_Round.value
    ]
    active_pipeline = sum(
        1 for c in candidates 
        if c.stage in active_stages and c.status != models.CandidateStatus.Rejected.value
    )
    hired_count = sum(
        1 for c in candidates 
        if (c.status == models.CandidateStatus.Hired.value or c.stage == "Hired" or c.stage == models.CandidateStage.Offer_Sent.value)
    )
    placement_rate = round((hired_count / total_applicants * 100.0), 1) if total_applicants > 0 else 0.0

    # Pipeline Health score
    if total_applicants == 0:
        health_score = 0.0
        health_status = "No Data"
    else:
        # Evaluated candidates ratio
        evaluated_ratio = len(all_scores) / total_applicants
        # Passing candidates ratio
        passing_ratio = sum(1 for s in all_scores if s >= 60.0) / len(all_scores) if all_scores else 0.0
        # Active conversion ratio
        conversion_ratio = (total_applicants - sum(1 for c in candidates if c.status == models.CandidateStatus.Rejected.value)) / total_applicants
        
        health_score = round(((evaluated_ratio * 0.3) + (passing_ratio * 0.4) + (conversion_ratio * 0.3)) * 100.0, 1)
        if health_score >= 70.0:
            health_status = "Healthy"
        elif health_score >= 50.0:
            health_status = "Fair"
        else:
            health_status = "Needs Attention"

    kpi = schemas.AnalyticsKpi(
        total_applicants=total_applicants,
        active_pipeline=active_pipeline,
        avg_talent_score=avg_talent_score,
        placement_rate=placement_rate,
        pipeline_health_score=health_score,
        pipeline_health_status=health_status
    )

    # 3. Funnel Stages Breakdown
    funnel_stages = [
        "Resume Screening",
        "Aptitude Round",
        "Coding Round",
        "Technical Interview",
        "Offer Sent",
        "Hired"
    ]
    # Count of candidates currently in each stage
    stage_counts = {s: 0 for s in funnel_stages}
    for c in candidates:
        stg = c.stage or "Resume Screening"
        if stg in stage_counts:
            stage_counts[stg] += 1
        elif stg == "Screened Candidates":
            stage_counts["Resume Screening"] += 1

    funnel = []
    prev_count = total_applicants
    for stg in funnel_stages:
        cnt = stage_counts[stg]
        conv_rate = round((cnt / prev_count * 100.0), 1) if prev_count > 0 else 0.0
        drop_rate = round(100.0 - conv_rate, 1) if prev_count > 0 else 0.0
        funnel.append(schemas.FunnelStageMetric(
            name=stg,
            count=cnt,
            conversion_rate=conv_rate,
            drop_off_rate=drop_rate
        ))
        prev_count = cnt if cnt > 0 else prev_count

    # 4. AI Recommendation Breakdown
    rec_counts = {
        "Strongly Recommend": 0,
        "Recommend": 0,
        "Borderline": 0,
        "Not Recommended": 0
    }
    for item in candidate_effective_scores:
        sc = item["score"]
        if sc >= 85.0:
            rec_counts["Strongly Recommend"] += 1
        elif sc >= 70.0:
            rec_counts["Recommend"] += 1
        elif sc >= 50.0:
            rec_counts["Borderline"] += 1
        else:
            rec_counts["Not Recommended"] += 1

    rec_colors = {
        "Strongly Recommend": "#2f4816",
        "Recommend": "#5d8c2c",
        "Borderline": "#f59e0b",
        "Not Recommended": "#ef4444"
    }
    ai_recommendations = [
        schemas.AiRecommendationMetric(
            name=name,
            count=cnt,
            percentage=round((cnt / total_applicants * 100.0), 1) if total_applicants > 0 else 0.0,
            color=rec_colors[name]
        )
        for name, cnt in rec_counts.items()
    ]

    # 5. Round Performance
    rounds_meta = [
        {"name": "Resume Screening", "field": "resume"},
        {"name": "Aptitude Round", "field": "aptitude"},
        {"name": "Coding Round", "field": "coding"},
        {"name": "Technical Interview", "field": "interview"}
    ]
    round_performance = []
    for r in rounds_meta:
        r_scores = []
        comp_count = 0
        pend_count = 0
        cand_count = 0

        for c in candidates:
            adata = c.analysis_data or {}
            sc = None
            if r["field"] == "resume":
                cand_count += 1
                if c.score and c.score > 0:
                    sc = float(c.score)
                    comp_count += 1
                else:
                    pend_count += 1
            elif r["field"] == "aptitude":
                if c.stage in [models.CandidateStage.Aptitude_Round.value, models.CandidateStage.Coding_Round.value, models.CandidateStage.Technical_Interview.value, "Offer Sent", "Hired"]:
                    cand_count += 1
                    if "score_percentage" in adata:
                        sc = float(adata["score_percentage"])
                        comp_count += 1
                    elif "correct" in adata and "total" in adata and adata["total"] > 0:
                        sc = (float(adata["correct"]) / float(adata["total"])) * 100.0
                        comp_count += 1
                    else:
                        pend_count += 1
            elif r["field"] == "coding":
                if c.stage in [models.CandidateStage.Coding_Round.value, models.CandidateStage.Technical_Interview.value, "Offer Sent", "Hired"]:
                    cand_count += 1
                    if "passed" in adata and "total" in adata and adata["total"] > 0:
                        sc = (float(adata["passed"]) / float(adata["total"])) * 100.0
                        comp_count += 1
                    elif "score" in adata and float(adata.get("score", 0)) > 0:
                        sc = float(adata["score"])
                        comp_count += 1
                    else:
                        pend_count += 1
            elif r["field"] == "interview":
                if c.stage in [models.CandidateStage.Technical_Interview.value, "Offer Sent", "Hired"]:
                    cand_count += 1
                    if "interview" in adata and isinstance(adata["interview"], dict) and adata["interview"].get("score"):
                        sc = float(adata["interview"]["score"])
                        comp_count += 1
                    else:
                        pend_count += 1

            if sc is not None:
                r_scores.append(sc)

        r_avg = round(sum(r_scores) / len(r_scores), 1) if r_scores else 0.0
        r_med = round(float(statistics.median(r_scores)), 1) if r_scores else 0.0
        r_pass = round((sum(1 for s in r_scores if s >= 60.0) / len(r_scores) * 100.0), 1) if r_scores else 0.0

        round_performance.append(schemas.RoundPerformanceMetric(
            round_name=r["name"],
            candidates_count=cand_count,
            completed_count=comp_count,
            pending_count=pend_count,
            avg_score=r_avg,
            median_score=r_med,
            pass_rate=r_pass
        ))

    # 6. Score Distribution (10 buckets)
    bucket_counts = [0] * 10
    for item in candidate_effective_scores:
        val = min(int(item["score"] / 10), 9) if item["score"] > 0 else 0
        if item["score"] > 0:
            bucket_counts[val] += 1
    score_distribution = [
        {
            "range": f"{i * 10}–{(i + 1) * 10}%",
            "count": bucket_counts[i],
            "percentage": round((bucket_counts[i] / total_applicants * 100.0), 1) if total_applicants > 0 else 0.0
        }
        for i in range(10)
    ]

    # 7. Role Insights
    role_map = {}
    for item in candidate_effective_scores:
        c = item["cand"]
        sc = item["score"]
        r_name = c.role or "Unspecified"
        if r_name not in role_map:
            role_map[r_name] = {
                "applicants": 0,
                "scores": [],
                "top_cand": None,
                "top_score": -1.0
            }
        role_map[r_name]["applicants"] += 1
        if sc > 0:
            role_map[r_name]["scores"].append(sc)
            if sc > role_map[r_name]["top_score"]:
                role_map[r_name]["top_score"] = sc
                role_map[r_name]["top_cand"] = c.name

    role_insights = []
    for r_name, r_data in role_map.items():
        eval_cnt = len(r_data["scores"])
        r_avg = round(sum(r_data["scores"]) / eval_cnt, 1) if eval_cnt > 0 else 0.0
        r_pass = round((sum(1 for s in r_data["scores"] if s >= 60.0) / eval_cnt * 100.0), 1) if eval_cnt > 0 else 0.0
        
        status_label = "Healthy" if r_avg >= 70.0 else ("Needs Review" if eval_cnt > 0 else "Low Volume")
        role_insights.append(schemas.RoleInsightMetric(
            role=r_name,
            total_applicants=r_data["applicants"],
            evaluated_count=eval_cnt,
            avg_score=r_avg,
            top_candidate_name=r_data["top_cand"],
            top_candidate_score=r_data["top_score"] if r_data["top_score"] >= 0 else None,
            pass_rate=r_pass,
            pipeline_status=status_label
        ))

    # 8. Bottleneck Detection
    bottlenecks = []
    for r in round_performance:
        if r.candidates_count > 0 and r.pending_count >= 2 and (r.pending_count / r.candidates_count) >= 0.3:
            bottlenecks.append(schemas.PipelineBottleneck(
                stage=r.round_name,
                severity="warning",
                message=f"{r.pending_count} candidates are currently awaiting evaluation in {r.round_name}.",
                affected_count=r.pending_count
            ))

    # 9. Skills Intelligence (Aggregate extracted skills from analysis_data)
    skill_counts = {}
    for c in candidates:
        adata = c.analysis_data or {}
        if isinstance(adata, dict):
            raw_skills = adata.get("skills") or adata.get("matching_skills") or []
            if isinstance(raw_skills, list):
                for sk in raw_skills:
                    if sk and isinstance(sk, str) and len(sk.strip()) > 1:
                        clean_sk = sk.strip()
                        skill_counts[clean_sk] = skill_counts.get(clean_sk, 0) + 1

    sorted_skills = sorted(skill_counts.items(), key=lambda x: x[1], reverse=True)[:15]
    skills_intelligence = [
        schemas.SkillIntelligenceItem(skill=k, candidate_count=v) for k, v in sorted_skills
    ]

    # 10. Candidate Attention Items
    attention_items = []
    for c in candidates:
        # Flag 1: Score 0 / Unscored
        if c.score == 0 and not (c.analysis_data and c.analysis_data.get("score")):
            attention_items.append(schemas.CandidateAttentionItem(
                id=c.id,
                name=c.name or "Unknown Candidate",
                email=c.email or "—",
                role=c.role or "Unspecified",
                stage=c.stage or "Resume Screening",
                issue="Awaiting evaluation / un-screened"
            ))
        # Flag 2: In assessment round with pending status
        elif c.stage in [models.CandidateStage.Aptitude_Round.value, models.CandidateStage.Coding_Round.value] and c.status == models.CandidateStatus.In_Progress.value:
            attention_items.append(schemas.CandidateAttentionItem(
                id=c.id,
                name=c.name or "Unknown Candidate",
                email=c.email or "—",
                role=c.role or "Unspecified",
                stage=c.stage,
                issue=f"In progress in {c.stage}"
            ))

    role_query = db.query(models.Candidate.role).filter(
        models.Candidate.role != None,
        models.Candidate.role != ""
    )
    if org_id:
        role_query = role_query.filter(models.Candidate.organization_id == org_id)
    elif getattr(current_user, "role", None) != models.UserRole.PLATFORM_ADMIN:
        role_query = role_query.filter(models.Candidate.created_by == current_user.id)

    distinct_roles = ["All Roles"] + [r[0] for r in role_query.distinct().all()]

    return schemas.AnalyticsDashboardResponse(
        kpi=kpi,
        funnel=funnel,
        ai_recommendations=ai_recommendations,
        round_performance=round_performance,
        score_distribution=score_distribution,
        role_insights=role_insights,
        bottlenecks=bottlenecks,
        skills_intelligence=skills_intelligence,
        attention_items=attention_items[:20],
        available_roles=distinct_roles,
        date_range_label=date_label,
        total_evaluated=len(all_scores)
    )

