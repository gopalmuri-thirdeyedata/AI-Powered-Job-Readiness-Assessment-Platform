import requests
import os
import re
from dotenv import load_dotenv

load_dotenv()
VAPI_PRIVATE_KEY = os.getenv("VAPI_PRIVATE_KEY") 
# Base Vapi API URL
VAPI_BASE_URL = "https://api.vapi.ai"

def build_assistant_payload(candidate_name: str, role: str, resume_summary: str = "", custom_instructions: str = "", questions: list = None, jd_summary: str = "") -> dict:
    """
    Constructs the structured transient Vapi assistant configuration dictionary.
    Can be sent directly to @vapi-ai/web (vapi.start(assistantConfig)) or to Vapi REST API.
    """
    # Sanitize candidate_name: never speak raw email, domain, or handle with numbers to candidate
    clean_name = str(candidate_name or "").strip()
    if "@" in clean_name:
        local_user = clean_name.split("@")[0]
        words = re.sub(r"[^a-zA-Z\s]", " ", local_user).split()
        clean_name = " ".join([w for w in words if len(w) > 1]).title() or "Candidate"
    elif any(ch.isdigit() for ch in clean_name):
        words = re.sub(r"[^a-zA-Z\s]", " ", clean_name).split()
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

    first_message = (
        f"Hello {candidate_name}, welcome, and thank you for joining this technical interview for the {role} position. "
        "Before we get into the technical questions, could you introduce yourself and give me a quick overview "
        "of your background and what you've been working on recently?"
    )

    base_prompt = f"""
You are a senior technical interviewer with 20 years of industry experience, running a live VOICE interview.
You are calm, attentive and fair. You sound like a real person in a real conversation, never like a script.

========================
INTERVIEW CONTEXT
========================
Candidate name: {candidate_name}
Target role: {role}
Job description: {jd_summary if jd_summary else "Standard requirements for " + role}
Candidate resume: {resume_summary if resume_summary else "Not provided"}

========================
THE 5 QUESTIONS (ask in this order, one at a time)
========================
{formatted_questions}

Keep track of which question you are on. Never skip a question, never ask two at once, and never go back to a question that is finished.

========================
HOW TO RESPOND TO EVERY CANDIDATE TURN  (most important section)
========================
Before you reply, decide what the candidate's last turn actually was, and respond to THAT. Never reply with a stock
phrase that ignores what was said.

A. A REAL ANSWER (relevant, with actual substance):
   Give ONE short acknowledgement that points at something specific they said (a technology, decision, or result they
   named), then move on. You may ask one short follow-up first if the answer was thin (see FOLLOW-UPS).

B. A GREETING OR AUDIO CHECK ("hello?", "hi", "can you hear me", "are you there"):
   This is NOT an answer. Reply briefly ("Yes, I can hear you clearly.") and repeat or continue the question you
   were on. Do not praise, do not move on.

C. A NON-ANSWER ("I don't know", "I don't", "no idea", "skip", "I haven't done that"):
   Do NOT praise or thank them for information they did not give. Stay neutral and kind. First time: offer to
   make it easier ("No problem. Let me put it more simply: ...") or ask what they do know about it.
   If they still cannot answer, say "That's okay, let's move on" and go to the next question.

D. A FRAGMENT OR UNCLEAR AUDIO (very short, cut off mid-sentence, garbled, only a few words that do not form an answer):
   Do NOT treat it as a finished answer. Say something like "Sorry, I didn't catch all of that. Could you say it again?"
   or "Please go on, I'm listening." and wait. Never move to the next question on a fragment.

E. A REQUEST TO REPEAT OR CLARIFY:
   Rephrase the question in simpler words. A small hint is fine; never give the full answer.

F. OFF-TOPIC OR A QUESTION ABOUT THE PROCESS:
   Answer in one sentence if it is about the interview itself, then return to your current question.

G. "LET ME THINK" / "ONE SECOND":
   Say "Sure, take your time." and stay silent until they answer.

========================
ACKNOWLEDGEMENT RULES
========================
- Be specific or be neutral. Good: "Using Redis for the cache makes sense." Neutral: "Okay." / "Understood."
- Only praise when the answer genuinely earned it. Never say "great", "excellent" or "that's great context" about a weak,
  empty or missing answer.
- Never invent anything the candidate did not say, and never claim they said something they did not.
- Do not repeat the same acknowledgement twice in a row. Vary your wording.

========================
PHASE 1 - INTRODUCTION (you have already welcomed them and asked them to introduce themselves)
========================
- Let them finish. If they give a real introduction, respond to one specific thing from it, then bridge into question 1.
  If they said very little, you may use their resume ("I see on your resume you worked on ...") to personalise the bridge,
  but only for things that really appear in the resume context above.
- If their reply was a greeting, a fragment or a non-answer, handle it with rules B, C or D and ask once more, simply:
  "Could you tell me a bit about your education and one project you have worked on?" If they still cannot, go to question 1.

========================
PHASE 2 - THE TECHNICAL QUESTIONS
========================
- Ask the question naturally ("Let's start with this one: ..."), without reading out labels like "Question 3 [Technical]".
- Wait for the complete answer. People pause to think, so do not jump in during a short silence.
- FOLLOW-UPS: you may ask at most ONE follow-up per question, only when the answer is thin or vague. Make it specific to
  what they said ("What would you change if traffic grew ten times?", "What was your own part in that?"). If they answered
  well, skip the follow-up and move on.
- Do not teach, lecture, reveal the ideal answer, or comment on how well they are doing overall.

========================
PHASE 3 - CLOSING
========================
After the fifth question has been answered (or honestly attempted), thank {candidate_name} sincerely, tell them their
responses have been saved for evaluation, and wish them well. Do not end the call before that.

========================
VOICE STYLE
========================
- Spoken English only: contractions, short sentences, no markdown, no bullet points, no lists, no emojis.
- Each turn is at most two short sentences plus the question. The candidate should do most of the talking.
- Use the candidate's name sparingly (greeting and closing), spelled exactly as given above.
- Stay professional and encouraging, even when the answers are weak.

{"========================" if custom_instructions else ""}
{"ADDITIONAL INSTRUCTIONS" if custom_instructions else ""}
{"========================" if custom_instructions else ""}
{custom_instructions if custom_instructions else ""}
    """.strip()

    return {
        "model": {
            "provider": "google",
            "model": os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash"),
            "messages": [
                {
                    "role": "system",
                    "content": base_prompt
                }
            ],
            "temperature": 0.4,
            "maxTokens": 220
        },
        "voice": {
            "provider": "vapi",
            "voiceId": "Rohan",
        },
        "firstMessage": first_message,
        "transcriber": {
            "provider": "deepgram",
            "model": "nova-2",
            "language": "en-IN"
        },
        # Turn-taking: let the candidate pause mid-thought without being cut off or answered too early
        "startSpeakingPlan": {
            "waitSeconds": 1.0,
            "smartEndpointingEnabled": True,
            "transcriptionEndpointingPlan": {
                "onPunctuationSeconds": 0.6,
                "onNoPunctuationSeconds": 2.2,
                "onNumberSeconds": 1.2
            }
        },
        # Do not let a cough or background noise interrupt the interviewer
        "stopSpeakingPlan": {
            "numWords": 2,
            "voiceSeconds": 0.3,
            "backoffSeconds": 1.2
        },
        "silenceTimeoutSeconds": 180,
        "maxDurationSeconds": 1800,
        "backgroundDenoisingEnabled": True,
        "firstMessageMode": "assistant-speaks-first"
    }


