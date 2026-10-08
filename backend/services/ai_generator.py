import requests
import json
import os
import re
from dotenv import load_dotenv
load_dotenv()


from . import groq_client


GROQ_API_KEY = "resilient" if groq_client.has_groq_key() else None
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

def generate_questions(assessment_type: str, config: dict):
    if not GROQ_API_KEY:
        print("ERROR: GROQ_API_KEY not found.")
        return []

    if assessment_type == "aptitude":
        return generate_aptitude_questions(config)
    elif assessment_type == "coding":
        return generate_coding_questions(config)
    elif assessment_type in ["interview", "technical interview", "technical_interview"]:
        return generate_interview_questions(config)
    
    return []

def generate_interview_questions(config: dict):
    # Minimal generator for Interview context to satisfy assignment logic
    focus_area = config.get("focus_area", "General Technical")
    difficulty = config.get("difficulty", "Medium")
    
    prompt = f"""
    Generate 5 technical interview discussion starters.
    Topic: {focus_area}
    Difficulty: {difficulty}
    
    Return a JSON array of strings only.
    Example: ["Explain X...", "How does Y work?", ...]
    """
    
    try:
        data = call_llm(prompt)
        # Ensure we return a list of objects expected by frontend/db structure
        # Or if the interview module expects strings, adapt.
        # usually generated_questions storage is flexible JSON.
        if isinstance(data, list):
             return [{"id": i+1, "question": q, "type": "verbal"} for i, q in enumerate(data) if isinstance(q, str)]
        return []
    except:
        # Fallback to prevent 500 error
        return [{"id": 1, "question": f"Tell me about your experience with {focus_area}.", "type": "verbal"}]

def evaluate_code(code: str, language: str, question: dict, test_cases: list):
    if not GROQ_API_KEY:
        return {"error": "AI Service Unavailable"}

    prompt = f"""
    Act as a Code Execution Engine. Evaluate the submitted code.
    Language: {language}
    Problem: {question.get('title')}
    Description: {question.get('description')}
    
    Code:
    {code}

    Test Cases to Evaluate (Input -> Expected Output):
    {json.dumps(test_cases)}

    Instructions:
    1. Check for Syntax Errors. 
       - **FOR JAVA**: Assume `import java.util.*;` is ALWAYS present. `HashMap`, `List`, `ArrayList` are VALID. Diamond `<>` is VALID.
       - Do NOT require a `main` method. The code is a `Solution` class.
       - Be EXTREMELY TOLERANT of missing imports.
    2. Check for Logical Correctness against the problem statement.
    3. Simulate the execution for EACH test case.
    4. Return a JSON object with: 
       - syntax_valid: boolean (Mark TRUE if logic is clear, even if imports missing)
       - error_message: string (Only for fatal logic gaps or broken braces)
       - results: array of objects {{ "id": int, "status": "passed"|"failed"|"error", "output": "string", "expected": "string" }}
       - feedback: string (brief feedback)

    CRITICAL: Focus on ALGORITHM LOGIC. Ignore boilerplate syntax issues.
    """
    
    try:
        response = call_llm(prompt) # Expecting JSON
        return response
    except Exception as e:
        print(f"Evaluation Error: {e}")
        return {"syntax_valid": False, "error_message": "Evaluation Failed", "results": []}

