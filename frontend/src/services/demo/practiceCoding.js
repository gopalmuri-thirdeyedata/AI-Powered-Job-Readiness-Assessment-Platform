// Sample data for the Student Dashboard Demo: the Practice page (studentApi) and the Coding platform (codingApi).
// Everything is made up and answered offline: no network, no code runner. Run / Submit "judge" the code with simple rules
// (does it define the method, does it return something, does it loop forever) and compute outputs with small reference
// functions below, so examples, custom test cases and failures look like the real platform's.
//
// Shapes mirror the API responses the pages read. State lives in this module, so solving, bookmarking and submitting update
// what the pages show next, until the browser tab is reloaded.

const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoDay = (offsetDays = 0) => new Date(Date.now() - offsetDays * DAY).toISOString().slice(0, 10);
const isoTime = (offsetDays = 0) => new Date(Date.now() - offsetDays * DAY).toISOString();
const demoError = (status, detail) => Object.assign(new Error(detail), { response: { status, data: { detail } } });
const json = (v) => JSON.stringify(v);

/* ═══════════════════════════ Practice (studentApi) ═══════════════════════════ */

const py = (fn, args) => `def ${fn}(${args}):\n    # Write your solution here\n    pass\n`;

// answer / explanation / hidden never leave this module through getPracticeQuestions
const PRACTICE = [
    { id: 1, topic: 'Arrays', category: 'CODING', difficulty: 'Easy', title: 'Two Sum', solved: true,
      description: 'Given a list of integers nums and an integer target, return the indices of the two numbers that add up to target. Exactly one pair exists and you may not use the same element twice.',
      starter: py('two_sum', 'nums, target'), hidden: 2,
      tests: [{ input: 'nums=[2,7,11,15], target=9', expected_output: '[0, 1]' }, { input: 'nums=[3,2,4], target=6', expected_output: '[1, 2]' }] },
    { id: 2, topic: 'Arrays', category: 'CODING', difficulty: 'Easy', title: 'Merge Two Sorted Arrays', solved: false,
      description: 'Merge two sorted lists a and b into a single sorted list and return it.',
      starter: py('merge_sorted', 'a, b'), hidden: 2,
      tests: [{ input: 'a=[1,3,5], b=[2,4,6]', expected_output: '[1, 2, 3, 4, 5, 6]' }, { input: 'a=[], b=[7]', expected_output: '[7]' }] },
    { id: 3, topic: 'Stacks & Queues', category: 'CODING', difficulty: 'Easy', title: 'Valid Parentheses', solved: true,
      description: 'Given a string s of brackets ()[]{}, return True if every opening bracket is closed by the same type in the correct order.',
      starter: py('is_valid', 's'), hidden: 3,
      tests: [{ input: 's="()[]{}"', expected_output: 'True' }, { input: 's="(]"', expected_output: 'False' }] },
    { id: 4, topic: 'Searching', category: 'CODING', difficulty: 'Easy', title: 'Binary Search', solved: false,
      description: 'Given a sorted list nums and a target, return the index of target, or -1 if it is not present. Aim for O(log n).',
      starter: py('binary_search', 'nums, target'), hidden: 2,
      tests: [{ input: 'nums=[-1,0,3,5,9,12], target=9', expected_output: '4' }, { input: 'nums=[-1,0,3,5,9,12], target=2', expected_output: '-1' }] },
    { id: 5, topic: 'Strings', category: 'CODING', difficulty: 'Medium', title: 'Longest Substring Without Repeating Characters', solved: false,
      description: 'Return the length of the longest substring of s that contains no repeated character.',
      starter: py('length_of_longest_substring', 's'), hidden: 3,
      tests: [{ input: 's="abcabcbb"', expected_output: '3' }, { input: 's="bbbbb"', expected_output: '1' }] },
    { id: 6, topic: 'Dynamic Programming', category: 'CODING', difficulty: 'Easy', title: 'Climbing Stairs', solved: false,
      description: 'You can climb 1 or 2 steps at a time. In how many distinct ways can you climb a staircase of n steps?',
      starter: py('climb_stairs', 'n'), hidden: 2,
      tests: [{ input: 'n=2', expected_output: '2' }, { input: 'n=5', expected_output: '8' }] },
    { id: 7, topic: 'Dynamic Programming', category: 'CODING', difficulty: 'Medium', title: 'Maximum Subarray', solved: false,
      description: 'Find the contiguous subarray of nums with the largest sum and return that sum (Kadane\'s algorithm).',
      starter: py('max_subarray', 'nums'), hidden: 2,
      tests: [{ input: 'nums=[-2,1,-3,4,-1,2,1,-5,4]', expected_output: '6' }, { input: 'nums=[1]', expected_output: '1' }] },
    { id: 8, topic: 'Graphs', category: 'CODING', difficulty: 'Medium', title: 'Number of Islands', solved: false,
      description: 'Given a grid of "1" (land) and "0" (water), count the islands. An island is land connected horizontally or vertically.',
      starter: py('num_islands', 'grid'), hidden: 2,
      tests: [{ input: 'grid=[["1","1","0"],["0","1","0"],["0","0","1"]]', expected_output: '2' }, { input: 'grid=[["0"]]', expected_output: '0' }] },
    { id: 9, topic: 'Quantitative Aptitude', category: 'APTITUDE', difficulty: 'Easy', title: 'Percentage Increase', solved: true,
      description: 'A salary rises from 40,000 to 46,000. What is the percentage increase?',
      options: [{ key: 'A', text: '12%' }, { key: 'B', text: '15%' }, { key: 'C', text: '18%' }, { key: 'D', text: '20%' }], answer: 'B',
      explanation: 'Increase = 6,000. Percentage increase = 6,000 / 40,000 x 100 = 15%.' },
    { id: 10, topic: 'Quantitative Aptitude', category: 'APTITUDE', difficulty: 'Medium', title: 'Time and Work', solved: false,
      description: 'A can finish a job in 12 days and B in 18 days. Working together, in how many days will they finish it?',
      options: [{ key: 'A', text: '6.5 days' }, { key: 'B', text: '7.2 days' }, { key: 'C', text: '8 days' }, { key: 'D', text: '9 days' }], answer: 'B',
      explanation: 'Combined rate = 1/12 + 1/18 = 5/36 per day, so the job takes 36/5 = 7.2 days.' },
    { id: 11, topic: 'Quantitative Aptitude', category: 'APTITUDE', difficulty: 'Easy', title: 'Profit and Loss', solved: false,
      description: 'An article bought for 500 is sold at a 20% profit. What is the selling price?',
      options: [{ key: 'A', text: '580' }, { key: 'B', text: '600' }, { key: 'C', text: '620' }, { key: 'D', text: '650' }], answer: 'B',
      explanation: 'Selling price = cost price x 1.20 = 500 x 1.2 = 600.' },
    { id: 12, topic: 'Logical Reasoning', category: 'APTITUDE', difficulty: 'Easy', title: 'Number Series', solved: true,
      description: 'Find the next number in the series: 2, 6, 12, 20, 30, ?',
      options: [{ key: 'A', text: '40' }, { key: 'B', text: '42' }, { key: 'C', text: '44' }, { key: 'D', text: '36' }], answer: 'B',
      explanation: 'The differences are 4, 6, 8, 10, so the next difference is 12 and the next term is 30 + 12 = 42.' },
    { id: 13, topic: 'Logical Reasoning', category: 'APTITUDE', difficulty: 'Medium', title: 'Blood Relations', solved: false,
      description: 'Pointing to a photograph, Riya says, "He is the son of my mother\'s only brother." How is the man in the photograph related to Riya?',
      options: [{ key: 'A', text: 'Brother' }, { key: 'B', text: 'Cousin' }, { key: 'C', text: 'Uncle' }, { key: 'D', text: 'Nephew' }], answer: 'B',
      explanation: 'Her mother\'s only brother is her maternal uncle, and his son is her cousin.' },
    { id: 14, topic: 'Verbal Ability', category: 'APTITUDE', difficulty: 'Easy', title: 'Synonyms', solved: false,
      description: 'Choose the word closest in meaning to "BRIEF".',
      options: [{ key: 'A', text: 'Lengthy' }, { key: 'B', text: 'Concise' }, { key: 'C', text: 'Vague' }, { key: 'D', text: 'Careful' }], answer: 'B',
      explanation: '"Brief" means short and to the point, which is "concise".' },
];

