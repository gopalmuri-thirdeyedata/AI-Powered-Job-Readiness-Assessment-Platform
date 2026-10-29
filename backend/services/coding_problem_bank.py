"""
LeetCode-style problem bank (Python only).

Every problem has ONE reference solution (`solution`, a `class Solution` source string). It is the single source of truth:
it produces every expected output when the bank is seeded and it is the "Solution" tab shown after a student solves the problem.
The `examples` carry the answer that is known from the statement, so `services.coding_platform_service.verify_bank()` can prove the
reference solution agrees with it. Test inputs are JSON-able argument lists; expected values are computed, never typed by hand.
"""
from typing import Any, Dict, List

def _p(slug, title, difficulty, tags, description, constraints, fn, sig, ret, solution, examples, tests,
       compare="exact", hints=None, explanation="", argtypes=None, rettype=None):
    return {
        "slug": slug, "title": title, "difficulty": difficulty, "tags": tags, "description": description.strip(),
        "constraints": constraints, "fn": fn, "sig": sig, "ret": ret, "solution": solution.strip("\n"),
        "examples": examples, "tests": tests, "compare": compare, "hints": hints or [], "explanation": explanation.strip(),
        "argtypes": argtypes or [], "rettype": rettype,
    }


PROBLEMS: List[Dict[str, Any]] = []


def add(*args, **kwargs):
    PROBLEMS.append(_p(*args, **kwargs))


# ------------------------------------------------------------------ Easy ------------------------------------------------------------------
add("two-sum", "Two Sum", "Easy", ["Array", "Hash Table"],
    "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.\n\n"
    "Each input has exactly one solution, and you may not use the same element twice. You can return the answer in any order.",
    ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9", "Exactly one valid answer exists."],
    "twoSum", "nums: List[int], target: int", "List[int]",
    "class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, x in enumerate(nums):\n"
    "            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n",
    [(([2, 7, 11, 15], 9), [0, 1], "nums[0] + nums[1] == 9, so we return [0, 1]."),
     (([3, 2, 4], 6), [1, 2], None), (([3, 3], 6), [0, 1], None)],
    [([1, 5, 9, 14], 23), ([-3, 4, 3, 90], 0), ([0, 4, 3, 0], 0), (list(range(1, 2001)), 3999), ([5, 75, 25], 100)],
    compare="unordered",
    hints=["A brute force check of every pair is O(n^2). Can you remember what you have already seen?",
           "For each number x you need target - x. A hash map answers 'have I seen it?' in O(1)."],
    explanation="Scan once, storing each value's index in a hash map. For x, look up target - x. O(n) time, O(n) space.")

add("valid-palindrome", "Valid Palindrome", "Easy", ["Two Pointers", "String"],
    "A phrase is a palindrome if, after converting all uppercase letters to lowercase and removing every character that is not "
    "alphanumeric, it reads the same forward and backward.\n\nGiven a string `s`, return `true` if it is a palindrome, otherwise `false`.",
    ["1 <= s.length <= 2 * 10^5", "s consists of printable ASCII characters."],
    "isPalindrome", "s: str", "bool",
    "class Solution:\n    def isPalindrome(self, s):\n        t = [c.lower() for c in s if c.isalnum()]\n        return t == t[::-1]\n",
    [(("A man, a plan, a canal: Panama",), True, "\"amanaplanacanalpanama\" is a palindrome."),
     (("race a car",), False, "\"raceacar\" is not a palindrome."), ((" ",), True, "An empty string reads the same both ways.")],
    [("0P",), ("ab_a",), ("Madam In Eden, I'm Adam",), ("a" * 10000 + "b" + "a" * 10000,), ("ab" * 5000,)],
    hints=["Filter to alphanumerics first, then compare.", "Two pointers moving inward avoid building a second string."],
    explanation="Keep only alphanumeric characters, lower-cased, and compare with the reverse. O(n).")

add("valid-parentheses", "Valid Parentheses", "Easy", ["Stack", "String"],
    "Given a string `s` containing just the characters `'('`, `')'`, `'{'`, `'}'`, `'['` and `']'`, determine whether the input is valid.\n\n"
    "A string is valid when open brackets are closed by the same type of bracket, in the correct order, and every close bracket has a matching open bracket.",
    ["1 <= s.length <= 10^4", "s consists only of the characters ()[]{}"],
    "isValid", "s: str", "bool",
    "class Solution:\n    def isValid(self, s):\n        pairs = {')': '(', ']': '[', '}': '{'}\n        stack = []\n        for c in s:\n"
    "            if c in pairs:\n                if not stack or stack.pop() != pairs[c]:\n                    return False\n"
    "            else:\n                stack.append(c)\n        return not stack\n",
    [(("()",), True, None), (("()[]{}",), True, None), (("(]",), False, None)],
    [("([)]",), ("{[]}",), ("(",), (")",), ("(" * 5000 + ")" * 5000,), ("((()))[[{}]]",)],
    hints=["The most recently opened bracket must be the first one closed.", "That is exactly how a stack behaves."],
    explanation="Push open brackets; on a close bracket the top of the stack must be its partner. Valid if the stack ends empty. O(n).")

add("best-time-to-buy-and-sell-stock", "Best Time to Buy and Sell Stock", "Easy", ["Array", "Dynamic Programming"],
    "You are given an array `prices` where `prices[i]` is the price of a stock on day `i`.\n\n"
    "Choose one day to buy and a later day to sell. Return the maximum profit you can achieve, or `0` if no profit is possible.",
    ["1 <= prices.length <= 10^5", "0 <= prices[i] <= 10^4"],
    "maxProfit", "prices: List[int]", "int",
    "class Solution:\n    def maxProfit(self, prices):\n        best, low = 0, float('inf')\n        for p in prices:\n"
    "            low = min(low, p)\n            best = max(best, p - low)\n        return best\n",
    [(([7, 1, 5, 3, 6, 4],), 5, "Buy on day 2 (price 1) and sell on day 5 (price 6)."),
     (([7, 6, 4, 3, 1],), 0, "Prices only fall, so no trade is made.")],
    [([2, 4, 1],), ([1],), ([3, 3, 3],), (list(range(3000, 0, -1)),), (list(range(1, 3001)),), ([2, 1, 2, 0, 1],)],
    hints=["Track the lowest price seen so far.", "At each day, the best sale is today's price minus that minimum."],
    explanation="One pass keeping the minimum price so far and the best profit so far. O(n) time, O(1) space.")