def generate_runner_code(code: str, language: str, test_cases: list, question_config: dict = None):
    """
    Wraps user code with a test runner.
    If the question_config contains a language-specific runner template, it uses that.
    Otherwise, it falls back to a generic template.
    """
    marker_start = "---EXECUTION_RESULT_START---"
    marker_end = "---EXECUTION_RESULT_END---"

    # Attempt to use specific runner template from the question if available
    if question_config and 'runner_templates' in question_config:
        templates = question_config['runner_templates']
        template = templates.get(language)
        if template:
            # The template should have a placeholder like //CANDIDATE_CODE
            # And inject test_cases as JSON
            final_code = template.replace("//CANDIDATE_CODE", code)
            final_code = final_code.replace("{{TEST_CASES}}", json.dumps(test_cases))
            final_code = final_code.replace("{{MARKER_START}}", marker_start)
            final_code = final_code.replace("{{MARKER_END}}", marker_end)
            return final_code

    # Fallback to Generic Templates
    if language == 'python':
        wrapper = f"""
import json
import inspect

# Candidate Code
{code}

# Test Cases
test_cases = json.loads(r'''{json.dumps(test_cases)}''')

def find_solving_function():
    # Priority 1: explicitly named 'solve'
    if 'solve' in globals() and callable(globals()['solve']):
        return globals()['solve']
    
    # Priority 2: Any function defined in this module
    # We filter out our own runner functions
    for name, obj in list(globals().items()):
        if callable(obj) and not name.startswith('__') and name not in ['find_solving_function', 'json', 'inspect']:
            return obj
    return None

target_fn = find_solving_function()

print("{marker_start}")
for tc in test_cases:
    try:
        if not target_fn:
             raise Exception("No solving function found in your code.")
             
        inp = tc.get('input', {{}})
        if isinstance(inp, dict):
            # Try calling with keywords, fallback to positional if needed
            try:
                actual = target_fn(**inp)
            except TypeError:
                actual = target_fn(*inp.values())
        else:
            actual = target_fn(inp)
            
        print(json.dumps({{"id": tc.get('id'), "status": "executed", "output": actual, "expected": tc.get('expected')}}))
    except Exception as e:
        print(json.dumps({{"id": tc.get('id'), "status": "error", "output": str(e), "expected": tc.get('expected')}}))
print("{marker_end}")
"""
        return wrapper

    elif language == 'java':
        test_calls = generate_java_test_calls(code, test_cases)
        wrapper = f"""
import java.util.*;
import java.lang.reflect.*;

public class Main {{
    // Helper to stringify results (handles Arrays, Lists, Maps, ListNode, TreeNode)
    public static String stringify(Object obj) {{
        if (obj == null) return "null";
        if (obj instanceof int[]) return Arrays.toString((int[]) obj);
        if (obj instanceof long[]) return Arrays.toString((long[]) obj);
        if (obj instanceof double[]) return Arrays.toString((double[]) obj);
        if (obj instanceof Object[]) return Arrays.deepToString((Object[]) obj);
        if (obj instanceof ListNode) {{
            StringBuilder sb = new StringBuilder("[");
            ListNode curr = (ListNode) obj;
            while (curr != null) {{
                sb.append(curr.val).append(curr.next != null ? "," : "");
                curr = curr.next;
            }}
            return sb.append("]").toString();
        }}
        return String.valueOf(obj);
    }}

    // Helpers to build Data Structures from Arrays
    public static ListNode buildList(int[] arr) {{
        if (arr == null || arr.length == 0) return null;
        ListNode head = new ListNode(arr[0]);
        ListNode curr = head;
        for (int i = 1; i < arr.length; i++) {{
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }}
        return head;
    }}

    public static void main(String[] args) {{
        try {{
            Solution solution = new Solution();
            // SELF-HEALING: Find the solving method dynamically
            Method targetMethod = null;
            for (Method m : Solution.class.getDeclaredMethods()) {{
                if (Modifier.isPublic(m.getModifiers()) && !m.getName().equals("main")) {{
                    targetMethod = m;
                    break;
                }}
            }}

            if (targetMethod == null) {{
                System.out.println("Error: No public method found in Solution class.");
                return;
            }}

            targetMethod.setAccessible(true);
            System.out.println("{marker_start}");
            {test_calls}
            System.out.println("{marker_end}");
        }} catch (Exception e) {{
            e.printStackTrace();
        }}
    }}
}}

// Standard Data Structures
class ListNode {{
    int val;
    ListNode next;
    ListNode(int x) {{ val = x; }}
}}

class TreeNode {{
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int x) {{ val = x; }}
}}

{code}
"""
        return wrapper

    return None

