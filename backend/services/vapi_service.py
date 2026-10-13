import requests
import os
import json
import re

VAPI_PRIVATE_KEY = os.getenv("VAPI_PRIVATE_KEY") 
# Base Vapi API URL
VAPI_BASE_URL = "https://api.vapi.ai"

def create_ephemeral_assistant(candidate_name: str, role: str, resume_summary: str = "", custom_instructions: str = "", questions: list = None, jd_summary: str = ""):
    """
    Creates a temporary/transient assistant configuration in Vapi
    customized for the candidate's specific profile and structured interview questions.
    """
    key = os.getenv("VAPI_PRIVATE_KEY") or VAPI_PRIVATE_KEY
    if not key:
        print("Error: VAPI_PRIVATE_KEY is missing.")
        return None

    # Sanitize candidate_name: never speak raw email or domain to candidate
    clean_name = str(candidate_name or "").strip()
    if "@" in clean_name:
        local_user = clean_name.split("@")[0]
        words = re.sub(r"[^a-zA-Z\s]", " ", local_user).split()
        clean_name = " ".join([w for w in words if len(w) > 1]).title() or "Candidate"
    elif clean_name.lower() in ("", "none", "null", "unknown"):
        clean_name = "Candidate"
    candidate_name = clean_name

    questions_list = questions or []
    if questions_list:
        formatted_questions = "\n".join([
            f"Question {i+1} [{q.get('category', 'Technical')}]: {q.get('question', q) if isinstance(q, dict) else q}"
            for i, q in enumerate(questions_list)
        ])
        first_q = questions_list[0].get('question', questions_list[0]) if isinstance(questions_list[0], dict) else str(questions_list[0])
    else:
        formatted_questions = f"1. Tell me about yourself and your experience with {role}.\n2. Explain core architecture patterns you utilize.\n3. How do you approach complex technical debugging?\n4. Describe a system design problem you solved.\n5. What are your production readiness best practices?"
        first_q = f"Could you introduce yourself and walk me through your background and technical experience for the {role} position?"

    # Advanced System Prompt - Professional Technical Interviewer
    first_message = f"Hello {candidate_name}, welcome! Thank you for joining today's technical interview for the {role} position. I'm excited to speak with you today. Before we dive into the technical questions, could you please take a moment to introduce yourself and share a brief overview of your background and what you've been working on recently?"

    base_prompt = f"""
You are a senior technical interviewer with over 20 years of real-world industry experience, conducting a voice-first technical interview.
Your goal is to conduct a structured, professional, and adaptive technical interview that feels realistic, conversational, and fair.

========================
INTERVIEW CONTEXT
========================
Candidate Name: {candidate_name}
Target Job Role: {role}
Job Description Requirements: {jd_summary if jd_summary else "Standard requirements for " + role}
Candidate Resume Context: {resume_summary if resume_summary else "Not provided"}

========================
5-QUESTION INTERVIEW STRUCTURE
========================
You must guide the candidate through these 5 structured technical questions in order after their introduction:
{formatted_questions}

========================
STRICT VOICE CONVERSATION FLOW RULES
========================
1. PHASE 1 - CANDIDATE INTRODUCTION (CURRENT STARTING POINT):
   - You have already welcomed {candidate_name} and asked them to introduce themselves.
   - Listen attentively while the candidate speaks without interrupting.
   - When the candidate finishes their introduction:
     a) Acknowledge their background warmly in one concise sentence (e.g., "Thank you {candidate_name}, that's great context on your background and projects.").
     b) Transition smoothly into Question 1: "Now let's dive into our technical discussion. Question 1: {first_q}".

2. PHASE 2 - TECHNICAL DISCUSSION (QUESTIONS 1 TO 5):
   - Ask strictly ONE question at a time.
   - ALWAYS wait for the candidate to finish their complete answer. Never interrupt while the candidate is answering.
   - Allow comfortable silence (at least 6-7 seconds) before assuming the candidate has finished their answer.
   - When the candidate finishes answering a question, briefly acknowledge their answer in one conversational sentence (e.g., "Thank you for explaining that.", "Understood, that makes sense.", "Great walkthrough of that architectural trade-off.").
   - Immediately transition to the next question (e.g., "Let's move on to Question 2: ...").
   - Do NOT give away answers, teach, or lecture the candidate. Keep your speaking brief so the candidate does most of the talking.

3. ADAPTIVE FOLLOW-UPS:
   - If the candidate's answer is very brief, you may ask one short follow-up clarification before moving to the next question.
   - If the candidate asks for clarification, provide a brief, helpful hint without giving away the full answer.

4. PHASE 3 - COMPLETION:
   - Once all 5 questions have been addressed, thank the candidate warmly:
     "Thank you so much, {candidate_name}. You have completed all technical questions for today. Your responses have been saved and will be analyzed as part of your overall evaluation. Best of luck, and have a wonderful day!"

{"========================" if custom_instructions else ""}
{"CUSTOM INSTRUCTIONS" if custom_instructions else ""}
{"========================" if custom_instructions else ""}
{custom_instructions if custom_instructions else ""}
    """.strip()

    payload = {
        "model": {
            "provider": "google",
            "model": os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash"),
            "messages": [
                {
                    "role": "system",
                    "content": base_prompt
                }
            ],
            "temperature": 0.6
        },
        "voice": {
            "provider": "vapi",
            "voiceId": "Rohan",
        },
        "firstMessage": first_message,
        "transcriber": {
            "provider": "deepgram",
            "model": "nova-2",
            "language": "en"
        },
        "silenceTimeoutSeconds": 180,
        "maxDurationSeconds": 1800,
        "backgroundDenoisingEnabled": True,
        "firstMessageMode": "assistant-speaks-first"
    }

    try:
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(f"{VAPI_BASE_URL}/assistant", json=payload, headers=headers)
        
        if response.status_code == 201:
            data = response.json()
            return data.get("id")
        else:
            print(f"Vapi Creation Failed: {response.text}")
            return None
            
    except Exception as e:
        print(f"Vapi Service Error: {e}")
        return None
