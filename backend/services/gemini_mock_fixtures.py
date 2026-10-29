"""
Deterministic offline fixtures for gemini_client mock mode (GEMINI_MOCK_MODE=true).
Responses follow the same JSON schemas the production prompts request.
Unrecognised prompts raise RuntimeError so callers use their own deterministic fallbacks.
"""
from typing import Any, Dict


def _aptitude_questions(count: int = 10) -> Dict[str, Any]:
    questions = []
    for i in range(1, count + 1):
        questions.append({
            "id": i,
            "topic": "Quantitative Reasoning" if i % 2 else "Logical Deduction",
            "question": f"Mock aptitude question {i}: what is {i} + {i}?",
            "options": [
                {"key": "A", "text": str(i * 2)},
                {"key": "B", "text": str(i * 2 + 1)},
                {"key": "C", "text": str(i * 2 + 2)},
                {"key": "D", "text": str(i * 2 + 3)},
            ],
            "correct_key": "A",
            "explanation": f"{i} + {i} = {i * 2}.",
        })
    return {"questions": questions}


def _coding_problems(prompt: str = "", count: int = 2) -> Dict[str, Any]:
    p = prompt.lower()
    if "frontend" in p:
        problems = [
            {
                "id": "1",
                "title": "Longest Run of Unique CSS Classes",
                "difficulty": "Medium",
                "description": "A style auditor scans a stream of CSS class tokens and wants the longest contiguous run in which no class name repeats. Given one line of space-separated class names, print the length of the longest contiguous run with all distinct class names.",
                "input_format": "A single line of space-separated class names.",
                "output_format": "A single integer.",
                "constraints": "1 <= number of tokens <= 10^5",
                "starter_code": {"python": "import sys\n\ndef longest_unique_run(tokens):\n    pass\n\nif __name__ == '__main__':\n    print(longest_unique_run(sys.stdin.read().split()))\n"},
                "public_test_cases": [{"input": "btn card btn nav card", "expected_output": "3", "explanation": "longest distinct run is 3"}],
                "hidden_test_cases": [
                    {"input": "a b c d", "expected_output": "4"},
                    {"input": "x x x x", "expected_output": "1"},
                    {"input": "a b a c b d a", "expected_output": "4"},
                    {"input": "p q r p s t u", "expected_output": "6"},
                ],
            },
            {
                "id": "2",
                "title": "HTML & JSX Component Tag Balancer",
                "difficulty": "Medium",
                "description": "Frontend template engines validate that opening and closing JSX/HTML tags match in proper nesting order. Given a single-line string consisting of space-separated tags, return 'true' if the tag sequence is properly balanced, or 'false' otherwise.",
                "input_format": "Single line string containing space-separated HTML/JSX tag tokens.",
                "output_format": "'true' or 'false'",
                "constraints": "Number of tag tokens <= 1000",
                "starter_code": {"python": "import sys\n\ndef is_valid_jsx(tag_str: str) -> str:\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    print(is_valid_jsx(s))\n"},
                "public_test_cases": [{"input": "<nav> <div> </div> </nav>", "expected_output": "true", "explanation": "Properly nested pairs."}],
                "hidden_test_cases": [
                    {"input": "<nav> <div> </nav> </div>", "expected_output": "false"},
                    {"input": "<header> <nav> <h1> </h1> </nav> </header>", "expected_output": "true"},
                    {"input": "<section> <div> </section>", "expected_output": "false"},
                ],
            },
        ]
    elif "data" in p:
        problems = [
            {
                "id": "1",
                "title": "Top-K Frequent Categories",
                "difficulty": "Medium",
                "description": "Given K and a comma-separated list of category labels, print the K most frequent categories separated by single spaces. Order by descending frequency; break ties alphabetically.",
                "input_format": "Line 1: integer K. Line 2: comma-separated category labels.",
                "output_format": "K space-separated labels.",
                "constraints": "1 <= K <= number of distinct labels <= 10^4",
                "starter_code": {"python": "import sys\n\ndef top_k_categories(k, labels):\n    pass\n\nif __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    print(top_k_categories(int(lines[0]), lines[1].split(',')))\n"},
                "public_test_cases": [{"input": "2\nads,web,ads,mobile,web,ads", "expected_output": "ads web", "explanation": "ads appears 3 times, web 2 times"}],
                "hidden_test_cases": [
                    {"input": "1\nx,y,y,z", "expected_output": "y"},
                    {"input": "3\nb,a,c,a,b,c", "expected_output": "a b c"},
                    {"input": "2\nq,w,e,r,t,q", "expected_output": "q e"},
                    {"input": "2\nm,m,n,n,o", "expected_output": "m n"},
                ],
            },
            {
                "id": "2",
                "title": "In-Memory Dataset Equi-Join by ID",
                "difficulty": "Medium",
                "description": "Given two datasets formatted as comma-separated ID:Value pairs on Line 1 (Table A) and Line 2 (Table B), perform an INNER JOIN on ID. Output matched records sorted ascending by integer ID.",
                "input_format": "Line 1: Dataset A. Line 2: Dataset B.",
                "output_format": "Space-separated 'ID:ValA:ValB' sorted by integer ID, or 'EMPTY'.",
                "constraints": "Number of records <= 5000",
                "starter_code": {"python": "import sys\n\ndef inner_join(line1: str, line2: str) -> str:\n    pass\n\nif __name__ == '__main__':\n    lines = [l.strip() for l in sys.stdin if l.strip()]\n    if len(lines) >= 2:\n        print(inner_join(lines[0], lines[1]))\n"},
                "public_test_cases": [{"input": "1:Engineering,2:Sales,3:Finance\n2:Chicago,1:Boston,4:Austin", "expected_output": "1:Engineering:Boston 2:Sales:Chicago", "explanation": "Joins ID 1 and 2 in sorted order."}],
                "hidden_test_cases": [
                    {"input": "10:Alpha,20:Beta\n20:100,10:200", "expected_output": "10:Alpha:200 20:Beta:100"},
                    {"input": "1:A,2:B\n3:C,4:D", "expected_output": "EMPTY"},
                    {"input": "5:Item5\n5:Stock50", "expected_output": "5:Item5:Stock50"},
                ],
            },
        ]
    elif "devops" in p or "cloud" in p:
        problems = [
            {
                "id": "1",
                "title": "Merge Overlapping Maintenance Windows",
                "difficulty": "Medium",
                "description": "Maintenance windows are given as comma-separated 'start-end' integer pairs. Merge all overlapping or touching windows and print in ascending order.",
                "input_format": "A single line of comma-separated 'start-end' pairs.",
                "output_format": "Comma-separated merged 'start-end' pairs.",
                "constraints": "1 <= windows <= 10^4, 0 <= start <= end <= 10^9",
                "starter_code": {"python": "import sys\n\ndef merge_windows(pairs):\n    pass\n\nif __name__ == '__main__':\n    print(merge_windows(sys.stdin.read().strip()))\n"},
                "public_test_cases": [{"input": "1-3,2-6,8-10,15-18", "expected_output": "1-6,8-10,15-18", "explanation": "1-3 and 2-6 overlap into 1-6"}],
                "hidden_test_cases": [
                    {"input": "1-4,4-5", "expected_output": "1-5"},
                    {"input": "5-8,1-2,2-3", "expected_output": "1-3,5-8"},
                    {"input": "1-10,2-3,4-5", "expected_output": "1-10"},
                    {"input": "7-9", "expected_output": "7-9"},
                ],
            },
            {
                "id": "2",
                "title": "Server Log Status Code Frequency Aggregator",
                "difficulty": "Medium",
                "description": "Calculate count of successful requests (2xx), client errors (4xx), and server errors (5xx) from space-separated HTTP status codes.",
                "input_format": "Single line of space-separated integer HTTP status codes.",
                "output_format": "'2XX:<n> 4XX:<n> 5XX:<n>'",
                "constraints": "Number of status codes <= 10^5",
                "starter_code": {"python": "import sys\n\ndef aggregate_logs(codes_str: str) -> str:\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    print(aggregate_logs(s))\n"},
                "public_test_cases": [{"input": "200 200 404 500 500 200 401 503", "expected_output": "2XX:3 4XX:2 5XX:3", "explanation": "3 2xx, 2 4xx, 3 5xx."}],
                "hidden_test_cases": [
                    {"input": "200 201 204", "expected_output": "2XX:3 4XX:0 5XX:0"},
                    {"input": "500 502 503 504", "expected_output": "2XX:0 4XX:0 5XX:4"},
                    {"input": "400 403 404 429 200", "expected_output": "2XX:1 4XX:4 5XX:0"},
                ],
            },
        ]
    elif "machine learning" in p or "ml engineer" in p or "learning" in p or " ml" in p:
        problems = [
            {
                "id": "1",
                "title": "Longest Improving Validation Streak",
                "difficulty": "Medium",
                "description": "Find the length of the longest strictly increasing subsequence of validation scores.",
                "input_format": "A single line of comma-separated integers.",
                "output_format": "A single integer.",
                "constraints": "1 <= scores <= 10^5, -10^9 <= score <= 10^9",
                "starter_code": {"python": "import sys\n\ndef longest_increasing(scores):\n    pass\n\nif __name__ == '__main__':\n    print(longest_increasing(list(map(int, sys.stdin.read().strip().split(',')))))\n"},
                "public_test_cases": [{"input": "10,9,2,5,3,7,101,18", "expected_output": "4", "explanation": "Longest subsequence is 2,3,7,101"}],
                "hidden_test_cases": [
                    {"input": "0,1,0,3,2,3", "expected_output": "4"},
                    {"input": "7,7,7,7", "expected_output": "1"},
                    {"input": "5,4,3,2,1", "expected_output": "1"},
                    {"input": "1,3,6,7,9,4,10,5,6", "expected_output": "6"},
                ],
            },
            {
                "id": "2",
                "title": "Feature Matrix Min-Max Normalizer",
                "difficulty": "Medium",
                "description": "Normalize numeric features to [0.0, 1.0] interval using (x - min) / (max - min).",
                "input_format": "Comma-separated numbers on a single line.",
                "output_format": "Space-separated normalized numbers rounded to 2 decimal places.",
                "constraints": "Array length <= 10^4",
                "starter_code": {"python": "import sys\n\ndef min_max_normalize(nums: list) -> str:\n    pass\n\nif __name__ == '__main__':\n    s = sys.stdin.read().strip()\n    if s:\n        nums = [float(x) for x in s.split(',') if x.strip()]\n        print(min_max_normalize(nums))\n"},
                "public_test_cases": [{"input": "10,20,30,40,50", "expected_output": "0.00 0.25 0.50 0.75 1.00", "explanation": "Normalizes 10 to 0.00 and 50 to 1.00."}],
                "hidden_test_cases": [
                    {"input": "5,5,5", "expected_output": "0.00 0.00 0.00"},
                    {"input": "0,100", "expected_output": "0.00 1.00"},
                    {"input": "1,3,5,7", "expected_output": "0.00 0.33 0.67 1.00"},
                ],
            },
        ]
    else:
        # Full Stack / Backend / Default
        problems = [
            {
                "id": "1",
                "title": "Subarray Sum Equals K",
                "difficulty": "Medium",
                "description": "Given an array of integers and an integer K, print the number of contiguous subarrays whose elements sum to exactly K.",
                "input_format": "Line 1: Comma-separated integers. Line 2: Integer K.",
                "output_format": "A single integer count.",
                "constraints": "1 <= length <= 10^5, -1000 <= value <= 1000",
                "starter_code": {"python": "import sys\n\ndef count_subarrays(nums, k):\n    pass\n\nif __name__ == '__main__':\n    lines = sys.stdin.read().splitlines()\n    print(count_subarrays(list(map(int, lines[0].split(','))), int(lines[1])))\n"},
                "public_test_cases": [{"input": "1,1,1\n2", "expected_output": "2", "explanation": "[1,1] occurs twice"}],
                "hidden_test_cases": [
                    {"input": "1,2,3\n3", "expected_output": "2"},
                    {"input": "1,-1,0\n0", "expected_output": "3"},
                    {"input": "3,4,7,2,-3,1,4,2\n7", "expected_output": "4"},
                    {"input": "0,0,0\n0", "expected_output": "6"},
                ],
            },
            {
                "id": "2",
                "title": "Valid Parentheses and Brackets",
                "difficulty": "Medium",
                "description": "Determine if the input string containing brackets is valid.",
                "input_format": "Single line string `s`",
                "output_format": "'true' or 'false'",
                "constraints": "1 <= s.length <= 10^4",
                "starter_code": {"python": "import sys\n\ndef is_valid(s):\n    pass\n\nif __name__ == '__main__':\n    import sys\n    s = sys.stdin.read().strip()\n    print(is_valid(s))\n"},
                "public_test_cases": [{"input": "()[]{}", "expected_output": "true", "explanation": "Properly nested pairs"}],
                "hidden_test_cases": [
                    {"input": "(]", "expected_output": "false"},
                    {"input": "([)]", "expected_output": "false"},
                    {"input": "{[]}", "expected_output": "true"},
                    {"input": "(((((())))))", "expected_output": "true"},
                ],
            },
        ]
    return {"problems": problems[:count]}


