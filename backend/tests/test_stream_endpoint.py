import os
import json
from fastapi.testclient import TestClient
from main import app
from database import SessionLocal
import models
from utils import create_access_token

def test_screen_stream():
    db = SessionLocal()
    user = db.query(models.User).filter(models.User.role != 'candidate').first()
    token = create_access_token({'sub': user.email})
    db.close()
    headers = {'Authorization': f'Bearer {token}'}

    client = TestClient(app)
    path1 = 'backend/media/resumes/Ashish_Pratap_Singh_Resume.pdf' if os.path.exists('backend/media/resumes/Ashish_Pratap_Singh_Resume.pdf') else 'media/resumes/Ashish_Pratap_Singh_Resume.pdf'
    path2 = 'backend/media/resumes/Suprit_Resume.pdf' if os.path.exists('backend/media/resumes/Suprit_Resume.pdf') else 'media/resumes/Suprit_Resume.pdf'
    with open(path1, 'rb') as f1, \
         open(path2, 'rb') as f2:
        files = [
            ('files', ('Ashish_Pratap_Singh_Resume.pdf', f1, 'application/pdf')),
            ('files', ('Suprit_Resume.pdf', f2, 'application/pdf'))
        ]
        data = {
            'job_description': 'Software Engineer with Python, React, Docker, FastAPI',
            'top_n': 5
        }
        res = client.post('/api/resume/screen-stream/', files=files, data=data, headers=headers)
        assert res.status_code == 200
        lines = [l for l in res.text.strip().split('\n') if l.strip()]
        print('Total lines:', len(lines))
        events = [json.loads(l) for l in lines]
        for e in events:
            ev_type = e.get('event')
            stage = e.get('stage')
            cand = e.get('candidate')
            print(f"Event: {ev_type}, Stage: {stage}, Candidate: {cand.get('name') if cand else None}, Status: {cand.get('status') if cand else None}")

        completed_events = [e for e in events if e.get('event') == 'candidate_completed']
        assert len(completed_events) == 2
        
        # Verify Ashish is rejected for invalid email
        ashish_event = [e for e in completed_events if 'Ashish' in str(e)][0]
        assert ashish_event['candidate']['status'] == 'Rejected'
        assert ashish_event['candidate']['score'] == 0

        # Verify Suprit is screened
        suprit_event = [e for e in completed_events if 'Suprit' in str(e)][0]
        assert suprit_event['candidate']['status'] == 'Screened'
        assert suprit_event['candidate']['score'] > 0

        # Verify DB: Suprit in DB, Ashish NOT in DB
        db = SessionLocal()
        suprit_db = db.query(models.Candidate).filter(models.Candidate.email == suprit_event['candidate']['email']).first()
        assert suprit_db is not None
        ashish_db = db.query(models.Candidate).filter(models.Candidate.email == 'xxx@gmail.com').first()
        assert ashish_db is None
        db.close()
        print("ALL STREAMING CHECKS PASSED!")

if __name__ == '__main__':
    test_screen_stream()