const publicQuestion = (q) => ({
    id: q.id, topic: q.topic, category: q.category, difficulty: q.difficulty, title: q.title, description: q.description,
    options: q.options || null,
    starter_code: q.category === 'CODING' ? { python: q.starter } : null,
    public_test_cases: q.tests || [],
    is_solved: q.solved,
});

const stripComments = (code) => String(code || '').split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
const hasRealReturn = (code) => /\breturn\b(?!\s*(None)?\s*$)/m.test(stripComments(code));

// Every topic with its progress, computed from the current state
const topicOverview = () => {
    const seen = [];
    PRACTICE.forEach((q) => { if (!seen.some((t) => t.topic === q.topic)) seen.push({ topic: q.topic, category: q.category }); });
    return seen.map(({ topic, category }) => {
        const all = PRACTICE.filter((q) => q.topic === topic);
        const solved = all.filter((q) => q.solved).length;
        return { topic, category, total_questions: all.length, solved_count: solved, completion_rate: Math.round((solved / all.length) * 1000) / 10 };
    });
};

const practiceHandlers = {
    getPracticeTopics: () => topicOverview(),

    getPracticeQuestions: (topic = null, category = null) => PRACTICE
        .filter((q) => (!topic || q.topic === topic) && (!category || q.category === category))
        .map(publicQuestion),

    async submitPracticeAttempt(questionId, code = null, language = null, selectedOption = null) {
        const q = PRACTICE.find((item) => item.id === Number(questionId));
        if (!q) throw demoError(404, 'Question not found.');
        await sleep(q.category === 'CODING' ? 700 : 250);

        if (q.category === 'APTITUDE') {
            const correct = selectedOption === q.answer;
            if (correct) q.solved = true;
            return {
                question_id: q.id, is_correct: correct, tests_passed: correct ? 1 : 0, total_tests: 1, public_results: [],
                feedback: correct ? `Correct! ${q.explanation}` : `Incorrect choice '${selectedOption}'. Read the explanation below and try the next one.`,
                explanation: q.explanation,
            };
        }

        const total = q.tests.length + q.hidden;
        if (!String(code || '').trim() || !hasRealReturn(code)) {
            return {
                question_id: q.id, is_correct: false, tests_passed: 0, total_tests: total,
                feedback: 'Your function returned None. Return the computed answer and submit again.',
                public_results: q.tests.map((t, i) => ({ test_case_number: i + 1, passed: false, expected_output: t.expected_output, actual_output: 'None' })),
                explanation: null,
            };
        }
        if (/while\s+True\s*:/.test(stripComments(code)) && !/\bbreak\b/.test(code)) {
            return {
                question_id: q.id, is_correct: false, tests_passed: 0, total_tests: total,
                feedback: 'Time Limit Exceeded: your code did not finish on the first test case.',
                public_results: q.tests.map((t, i) => ({ test_case_number: i + 1, passed: false, expected_output: t.expected_output, actual_output: '' })),
                explanation: null,
            };
        }
        q.solved = true;
        return {
            question_id: q.id, is_correct: true, tests_passed: total, total_tests: total,
            feedback: `All ${total} test cases passed.`,
            public_results: q.tests.map((t, i) => ({ test_case_number: i + 1, passed: true, expected_output: t.expected_output, actual_output: t.expected_output })),
            explanation: null,
        };
    },
};