add("contains-duplicate", "Contains Duplicate", "Easy", ["Array", "Hash Table"],
    "Given an integer array `nums`, return `true` if any value appears at least twice, and `false` if every element is distinct.",
    ["1 <= nums.length <= 10^5", "-10^9 <= nums[i] <= 10^9"],
    "containsDuplicate", "nums: List[int]", "bool",
    "class Solution:\n    def containsDuplicate(self, nums):\n        return len(set(nums)) != len(nums)\n",
    [(([1, 2, 3, 1],), True, None), (([1, 2, 3, 4],), False, None), (([1, 1, 1, 3, 3, 4, 3, 2, 4, 2],), True, None)],
    [([1],), ([0, 0],), (list(range(3000)),), (list(range(3000)) + [7],)],
    hints=["A set remembers what you have seen."], explanation="Compare the size of the set to the size of the list. O(n).")

add("valid-anagram", "Valid Anagram", "Easy", ["Hash Table", "String", "Sorting"],
    "Given two strings `s` and `t`, return `true` if `t` is an anagram of `s`, and `false` otherwise.\n\n"
    "An anagram uses all the original letters exactly once, rearranged.",
    ["1 <= s.length, t.length <= 5 * 10^4", "s and t consist of lowercase English letters."],
    "isAnagram", "s: str, t: str", "bool",
    "class Solution:\n    def isAnagram(self, s, t):\n        from collections import Counter\n        return Counter(s) == Counter(t)\n",
    [(("anagram", "nagaram"), True, None), (("rat", "car"), False, None)],
    [("a", "ab"), ("aacc", "ccac"), ("listen", "silent"), ("a" * 20000, "a" * 19999 + "b")],
    hints=["Two strings are anagrams when every letter occurs the same number of times in both."],
    explanation="Count letters in both strings and compare. O(n).")

add("maximum-subarray", "Maximum Subarray", "Medium", ["Array", "Dynamic Programming"],
    "Given an integer array `nums`, find the contiguous subarray (containing at least one number) with the largest sum, and return that sum.",
    ["1 <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4"],
    "maxSubArray", "nums: List[int]", "int",
    "class Solution:\n    def maxSubArray(self, nums):\n        best = cur = nums[0]\n        for x in nums[1:]:\n"
    "            cur = max(x, cur + x)\n            best = max(best, cur)\n        return best\n",
    [(([-2, 1, -3, 4, -1, 2, 1, -5, 4],), 6, "The subarray [4, -1, 2, 1] has the largest sum, 6."),
     (([1],), 1, None), (([5, 4, -1, 7, 8],), 23, None)],
    [([-1],), ([-3, -2, -5],), ([0, 0, 0],), ([8, -19, 5, -4, 20],), ([i % 7 - 3 for i in range(4000)],)],
    hints=["Decide at each element: extend the running subarray or start fresh.", "This is Kadane's algorithm."],
    explanation="Kadane: cur = max(x, cur + x); answer is the best cur seen. O(n) time, O(1) space.")

add("climbing-stairs", "Climbing Stairs", "Easy", ["Dynamic Programming", "Math"],
    "You are climbing a staircase that takes `n` steps to reach the top. Each time you can climb `1` or `2` steps.\n\n"
    "Return the number of distinct ways you can climb to the top.",
    ["1 <= n <= 45"],
    "climbStairs", "n: int", "int",
    "class Solution:\n    def climbStairs(self, n):\n        a, b = 1, 1\n        for _ in range(n - 1):\n            a, b = b, a + b\n        return b\n",
    [((2,), 2, "1 + 1 or 2."), ((3,), 3, "1+1+1, 1+2, 2+1.")],
    [(1,), (4,), (5,), (10,), (30,), (45,)],
    hints=["The ways to reach step n come from step n-1 and step n-2."], explanation="Fibonacci recurrence ways(n) = ways(n-1) + ways(n-2). O(n) time, O(1) space.")

add("missing-number", "Missing Number", "Easy", ["Array", "Math"],
    "Given an array `nums` containing `n` distinct numbers taken from the range `[0, n]`, return the one number in that range that is missing from the array.",
    ["n == nums.length", "1 <= n <= 10^4", "0 <= nums[i] <= n", "All numbers in nums are unique."],
    "missingNumber", "nums: List[int]", "int",
    "class Solution:\n    def missingNumber(self, nums):\n        n = len(nums)\n        return n * (n + 1) // 2 - sum(nums)\n",
    [(([3, 0, 1],), 2, None), (([0, 1],), 2, None), (([9, 6, 4, 2, 3, 5, 7, 0, 1],), 8, None)],
    [([0],), ([1],), (list(range(1, 3001)),), (list(range(0, 1500)) + list(range(1501, 3001)),)],
    hints=["The sum of 0..n is known in closed form."], explanation="Expected sum n(n+1)/2 minus the actual sum. O(n) time, O(1) space.")

add("single-number", "Single Number", "Easy", ["Array", "Bit Manipulation"],
    "Every element of `nums` appears twice except for one. Find that single element.\n\nSolve it in linear time using only constant extra space.",
    ["1 <= nums.length <= 3 * 10^4", "Every element appears twice except for one."],
    "singleNumber", "nums: List[int]", "int",
    "class Solution:\n    def singleNumber(self, nums):\n        r = 0\n        for x in nums:\n            r ^= x\n        return r\n",
    [(([2, 2, 1],), 1, None), (([4, 1, 2, 1, 2],), 4, None), (([1],), 1, None)],
    [([-1, -1, -2],), ([0, 0, 5],), (list(range(1, 2000)) * 2 + [77777],)],
    hints=["x XOR x is 0 and x XOR 0 is x."], explanation="XOR everything: pairs cancel, the single number remains. O(n) time, O(1) space.")

add("move-zeroes", "Move Zeroes", "Easy", ["Array", "Two Pointers"],
    "Given an integer array `nums`, move all `0`s to the end while keeping the relative order of the non-zero elements.\n\n"
    "Return the resulting array.",
    ["1 <= nums.length <= 10^4", "-2^31 <= nums[i] <= 2^31 - 1"],
    "moveZeroes", "nums: List[int]", "List[int]",
    "class Solution:\n    def moveZeroes(self, nums):\n        out = [x for x in nums if x != 0]\n        return out + [0] * (len(nums) - len(out))\n",
    [(([0, 1, 0, 3, 12],), [1, 3, 12, 0, 0], None), (([0],), [0], None)],
    [([1, 2, 3],), ([0, 0, 1],), ([4, 0, 0, 5, 0, 6],), ([0] * 5000 + [1] * 5000,)],
    hints=["Write the non-zeros in order, then fill the rest with zeros."], explanation="Collect non-zeros, pad with zeros. O(n).")

