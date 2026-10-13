# RoleReady — Reporting Design & Analytics

## 1. Dual Audience Architecture
RoleReady generates two strictly partitioned reports:
- **Candidate/Student Job-Readiness Dossier:** Empowering, diagnostic, and private to the student.
- **Administrator Recruitment Dossier:** Comparative, metric-driven, ranking-capable, and private to the recruiting organization.

---

## 2. Student Job-Readiness Report Structure
1. **Header & Context:** Target Role, Target Company (if specified), Date of Evaluation, and Evaluation UUID.
2. **Overall Job Readiness Score (0–100%):** Weighted algorithmic synthesis:
   - Aptitude & Reasoning Weight: 25%
   - Practical Coding & Algorithmic Execution: 40%
   - Technical & Behavioral Interview: 35%
3. **Core Readiness Tier:**
   - **85–100%:** Direct Role Ready (Ready for high-stakes employer interview)
   - **70–84%:** Foundation Strong (Minor targeted revision recommended)
   - **50–69%:** Intermediate Potential (Structured remediation plan needed)
   - **<50%:** Foundational Gap (Core fundamentals need strengthening)
4. **Dimension Diagnostics:**
   - *Aptitude Breakdown:* Quantitative accuracy, logical deduction, time-efficiency rating.
   - *Coding Breakdown:* Test cases passed (Public & Hidden), runtime efficiency, code modularity.
   - *Interview Breakdown:* Technical concept clarity, STAR response structure, verbal confidence.
5. **JD Competency Gap Matrix:**
   - Skills Verified (Strong alignment with JD)
   - Skills Missing / Not Evidenced
6. **Actionable Next Steps:** Direct links to recommended practice questions, system design primers, or mock interview drills.

---

## 3. Administrator Recruitment Report Structure
1. **Recruitment Batch Summary:** Campaign name, target JD, total candidates imported, invitations sent, completion rate.
2. **Candidate Comparison Leaderboard:**
   - Candidate Name, Email, Overall Readiness %, Aptitude Score, Coding Score, Interview Score, Proctoring Integrity Index.
   - Sortable by overall score or individual round performance.
3. **Deep-Dive Candidate Drawer:**
   - Code inspection viewer with syntax highlighting and test results.
   - Proctoring incident log (tab switches, full-screen violations).
   - Audio recording playback and full interview transcript with AI sentiment & technical score breakdown.
4. **Export Capabilities:** Downloadable CSV / PDF candidate comparison summaries.