/* ═══════════════════════════ Coding platform (codingApi) ═══════════════════════════ */

const starter = (defs, fn, sig, ret) => `${defs}class Solution:\n    def ${fn}(self, ${sig}) -> ${ret}:\n        \n`;
const LIST_IMPORT = 'from typing import List\n\n';

// ref: the reference answer, used for example outputs, hidden test expectations and custom test cases
const PROBLEMS = [
    { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', tags: ['Array', 'Hash Table'], accept: 51.3,
      fn: 'twoSum', params: ['nums', 'target'], sig: 'nums: List[int], target: int', ret: 'List[int]',
      description: 'Given an array of integers `nums` and an integer `target`, return the **indices** of the two numbers that add up to `target`.\n\nYou may assume each input has exactly one solution, and you may not use the same element twice. Return the answer in any order.',
      constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', 'Exactly one valid answer exists.'],
      hints: ['A brute force check of every pair is O(n^2). Can you remember what you have already seen?', 'Store each number with its index in a dictionary and look up `target - x`.'],
      examples: [[[2, 7, 11, 15], 9, 'nums[0] + nums[1] == 9, so the answer is [0,1].'], [[3, 2, 4], 6, ''], [[3, 3], 6, '']],
      hidden: [[[1, 5, 9, 14], 14], [[-3, 4, 3, 90], 0], [[0, 4, 3, 0], 0]],
      ref: (nums, target) => { for (let i = 0; i < nums.length; i += 1) for (let j = i + 1; j < nums.length; j += 1) if (nums[i] + nums[j] === target) return [i, j]; return []; },
      solution: 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n',
      explanation: 'Walk the array once and keep a dictionary of value -> index. For each number look up its complement. O(n) time, O(n) space.' },
    { slug: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'Easy', tags: ['String', 'Stack'], accept: 40.7,
      fn: 'isValid', params: ['s'], sig: 's: str', ret: 'bool',
      description: 'Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.\n\nAn input string is valid if:\n\n- Open brackets are closed by the same type of bracket.\n- Open brackets are closed in the correct order.',
      constraints: ['1 <= s.length <= 10^4', 's consists of parentheses only: ()[]{}'],
      hints: ['Think of the most recent unmatched opening bracket: which data structure gives it to you first?'],
      examples: [['()', 'The brackets match.'], ['()[]{}', ''], ['(]', 'A round bracket is closed by a square one.']],
      hidden: [['([)]'], ['{[]}'], ['(((']],
      ref: (s) => { const st = []; const m = { ')': '(', ']': '[', '}': '{' }; for (const c of s) { if ('([{'.includes(c)) st.push(c); else if (st.pop() !== m[c]) return false; } return st.length === 0; },
      solution: 'class Solution:\n    def isValid(self, s):\n        stack, pair = [], {")": "(", "]": "[", "}": "{"}\n        for c in s:\n            if c in pair:\n                if not stack or stack.pop() != pair[c]:\n                    return False\n            else:\n                stack.append(c)\n        return not stack\n',
      explanation: 'Push opening brackets on a stack; each closing bracket must match the top. The string is valid if the stack is empty at the end.' },
    { slug: 'best-time-to-buy-and-sell-stock', title: 'Best Time to Buy and Sell Stock', difficulty: 'Easy', tags: ['Array', 'Dynamic Programming'], accept: 54.1,
      fn: 'maxProfit', params: ['prices'], sig: 'prices: List[int]', ret: 'int',
      description: 'You are given an array `prices` where `prices[i]` is the price of a stock on day `i`.\n\nChoose one day to buy and a **later** day to sell to maximise profit. Return the maximum profit, or `0` if no profit is possible.',
      constraints: ['1 <= prices.length <= 10^5', '0 <= prices[i] <= 10^4'],
      hints: ['Track the lowest price seen so far while scanning left to right.'],
      examples: [[[7, 1, 5, 3, 6, 4], 'Buy at 1, sell at 6: profit 5.'], [[7, 6, 4, 3, 1], 'Prices only fall, so no profit.']],
      hidden: [[[2, 4, 1]], [[1, 2]], [[3, 3, 3, 3]]],
      ref: (p) => { let lo = Infinity; let best = 0; for (const x of p) { lo = Math.min(lo, x); best = Math.max(best, x - lo); } return best; },
      solution: 'class Solution:\n    def maxProfit(self, prices):\n        lo, best = float("inf"), 0\n        for p in prices:\n            lo = min(lo, p)\n            best = max(best, p - lo)\n        return best\n',
      explanation: 'One pass: remember the cheapest price so far and the best profit if you sold today. O(n) time, O(1) space.' },
    { slug: 'binary-search', title: 'Binary Search', difficulty: 'Easy', tags: ['Array', 'Binary Search'], accept: 56.8,
      fn: 'search', params: ['nums', 'target'], sig: 'nums: List[int], target: int', ret: 'int',
      description: 'Given a sorted array `nums` of distinct integers and an integer `target`, return the index of `target` or `-1` if it is not in the array.\n\nYour algorithm must run in **O(log n)** time.',
      constraints: ['1 <= nums.length <= 10^4', 'All values in nums are unique and sorted in ascending order.'],
      hints: ['Compare the middle element with the target and discard half of the range each step.'],
      examples: [[[-1, 0, 3, 5, 9, 12], 9, '9 exists at index 4.'], [[-1, 0, 3, 5, 9, 12], 2, '2 is not in the array.']],
      hidden: [[[5], 5], [[1, 3, 5, 7, 9, 11, 13], 1], [[1, 3, 5, 7, 9, 11, 13], 14]],
      ref: (nums, t) => { let lo = 0; let hi = nums.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (nums[mid] === t) return mid; if (nums[mid] < t) lo = mid + 1; else hi = mid - 1; } return -1; },
      solution: 'class Solution:\n    def search(self, nums, target):\n        lo, hi = 0, len(nums) - 1\n        while lo <= hi:\n            mid = (lo + hi) // 2\n            if nums[mid] == target:\n                return mid\n            if nums[mid] < target:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n        return -1\n',
      explanation: 'Keep a [lo, hi] window and halve it each step by comparing the middle value with the target.' },
    { slug: 'climbing-stairs', title: 'Climbing Stairs', difficulty: 'Easy', tags: ['Math', 'Dynamic Programming'], accept: 52.4,
      fn: 'climbStairs', params: ['n'], sig: 'n: int', ret: 'int',
      description: 'You are climbing a staircase with `n` steps. Each time you can climb **1 or 2** steps.\n\nIn how many distinct ways can you climb to the top?',
      constraints: ['1 <= n <= 45'],
      hints: ['The ways to reach step n come from step n-1 and step n-2.'],
      examples: [[2, 'Two ways: 1+1 and 2.'], [3, 'Three ways: 1+1+1, 1+2 and 2+1.']],
      hidden: [[1], [10], [30]],
      ref: (n) => { let a = 1; let b = 1; for (let i = 1; i < n; i += 1) [a, b] = [b, a + b]; return b; },
      solution: 'class Solution:\n    def climbStairs(self, n):\n        a, b = 1, 1\n        for _ in range(n - 1):\n            a, b = b, a + b\n        return b\n',
      explanation: 'It is the Fibonacci recurrence ways(n) = ways(n-1) + ways(n-2). Keep only the last two values.' },
    { slug: 'longest-substring-without-repeating-characters', title: 'Longest Substring Without Repeating Characters', difficulty: 'Medium', tags: ['String', 'Sliding Window'], accept: 34.9,
      fn: 'lengthOfLongestSubstring', params: ['s'], sig: 's: str', ret: 'int',
      description: 'Given a string `s`, find the length of the **longest substring** without repeating characters.',
      constraints: ['0 <= s.length <= 5 * 10^4', 's consists of English letters, digits, symbols and spaces.'],
      hints: ['Slide a window and move its left edge past the previous copy of a repeated character.'],
      examples: [['abcabcbb', 'The answer is "abc", with length 3.'], ['bbbbb', 'The answer is "b", with length 1.'], ['pwwkew', 'The answer is "wke", with length 3.']],
      hidden: [[''], ['dvdf'], ['abba']],
      ref: (s) => { const last = {}; let start = 0; let best = 0; for (let i = 0; i < s.length; i += 1) { if (last[s[i]] !== undefined && last[s[i]] >= start) start = last[s[i]] + 1; last[s[i]] = i; best = Math.max(best, i - start + 1); } return best; },
      solution: 'class Solution:\n    def lengthOfLongestSubstring(self, s):\n        last, start, best = {}, 0, 0\n        for i, c in enumerate(s):\n            if c in last and last[c] >= start:\n                start = last[c] + 1\n            last[c] = i\n            best = max(best, i - start + 1)\n        return best\n',
      explanation: 'A sliding window with a dictionary of last-seen positions: when a character repeats inside the window, move the start just after its previous position.' },
    { slug: 'maximum-subarray', title: 'Maximum Subarray', difficulty: 'Medium', tags: ['Array', 'Dynamic Programming'], accept: 50.2,
      fn: 'maxSubArray', params: ['nums'], sig: 'nums: List[int]', ret: 'int',
      description: 'Given an integer array `nums`, find the contiguous subarray (containing at least one number) with the **largest sum**, and return its sum.',
      constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4'],
      hints: ['At each position decide: extend the running subarray or start a new one here.'],
      examples: [[[-2, 1, -3, 4, -1, 2, 1, -5, 4], 'The subarray [4,-1,2,1] has the largest sum 6.'], [[1], ''], [[5, 4, -1, 7, 8], 'The whole array sums to 23.']],
      hidden: [[[-3, -1, -2]], [[2, -1, 2, -1, 2]], [[0]]],
      ref: (nums) => { let cur = nums[0]; let best = nums[0]; for (let i = 1; i < nums.length; i += 1) { cur = Math.max(nums[i], cur + nums[i]); best = Math.max(best, cur); } return best; },
      solution: 'class Solution:\n    def maxSubArray(self, nums):\n        cur = best = nums[0]\n        for x in nums[1:]:\n            cur = max(x, cur + x)\n            best = max(best, cur)\n        return best\n',
      explanation: 'Kadane\'s algorithm: the best subarray ending here is either the element alone or the element added to the best ending at the previous position.' },
    { slug: 'product-of-array-except-self', title: 'Product of Array Except Self', difficulty: 'Medium', tags: ['Array', 'Prefix Sum'], accept: 65.1,
      fn: 'productExceptSelf', params: ['nums'], sig: 'nums: List[int]', ret: 'List[int]',
      description: 'Given an integer array `nums`, return an array `answer` such that `answer[i]` is the product of all the elements of `nums` **except** `nums[i]`.\n\nYou must write an algorithm that runs in O(n) time and **without using division**.',
      constraints: ['2 <= nums.length <= 10^5', '-30 <= nums[i] <= 30'],
      hints: ['Build the product of everything to the left of each index, then everything to the right.'],
      examples: [[[1, 2, 3, 4], ''], [[-1, 1, 0, -3, 3], 'A zero makes every other product zero.']],
      hidden: [[[2, 3]], [[0, 0, 2]], [[1, 1, 1, 1, 1]]],
      ref: (nums) => nums.map((_, i) => nums.reduce((p, x, j) => (j === i ? p : p * x), 1)),
      solution: 'class Solution:\n    def productExceptSelf(self, nums):\n        n = len(nums)\n        out = [1] * n\n        left = 1\n        for i in range(n):\n            out[i] = left\n            left *= nums[i]\n        right = 1\n        for i in range(n - 1, -1, -1):\n            out[i] *= right\n            right *= nums[i]\n        return out\n',
      explanation: 'Two passes: the first stores the product of everything left of i, the second multiplies in the product of everything right of i.' },
    { slug: 'merge-intervals', title: 'Merge Intervals', difficulty: 'Medium', tags: ['Array', 'Sorting'], accept: 46.0,
      fn: 'merge', params: ['intervals'], sig: 'intervals: List[List[int]]', ret: 'List[List[int]]',
      description: 'Given an array of `intervals` where `intervals[i] = [start, end]`, merge all overlapping intervals and return the non-overlapping intervals that cover all the input, sorted by start.',
      constraints: ['1 <= intervals.length <= 10^4', '0 <= start <= end <= 10^4'],
      hints: ['Sort by start time, then compare each interval with the last merged one.'],
      examples: [[[[1, 3], [2, 6], [8, 10], [15, 18]], '[1,3] and [2,6] overlap and merge into [1,6].'], [[[1, 4], [4, 5]], 'Intervals that touch are merged.']],
      hidden: [[[[1, 4], [0, 4]]], [[[1, 10], [2, 3], [4, 5]]], [[[5, 6]]]],
      ref: (iv) => { const s = iv.map((x) => [...x]).sort((a, b) => a[0] - b[0]); const out = []; for (const x of s) { if (out.length && x[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]); else out.push(x); } return out; },
      solution: 'class Solution:\n    def merge(self, intervals):\n        out = []\n        for s, e in sorted(intervals):\n            if out and s <= out[-1][1]:\n                out[-1][1] = max(out[-1][1], e)\n            else:\n                out.append([s, e])\n        return out\n',
      explanation: 'After sorting by start, an interval either overlaps the last merged one (extend its end) or starts a new group. O(n log n).' },
    { slug: 'trapping-rain-water', title: 'Trapping Rain Water', difficulty: 'Hard', tags: ['Array', 'Two Pointers'], accept: 29.8,
      fn: 'trap', params: ['height'], sig: 'height: List[int]', ret: 'int',
      description: 'Given `n` non-negative integers representing an elevation map where the width of each bar is `1`, compute how much water it can trap after raining.',
      constraints: ['1 <= n <= 2 * 10^4', '0 <= height[i] <= 10^5'],
      hints: ['Water above a bar is limited by the shorter of the tallest bars to its left and right.', 'Two pointers can maintain both maxima in O(1) space.'],
      examples: [[[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1], '6 units of water are trapped.'], [[4, 2, 0, 3, 2, 5], '']],
      hidden: [[[1, 2, 3]], [[3, 0, 3]], [[5, 4, 1, 2]]],
      ref: (h) => { let l = 0; let r = h.length - 1; let lm = 0; let rm = 0; let w = 0; while (l < r) { if (h[l] < h[r]) { lm = Math.max(lm, h[l]); w += lm - h[l]; l += 1; } else { rm = Math.max(rm, h[r]); w += rm - h[r]; r -= 1; } } return w; },
      solution: 'class Solution:\n    def trap(self, height):\n        l, r = 0, len(height) - 1\n        lm = rm = water = 0\n        while l < r:\n            if height[l] < height[r]:\n                lm = max(lm, height[l])\n                water += lm - height[l]\n                l += 1\n            else:\n                rm = max(rm, height[r])\n                water += rm - height[r]\n                r -= 1\n        return water\n',
      explanation: 'Move the pointer at the lower side inwards: the water above it is bounded by the maximum seen on that side. O(n) time, O(1) space.' },
].map((p, i) => ({ ...p, order: i + 1 }));