add("binary-search", "Binary Search", "Easy", ["Array", "Binary Search"],
    "Given an array of integers `nums` sorted in ascending order and an integer `target`, return the index of `target` in `nums`, or `-1` if it does not exist.\n\n"
    "Your algorithm must run in O(log n) time.",
    ["1 <= nums.length <= 10^4", "-10^4 < nums[i], target < 10^4", "All integers in nums are unique and sorted ascending."],
    "search", "nums: List[int], target: int", "int",
    "class Solution:\n    def search(self, nums, target):\n        lo, hi = 0, len(nums) - 1\n        while lo <= hi:\n            mid = (lo + hi) // 2\n"
    "            if nums[mid] == target:\n                return mid\n            if nums[mid] < target:\n                lo = mid + 1\n"
    "            else:\n                hi = mid - 1\n        return -1\n",
    [(([-1, 0, 3, 5, 9, 12], 9), 4, None), (([-1, 0, 3, 5, 9, 12], 2), -1, "2 is not in the array.")],
    [([5], 5), ([5], -5), ([1, 3], 3), (list(range(-1000, 1000)), 999), (list(range(-1000, 1000)), -1000), (list(range(-1000, 1000)), 1000)],
    hints=["Compare the middle element with the target and discard half of the range."],
    explanation="Classic binary search over [lo, hi]. O(log n).")

add("majority-element", "Majority Element", "Easy", ["Array", "Hash Table", "Counting"],
    "Given an array `nums` of size `n`, return the majority element: the element that appears more than `⌊n / 2⌋` times.\n\nYou may assume it always exists.",
    ["n == nums.length", "1 <= n <= 5 * 10^4", "A majority element always exists."],
    "majorityElement", "nums: List[int]", "int",
    "class Solution:\n    def majorityElement(self, nums):\n        cand, cnt = None, 0\n        for x in nums:\n            if cnt == 0:\n                cand = x\n"
    "            cnt += 1 if x == cand else -1\n        return cand\n",
    [(([3, 2, 3],), 3, None), (([2, 2, 1, 1, 1, 2, 2],), 2, None)],
    [([1],), ([6, 6, 6, 7, 7],), ([1, 2, 1, 2, 1],), ([4] * 3001 + [5] * 3000,)],
    hints=["Pair off different elements: the majority survives."], explanation="Boyer–Moore voting. O(n) time, O(1) space.")

add("roman-to-integer", "Roman to Integer", "Easy", ["Hash Table", "Math", "String"],
    "Roman numerals use the symbols I=1, V=5, X=10, L=50, C=100, D=500, M=1000. Usually symbols are written largest to smallest, "
    "but a smaller symbol before a larger one means subtraction (for example `IV` = 4 and `IX` = 9).\n\nGiven a valid roman numeral `s`, convert it to an integer.",
    ["1 <= s.length <= 15", "s contains only I, V, X, L, C, D, M", "s is a valid roman numeral in the range [1, 3999]."],
    "romanToInt", "s: str", "int",
    "class Solution:\n    def romanToInt(self, s):\n        v = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}\n        total = 0\n"
    "        for i, c in enumerate(s):\n            if i + 1 < len(s) and v[c] < v[s[i + 1]]:\n                total -= v[c]\n"
    "            else:\n                total += v[c]\n        return total\n",
    [(("III",), 3, None), (("LVIII",), 58, "L = 50, V = 5, III = 3."), (("MCMXCIV",), 1994, "M = 1000, CM = 900, XC = 90 and IV = 4.")],
    [("IV",), ("IX",), ("XL",), ("CDXLIV",), ("MMMCMXCIX",)],
    hints=["If a symbol is smaller than the one after it, subtract it; otherwise add it."], explanation="Single left-to-right pass with the subtraction rule. O(n).")

add("longest-common-prefix", "Longest Common Prefix", "Easy", ["String"],
    "Write a function to find the longest common prefix string amongst an array of strings.\n\nIf there is no common prefix, return an empty string `\"\"`.",
    ["1 <= strs.length <= 200", "0 <= strs[i].length <= 200", "strs[i] consists of lowercase English letters."],
    "longestCommonPrefix", "strs: List[str]", "str",
    "class Solution:\n    def longestCommonPrefix(self, strs):\n        prefix = strs[0]\n        for s in strs[1:]:\n            while not s.startswith(prefix):\n"
    "                prefix = prefix[:-1]\n        return prefix\n",
    [((["flower", "flow", "flight"],), "fl", None), ((["dog", "racecar", "car"],), "", "There is no common prefix.")],
    [(["a"],), (["", "b"],), (["ab", "ab"],), (["interview", "internet", "internal", "interval"],), (["a" * 200] * 200,)],
    hints=["Shrink a candidate prefix until every string starts with it."], explanation="Start with the first string and trim it until all strings share it. O(total characters).")

add("plus-one", "Plus One", "Easy", ["Array", "Math"],
    "You are given a large integer represented as an array `digits`, where `digits[i]` is the i-th digit (most significant first). "
    "The number has no leading zeros.\n\nIncrement the number by one and return the resulting array of digits.",
    ["1 <= digits.length <= 100", "0 <= digits[i] <= 9", "digits has no leading zeros."],
    "plusOne", "digits: List[int]", "List[int]",
    "class Solution:\n    def plusOne(self, digits):\n        for i in range(len(digits) - 1, -1, -1):\n            if digits[i] < 9:\n                digits[i] += 1\n"
    "                return digits\n            digits[i] = 0\n        return [1] + digits\n",
    [(([1, 2, 3],), [1, 2, 4], None), (([4, 3, 2, 1],), [4, 3, 2, 2], None), (([9],), [1, 0], "9 + 1 = 10.")],
    [([0],), ([1, 9],), ([9, 9, 9],), ([9] * 100,), ([8, 9, 9],)],
    hints=["Work from the last digit and carry while the digit is 9."], explanation="Propagate the carry from the right; if it falls off the left, prepend 1. O(n).")