def generate_java_test_calls(code: str, test_cases: list):
    """
    Helper to generate hardcoded Java calls for each test case.
    Handles primitives, arrays, and basic data structures like ListNode.
    """
    # Detect if we need special handling for ListNode (based on code context)
    needs_list_node = "ListNode" in code
    needs_tree_node = "TreeNode" in code

    calls = []
    for tc in test_cases:
        inp = tc.get('input', {})
        expected = str(tc.get('expected', '')).replace('\\', '\\\\').replace('"', '\\"')
        tc_id = tc.get('id')
        
        args = []
        inputs = inp if isinstance(inp, dict) else {"input": inp}
        
        for k, v in inputs.items():
            # Auto-heal stringified arrays
            if isinstance(v, str) and v.strip().startswith('[') and v.strip().endswith(']'):
                try:
                    import json
                    v = json.loads(v)
                except:
                    pass
                    
            if isinstance(v, list):
                if all(isinstance(x, int) for x in v):
                    arr_init = f"new int[]{{{','.join(map(str, v))}}}"
                    if needs_list_node and (k == 'head' or 'list' in k.lower()):
                         args.append(f"Main.buildList({arr_init})")
                    else:
                         args.append(arr_init)
                elif all(isinstance(x, str) for x in v):
                    quoted_values = ",".join([f'"{x}"' for x in v])
                    args.append(f"new String[]{{{quoted_values}}}")
                else:
                    args.append("null")
            elif isinstance(v, str):
                args.append(f"\"{v}\"")
            elif isinstance(v, (int, float, bool)):
                args.append(str(v).lower())
            else:
                args.append("null")
        
        arg_str = ", ".join(args)

        calls.append(f"""
        try {{
            Object actual = targetMethod.invoke(solution, {arg_str});
            System.out.print("{{\\"id\\":{tc_id},\\"status\\":\\"executed\\",\\"output\\":\\"" + Main.stringify(actual).replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\",\\"expected\\":\\"{expected}\\"}}\\n");
        }} catch (InvocationTargetException e) {{
            Throwable cause = e.getCause();
            System.out.print("{{\\"id\\":{tc_id},\\"status\\":\\"error\\",\\"output\\":\\"" + (cause.getMessage() != null ? cause.getMessage() : "Runtime Error").replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\",\\"expected\\":\\"{expected}\\"}}\\n");
        }} catch (Exception e) {{
            System.out.print("{{\\"id\\":{tc_id},\\"status\\":\\"error\\",\\"output\\":\\"" + (e.getMessage() != null ? e.getMessage() : "Execution Error").replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\",\\"expected\\":\\"{expected}\\"}}\\n");
        }}""")
            
    return "\n".join(calls)

def analyze_error(code: str, error_message: str):
    """
    Analyzes execution error to provide hints.
    """
    if not GROQ_API_KEY:
        return "Analysis unavailable."

    prompt = f"""
    Analyze this Code Execution Error.
    
    User Code:
    {code[:1000]}
    
    Error Output:
    {error_message}
    
    Task: Explain the error in 2 simple sentences. Suggest a fix.
    
    Return JSON: {{ "feedback": "Your explanation here." }}
    """
    
    try:
        data = call_llm(prompt)
        if isinstance(data, dict):
            return data.get("feedback", "Check your syntax.")
    except Exception as e:
        print(f"Analysis Error: {e}")
        import traceback
        traceback.print_exc()
        
    return "Check your syntax and logic."




def generate_aptitude_questions(config: dict):
    topics = config.get("topics", ["General Aptitude"])
    difficulty = config.get("difficulty", "Medium")
    count = int(config.get("qCount", 10))
    limit = min(count, 30) # Cap at 30 to avoid timeout/token limits

    custom_notes = config.get("description", "")
    
    prompt = f"""
    Generate {limit} multiple-choice aptitude questions.
    Primary Topics: {', '.join(topics)}
    Difficulty: {difficulty}
    
    {"CRITICAL INSTRUCTION: " + custom_notes if custom_notes else ""}
    
    If custom instructions are provided above, prioritize them over Primary Topics.
    
    Return ONLY a raw JSON array of objects. No markdown formatting.
    Each object must have:
    - id: integer (1 to {limit})
    - question: string
    - options: array of 4 strings
    - correct: integer (index of correct option: 0-3)

    Example format:
    [
        {{"id": 1, "question": "What is 2+2?", "options": ["3", "4", "5", "6"], "correct": 1}}
    ]
    """

    return call_llm(prompt)

