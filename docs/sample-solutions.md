# Sample assessment: the questions and their solutions

For testing `backend/scripts/sample_blueprint.json`. Paste a solution over the whole editor content, then **Run** (2 examples) or **Submit** the section (all 7 tests: 2 examples + 5 hidden).

## Problem 1: Pair With Target Sum (Easy) · `pairIndices(int[] nums, int target) -> int[]`
Return the indices of the two numbers that add up to `target` (exactly one pair exists).
Examples: `nums=[2,7,11,15], target=9 -> [0,1]` · `nums=[3,2,4], target=6 -> [1,2]`

**Python3**
```python
class Solution:
    def pairIndices(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
        return []
```
**Java**
```java
class Solution {
    public int[] pairIndices(int[] nums, int target) {
        for (int i = 0; i < nums.length; i++)
            for (int j = i + 1; j < nums.length; j++)
                if (nums[i] + nums[j] == target) return new int[]{i, j};
        return new int[0];
    }
}
```
**C++**
```cpp
class Solution {
public:
    vector<int> pairIndices(vector<int>& nums, int target) {
        for (int i = 0; i < (int)nums.size(); i++)
            for (int j = i + 1; j < (int)nums.size(); j++)
                if (nums[i] + nums[j] == target) return {i, j};
        return {};
    }
};
```
**C**
```c
int* pairIndices(int* nums, int numsSize, int target, int* returnSize) {
    for (int i = 0; i < numsSize; i++)
        for (int j = i + 1; j < numsSize; j++)
            if (nums[i] + nums[j] == target) {
                int* r = malloc(2 * sizeof(int));
                r[0] = i; r[1] = j; *returnSize = 2;
                return r;
            }
    *returnSize = 0;
    return NULL;
}
```

## Problem 2: Longest Unique Substring (Medium) · `longestUniqueSubstring(string s) -> int`
Return the length of the longest substring without a repeated character.
Examples: `"abcabcbb" -> 3` · `"bbbbb" -> 1`

**Python3**
```python
class Solution:
    def longestUniqueSubstring(self, s: str) -> int:
        last, start, best = {}, 0, 0
        for i, ch in enumerate(s):
            if ch in last and last[ch] >= start:
                start = last[ch] + 1
            last[ch] = i
            best = max(best, i - start + 1)
        return best
```
**Java**
```java
class Solution {
    public int longestUniqueSubstring(String s) {
        int[] last = new int[128];
        Arrays.fill(last, -1);
        int start = 0, best = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (last[c] >= start) start = last[c] + 1;
            last[c] = i;
            best = Math.max(best, i - start + 1);
        }
        return best;
    }
}
```
**C++**
```cpp
class Solution {
public:
    int longestUniqueSubstring(string s) {
        int last[128];
        fill(begin(last), end(last), -1);
        int start = 0, best = 0;
        for (int i = 0; i < (int)s.size(); i++) {
            unsigned char c = s[i];
            if (last[c] >= start) start = last[c] + 1;
            last[c] = i;
            best = max(best, i - start + 1);
        }
        return best;
    }
};
```
**C**
```c
int longestUniqueSubstring(char* s) {
    int last[128];
    for (int i = 0; i < 128; i++) last[i] = -1;
    int start = 0, best = 0;
    for (int i = 0; s[i]; i++) {
        unsigned char c = s[i];
        if (last[c] >= start) start = last[c] + 1;
        last[c] = i;
        if (i - start + 1 > best) best = i - start + 1;
    }
    return best;
}
```

## Snippets to provoke each result (Problem 1)
| Result | Python3 | C++ |
|---|---|---|
| Wrong Answer | `return []` | `return {};` |
| Compile Error | `def pairIndices(self, nums, target)` (delete the colon) | delete a `;` |
| Runtime Error | `raise ValueError("boom")` | `int* p = nullptr; return {*p};` |
| Time Limit Exceeded | `while True: pass` | `while (true) {}` |

Expected scoring on Submit: both problems correct = 7/7 each = 100%. Problem 1 returning an empty answer passes none of the tests.