add("fizz-buzz", "Fizz Buzz", "Easy", ["Math", "String", "Simulation"],
    "Given an integer `n`, return a list of strings `answer` (1-indexed) where:\n\n"
    "- `answer[i]` is `\"FizzBuzz\"` if `i` is divisible by 3 and 5.\n- `\"Fizz\"` if `i` is divisible by 3.\n- `\"Buzz\"` if `i` is divisible by 5.\n"
    "- otherwise `answer[i]` is `i` as a string.",
    ["1 <= n <= 10^4"],
    "fizzBuzz", "n: int", "List[str]",
    "class Solution:\n    def fizzBuzz(self, n):\n        out = []\n        for i in range(1, n + 1):\n            s = ('Fizz' if i % 3 == 0 else '') + ('Buzz' if i % 5 == 0 else '')\n"
    "            out.append(s or str(i))\n        return out\n",
    [((3,), ["1", "2", "Fizz"], None), ((5,), ["1", "2", "Fizz", "4", "Buzz"], None)],
    [(1,), (15,), (30,), (1000,)],
    hints=["Build the word from 'Fizz' and 'Buzz' parts and fall back to the number."], explanation="Direct simulation. O(n).")

# ---------------------------------------------------------------- Medium -----------------------------------------------------------------
add("longest-substring-without-repeating-characters", "Longest Substring Without Repeating Characters", "Medium", ["Hash Table", "String", "Sliding Window"],
    "Given a string `s`, find the length of the longest substring without repeating characters.",
    ["0 <= s.length <= 5 * 10^4", "s consists of English letters, digits, symbols and spaces."],
    "lengthOfLongestSubstring", "s: str", "int",
    "class Solution:\n    def lengthOfLongestSubstring(self, s):\n        last, start, best = {}, 0, 0\n        for i, c in enumerate(s):\n"
    "            if c in last and last[c] >= start:\n                start = last[c] + 1\n            last[c] = i\n            best = max(best, i - start + 1)\n        return best\n",
    [(("abcabcbb",), 3, "The answer is \"abc\"."), (("bbbbb",), 1, None), (("pwwkew",), 3, "The answer is \"wke\".")],
    [("",), (" ",), ("au",), ("dvdf",), ("abba",), ("abcdefghijklmnopqrstuvwxyz" * 1500,)],
    hints=["Keep a window with no repeats and the last index of each character.", "When a repeat appears, move the window start past its previous position."],
    explanation="Sliding window with a last-seen map. O(n) time.")

add("product-of-array-except-self", "Product of Array Except Self", "Medium", ["Array", "Prefix Sum"],
    "Given an integer array `nums`, return an array `answer` such that `answer[i]` is the product of all the elements of `nums` except `nums[i]`.\n\n"
    "Solve it in O(n) time without using the division operation.",
    ["2 <= nums.length <= 10^5", "-30 <= nums[i] <= 30", "The product of any prefix or suffix fits in a 32-bit integer."],
    "productExceptSelf", "nums: List[int]", "List[int]",
    "class Solution:\n    def productExceptSelf(self, nums):\n        n = len(nums)\n        out = [1] * n\n        left = 1\n        for i in range(n):\n"
    "            out[i] = left\n            left *= nums[i]\n        right = 1\n        for i in range(n - 1, -1, -1):\n            out[i] *= right\n            right *= nums[i]\n        return out\n",
    [(([1, 2, 3, 4],), [24, 12, 8, 6], None), (([-1, 1, 0, -3, 3],), [0, 0, 9, 0, 0], None)],
    [([2, 3],), ([0, 0],), ([1, 1, 1, 1],), ([5, -2, 4, 1],), ([1] * 5000,)],
    hints=["answer[i] = (product of everything left of i) * (product of everything right of i)."],
    explanation="One pass for left products, one pass for right products. O(n) time, O(1) extra space.")

add("group-anagrams", "Group Anagrams", "Medium", ["Array", "Hash Table", "String", "Sorting"],
    "Given an array of strings `strs`, group the anagrams together. You can return the groups in any order, and the strings inside each group in any order.",
    ["1 <= strs.length <= 10^4", "0 <= strs[i].length <= 100", "strs[i] consists of lowercase English letters."],
    "groupAnagrams", "strs: List[str]", "List[List[str]]",
    "class Solution:\n    def groupAnagrams(self, strs):\n        groups = {}\n        for s in strs:\n            groups.setdefault(''.join(sorted(s)), []).append(s)\n        return list(groups.values())\n",
    [((["eat", "tea", "tan", "ate", "nat", "bat"],), [["bat"], ["nat", "tan"], ["ate", "eat", "tea"]], None),
     (([""],), [[""]], None), ((["a"],), [["a"]], None)],
    [(["abc", "bca", "cab", "xyz", "zyx"],), (["", ""],), (["ab", "ba", "abc"],), ([("a" * i) + "b" for i in range(1, 60)] + [("b" + "a" * i) for i in range(1, 60)],)],
    compare="unordered_nested",
    hints=["Anagrams share the same sorted letters.", "Use the sorted string as a dictionary key."],
    explanation="Group by the sorted form of each word. O(n · k log k).")

add("three-sum", "3Sum", "Medium", ["Array", "Two Pointers", "Sorting"],
    "Given an integer array `nums`, return all the triplets `[nums[i], nums[j], nums[k]]` such that `i != j`, `i != k`, `j != k` and `nums[i] + nums[j] + nums[k] == 0`.\n\n"
    "The solution set must not contain duplicate triplets. The order of the triplets and of the numbers inside a triplet does not matter.",
    ["3 <= nums.length <= 3000", "-10^5 <= nums[i] <= 10^5"],
    "threeSum", "nums: List[int]", "List[List[int]]",
    "class Solution:\n    def threeSum(self, nums):\n        nums.sort()\n        res = []\n        for i in range(len(nums) - 2):\n            if i and nums[i] == nums[i - 1]:\n                continue\n"
    "            lo, hi = i + 1, len(nums) - 1\n            while lo < hi:\n                s = nums[i] + nums[lo] + nums[hi]\n                if s < 0:\n                    lo += 1\n"
    "                elif s > 0:\n                    hi -= 1\n                else:\n                    res.append([nums[i], nums[lo], nums[hi]])\n                    lo += 1\n"
    "                    while lo < hi and nums[lo] == nums[lo - 1]:\n                        lo += 1\n        return res\n",
    [(([-1, 0, 1, 2, -1, -4],), [[-1, -1, 2], [-1, 0, 1]], None), (([0, 1, 1],), [], "No triplet sums to 0."), (([0, 0, 0],), [[0, 0, 0]], None)],
    [([0, 0, 0, 0],), ([-2, 0, 1, 1, 2],), ([1, 2, -2, -1],), (list(range(-400, 400)),)],
    compare="unordered_nested",
    hints=["Sort first, then fix one number and use two pointers for the rest.", "Skip equal neighbours to avoid duplicate triplets."],
    explanation="Sort, then for each i run a two-pointer sweep. O(n^2).")