// examples are stored as [...args, explanation]; hidden as [...args]
const exampleArgs = (p, ex) => ex.slice(0, p.params.length);
const exampleNote = (p, ex) => ex[p.params.length] || '';
const displayArgs = (p, args) => p.params.map((name, i) => `${name} = ${json(args[i])}`).join(', ');
const allCases = (p) => [
    ...p.examples.map((ex) => ({ args: exampleArgs(p, ex), isExample: true })),
    ...p.hidden.map((args) => ({ args, isExample: false })),
].map((c) => ({ ...c, expected: p.ref(...c.args) }));

const bySlug = (slug) => {
    const p = PROBLEMS.find((item) => item.slug === slug);
    if (!p) throw demoError(404, 'Problem not found.');
    return p;
};

/* ── state ── */
let nextSubmissionId = 4100;
const state = {};     // slug -> { bookmarked, submissions: [{id, verdict, code, passed, total, runtime_ms, memory_kb, failed_case, message, created_at}] }
const activity = {};  // UTC day -> submissions that day

const addSubmission = (slug, sub, daysAgo = 0) => {
    const entry = { id: (nextSubmissionId += 1), created_at: isoTime(daysAgo), failed_case: null, message: null, ...sub };
    state[slug].submissions.unshift(entry);
    activity[isoDay(daysAgo)] = (activity[isoDay(daysAgo)] || 0) + 1;
    return entry;
};
PROBLEMS.forEach((p) => { state[p.slug] = { bookmarked: false, submissions: [] }; });