def generate_coding_questions(config: dict):
    topics = config.get("topics", ["Algorithms"])
    if not isinstance(topics, list): topics = ["Algorithms"]
    difficulty = config.get("difficulty", "Medium")
    tc_count = config.get("testIntensity") or config.get("testCaseCount", 3)
    try: tc_count = int(tc_count)
    except: tc_count = 3
    count = config.get("questionCount") or config.get("problemCount", 1)
    try: count = int(count)
    except: count = 1
    custom_notes = config.get("description", "")
    
    import time
    example_tcs = []
    for i in range(1, tc_count + 1):
        example_tcs.append({
            "id": i,
            "input": {"nums": [i, i * 2]},
            "expected": i * 3
        })
    example_tcs_json = json.dumps(example_tcs).replace("{", "{{").replace("}", "}}")

    prompt = f"""
    Generate {count} UNIQUE and varied professional coding challenge problem(s) similar to LeetCode.
    Current Time/Seed: {time.time()} (Ensure problems are different from previous generations)
    Primary Topics: {', '.join(topics)}
    Difficulty: {difficulty}
    
    {"CRITICAL INSTRUCTION: " + custom_notes if custom_notes else ""}
    
    STRICT TOPIC RESTRICTIONS (MUST FOLLOW):
    - ALLOWED topics: Arrays, Strings, HashMaps, Math, Sorting, Sliding Window, Two Pointers, Binary Search, Dynamic Programming, Stack/Queue, Matrix, Prefix Sum, Frequency Counting.
    - FORBIDDEN topics: Linked Lists, Trees, Graphs, Heaps, Tries, anything requiring Circular References, anything where test case input can NOT be expressed as a simple integer, string, array of integers, or array of strings.
    - If the selected topic would require Linked List or Tree structures in the test input, SWITCH to an Array-based variant of the same problem.
    
    GUIDELINES:
    1. Problem Statement: TECHNICAL, detailed, and clear. Explain the goal thoroughly.
    2. Constraints: Provide a list of at least 3 technical constraints (e.g., "1 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9").
    3. Examples: EXACTLY 3 examples (no more, no less). Each MUST have "input", "output", and a detailed "explanation". Use real array/integer values, not descriptive text.
    4. Signatures (STRICT): 
       - Java: `public <type> solve(<params>)` inside `class Solution`.
       - Python: `def solve(<params>):`
       - **CRITICAL**: The method name MUST be exactly `solve`. Do NOT name it based on the problem (e.g., do not use `threeSum`).
    5. Starter Code: Professional indentation (4 spaces).
    6. Languages: ONLY Java and Python.
    7. Test Cases: Exactly {tc_count} test cases. "input" MUST be an object mapping parameter names to SIMPLE values ONLY: integers, strings, arrays of integers, or arrays of strings. NO nested objects. NO null values in input. "expected" MUST be the actual raw expected value (int, string, bool, or simple array).
    8. LOGICAL VERIFICATION: Before returning, cross-check every 'testCase' and 'example' against your 'description'. Ensure every single test case follows the rules defined in the description exactly.
    
    JSON STRUCTURE TO RETURN:
    [
        {{
            "id": 1,
            "title": "Short Title",
            "description": "Full technical description...",
            "constraints": ["1 <= n <= 100", "nums.length == n", "-10^4 <= nums[i] <= 10^4"],
            "starterCode": {{
                "java": "class Solution {{\\n    public int solve(int[] nums) {{\\n        \\n    }}\\n}}",
                "python": "def solve(nums):\\n    pass"
            }},
            "testCases": {example_tcs_json},
            "examples": [
                {{"input": "nums = [1, 2]", "output": "3", "explanation": "1 + 2 = 3, so the answer is 3."}},
                {{"input": "nums = [5, 10]", "output": "15", "explanation": "5 + 10 = 15, so the answer is 15."}},
                {{"input": "nums = [0, 0]", "output": "0", "explanation": "0 + 0 = 0, so the answer is 0."}}
            ]
        }}
    ]
    
    Return ONLY the raw JSON array. No explanations, no code examples, no markdown after the JSON.
    """
    
    try:
        data = call_llm(prompt) # Expecting JSON
        
        # Post-process templates
        if isinstance(data, list):
            for q in data:
                if 'starterCode' not in q:
                     # Fallback mapping from old keys if AI mixed them up
                     q['starterCode'] = {
                        'java': q.get('code_java', ''),
                        'python': q.get('code_python', ''),
                     }
                # CLEANUP: Force rename method to 'solve' and strip any solution body
                clean_starter_code(q)
                
                # GUARANTEE: Ensure exactly 3 examples by building from testCases if needed
                examples = q.get('examples', [])
                test_cases = q.get('testCases', [])
                
                # Build synthetic examples from test cases if AI gave fewer than 3
                if len(examples) < 3 and test_cases:
                    for tc in test_cases:
                        if len(examples) >= 3:
                            break
                        inp = tc.get('input', {})
                        expected = tc.get('expected', '')
                        # Format input as LeetCode style: "param = value, param2 = value2"
                        if isinstance(inp, dict):
                            input_str = ', '.join(
                                f"{k} = {json.dumps(v)}" for k, v in inp.items()
                            )
                        else:
                            input_str = str(inp)
                        output_str = json.dumps(expected) if not isinstance(expected, str) else expected
                        # Avoid duplicate examples
                        already_exists = any(e.get('input') == input_str for e in examples)
                        if not already_exists:
                            examples.append({
                                'input': input_str,
                                'output': output_str,
                                'explanation': f"For input {input_str}, the expected output is {output_str}."
                            })
                q['examples'] = examples
                
                # ENFORCE: Slice testCases to EXACTLY the admin-configured count
                # This prevents the AI from showing more tabs than the admin set
                if q.get('testCases') and len(q['testCases']) > tc_count:
                    q['testCases'] = q['testCases'][:tc_count]
                # Reassign sequential IDs to avoid gaps
                for i, tc in enumerate(q.get('testCases', [])):
                    tc['id'] = i + 1
                    
                # GUARANTEE: Ensure constraints is never empty
                if not q.get('constraints'):
                    q['constraints'] = ["1 <= input size <= 10^4", "Values can be negative or positive"]
                    
        return data
    except Exception as e:
        print(f"Evaluation Error: {e}")
        import traceback
        traceback.print_exc()
        return []