add("container-with-most-water", "Container With Most Water", "Medium", ["Array", "Two Pointers", "Greedy"],
    "You are given an integer array `height` of length `n`. There are `n` vertical lines, the i-th with endpoints `(i, 0)` and `(i, height[i])`.\n\n"
    "Find two lines that, together with the x-axis, form a container holding the most water. Return that maximum amount.",
    ["2 <= n <= 10^5", "0 <= height[i] <= 10^4"],
    "maxArea", "height: List[int]", "int",
    "class Solution:\n    def maxArea(self, height):\n        lo, hi, best = 0, len(height) - 1, 0\n        while lo < hi:\n            best = max(best, min(height[lo], height[hi]) * (hi - lo))\n"
    "            if height[lo] < height[hi]:\n                lo += 1\n            else:\n                hi -= 1\n        return best\n",
    [(([1, 8, 6, 2, 5, 4, 8, 3, 7],), 49, None), (([1, 1],), 1, None)],
    [([4, 3, 2, 1, 4],), ([1, 2, 1],), ([0, 0],), (list(range(1, 3001)),), ([10000] * 3000,)],
    hints=["Start with the widest container and move the shorter side inward."], explanation="Two pointers, always advancing the shorter line. O(n).")

add("coin-change", "Coin Change", "Medium", ["Dynamic Programming", "Array"],
    "You are given an integer array `coins` of different denominations and an integer `amount`.\n\n"
    "Return the fewest number of coins needed to make up that amount, or `-1` if it cannot be made. You have an infinite supply of each coin.",
    ["1 <= coins.length <= 12", "1 <= coins[i] <= 2^31 - 1", "0 <= amount <= 10^4"],
    "coinChange", "coins: List[int], amount: int", "int",
    "class Solution:\n    def coinChange(self, coins, amount):\n        INF = amount + 1\n        dp = [0] + [INF] * amount\n        for a in range(1, amount + 1):\n            for c in coins:\n"
    "                if c <= a and dp[a - c] + 1 < dp[a]:\n                    dp[a] = dp[a - c] + 1\n        return dp[amount] if dp[amount] != INF else -1\n",
    [(([1, 2, 5], 11), 3, "11 = 5 + 5 + 1."), (([2], 3), -1, None), (([1], 0), 0, None)],
    [([186, 419, 83, 408], 6249), ([2, 5, 10, 1], 27), ([5, 7], 3), ([1, 3, 4], 6), ([3, 7, 405, 436], 8839), ([1, 2, 5], 10000)],
    hints=["dp[a] is the fewest coins for amount a.", "dp[a] = 1 + min(dp[a - c]) over coins c."],
    explanation="Bottom-up DP over amounts. O(amount · coins).")

add("longest-increasing-subsequence", "Longest Increasing Subsequence", "Medium", ["Array", "Binary Search", "Dynamic Programming"],
    "Given an integer array `nums`, return the length of the longest strictly increasing subsequence.",
    ["1 <= nums.length <= 2500", "-10^4 <= nums[i] <= 10^4"],
    "lengthOfLIS", "nums: List[int]", "int",
    "class Solution:\n    def lengthOfLIS(self, nums):\n        import bisect\n        tails = []\n        for x in nums:\n            i = bisect.bisect_left(tails, x)\n"
    "            if i == len(tails):\n                tails.append(x)\n            else:\n                tails[i] = x\n        return len(tails)\n",
    [(([10, 9, 2, 5, 3, 7, 101, 18],), 4, "[2, 3, 7, 101] is one longest increasing subsequence."), (([0, 1, 0, 3, 2, 3],), 4, None), (([7, 7, 7, 7, 7, 7, 7],), 1, None)],
    [([1],), ([4, 10, 4, 3, 8, 9],), (list(range(2500)),), (list(range(2500, 0, -1)),), ([(i * 37) % 1001 for i in range(2500)],)],
    hints=["An O(n^2) DP works. For O(n log n) keep the smallest possible tail of each length."],
    explanation="Patience-sorting tails with binary search. O(n log n).")

add("house-robber", "House Robber", "Medium", ["Array", "Dynamic Programming"],
    "You are a robber planning to rob houses along a street. Each house has a certain amount of money, but adjacent houses have connected alarms: "
    "robbing two adjacent houses triggers the police.\n\nGiven an array `nums` of money per house, return the maximum amount you can rob without alerting the police.",
    ["1 <= nums.length <= 100", "0 <= nums[i] <= 400"],
    "rob", "nums: List[int]", "int",
    "class Solution:\n    def rob(self, nums):\n        take, skip = 0, 0\n        for x in nums:\n            take, skip = skip + x, max(take, skip)\n        return max(take, skip)\n",
    [(([1, 2, 3, 1],), 4, "Rob houses 1 and 3: 1 + 3 = 4."), (([2, 7, 9, 3, 1],), 12, "Rob houses 1, 3 and 5: 2 + 9 + 1 = 12.")],
    [([5],), ([2, 1],), ([0, 0, 0],), ([100, 1, 1, 100],), ([(i * 53) % 401 for i in range(100)],)],
    hints=["At each house you either rob it (and skipped the previous one) or you don't."], explanation="Track best-with-and-without the current house. O(n) time, O(1) space.")

add("rotate-image", "Rotate Image", "Medium", ["Array", "Matrix"],
    "You are given an `n x n` matrix representing an image. Rotate the image by 90 degrees clockwise and return the rotated matrix.",
    ["n == matrix.length == matrix[i].length", "1 <= n <= 20", "-1000 <= matrix[i][j] <= 1000"],
    "rotate", "matrix: List[List[int]]", "List[List[int]]",
    "class Solution:\n    def rotate(self, matrix):\n        return [list(row) for row in zip(*matrix[::-1])]\n",
    [(([[1, 2, 3], [4, 5, 6], [7, 8, 9]],), [[7, 4, 1], [8, 5, 2], [9, 6, 3]], None),
     (([[5, 1, 9, 11], [2, 4, 8, 10], [13, 3, 6, 7], [15, 14, 12, 16]],), [[15, 13, 2, 5], [14, 3, 4, 1], [12, 6, 8, 9], [16, 7, 10, 11]], None)],
    [([[1]],), ([[1, 2], [3, 4]],), ([[0, 1], [1, 0]],), ([[-1, -2], [-3, -4]],), ([[1, 2, 3], [4, 5, 6], [7, 8, 9]],), ([[i * 10 + j for j in range(20)] for i in range(20)],)],
    hints=["Reverse the rows, then transpose."], explanation="A clockwise rotation equals reverse-rows then transpose. O(n^2).")