// Seed: a few solved problems, one attempted, a recent streak and some older activity, so the page opens looking used
const seedAccepted = (slug, daysAgo, runtime, memory) => {
    const p = bySlug(slug);
    addSubmission(slug, { verdict: 'ACCEPTED', code: `${p.slug === 'two-sum' ? LIST_IMPORT : ''}${p.solution}`, passed: allCases(p).length, total: allCases(p).length, runtime_ms: runtime, memory_kb: memory }, daysAgo);
};
seedAccepted('two-sum', 0, 52, 15240);
seedAccepted('valid-parentheses', 1, 38, 14180);
seedAccepted('climbing-stairs', 2, 31, 13920);
{
    const p = bySlug('maximum-subarray');
    const cases = allCases(p);
    addSubmission('maximum-subarray', { verdict: 'WRONG_ANSWER', code: 'class Solution:\n    def maxSubArray(self, nums):\n        return sum(nums)\n', passed: 2, total: cases.length, runtime_ms: 29, memory_kb: 14010,
        failed_case: { input: displayArgs(p, cases[0].args), expected: json(cases[0].expected), actual: json(cases[0].args[0].reduce((a, b) => a + b, 0)) } }, 3);
}
[5, 6, 8, 9, 12, 13, 15, 19, 22, 26, 27, 33, 40, 41, 47, 52, 60].forEach((d, i) => { activity[isoDay(d)] = (i % 3) + 1; });
state['two-sum'].bookmarked = true;
state['trapping-rain-water'].bookmarked = true;