def _interview_questions(count: int = 5) -> Dict[str, Any]:
    return {"questions": [
        {
            "id": i,
            "type": "BEHAVIORAL" if i % 2 else "TECHNICAL",
            "question": f"Mock STAR interview question {i}: describe a relevant project situation, your task, actions and result.",
            "evaluation_criteria": "Situation, Task, Action, Result clarity.",
        }
        for i in range(1, count + 1)
    ]}


def sample_blueprint(role_title: str = "Backend Engineer") -> Dict[str, Any]:
    """A schema-valid JobAssessmentBlueprint (15 aptitude, 2 coding, 5 interview) for offline dev/tests."""
    keys = ["A", "B", "C", "D"]
    aptitude = []
    for i in range(1, 16):
        correct = keys[i % 4]
        options = {k: f"Option {k} for question {i}" for k in keys}
        aptitude.append({
            "id": f"A{i}", "domain": ["Quantitative", "Logical", "Verbal", "Domain Fundamentals"][i % 4],
            "difficulty": ["Easy", "Medium", "Hard"][i % 3],
            "question": f"Mock aptitude question {i}: choose the correct option.",
            "options": options, "correct_key": correct, "explanation": f"Option {correct} is correct.",
        })
    coding = [
        {"id": "C1", "title": "Sum Two Numbers", "difficulty": "Easy",
         "description": "Return the sum of a and b.",
         "starter_code": {"python": "def solve(a, b):\n    pass\n"},
         "public_test_cases": [{"input": {"a": 1, "b": 2}, "expected": 3}, {"input": {"a": 5, "b": 7}, "expected": 12}],
         "hidden_test_cases": [{"input": {"a": 0, "b": 0}, "expected": 0}, {"input": {"a": -1, "b": 1}, "expected": 0},
                               {"input": {"a": 100, "b": 200}, "expected": 300}]},
        {"id": "C2", "title": "Reverse String", "difficulty": "Easy",
         "description": "Return the string s reversed.",
         "starter_code": {"python": "def solve(s):\n    pass\n"},
         "public_test_cases": [{"input": {"s": "abc"}, "expected": "cba"}, {"input": {"s": "ab"}, "expected": "ba"}],
         "hidden_test_cases": [{"input": {"s": ""}, "expected": ""}, {"input": {"s": "racecar"}, "expected": "racecar"},
                               {"input": {"s": "hello"}, "expected": "olleh"}]},
    ]
    interview = [
        {"id": f"I{i}", "topic": f"Topic {i}", "competency": "Technical depth",
         "question_text": f"Mock interview question {i}: explain a relevant design trade-off.",
         "evaluation_criteria": ["Technical accuracy", "Depth of fundamentals", "Structured communication", "Edge cases"],
         "expected_technical_concepts": ["trade-offs", "scalability"]}
        for i in range(1, 6)
    ]
    return {"blueprint_version": 1, "role_title": role_title, "seniority_level": "Mid",
            "required_technical_skills": ["Python", "SQL"], "aptitude_questions": aptitude,
            "coding_problems": coding, "interview_questions": interview}