add("number-of-islands", "Number of Islands", "Medium", ["Array", "Depth-First Search", "Matrix"],
    "Given an `m x n` grid of `1`s (land) and `0`s (water), return the number of islands.\n\n"
    "An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically. All four edges of the grid are surrounded by water.",
    ["1 <= m, n <= 100", "grid[i][j] is 0 or 1"],
    "numIslands", "grid: List[List[int]]", "int",
    "class Solution:\n    def numIslands(self, grid):\n        rows, cols = len(grid), len(grid[0])\n        seen = [[False] * cols for _ in range(rows)]\n        count = 0\n"
    "        for r in range(rows):\n            for c in range(cols):\n                if grid[r][c] == 1 and not seen[r][c]:\n                    count += 1\n                    stack = [(r, c)]\n"
    "                    seen[r][c] = True\n                    while stack:\n                        y, x = stack.pop()\n                        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n"
    "                            ny, nx = y + dy, x + dx\n                            if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == 1 and not seen[ny][nx]:\n"
    "                                seen[ny][nx] = True\n                                stack.append((ny, nx))\n        return count\n",
    [(([[1, 1, 1, 1, 0], [1, 1, 0, 1, 0], [1, 1, 0, 0, 0], [0, 0, 0, 0, 0]],), 1, None),
     (([[1, 1, 0, 0, 0], [1, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 1]],), 3, None)],
    [([[0]],), ([[1]],), ([[1, 0, 1, 0, 1]],), ([[1, 0], [0, 1]],), ([[(i + j) % 2 for j in range(60)] for i in range(60)],)],
    hints=["Every time you find unvisited land, count an island and flood it.", "Use an explicit stack or queue to avoid deep recursion."],
    explanation="Flood-fill each unvisited land cell. O(m · n).")

add("merge-intervals", "Merge Intervals", "Medium", ["Array", "Sorting"],
    "Given an array of `intervals` where `intervals[i] = [start, end]`, merge all overlapping intervals and return an array of the non-overlapping intervals that cover all the input intervals, sorted by start.",
    ["1 <= intervals.length <= 10^4", "0 <= start <= end <= 10^4"],
    "merge", "intervals: List[List[int]]", "List[List[int]]",
    "class Solution:\n    def merge(self, intervals):\n        out = []\n        for s, e in sorted(intervals):\n            if out and s <= out[-1][1]:\n                out[-1][1] = max(out[-1][1], e)\n"
    "            else:\n                out.append([s, e])\n        return out\n",
    [(([[1, 3], [2, 6], [8, 10], [15, 18]],), [[1, 6], [8, 10], [15, 18]], None), (([[1, 4], [4, 5]],), [[1, 5]], "Intervals touching at 4 overlap.")],
    [([[1, 4], [0, 4]],), ([[1, 4], [2, 3]],), ([[5, 6]],), ([[i, i + 1] for i in range(0, 1000, 2)],), ([[i, i + 2] for i in range(0, 1000)],)],
    hints=["Sort by start, then extend the last merged interval while the next one overlaps."], explanation="Sort then sweep. O(n log n).")

add("top-k-frequent-elements", "Top K Frequent Elements", "Medium", ["Array", "Hash Table", "Heap"],
    "Given an integer array `nums` and an integer `k`, return the `k` most frequent elements. You may return the answer in any order.\n\n"
    "The answer is guaranteed to be unique.",
    ["1 <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4", "k is in the range [1, number of unique elements]", "The answer is unique."],
    "topKFrequent", "nums: List[int], k: int", "List[int]",
    "class Solution:\n    def topKFrequent(self, nums, k):\n        from collections import Counter\n        return [x for x, _ in Counter(nums).most_common(k)]\n",
    [(([1, 1, 1, 2, 2, 3], 2), [1, 2], None), (([1], 1), [1], None)],
    [([4, 4, 4, 4, 5, 5, 5, 6, 6, 7], 3), ([-1, -1], 1), ([1, 2, 2, 3, 3, 3], 2), ([i % 10 for i in range(100)] + [3] * 5, 1)],
    compare="unordered",
    hints=["Count frequencies first.", "A heap or bucket sort picks the top k."], explanation="Frequency map then take the k largest counts. O(n log k).")

add("search-in-rotated-sorted-array", "Search in Rotated Sorted Array", "Medium", ["Array", "Binary Search"],
    "A sorted array of distinct values was rotated at an unknown pivot (for example `[0,1,2,4,5,6,7]` became `[4,5,6,7,0,1,2]`).\n\n"
    "Given the rotated array `nums` and an integer `target`, return the index of `target`, or `-1` if it is not present. Your algorithm must run in O(log n).",
    ["1 <= nums.length <= 5000", "-10^4 <= nums[i] <= 10^4", "All values are distinct."],
    "search", "nums: List[int], target: int", "int",
    "class Solution:\n    def search(self, nums, target):\n        lo, hi = 0, len(nums) - 1\n        while lo <= hi:\n            mid = (lo + hi) // 2\n            if nums[mid] == target:\n                return mid\n"
    "            if nums[lo] <= nums[mid]:\n                if nums[lo] <= target < nums[mid]:\n                    hi = mid - 1\n                else:\n                    lo = mid + 1\n"
    "            else:\n                if nums[mid] < target <= nums[hi]:\n                    lo = mid + 1\n                else:\n                    hi = mid - 1\n        return -1\n",
    [(([4, 5, 6, 7, 0, 1, 2], 0), 4, None), (([4, 5, 6, 7, 0, 1, 2], 3), -1, None), (([1], 0), -1, None)],
    [([1], 1), ([3, 1], 1), ([5, 1, 3], 5), (list(range(2500, 5000)) + list(range(0, 2500)), 4999), (list(range(2500, 5000)) + list(range(0, 2500)), 2499)],
    hints=["At least one half of the range around mid is always sorted."], explanation="Binary search, checking which half is sorted. O(log n).")