const statusOf = (slug) => {
    const subs = state[slug].submissions;
    if (subs.some((s) => s.verdict === 'ACCEPTED')) return 'solved';
    return subs.length ? 'attempted' : 'todo';
};
const dailySlug = () => PROBLEMS[Math.floor(Date.now() / DAY) % PROBLEMS.length].slug;

const listItem = (p) => ({
    slug: p.slug, title: p.title, difficulty: p.difficulty, tags: p.tags, status: statusOf(p.slug), acceptance_rate: p.accept,
    order: p.order, bookmarked: state[p.slug].bookmarked, is_daily: p.slug === dailySlug(),
});

const streakDays = () => {
    let streak = 0;
    let d = 0;
    if (!activity[isoDay(0)]) d = 1;
    while (activity[isoDay(d)]) { streak += 1; d += 1; }
    return streak;
};

const stats = () => {
    const by = { Easy: { solved: 0, total: 0 }, Medium: { solved: 0, total: 0 }, Hard: { solved: 0, total: 0 } };
    PROBLEMS.forEach((p) => { by[p.difficulty].total += 1; if (statusOf(p.slug) === 'solved') by[p.difficulty].solved += 1; });
    const sub = Object.values(state).reduce((n, s) => n + s.submissions.length, 0);
    return {
        solved: PROBLEMS.filter((p) => statusOf(p.slug) === 'solved').length, total: PROBLEMS.length, by_difficulty: by,
        streak_days: streakDays(), activity: { ...activity }, activity_days: 84, submissions: sub,
    };
};