def sample_coding_problem(slot: int = 1) -> Dict[str, Any]:
    """
    What the coding-problem prompt returns (typed signature, 2 examples, 8 hidden-test candidates, a Python reference solution), as realistic
    offline data. The reference solutions are correct, so these pass the same sandbox verification real Gemini output must pass.
    """
    if int(slot) == 2:
        return {
            "id": "C2", "title": "Longest Unique Substring", "difficulty": "Medium",
            "description": "Given a string s, return the length of the longest substring that contains no repeated character.",
            "constraints": ["0 <= s.length <= 100", "s consists of printable ASCII characters"],
            "signature": {"name": "longestUniqueSubstring", "params": [{"name": "s", "type": "string"}], "returns": "int"},
            "compare": "exact",
            "examples": [
                {"input": {"s": "abcabcbb"}, "expected": 3, "explanation": "The longest substring without repeats is \"abc\", length 3."},
                {"input": {"s": "bbbbb"}, "expected": 1, "explanation": "Every substring of repeated letters has length 1."},
            ],
            "hidden_tests": [{"input": {"s": s}, "expected": e} for s, e in
                             [("pwwkew", 3), ("", 0), ("a", 1), ("abba", 2), ("dvdf", 3), ("abcdef", 6), ("tmmzuxt", 5), ("aab", 2)]],
            "reference_solution": (
                "class Solution:\n"
                "    def longestUniqueSubstring(self, s: str) -> int:\n"
                "        last, start, best = {}, 0, 0\n"
                "        for i, ch in enumerate(s):\n"
                "            if ch in last and last[ch] >= start:\n"
                "                start = last[ch] + 1\n"
                "            last[ch] = i\n"
                "            best = max(best, i - start + 1)\n"
                "        return best\n"),
        }
    return {
        "id": "C1", "title": "Pair With Target Sum", "difficulty": "Easy",
        "description": ("Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target. "
                        "Exactly one such pair exists, and the same element may not be used twice."),
        "constraints": ["2 <= nums.length <= 20", "-100 <= nums[i] <= 100", "Exactly one valid pair exists"],
        "signature": {"name": "pairIndices", "params": [{"name": "nums", "type": "int[]"}, {"name": "target", "type": "int"}], "returns": "int[]"},
        "compare": "exact",
        "examples": [
            {"input": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1], "explanation": "nums[0] + nums[1] = 2 + 7 = 9, so return [0, 1]."},
            {"input": {"nums": [3, 2, 4], "target": 6}, "expected": [1, 2], "explanation": "nums[1] + nums[2] = 2 + 4 = 6."},
        ],
        "hidden_tests": [{"input": {"nums": n, "target": t}, "expected": e} for n, t, e in
                         [([3, 3], 6, [0, 1]), ([1, 2, 3, 4, 5], 9, [3, 4]), ([-1, -2, -3, -4, -5], -8, [2, 4]), ([0, 4, 3, 0], 0, [0, 3]),
                          ([5, 75, 25], 100, [1, 2]), ([1, 5, 1, 5], 10, [1, 3]), ([10, 20, 30], 50, [1, 2]), ([4, 6], 10, [0, 1])]],
        "reference_solution": (
            "class Solution:\n"
            "    def pairIndices(self, nums: List[int], target: int) -> List[int]:\n"
            "        seen = {}\n"
            "        for i, x in enumerate(nums):\n"
            "            if target - x in seen:\n"
            "                return [seen[target - x], i]\n"
            "            seen[x] = i\n"
            "        return []\n"),
    }