add("unique-paths", "Unique Paths", "Medium", ["Math", "Dynamic Programming", "Combinatorics"],
    "A robot sits at the top-left corner of an `m x n` grid and can only move right or down. It wants to reach the bottom-right corner.\n\n"
    "Return the number of unique paths.",
    ["1 <= m, n <= 100", "The answer fits in a 64-bit integer for the tested inputs."],
    "uniquePaths", "m: int, n: int", "int",
    "class Solution:\n    def uniquePaths(self, m, n):\n        row = [1] * n\n        for _ in range(1, m):\n            for j in range(1, n):\n                row[j] += row[j - 1]\n        return row[-1]\n",
    [((3, 7), 28, None), ((3, 2), 3, None)],
    [(1, 1), (1, 10), (10, 1), (7, 3), (23, 12), (30, 30)],
    hints=["paths(r, c) = paths(r-1, c) + paths(r, c-1)."], explanation="DP over a single row. O(m · n) time, O(n) space.")

add("word-break", "Word Break", "Medium", ["Dynamic Programming", "String", "Hash Table"],
    "Given a string `s` and a list of words `wordDict`, return `true` if `s` can be segmented into a space-separated sequence of one or more dictionary words. "
    "The same word may be reused multiple times.",
    ["1 <= s.length <= 300", "1 <= wordDict.length <= 1000", "1 <= wordDict[i].length <= 20", "All strings are lowercase English letters; words are unique."],
    "wordBreak", "s: str, wordDict: List[str]", "bool",
    "class Solution:\n    def wordBreak(self, s, wordDict):\n        words = set(wordDict)\n        dp = [True] + [False] * len(s)\n        for i in range(1, len(s) + 1):\n            for j in range(i):\n"
    "                if dp[j] and s[j:i] in words:\n                    dp[i] = True\n                    break\n        return dp[-1]\n",
    [(("leetcode", ["leet", "code"]), True, None), (("applepenapple", ["apple", "pen"]), True, "\"apple pen apple\" reuses \"apple\"."),
     (("catsandog", ["cats", "dog", "sand", "and", "cat"]), False, None)],
    [("a", ["b"]), ("aaaaaaa", ["aaaa", "aaa"]), ("a" * 299 + "b", ["a", "aa", "aaa"]), ("abcd", ["a", "abc", "b", "cd"])],
    hints=["dp[i] means the first i characters can be segmented.", "dp[i] is true if some earlier dp[j] is true and s[j:i] is a word."],
    explanation="Prefix DP with a word set. O(n^2).")

add("longest-palindromic-substring-length", "Longest Palindromic Substring (Length)", "Medium", ["String", "Dynamic Programming"],
    "Given a string `s`, return the **length** of the longest palindromic substring in `s`.",
    ["1 <= s.length <= 1000", "s consists of digits and English letters."],
    "longestPalindromeLength", "s: str", "int",
    "class Solution:\n    def longestPalindromeLength(self, s):\n        best = 0\n        for center in range(2 * len(s) - 1):\n            lo, hi = center // 2, center // 2 + center % 2\n"
    "            while lo >= 0 and hi < len(s) and s[lo] == s[hi]:\n                lo -= 1\n                hi += 1\n            best = max(best, hi - lo - 1)\n        return best\n",
    [(("babad",), 3, "\"bab\" and \"aba\" are both valid."), (("cbbd",), 2, "\"bb\"."), (("a",), 1, None)],
    [("ac",), ("forgeeksskeegfor",), ("abacdfgdcaba",), ("a" * 1000,), ("ab" * 500,)],
    hints=["Expand around every possible center (a character or a gap between two)."], explanation="Expand around each of the 2n-1 centers. O(n^2).")

# ----------------------------------------------------------------- Hard ------------------------------------------------------------------
add("trapping-rain-water", "Trapping Rain Water", "Hard", ["Array", "Two Pointers", "Dynamic Programming"],
    "Given `n` non-negative integers representing an elevation map where the width of each bar is `1`, compute how much water it can trap after raining.",
    ["n == height.length", "1 <= n <= 2 * 10^4", "0 <= height[i] <= 10^5"],
    "trap", "height: List[int]", "int",
    "class Solution:\n    def trap(self, height):\n        lo, hi = 0, len(height) - 1\n        left_max = right_max = water = 0\n        while lo < hi:\n            if height[lo] < height[hi]:\n"
    "                left_max = max(left_max, height[lo])\n                water += left_max - height[lo]\n                lo += 1\n            else:\n"
    "                right_max = max(right_max, height[hi])\n                water += right_max - height[hi]\n                hi -= 1\n        return water\n",
    [(([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1],), 6, None), (([4, 2, 0, 3, 2, 5],), 9, None)],
    [([1],), ([3, 0, 3],), ([5, 4, 1, 2],), (list(range(1500)) + list(range(1500, 0, -1)),), ([500, 0] * 1500,)],
    hints=["Water above a bar = min(tallest to its left, tallest to its right) minus its height.", "Two pointers can compute this in O(1) space."],
    explanation="Two pointers from both ends, tracking the best wall on each side. O(n).")

add("edit-distance", "Edit Distance", "Hard", ["String", "Dynamic Programming"],
    "Given two strings `word1` and `word2`, return the minimum number of operations needed to convert `word1` into `word2`.\n\n"
    "You may insert a character, delete a character, or replace a character.",
    ["0 <= word1.length, word2.length <= 500", "Both words consist of lowercase English letters."],
    "minDistance", "word1: str, word2: str", "int",
    "class Solution:\n    def minDistance(self, word1, word2):\n        prev = list(range(len(word2) + 1))\n        for i in range(1, len(word1) + 1):\n            cur = [i] + [0] * len(word2)\n"
    "            for j in range(1, len(word2) + 1):\n                if word1[i - 1] == word2[j - 1]:\n                    cur[j] = prev[j - 1]\n                else:\n"
    "                    cur[j] = 1 + min(prev[j], cur[j - 1], prev[j - 1])\n            prev = cur\n        return prev[-1]\n",
    [(("horse", "ros"), 3, "horse -> rorse -> rose -> ros."), (("intention", "execution"), 5, None)],
    [("", ""), ("", "abc"), ("abc", ""), ("same", "same"), ("kitten", "sitting"), ("a" * 400, "b" * 400)],
    hints=["dp[i][j] is the distance between the first i letters of word1 and the first j of word2."], explanation="Classic Levenshtein DP. O(m · n).")