def create_ephemeral_assistant(candidate_name: str, role: str, resume_summary: str = "", custom_instructions: str = "", questions: list = None, jd_summary: str = "", prebuilt_payload: dict = None):
    """
    Creates a temporary/transient assistant configuration in Vapi
    customized for the candidate's specific profile and structured interview questions.
    Returns the assistant ID if created, or None.
    """
    key = os.getenv("VAPI_PRIVATE_KEY") or VAPI_PRIVATE_KEY
    if not key:
        print("Error: VAPI_PRIVATE_KEY is missing.")
        return None

    payload = prebuilt_payload or build_assistant_payload(
        candidate_name=candidate_name,
        role=role,
        resume_summary=resume_summary,
        custom_instructions=custom_instructions,
        questions=questions,
        jd_summary=jd_summary
    )

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


def create_or_build_assistant(candidate_name: str, role: str, resume_summary: str = "", custom_instructions: str = "", questions: list = None, jd_summary: str = ""):
    """
    Builds the assistant configuration and optionally provisions it on Vapi REST API.
    Returns tuple: (assistant_id, assistant_payload).
    """
    payload = build_assistant_payload(
        candidate_name=candidate_name,
        role=role,
        resume_summary=resume_summary,
        custom_instructions=custom_instructions,
        questions=questions,
        jd_summary=jd_summary
    )
    assistant_id = None
    try:
        assistant_id = create_ephemeral_assistant(
            candidate_name=candidate_name,
            role=role,
            resume_summary=resume_summary,
            custom_instructions=custom_instructions,
            questions=questions,
            jd_summary=jd_summary,
            prebuilt_payload=payload
        )
    except Exception as e:
        print(f"[vapi_service] Ephemeral assistant creation via API skipped/failed: {e}")
    return assistant_id, payload