def clean_starter_code(q: dict):
    """
    Programmatically strips the body of the solving method and renames it to 'solve'.
    Handles cases where the AI names the function based on the problem title.
    """
    sc = q.get('starterCode', {})
    
    # --- Clean Python ---
    if sc.get('python'):
        py = sc['python']
        # First: rename any existing function to 'solve' (AI sometimes uses problem-specific names)
        # Match: def anyFunctionName(params): and rename to def solve(params):
        renamed = re.sub(r'def\s+\w+\s*(\(.*?\)\s*:)', r'def solve\1', py, count=1)
        # Extract the clean signature
        match = re.search(r'(def\s+solve\s*\(.*?\)\s*:)', renamed)
        if match:
            sc['python'] = f"{match.group(1)}\n    pass"
        else:
            # Fallback: if nothing matched, set a basic template
            sc['python'] = "def solve(input_data):\n    pass"

    # --- Clean Java ---
    if sc.get('java'):
        java = sc['java']
        # First: rename any public method to 'solve'
        # Match: public <returnType> anyMethodName( -> public <returnType> solve(
        renamed = re.sub(
            r'(public\s+[\w<>\[\]]+\s+)(\w+)(\s*\()',
            lambda m: m.group(1) + 'solve' + m.group(3),
            java,
            count=1
        )
        # Now extract the clean class+method signature
        match = re.search(r'(class\s+Solution\s*\{.*?\s+public\s+[\w<>\[\]]+\s+solve\s*\(.*?\)\s*\{)', renamed, re.DOTALL)
        if match:
            sig = match.group(1)
            ret_match = re.search(r'public\s+([\w<>\[\]]+)\s+solve', sig)
            ret_type = ret_match.group(1) if ret_match else "int"
            
            placeholder = "0"
            if ret_type == "String": placeholder = '""'
            elif ret_type == "boolean": placeholder = "false"
            elif "[]" in ret_type or "List" in ret_type: placeholder = "null"
            elif ret_type == "void": placeholder = ""
            
            sc['java'] = f"{sig}\n        // TODO: Implement solution\n        " + (f"return {placeholder};" if placeholder else "") + "\n    }\n}"