/* ── judging ── */
const judge = (p, code) => {
    const text = stripComments(code);
    if (!String(code || '').trim()) return { fatal: 'COMPILE_ERROR', message: 'Write your solution first: the editor is empty.' };
    if (!/class\s+Solution\b/.test(text) || !new RegExp(`def\\s+${p.fn}\\s*\\(`).test(text)) {
        return { fatal: 'COMPILE_ERROR', message: `Your code must define class Solution with a method named ${p.fn}.` };
    }
    const body = text.slice(text.search(new RegExp(`def\\s+${p.fn}\\s*\\(`)));
    if (!body.split('\n').slice(1).some((l) => l.trim())) return { fatal: 'COMPILE_ERROR', message: `IndentationError: expected an indented block after the definition of ${p.fn}.` };
    if (/while\s+True\s*:/.test(text) && !/\bbreak\b|\breturn\b/.test(body.slice(body.search(/while\s+True/)))) return { fatal: 'TIME_LIMIT_EXCEEDED', message: 'Time Limit Exceeded' };
    if (/\b1\s*\/\s*0\b|\braise\b/.test(text)) return { fatal: 'RUNTIME_ERROR', message: 'ZeroDivisionError: division by zero' };
    return { correct: hasRealReturn(body) };
};

const parseCustomInput = (p, text) => {
    const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length !== p.params.length) {
        throw demoError(400, `Enter ${p.params.length} line${p.params.length === 1 ? '' : 's'}, one JSON value per parameter (${p.params.join(', ')}); got ${lines.length}.`);
    }
    return lines.map((l, i) => {
        try { return JSON.parse(l); } catch { throw demoError(400, `Line ${i + 1} (${p.params[i]}) is not valid JSON: ${l.slice(0, 60)}`); }
    });
};

const runtimeFor = (p, salt = 0) => 24 + ((p.order * 7 + salt * 11) % 41);
const memoryFor = (p) => 13200 + p.order * 310;