add("median-of-two-sorted-arrays", "Median of Two Sorted Arrays", "Hard", ["Array", "Binary Search", "Divide and Conquer"],
    "Given two sorted arrays `nums1` and `nums2`, return the median of the two sorted arrays.\n\nThe overall run time complexity should be O(log (m+n)).",
    ["0 <= nums1.length, nums2.length <= 1000", "1 <= nums1.length + nums2.length <= 2000", "-10^6 <= nums1[i], nums2[i] <= 10^6"],
    "findMedianSortedArrays", "nums1: List[int], nums2: List[int]", "float",
    "class Solution:\n    def findMedianSortedArrays(self, nums1, nums2):\n        a, b = sorted(nums1), sorted(nums2)\n        if len(a) > len(b):\n            a, b = b, a\n        m, n = len(a), len(b)\n"
    "        lo, hi, half = 0, m, (m + n + 1) // 2\n        while lo <= hi:\n            i = (lo + hi) // 2\n            j = half - i\n            a_left = a[i - 1] if i else float('-inf')\n"
    "            a_right = a[i] if i < m else float('inf')\n            b_left = b[j - 1] if j else float('-inf')\n            b_right = b[j] if j < n else float('inf')\n"
    "            if a_left <= b_right and b_left <= a_right:\n                if (m + n) % 2:\n                    return float(max(a_left, b_left))\n"
    "                return (max(a_left, b_left) + min(a_right, b_right)) / 2\n            if a_left > b_right:\n                hi = i - 1\n            else:\n                lo = i + 1\n",
    [(([1, 3], [2]), 2.0, "Merged array is [1, 2, 3]; the median is 2."), (([1, 2], [3, 4]), 2.5, "Merged array is [1, 2, 3, 4]; the median is (2 + 3) / 2.")],
    [([], [1]), ([2], []), ([0, 0], [0, 0]), ([1, 3, 5, 7], [2, 4, 6]), (list(range(0, 2000, 2)), list(range(1, 2001, 2)))],
    compare="float",
    hints=["Binary search the partition point of the smaller array."], explanation="Partition both arrays so that the left halves hold half the elements. O(log(min(m, n))).")

add("longest-valid-parentheses", "Longest Valid Parentheses", "Hard", ["String", "Dynamic Programming", "Stack"],
    "Given a string containing just the characters `'('` and `')'`, return the length of the longest valid (well-formed) parentheses substring.",
    ["0 <= s.length <= 3 * 10^4", "s[i] is '(' or ')'."],
    "longestValidParentheses", "s: str", "int",
    "class Solution:\n    def longestValidParentheses(self, s):\n        stack, best = [-1], 0\n        for i, c in enumerate(s):\n            if c == '(':\n                stack.append(i)\n            else:\n"
    "                stack.pop()\n                if not stack:\n                    stack.append(i)\n                else:\n                    best = max(best, i - stack[-1])\n        return best\n",
    [(("(()",), 2, "The longest valid substring is \"()\"."), ((")()())",), 4, "The longest valid substring is \"()()\"."), (("",), 0, None)],
    [("()(()",), ("()(())",), ("))))((()((",), ("(" * 10000 + ")" * 10000,), ("()" * 10000,)],
    hints=["Keep a stack of indices; the index below the top marks where a valid run began."], explanation="Index stack with a sentinel. O(n).")

add("minimum-window-substring", "Minimum Window Substring", "Hard", ["Hash Table", "String", "Sliding Window"],
    "Given two strings `s` and `t`, return the minimum window substring of `s` such that every character in `t` (including duplicates) is included in the window. "
    "If there is no such window, return the empty string `\"\"`.\n\nIf several windows have the minimum length, return the leftmost one.",
    ["1 <= s.length, t.length <= 10^5", "s and t consist of uppercase and lowercase English letters."],
    "minWindow", "s: str, t: str", "str",
    "class Solution:\n    def minWindow(self, s, t):\n        from collections import Counter\n        need, missing = Counter(t), len(t)\n        best = (0, 0)\n        start = 0\n        for end, c in enumerate(s, 1):\n"
    "            if need[c] > 0:\n                missing -= 1\n            need[c] -= 1\n            if missing == 0:\n                while need[s[start]] < 0:\n                    need[s[start]] += 1\n                    start += 1\n"
    "                if best == (0, 0) or end - start < best[1] - best[0]:\n                    best = (start, end)\n                need[s[start]] += 1\n                missing += 1\n                start += 1\n"
    "        return s[best[0]:best[1]]\n",
    [(("ADOBECODEBANC", "ABC"), "BANC", None), (("a", "a"), "a", None), (("a", "aa"), "", "Both 'a's from t must be in the window.")],
    [("ab", "b"), ("abc", "cba"), ("aaflslflsldkalskaaa", "aaa"), ("a" * 5000 + "b" + "a" * 5000, "ab")],
    hints=["Expand the right end until the window is valid, then shrink the left end as far as possible."],
    explanation="Sliding window with a need-counter. O(|s| + |t|).")

add("n-queens-count", "N-Queens (Count)", "Hard", ["Backtracking"],
    "The n-queens puzzle places `n` queens on an `n x n` chessboard so that no two queens attack each other (no shared row, column or diagonal).\n\n"
    "Given `n`, return the **number** of distinct solutions.",
    ["1 <= n <= 9"],
    "totalNQueens", "n: int", "int",
    "class Solution:\n    def totalNQueens(self, n):\n        cols, d1, d2 = set(), set(), set()\n\n        def place(r):\n            if r == n:\n                return 1\n            total = 0\n"
    "            for c in range(n):\n                if c in cols or r - c in d1 or r + c in d2:\n                    continue\n                cols.add(c)\n                d1.add(r - c)\n                d2.add(r + c)\n"
    "                total += place(r + 1)\n                cols.remove(c)\n                d1.remove(r - c)\n                d2.remove(r + c)\n            return total\n\n        return place(0)\n",
    [((4,), 2, "There are two distinct solutions."), ((1,), 1, None)],
    [(2,), (3,), (5,), (6,), (8,), (9,)],
    hints=["Place one queen per row and track used columns and diagonals."], explanation="Backtracking with column and diagonal sets. About O(n!).")


from services import coding_problem_bank_extra  # noqa: E402  (registers the linked-list / tree / further problems after the originals)

coding_problem_bank_extra.register(add)