def extract_json_block(text: str) -> str:
    # Find the first opening character ('[' or '{')
    start_idx = -1
    start_char = None
    end_char = None
    
    for i, char in enumerate(text):
        if char in ('[', '{'):
            start_idx = i
            start_char = char
            end_char = ']' if char == '[' else '}'
            break
            
    if start_idx == -1:
        return ""
        
    count = 0
    in_string = False
    escape = False
    
    for i in range(start_idx, len(text)):
        char = text[i]
        if escape:
            escape = False
            continue
        if char == '\\':
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char == start_char:
                count += 1
            elif char == end_char:
                count -= 1
                if count == 0:
                    return text[start_idx:i+1]
    return ""

def call_llm(prompt, retries=2):
    data = {
        "model": groq_client.get_groq_model(), 
        "messages": [
            {"role": "system", "content": "You are a helpful AI that generates assessment questions in strict JSON format."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7
    }

    for attempt in range(retries):
        try:
            response = groq_client.execute_groq_request(GROQ_API_URL, data, timeout=30)
            if response.status_code != 200:
                print(f"LLM API Error (Attempt {attempt+1}): {response.status_code} - {response.text}")
                continue # Retry

            result = response.json()
            content = result['choices'][0]['message']['content']
            
            # Robust JSON extraction using matching block parser
            block = extract_json_block(content)
            if block:
                try:
                    return json.loads(block)
                except Exception as parse_err:
                    print(f"Direct block parse failed, attempting fallback healing: {parse_err}")
            
            # Fallback parse & heal common issues
            clean_content = block.strip() if block else content.strip()
            if clean_content.startswith("```"):
                import re
                clean_content = re.sub(r'^```(?:json)?\s*', '', clean_content)
                clean_content = re.sub(r'\s*```$', '', clean_content)
            clean_content = clean_content.strip()
            
            # Extract main JSON block
            first_bracket = clean_content.find('[')
            if first_bracket == -1:
                first_bracket = clean_content.find('{')
            last_bracket = clean_content.rfind(']')
            if last_bracket == -1:
                last_bracket = clean_content.rfind('}')
                
            if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
                clean_content = clean_content[first_bracket:last_bracket+1]
                
            # Heal trailing commas in arrays/objects
            import re
            clean_content = re.sub(r',\s*([\]}])', r'\1', clean_content)
            
            try:
                return json.loads(clean_content)
            except json.JSONDecodeError:
                # Last resort Single-Quote healing
                try:
                    healed = re.sub(r"([{,]\s*)'([^']+)'\s*:", r'\1"\2":', clean_content)
                    healed = re.sub(r"'\s*([,}])", r'"\1', healed)
                    healed = re.sub(r"([{,]\s*)'", r'\1"', healed)
                    return json.loads(healed)
                except Exception as final_err:
                    raise final_err
            
        except Exception as e:
            print(f"LLM Call Failed (Attempt {attempt+1}): {e}")
            if attempt == retries - 1:
                return [] # Give up after last retry
            import time
            time.sleep(1) # Wait 1s before retry
            
    return []