const codingHandlers = {
    async getProblems({ difficulty, tag, status, q, bookmarked } = {}) {
        await sleep(120);
        const needle = String(q || '').trim().toLowerCase();
        const items = PROBLEMS.map(listItem).filter((p) => (!difficulty || p.difficulty === difficulty) && (!tag || p.tags.includes(tag))
            && (!status || p.status === status) && (!bookmarked || p.bookmarked) && (!needle || p.title.toLowerCase().includes(needle)));
        const daily = PROBLEMS.map(listItem).find((p) => p.is_daily);
        return {
            problems: items,
            tags: [...new Set(PROBLEMS.flatMap((p) => p.tags))].sort(),
            daily: daily ? { slug: daily.slug, title: daily.title, difficulty: daily.difficulty, status: daily.status } : null,
            bookmarks: PROBLEMS.filter((p) => state[p.slug].bookmarked).length,
            stats: stats(),
        };
    },

    async getProblem(slug) {
        await sleep(120);
        const p = bySlug(slug);
        const subs = state[slug].submissions;
        const solved = statusOf(slug) === 'solved';
        const cases = allCases(p);
        return {
            id: p.order, slug: p.slug, title: p.title, difficulty: p.difficulty, tags: p.tags, description: p.description,
            constraints: p.constraints, hints: p.hints,
            examples: p.examples.map((ex) => ({ input: displayArgs(p, exampleArgs(p, ex)), output: json(p.ref(...exampleArgs(p, ex))), explanation: exampleNote(p, ex) })),
            function_name: p.fn, param_names: p.params,
            starter_code: starter(/List/.test(p.sig + p.ret) ? LIST_IMPORT : '', p.fn, p.sig, p.ret),
            status: statusOf(slug), last_code: subs[0] ? subs[0].code : null, bookmarked: state[slug].bookmarked, is_daily: slug === dailySlug(),
            solution: solved ? { code: p.solution, explanation: p.explanation } : null,
            default_custom_input: cases[0].args.map((a) => json(a)).join('\n'),
            prev_slug: PROBLEMS[p.order - 2]?.slug || null, next_slug: PROBLEMS[p.order]?.slug || null,
        };
    },

    async run(slug, code, customInput) {
        const p = bySlug(slug);
        const customArgs = customInput && String(customInput).trim() ? parseCustomInput(p, customInput) : null;
        await sleep(650);
        const verdictInfo = judge(p, code);
        const examples = p.examples.map((ex) => ({ args: exampleArgs(p, ex), expected: json(p.ref(...exampleArgs(p, ex))) }));
        if (verdictInfo.fatal) return { verdict: verdictInfo.fatal, message: verdictInfo.message, cases: [], passed: 0, total: examples.length + (customArgs ? 1 : 0) };
        const cases = examples.map((e, i) => ({
            input: displayArgs(p, e.args), expected: e.expected, custom: false, stdout: '', runtime_ms: runtimeFor(p, i),
            status: verdictInfo.correct ? 'passed' : 'failed', actual: verdictInfo.correct ? e.expected : 'null',
        }));
        if (customArgs) {
            cases.push({ input: displayArgs(p, customArgs), expected: null, custom: true, stdout: '', runtime_ms: runtimeFor(p, 9), status: 'ran',
                actual: verdictInfo.correct ? json(p.ref(...customArgs)) : 'null' });
        }
        const passed = cases.filter((c) => c.status === 'passed').length;
        return { verdict: verdictInfo.correct ? 'ACCEPTED' : 'WRONG_ANSWER', cases, passed, total: examples.length, message: null };
    },

    async submit(slug, code) {
        const p = bySlug(slug);
        await sleep(900);
        const cases = allCases(p);
        const verdictInfo = judge(p, code);
        let record;
        if (verdictInfo.fatal) {
            record = { verdict: verdictInfo.fatal, code, passed: 0, total: cases.length, runtime_ms: null, memory_kb: null, message: verdictInfo.message };
        } else if (verdictInfo.correct) {
            record = { verdict: 'ACCEPTED', code, passed: cases.length, total: cases.length, runtime_ms: runtimeFor(p, state[slug].submissions.length), memory_kb: memoryFor(p) };
        } else {
            record = { verdict: 'WRONG_ANSWER', code, passed: 0, total: cases.length, runtime_ms: runtimeFor(p), memory_kb: memoryFor(p),
                failed_case: { input: displayArgs(p, cases[0].args), expected: json(cases[0].expected), actual: 'null' } };
        }
        const saved = addSubmission(slug, record);
        return {
            id: saved.id, verdict: saved.verdict, passed: saved.passed, total: saved.total, runtime_ms: saved.runtime_ms, memory_kb: saved.memory_kb,
            failed_case: saved.failed_case, message: saved.message, beats_runtime_pct: saved.verdict === 'ACCEPTED' ? 58 + ((p.order * 9) % 38) : null,
            created_at: saved.created_at,
        };
    },

    async bookmark(slug) {
        bySlug(slug);
        state[slug].bookmarked = !state[slug].bookmarked;
        return { slug, bookmarked: state[slug].bookmarked };
    },

    async getSubmissions(slug) {
        bySlug(slug);
        return state[slug].submissions.map(({ id, verdict, passed, total, runtime_ms, memory_kb, created_at }) => ({ id, verdict, passed, total, runtime_ms, memory_kb, created_at }));
    },

    async getSubmission(id) {
        const found = Object.values(state).flatMap((s) => s.submissions).find((s) => s.id === Number(id));
        if (!found) throw demoError(404, 'Submission not found.');
        return { ...found };
    },
};

export { codingHandlers };
export default practiceHandlers;