def get_mock_response(prompt: str, json_mode: bool = True) -> Dict[str, Any]:
    if not json_mode:
        return {"text": "Thanks, that is clear. Can you tell me more about how you would measure the improvement? Please walk me through it step by step."}

    p = prompt.lower()
    if "aptitude answer check" in p:                              # the independent answer check of the blueprint's aptitude questions
        import re as _re
        keys = ["A", "B", "C", "D"]
        ids = _re.findall(r"\[(A\d+)\]", prompt)
        return {"answers": [{"id": qid, "answer": keys[int(qid[1:]) % 4]} for qid in ids]}     # sample_blueprint(): correct = keys[i % 4]
    if "leetcode-style coding problem" in p:                      # one coding problem of the JD blueprint
        return sample_coding_problem(2 if "slot 2 of" in p else 1)
    if "jd assessment blueprint" in p:
        return sample_blueprint()
    if "technical hiring bar-raiser" in p:
        return {"overall_score": 80.0, "technical_depth_score": 78.0, "communication_score": 82.0,
                "summary": "Mock evaluation: clear, structured technical answers.",
                "key_strengths": ["Structured answers"], "key_areas_for_improvement": ["Quantify impact"],
                "question_evaluations": []}
    if "aptitude questions" in p:
        return _aptitude_questions(10)
    if "coding assessment problems" in p:
        return _coding_problems(prompt, 2)
    if "interview questions for a candidate" in p:
        return _interview_questions(5)
    if "evaluate the candidate's interview responses" in p:
        return {
            "score": 80.0, "communication_score": 80.0, "technical_depth_score": 78.0,
            "strengths": ["Structured STAR responses"], "areas_for_improvement": ["Quantify impact"],
            "summary": "Mock evaluation: clear and structured answers.",
        }
    if "analyze the following job description" in p:
        role = "Software Engineer"
        if "spark" in p or "parquet" in p or "warehouse" in p or "data engineer" in p:
            role = "Data Engineer"
        elif "kubernetes" in p or "terraform" in p or "ci/cd" in p or "devops" in p:
            role = "DevOps / Cloud Engineer"
        elif "react" in p or "frontend" in p or "css" in p:
            role = "Frontend Developer"
        elif "ml" in p or "machine learning" in p or "model" in p:
            role = "ML Engineer"
        elif "backend" in p:
            role = "Backend Engineer"
        elif "full stack" in p:
            role = "Full Stack Engineer"

        return {
            "role_title": role, "seniority_level": "Mid",
            "required_skills": ["Python", "SQL", "FastAPI"], "preferred_skills": ["Docker"],
            "responsibilities": ["Build backend services"],
            "aptitude_domains": ["Quantitative Ability", "Logical Deduction"],
            "coding_topics": ["Arrays", "Strings"], "interview_focus_areas": ["Project Experience"],
        }
    if "evaluating an interview transcript" in p:
        return {
            "technical_accuracy": 80, "communication_clarity": 80, "problem_solving": 80,
            "depth_of_knowledge": 80, "overall_score": 80.0, "feedback": "Mock evaluation.",
        }
    raise RuntimeError("No Gemini mock fixture for this prompt")
