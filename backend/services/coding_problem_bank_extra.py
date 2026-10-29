"""
More problems for the bank: linked lists, binary trees (LeetCode's ListNode / TreeNode convention) and further classics.
Test data stays plain JSON: a list is [1,2,3]; a tree is level order with null for a missing child, e.g. [1,null,2,3].
"""
LIST_SIG = ("head: Optional[ListNode]", "Optional[ListNode]")


def register(add):
    # ------------------------------------------------------------- linked lists -------------------------------------------------------------
    add("reverse-linked-list", "Reverse Linked List", "Easy", ["Linked List"],
        "Given the `head` of a singly linked list, reverse the list and return the reversed list.",
        ["The number of nodes is in the range [0, 5000]", "-5000 <= Node.val <= 5000"],
        "reverseList", "head: Optional[ListNode]", "Optional[ListNode]",
        "class Solution:\n    def reverseList(self, head):\n        prev = None\n        while head:\n            nxt = head.next\n            head.next = prev\n"
        "            prev, head = head, nxt\n        return prev\n",
        [(([1, 2, 3, 4, 5],), [5, 4, 3, 2, 1], None), (([1, 2],), [2, 1], None), (([],), [], "An empty list stays empty.")],
        [([1],), ([7, 7],), (list(range(1, 3001)),), ([-3, 0, 5],), ([9, 8, 7, 6],)],
        hints=["Keep track of the previous node while walking the list.", "Re-point each node's next to the previous node before you move on."],
        explanation="Walk once, flipping each next pointer to the previous node. O(n) time, O(1) space.", argtypes=["list"], rettype="list")

    add("merge-two-sorted-lists", "Merge Two Sorted Lists", "Easy", ["Linked List", "Recursion"],
        "You are given the heads of two sorted linked lists `list1` and `list2`. Merge them into one sorted list by splicing together the nodes of the two lists, and return the head of the merged list.",
        ["The number of nodes in both lists is in the range [0, 50]", "-100 <= Node.val <= 100", "Both lists are sorted in non-decreasing order."],
        "mergeTwoLists", "list1: Optional[ListNode], list2: Optional[ListNode]", "Optional[ListNode]",
        "class Solution:\n    def mergeTwoLists(self, list1, list2):\n        dummy = tail = ListNode()\n        while list1 and list2:\n            if list1.val <= list2.val:\n"
        "                tail.next, list1 = list1, list1.next\n            else:\n                tail.next, list2 = list2, list2.next\n            tail = tail.next\n"
        "        tail.next = list1 or list2\n        return dummy.next\n",
        [(([1, 2, 4], [1, 3, 4]), [1, 1, 2, 3, 4, 4], None), (([], []), [], None), (([], [0]), [0], None)],
        [([5], [1, 2, 4]), ([1, 1, 1], [1, 1]), ([-10, -5, 0], [-7, -6, 3, 9]), (list(range(0, 2000, 2)), list(range(1, 2000, 2))), ([2], [])],
        hints=["Use a dummy head so you never special-case the first node."], explanation="Repeatedly attach the smaller head. O(n + m).",
        argtypes=["list", "list"], rettype="list")

    add("middle-of-the-linked-list", "Middle of the Linked List", "Easy", ["Linked List", "Two Pointers"],
        "Given the `head` of a singly linked list, return the middle node of the list. If there are two middle nodes, return the second one.\n\n"
        "The returned list is the middle node and everything after it.",
        ["The number of nodes is in the range [1, 100]", "1 <= Node.val <= 100"],
        "middleNode", "head: Optional[ListNode]", "Optional[ListNode]",
        "class Solution:\n    def middleNode(self, head):\n        slow = fast = head\n        while fast and fast.next:\n            slow, fast = slow.next, fast.next.next\n        return slow\n",
        [(([1, 2, 3, 4, 5],), [3, 4, 5], None), (([1, 2, 3, 4, 5, 6],), [4, 5, 6], "There are two middle nodes (3 and 4); return the second.")],
        [([1],), ([1, 2],), ([1, 2, 3],), (list(range(1, 101)),), (list(range(1, 100)),), ([5, 5, 5, 5],)],
        hints=["Move one pointer twice as fast as the other."], explanation="Fast and slow pointers. O(n) time, O(1) space.", argtypes=["list"], rettype="list")

    add("remove-nth-node-from-end-of-list", "Remove Nth Node From End of List", "Medium", ["Linked List", "Two Pointers"],
        "Given the `head` of a linked list, remove the `n`-th node from the end of the list and return its head.",
        ["The number of nodes is `sz`", "1 <= sz <= 30", "0 <= Node.val <= 100", "1 <= n <= sz"],
        "removeNthFromEnd", "head: Optional[ListNode], n: int", "Optional[ListNode]",
        "class Solution:\n    def removeNthFromEnd(self, head, n):\n        dummy = ListNode(0, head)\n        fast = slow = dummy\n        for _ in range(n):\n            fast = fast.next\n"
        "        while fast.next:\n            fast, slow = fast.next, slow.next\n        slow.next = slow.next.next\n        return dummy.next\n",
        [(([1, 2, 3, 4, 5], 2), [1, 2, 3, 5], None), (([1], 1), [], None), (([1, 2], 1), [1], None)],
        [([1, 2], 2), ([1, 2, 3], 3), ([1, 2, 3], 1), (list(range(1, 31)), 15), (list(range(1, 31)), 30), ([4, 5, 6, 7], 4)],
        hints=["Put a gap of n nodes between two pointers, then move both to the end."], explanation="Two pointers n apart. O(n) time, O(1) space.",
        argtypes=["list", None], rettype="list")

    add("palindrome-linked-list", "Palindrome Linked List", "Easy", ["Linked List", "Two Pointers", "Stack"],
        "Given the `head` of a singly linked list, return `true` if it is a palindrome, or `false` otherwise.",
        ["The number of nodes is in the range [1, 10^5]", "0 <= Node.val <= 9"],
        "isPalindrome", "head: Optional[ListNode]", "bool",
        "class Solution:\n    def isPalindrome(self, head):\n        values = []\n        while head:\n            values.append(head.val)\n            head = head.next\n        return values == values[::-1]\n",
        [(([1, 2, 2, 1],), True, None), (([1, 2],), False, None)],
        [([1],), ([1, 2, 1],), ([1, 2, 3, 2, 1],), ([1, 1, 2, 1],), (list(range(5)) + list(range(4, -1, -1)),), ([1] * 2000 + [2] + [1] * 2000,)],
        hints=["Copy the values into an array, or reverse the second half in place."], explanation="Compare the values to their reverse. O(n).",
        argtypes=["list"])

    add("add-two-numbers", "Add Two Numbers", "Medium", ["Linked List", "Math"],
        "You are given two non-empty linked lists representing two non-negative integers. The digits are stored in **reverse order**, and each node contains a single digit.\n\n"
        "Add the two numbers and return the sum as a linked list in the same format.",
        ["The number of nodes in each list is in the range [1, 100]", "0 <= Node.val <= 9", "The lists have no leading zeros, except for the number 0 itself."],
        "addTwoNumbers", "l1: Optional[ListNode], l2: Optional[ListNode]", "Optional[ListNode]",
        "class Solution:\n    def addTwoNumbers(self, l1, l2):\n        dummy = tail = ListNode()\n        carry = 0\n        while l1 or l2 or carry:\n            total = carry + (l1.val if l1 else 0) + (l2.val if l2 else 0)\n"
        "            carry, digit = divmod(total, 10)\n            tail.next = ListNode(digit)\n            tail = tail.next\n            l1 = l1.next if l1 else None\n            l2 = l2.next if l2 else None\n        return dummy.next\n",
        [(([2, 4, 3], [5, 6, 4]), [7, 0, 8], "342 + 465 = 807."), (([0], [0]), [0], None), (([9, 9, 9, 9, 9, 9, 9], [9, 9, 9, 9]), [8, 9, 9, 9, 0, 0, 0, 1], None)],
        [([1], [9]), ([5], [5]), ([1, 8], [0]), ([9] * 100, [1]), ([2] * 50, [8] * 60), ([0, 1], [0, 1, 2])],
        hints=["Add digit by digit, carrying into the next position."], explanation="Simulate column addition with a carry. O(max(n, m)).",
        argtypes=["list", "list"], rettype="list")

    add("remove-duplicates-from-sorted-list", "Remove Duplicates from Sorted List", "Easy", ["Linked List"],
        "Given the `head` of a sorted linked list, delete all duplicates so that each element appears only once. Return the linked list sorted as well.",
        ["The number of nodes is in the range [0, 300]", "-100 <= Node.val <= 100", "The list is sorted in ascending order."],
        "deleteDuplicates", "head: Optional[ListNode]", "Optional[ListNode]",
        "class Solution:\n    def deleteDuplicates(self, head):\n        cur = head\n        while cur and cur.next:\n            if cur.val == cur.next.val:\n                cur.next = cur.next.next\n"
        "            else:\n                cur = cur.next\n        return head\n",
        [(([1, 1, 2],), [1, 2], None), (([1, 1, 2, 3, 3],), [1, 2, 3], None)],
        [([],), ([1],), ([2, 2, 2, 2],), ([1, 2, 3],), ([-1, -1, 0, 0, 5, 5, 5],), ([i // 3 for i in range(300)],)],
        hints=["Because the list is sorted, duplicates are always adjacent."], explanation="Skip a node when it equals its successor. O(n).",
        argtypes=["list"], rettype="list")

    # --------------------------------------------------------------- binary trees --------------------------------------------------------------
    skew = sum(([i, None] for i in range(1, 400)), [400])        # a right-leaning chain 400 deep: catches slow or recursive-heavy code
    full = list(range(1, 1024))                                   # a perfect tree, 10 levels
    add("maximum-depth-of-binary-tree", "Maximum Depth of Binary Tree", "Easy", ["Tree", "Depth-First Search", "Binary Tree"],
        "Given the `root` of a binary tree, return its maximum depth: the number of nodes along the longest path from the root down to the farthest leaf.",
        ["The number of nodes is in the range [0, 10^4]", "-100 <= Node.val <= 100"],
        "maxDepth", "root: Optional[TreeNode]", "int",
        "class Solution:\n    def maxDepth(self, root):\n        if not root:\n            return 0\n        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))\n",
        [(([3, 9, 20, None, None, 15, 7],), 3, None), (([1, None, 2],), 2, None), (([],), 0, None)],
        [([1],), ([1, 2],), ([1, 2, 3, 4, 5],), (full,), (skew,), ([1, None, 2, None, 3, None, 4],)],
        hints=["The depth of a tree is 1 plus the larger depth of its two subtrees."], explanation="Recursive depth. O(n).", argtypes=["tree"])

    add("invert-binary-tree", "Invert Binary Tree", "Easy", ["Tree", "Binary Tree"],
        "Given the `root` of a binary tree, invert the tree (swap every left and right child) and return its root.",
        ["The number of nodes is in the range [0, 100]", "-100 <= Node.val <= 100"],
        "invertTree", "root: Optional[TreeNode]", "Optional[TreeNode]",
        "class Solution:\n    def invertTree(self, root):\n        if root:\n            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root\n",
        [(([4, 2, 7, 1, 3, 6, 9],), [4, 7, 2, 9, 6, 3, 1], None), (([2, 1, 3],), [2, 3, 1], None), (([],), [], None)],
        [([1],), ([1, 2],), ([1, None, 2],), ([1, 2, 3, 4, None, None, 5],), (list(range(1, 64)),), ([5, 3, 8, 1, 4, 7, 9, 0, 2, 6],)],
        hints=["Swap the children of every node."], explanation="Recursively swap children. O(n).", argtypes=["tree"], rettype="tree")

    add("same-tree", "Same Tree", "Easy", ["Tree", "Depth-First Search"],
        "Given the roots of two binary trees `p` and `q`, return `true` if they are the same tree: structurally identical and with equal node values.",
        ["The number of nodes in both trees is in the range [0, 100]", "-10^4 <= Node.val <= 10^4"],
        "isSameTree", "p: Optional[TreeNode], q: Optional[TreeNode]", "bool",
        "class Solution:\n    def isSameTree(self, p, q):\n        if not p or not q:\n            return p is q\n        return p.val == q.val and self.isSameTree(p.left, q.left) and self.isSameTree(p.right, q.right)\n",
        [(([1, 2, 3], [1, 2, 3]), True, None), (([1, 2], [1, None, 2]), False, "Same values, different shape."), (([1, 2, 1], [1, 1, 2]), False, None)],
        [([], []), ([], [1]), ([1], [1]), ([1, 2, 3], [1, 2, 4]), (full, full), (full, full[:-1] + [0])],
        hints=["Compare the roots, then recurse on both subtrees."], explanation="Simultaneous traversal. O(n).", argtypes=["tree", "tree"])

    add("symmetric-tree", "Symmetric Tree", "Easy", ["Tree", "Breadth-First Search"],
        "Given the `root` of a binary tree, check whether it is a mirror of itself (symmetric around its centre).",
        ["The number of nodes is in the range [1, 1000]", "-100 <= Node.val <= 100"],
        "isSymmetric", "root: Optional[TreeNode]", "bool",
        "class Solution:\n    def isSymmetric(self, root):\n        def mirror(a, b):\n            if not a or not b:\n                return a is b\n            return a.val == b.val and mirror(a.left, b.right) and mirror(a.right, b.left)\n"
        "        return mirror(root.left, root.right) if root else True\n",
        [(([1, 2, 2, 3, 4, 4, 3],), True, None), (([1, 2, 2, None, 3, None, 3],), False, None)],
        [([1],), ([1, 2, 2],), ([1, 2, 3],), ([1, 2, 2, 3, None, None, 3],), ([1, 2, 2, None, 3, 3],), ([1] * 63,)],
        hints=["A tree is symmetric when its left subtree mirrors its right subtree."], explanation="Mirror recursion. O(n).", argtypes=["tree"])

    add("binary-tree-level-order-traversal", "Binary Tree Level Order Traversal", "Medium", ["Tree", "Breadth-First Search"],
        "Given the `root` of a binary tree, return the level order traversal of its node values: from left to right, level by level.",
        ["The number of nodes is in the range [0, 2000]", "-1000 <= Node.val <= 1000"],
        "levelOrder", "root: Optional[TreeNode]", "List[List[int]]",
        "class Solution:\n    def levelOrder(self, root):\n        out, level = [], [root] if root else []\n        while level:\n            out.append([n.val for n in level])\n"
        "            level = [c for n in level for c in (n.left, n.right) if c]\n        return out\n",
        [(([3, 9, 20, None, None, 15, 7],), [[3], [9, 20], [15, 7]], None), (([1],), [[1]], None), (([],), [], None)],
        [([1, 2],), ([1, None, 2],), ([1, 2, 3, 4, 5, 6, 7],), (list(range(1, 32)),), ([1, 2, 3, None, 4, 5],), ([2, 1, 3, 0, 7, 9, 1, 2],)],
        hints=["Process one whole level at a time using a queue or a list of the current level."], explanation="BFS by levels. O(n).", argtypes=["tree"])

    add("validate-binary-search-tree", "Validate Binary Search Tree", "Medium", ["Tree", "Binary Search Tree"],
        "Given the `root` of a binary tree, determine whether it is a valid binary search tree (BST).\n\n"
        "A valid BST has, for every node, only smaller keys in its left subtree and only larger keys in its right subtree.",
        ["The number of nodes is in the range [1, 10^4]", "-2^31 <= Node.val <= 2^31 - 1"],
        "isValidBST", "root: Optional[TreeNode]", "bool",
        "class Solution:\n    def isValidBST(self, root):\n        def ok(node, lo, hi):\n            if not node:\n                return True\n            if not lo < node.val < hi:\n                return False\n"
        "            return ok(node.left, lo, node.val) and ok(node.right, node.val, hi)\n        return ok(root, float('-inf'), float('inf'))\n",
        [(([2, 1, 3],), True, None), (([5, 1, 4, None, None, 3, 6],), False, "The right child 4 is smaller than the root 5.")],
        [([1],), ([1, 1],), ([2, 2, 2],), ([5, 4, 6, None, None, 3, 7],), ([10, 5, 15, None, None, 6, 20],), ([8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15],)],
        hints=["Checking only a node's children is not enough: every node in a subtree must respect every ancestor's bound."],
        explanation="Pass down an (exclusive) lower and upper bound. O(n).", argtypes=["tree"])

    add("kth-smallest-element-in-a-bst", "Kth Smallest Element in a BST", "Medium", ["Tree", "Binary Search Tree"],
        "Given the `root` of a binary search tree and an integer `k`, return the `k`-th smallest value (1-indexed) of all the values of the nodes in the tree.",
        ["The number of nodes is `n`", "1 <= k <= n <= 10^4", "0 <= Node.val <= 10^4"],
        "kthSmallest", "root: Optional[TreeNode], k: int", "int",
        "class Solution:\n    def kthSmallest(self, root, k):\n        stack, node = [], root\n        while True:\n            while node:\n                stack.append(node)\n                node = node.left\n"
        "            node = stack.pop()\n            k -= 1\n            if k == 0:\n                return node.val\n            node = node.right\n",
        [(([3, 1, 4, None, 2], 1), 1, None), (([5, 3, 6, 2, 4, None, None, 1], 3), 3, None)],
        [([1], 1), ([2, 1], 2), ([2, None, 3], 2), ([8, 4, 12, 2, 6, 10, 14], 5), ([8, 4, 12, 2, 6, 10, 14], 7), ([4, 2, 6, 1, 3, 5, 7], 4)],
        hints=["An in-order traversal of a BST visits values in ascending order."], explanation="Iterative in-order traversal, stopping at the k-th node. O(h + k).",
        argtypes=["tree", None])

    add("path-sum", "Path Sum", "Easy", ["Tree", "Depth-First Search"],
        "Given the `root` of a binary tree and an integer `targetSum`, return `true` if the tree has a **root-to-leaf** path whose node values add up to `targetSum`.",
        ["The number of nodes is in the range [0, 5000]", "-1000 <= Node.val <= 1000", "-1000 <= targetSum <= 1000"],
        "hasPathSum", "root: Optional[TreeNode], targetSum: int", "bool",
        "class Solution:\n    def hasPathSum(self, root, targetSum):\n        if not root:\n            return False\n        if not root.left and not root.right:\n            return root.val == targetSum\n"
        "        rest = targetSum - root.val\n        return self.hasPathSum(root.left, rest) or self.hasPathSum(root.right, rest)\n",
        [(([5, 4, 8, 11, None, 13, 4, 7, 2, None, None, None, 1], 22), True, "5 + 4 + 11 + 2 = 22."), (([1, 2, 3], 5), False, None), (([], 0), False, None)],
        [([1], 1), ([1, 2], 1), ([1, 2], 3), ([-2, None, -3], -5), ([1, -2, -3, 1, 3, -2, None, -1], -1), ([0, 1, 1], 1)],
        hints=["A path must end at a leaf: a node with no children."], explanation="Subtract as you descend; check at the leaves. O(n).", argtypes=["tree", None])

    add("diameter-of-binary-tree", "Diameter of Binary Tree", "Easy", ["Tree", "Depth-First Search"],
        "Given the `root` of a binary tree, return the length of its **diameter**: the number of edges on the longest path between any two nodes. The path may or may not pass through the root.",
        ["The number of nodes is in the range [1, 10^4]", "-100 <= Node.val <= 100"],
        "diameterOfBinaryTree", "root: Optional[TreeNode]", "int",
        "class Solution:\n    def diameterOfBinaryTree(self, root):\n        best = 0\n\n        def depth(node):\n            nonlocal best\n            if not node:\n                return 0\n"
        "            left, right = depth(node.left), depth(node.right)\n            best = max(best, left + right)\n            return 1 + max(left, right)\n\n        depth(root)\n        return best\n",
        [(([1, 2, 3, 4, 5],), 3, "The path [4, 2, 1, 3] has 3 edges."), (([1, 2],), 1, None)],
        [([1],), ([1, 2, 3],), ([1, None, 2, None, 3],), (full,), (skew,), ([1, 2, None, 3, 4, 5, None, None, 6],)],
        hints=["The longest path through a node is its left depth plus its right depth."], explanation="One DFS that tracks the best left+right depth. O(n).", argtypes=["tree"])

    add("binary-tree-right-side-view", "Binary Tree Right Side View", "Medium", ["Tree", "Breadth-First Search"],
        "Given the `root` of a binary tree, imagine standing on its right side. Return the values of the nodes you can see, ordered from top to bottom.",
        ["The number of nodes is in the range [0, 100]", "-100 <= Node.val <= 100"],
        "rightSideView", "root: Optional[TreeNode]", "List[int]",
        "class Solution:\n    def rightSideView(self, root):\n        out, level = [], [root] if root else []\n        while level:\n            out.append(level[-1].val)\n            level = [c for n in level for c in (n.left, n.right) if c]\n        return out\n",
        [(([1, 2, 3, None, 5, None, 4],), [1, 3, 4], None), (([1, None, 3],), [1, 3], None), (([],), [], None)],
        [([1],), ([1, 2],), ([1, 2, 3, 4],), ([1, 2, 3, 4, None, None, None, 5],), (list(range(1, 64)),), ([1, 2, None, 3, None, 4],)],
        hints=["The last node of every level is the one you can see."], explanation="Level-order traversal keeping each level's last node. O(n).", argtypes=["tree"])

    # ------------------------------------------------------------------ more classics ------------------------------------------------------------------
    add("kth-largest-element-in-an-array", "Kth Largest Element in an Array", "Medium", ["Array", "Heap", "Sorting"],
        "Given an integer array `nums` and an integer `k`, return the `k`-th largest element in the array.\n\nIt is the `k`-th largest in sorted order, not the `k`-th distinct element.",
        ["1 <= k <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4"],
        "findKthLargest", "nums: List[int], k: int", "int",
        "class Solution:\n    def findKthLargest(self, nums, k):\n        import heapq\n        return heapq.nlargest(k, nums)[-1]\n",
        [(([3, 2, 1, 5, 6, 4], 2), 5, None), (([3, 2, 3, 1, 2, 4, 5, 5, 6], 4), 4, None)],
        [([1], 1), ([2, 1], 2), ([7, 7, 7], 2), ([-1, -2, -3], 3), (list(range(2000, 0, -1)), 1000), ([i % 50 for i in range(3000)], 100)],
        hints=["A min-heap of size k keeps the k largest so far."], explanation="Heap of the k largest. O(n log k).")

    add("subsets", "Subsets", "Medium", ["Array", "Backtracking", "Bit Manipulation"],
        "Given an integer array `nums` of **unique** elements, return all possible subsets (the power set).\n\nThe solution set must not contain duplicate subsets. Return the subsets in any order.",
        ["1 <= nums.length <= 10", "-10 <= nums[i] <= 10", "All the numbers of nums are unique."],
        "subsets", "nums: List[int]", "List[List[int]]",
        "class Solution:\n    def subsets(self, nums):\n        out = [[]]\n        for x in nums:\n            out += [s + [x] for s in out]\n        return out\n",
        [(([1, 2, 3],), [[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3]], None), (([0],), [[], [0]], None)],
        [([1, 2],), ([5, -5],), ([1, 2, 3, 4],), ([-1, 0, 1],), (list(range(10)),), ([3],)],
        compare="unordered_nested", hints=["Each element is either in a subset or not."], explanation="Doubling: add each new element to every existing subset. O(n · 2^n).")

    add("permutations", "Permutations", "Medium", ["Array", "Backtracking"],
        "Given an array `nums` of distinct integers, return all the possible permutations. You can return the answer in any order.",
        ["1 <= nums.length <= 6", "-10 <= nums[i] <= 10", "All the integers of nums are unique."],
        "permute", "nums: List[int]", "List[List[int]]",
        "class Solution:\n    def permute(self, nums):\n        import itertools\n        return [list(p) for p in itertools.permutations(nums)]\n",
        [(([1, 2, 3],), [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]], None), (([0, 1],), [[0, 1], [1, 0]], None), (([1],), [[1]], None)],
        [([1, 2],), ([3, 1, 2],), ([-1, 0, 1],), ([1, 2, 3, 4],), ([5, 4, 3, 2, 1],), ([1, 2, 3, 4, 5, 6],)],
        compare="unordered", hints=["Choose one unused number at each position and backtrack."], explanation="Backtracking over unused elements. O(n · n!).")

    add("combination-sum", "Combination Sum", "Medium", ["Array", "Backtracking"],
        "Given an array of **distinct** integers `candidates` and a target integer `target`, return all unique combinations of candidates where the chosen numbers sum to `target`, in any order.\n\n"
        "The same number may be chosen from `candidates` an unlimited number of times.",
        ["1 <= candidates.length <= 30", "2 <= candidates[i] <= 40", "All elements of candidates are distinct.", "1 <= target <= 40"],
        "combinationSum", "candidates: List[int], target: int", "List[List[int]]",
        "class Solution:\n    def combinationSum(self, candidates, target):\n        out = []\n\n        def go(start, remaining, path):\n            if remaining == 0:\n                out.append(path[:])\n                return\n"
        "            for i in range(start, len(candidates)):\n                if candidates[i] <= remaining:\n                    path.append(candidates[i])\n                    go(i, remaining - candidates[i], path)\n                    path.pop()\n\n        go(0, target, [])\n        return out\n",
        [(([2, 3, 6, 7], 7), [[2, 2, 3], [7]], None), (([2, 3, 5], 8), [[2, 2, 2, 2], [2, 3, 3], [3, 5]], None), (([2], 1), [], None)],
        [([3], 9), ([2, 4], 8), ([5, 3, 4], 12), ([7, 3, 2], 18), ([2, 3, 5, 7, 11], 20), ([8, 7, 4, 3], 11)],
        compare="unordered_nested", hints=["Try each candidate from the current index onward, so combinations are not repeated in a different order."],
        explanation="Backtracking with a start index. Exponential in the worst case.")

    add("generate-parentheses", "Generate Parentheses", "Medium", ["String", "Backtracking", "Dynamic Programming"],
        "Given `n` pairs of parentheses, write a function to generate all combinations of well-formed parentheses. Return them in any order.",
        ["1 <= n <= 8"],
        "generateParenthesis", "n: int", "List[str]",
        "class Solution:\n    def generateParenthesis(self, n):\n        out = []\n\n        def go(cur, opened, closed):\n            if len(cur) == 2 * n:\n                out.append(cur)\n                return\n"
        "            if opened < n:\n                go(cur + '(', opened + 1, closed)\n            if closed < opened:\n                go(cur + ')', opened, closed + 1)\n\n        go('', 0, 0)\n        return out\n",
        [((3,), ["((()))", "(()())", "(())()", "()(())", "()()()"], None), ((1,), ["()"], None)],
        [(2,), (4,), (5,), (6,), (7,), (8,)],
        compare="unordered", hints=["You may add a closing bracket only while there are more opens than closes."], explanation="Backtracking on open/close counts (Catalan number of results).")

    add("jump-game", "Jump Game", "Medium", ["Array", "Greedy", "Dynamic Programming"],
        "You are given an integer array `nums`. You start at the first index and each element is your **maximum** jump length from that position.\n\nReturn `true` if you can reach the last index, or `false` otherwise.",
        ["1 <= nums.length <= 10^4", "0 <= nums[i] <= 10^5"],
        "canJump", "nums: List[int]", "bool",
        "class Solution:\n    def canJump(self, nums):\n        reach = 0\n        for i, x in enumerate(nums):\n            if i > reach:\n                return False\n            reach = max(reach, i + x)\n        return True\n",
        [(([2, 3, 1, 1, 4],), True, None), (([3, 2, 1, 0, 4],), False, "You always end up at index 3, whose jump length is 0.")],
        [([0],), ([0, 1],), ([1, 0],), ([2, 0, 0],), ([1] * 3000,), ([1] * 2999 + [0] + [5],)],
        hints=["Track the furthest index you can reach so far."], explanation="Greedy furthest-reach. O(n).")

    add("search-a-2d-matrix", "Search a 2D Matrix", "Medium", ["Array", "Binary Search", "Matrix"],
        "You are given an `m x n` integer matrix where each row is sorted ascending and the first integer of each row is greater than the last integer of the previous row.\n\n"
        "Return `true` if `target` is in the matrix and `false` otherwise, in O(log(m · n)) time.",
        ["1 <= m, n <= 100", "-10^4 <= matrix[i][j], target <= 10^4"],
        "searchMatrix", "matrix: List[List[int]], target: int", "bool",
        "class Solution:\n    def searchMatrix(self, matrix, target):\n        rows, cols = len(matrix), len(matrix[0])\n        lo, hi = 0, rows * cols - 1\n        while lo <= hi:\n            mid = (lo + hi) // 2\n"
        "            value = matrix[mid // cols][mid % cols]\n            if value == target:\n                return True\n            if value < target:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n        return False\n",
        [(([[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], 3), True, None), (([[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], 13), False, None)],
        [([[1]], 1), ([[1]], 2), ([[1, 3]], 3), ([[1], [3]], 3), ([[i * 10 + j for j in range(10)] for i in range(10)], 99), ([[i * 10 + j for j in range(10)] for i in range(10)], -1)],
        hints=["Treat the matrix as one sorted array of m·n items."], explanation="Binary search over the flattened index. O(log(m·n)).")

    add("spiral-matrix", "Spiral Matrix", "Medium", ["Array", "Matrix", "Simulation"],
        "Given an `m x n` matrix, return all elements of the matrix in spiral order (clockwise, starting from the top-left).",
        ["1 <= m, n <= 10", "-100 <= matrix[i][j] <= 100"],
        "spiralOrder", "matrix: List[List[int]]", "List[int]",
        "class Solution:\n    def spiralOrder(self, matrix):\n        out = []\n        while matrix:\n            out += matrix.pop(0)\n            matrix = [list(row) for row in zip(*matrix)][::-1]\n        return out\n",
        [(([[1, 2, 3], [4, 5, 6], [7, 8, 9]],), [1, 2, 3, 6, 9, 8, 7, 4, 5], None),
         (([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]],), [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7], None)],
        [([[1]],), ([[1, 2]],), ([[1], [2]],), ([[1, 2], [3, 4]],), ([[i * 7 + j for j in range(7)] for i in range(5)],), ([[i * 3 + j for j in range(3)] for i in range(9)],)],
        hints=["Peel off the top row, then rotate what is left."], explanation="Remove the first row and rotate the remainder counter-clockwise. O(m·n).")

    add("rotate-array", "Rotate Array", "Medium", ["Array", "Math", "Two Pointers"],
        "Given an integer array `nums`, rotate it to the right by `k` steps, where `k` is non-negative. Return the rotated array.",
        ["1 <= nums.length <= 10^5", "-2^31 <= nums[i] <= 2^31 - 1", "0 <= k <= 10^5"],
        "rotate", "nums: List[int], k: int", "List[int]",
        "class Solution:\n    def rotate(self, nums, k):\n        k %= len(nums)\n        return nums[-k:] + nums[:-k] if k else nums[:]\n",
        [(([1, 2, 3, 4, 5, 6, 7], 3), [5, 6, 7, 1, 2, 3, 4], None), (([-1, -100, 3, 99], 2), [3, 99, -1, -100], None)],
        [([1], 5), ([1, 2], 0), ([1, 2, 3], 3), ([1, 2, 3], 4), (list(range(2000)), 777), ([5, 6, 7], 100000)],
        hints=["Rotating by k is the same as rotating by k mod n."], explanation="Slice and concatenate. O(n).")

    add("happy-number", "Happy Number", "Easy", ["Hash Table", "Math", "Two Pointers"],
        "A **happy number** is defined by repeatedly replacing a number with the sum of the squares of its digits until it equals 1 (happy) or loops forever in a cycle that does not include 1.\n\n"
        "Return `true` if `n` is a happy number, and `false` if not.",
        ["1 <= n <= 2^31 - 1"],
        "isHappy", "n: int", "bool",
        "class Solution:\n    def isHappy(self, n):\n        seen = set()\n        while n != 1 and n not in seen:\n            seen.add(n)\n            n = sum(int(d) ** 2 for d in str(n))\n        return n == 1\n",
        [((19,), True, "1 + 81 = 82, 64 + 4 = 68, 36 + 64 = 100, 1 + 0 + 0 = 1."), ((2,), False, None)],
        [(1,), (7,), (4,), (100,), (2147483647,), (999999999,)],
        hints=["If you ever see a number twice you are in a cycle."], explanation="Track visited numbers (or use fast/slow pointers).")

    add("sqrtx", "Sqrt(x)", "Easy", ["Math", "Binary Search"],
        "Given a non-negative integer `x`, return the square root of `x` rounded **down** to the nearest integer. You may not use any built-in exponent function or operator.",
        ["0 <= x <= 2^31 - 1"],
        "mySqrt", "x: int", "int",
        "class Solution:\n    def mySqrt(self, x):\n        lo, hi = 0, x\n        while lo < hi:\n            mid = (lo + hi + 1) // 2\n            if mid * mid <= x:\n                lo = mid\n            else:\n                hi = mid - 1\n        return lo\n",
        [((4,), 2, None), ((8,), 2, "The square root of 8 is 2.828..., rounded down to 2.")],
        [(0,), (1,), (2,), (15,), (16,), (2147483647,)],
        hints=["Binary search the answer between 0 and x."], explanation="Binary search for the largest m with m*m <= x. O(log x).")

    add("powx-n", "Pow(x, n)", "Medium", ["Math", "Recursion"],
        "Implement `pow(x, n)`, which calculates `x` raised to the power `n` (that is, `x^n`).",
        ["-100.0 < x < 100.0", "-2^31 <= n <= 2^31 - 1", "-10^4 <= x^n <= 10^4"],
        "myPow", "x: float, n: int", "float",
        "class Solution:\n    def myPow(self, x, n):\n        if n < 0:\n            x, n = 1 / x, -n\n        result = 1.0\n        while n:\n            if n & 1:\n                result *= x\n            x *= x\n            n >>= 1\n        return result\n",
        [((2.0, 10), 1024.0, None), ((2.1, 3), 9.261, None), ((2.0, -2), 0.25, None)],
        [(1.0, 2147483647), (2.0, 0), (0.5, 3), (-2.0, 3), (-2.0, 4), (1.00001, 1000)],
        compare="float", hints=["Square the base and halve the exponent: O(log n) multiplications."], explanation="Exponentiation by squaring. O(log n).")

    add("daily-temperatures", "Daily Temperatures", "Medium", ["Array", "Stack", "Monotonic Stack"],
        "Given an array of integers `temperatures` for daily temperatures, return an array `answer` such that `answer[i]` is the number of days you have to wait after day `i` to get a warmer temperature. "
        "If there is no future day for which this is possible, keep `answer[i] == 0`.",
        ["1 <= temperatures.length <= 10^5", "30 <= temperatures[i] <= 100"],
        "dailyTemperatures", "temperatures: List[int]", "List[int]",
        "class Solution:\n    def dailyTemperatures(self, temperatures):\n        out = [0] * len(temperatures)\n        stack = []\n        for i, t in enumerate(temperatures):\n            while stack and temperatures[stack[-1]] < t:\n"
        "                j = stack.pop()\n                out[j] = i - j\n            stack.append(i)\n        return out\n",
        [(([73, 74, 75, 71, 69, 72, 76, 73],), [1, 1, 4, 2, 1, 1, 0, 0], None), (([30, 40, 50, 60],), [1, 1, 1, 0], None), (([30, 60, 90],), [1, 1, 0], None)],
        [([50],), ([60, 60, 60],), ([90, 80, 70],), ([30 + i % 70 for i in range(3000)],), (list(range(30, 100)) * 40,), ([100, 30, 100, 31, 100],)],
        hints=["Keep a stack of days still waiting for a warmer temperature."], explanation="Monotonic decreasing stack of indices. O(n).")

    add("decode-ways", "Decode Ways", "Medium", ["String", "Dynamic Programming"],
        "A message containing letters from `A-Z` is encoded to numbers using `A -> 1`, `B -> 2`, ..., `Z -> 26`. To decode, digits are grouped and mapped back; for example `\"11106\"` can be grouped as `(1 1 10 6)` or `(11 10 6)`.\n\n"
        "Given a string `s` of digits, return the **number of ways** to decode it. A group may not have a leading zero.",
        ["1 <= s.length <= 100", "s contains only digits and may contain leading zero(s)."],
        "numDecodings", "s: str", "int",
        "class Solution:\n    def numDecodings(self, s):\n        prev, cur = 0, 1\n        for i, c in enumerate(s):\n            nxt = 0\n            if c != '0':\n                nxt += cur\n            if i and 10 <= int(s[i - 1:i + 1]) <= 26:\n                nxt += prev\n            prev, cur = cur, nxt\n        return cur\n",
        [(("12",), 2, "\"AB\" (1 2) or \"L\" (12)."), (("226",), 3, None), (("06",), 0, "A leading zero cannot be decoded.")],
        [("0",), ("10",), ("27",), ("11106",), ("1" * 60,), ("2101",)],
        hints=["ways(i) depends on ways(i-1) and ways(i-2)."], explanation="DP over prefixes with two rolling values. O(n).")

    add("partition-equal-subset-sum", "Partition Equal Subset Sum", "Medium", ["Array", "Dynamic Programming"],
        "Given an integer array `nums`, return `true` if you can partition the array into two subsets such that the sum of the elements in both subsets is equal, or `false` otherwise.",
        ["1 <= nums.length <= 200", "1 <= nums[i] <= 100"],
        "canPartition", "nums: List[int]", "bool",
        "class Solution:\n    def canPartition(self, nums):\n        total = sum(nums)\n        if total % 2:\n            return False\n        reachable = 1\n        for x in nums:\n            reachable |= reachable << x\n        return bool(reachable >> (total // 2) & 1)\n",
        [(([1, 5, 11, 5],), True, "[1, 5, 5] and [11]."), (([1, 2, 3, 5],), False, None)],
        [([1],), ([2, 2],), ([1, 1],), ([3, 3, 3, 4, 5],), ([100] * 200,), ([1] * 199 + [100],)],
        hints=["Equal halves means finding a subset that sums to total/2."], explanation="Subset-sum with a bitset. O(n · sum / wordsize).")

    add("minimum-path-sum", "Minimum Path Sum", "Medium", ["Array", "Dynamic Programming", "Matrix"],
        "Given an `m x n` grid filled with non-negative numbers, find a path from the top-left to the bottom-right that minimises the sum of all numbers along the path. You can only move right or down.",
        ["1 <= m, n <= 200", "0 <= grid[i][j] <= 200"],
        "minPathSum", "grid: List[List[int]]", "int",
        "class Solution:\n    def minPathSum(self, grid):\n        rows, cols = len(grid), len(grid[0])\n        dp = [float('inf')] * cols\n        dp[0] = 0\n        for r in range(rows):\n            for c in range(cols):\n"
        "                best = dp[c] if r else (0 if c == 0 else float('inf'))\n                if c:\n                    best = min(best, dp[c - 1])\n                dp[c] = best + grid[r][c]\n        return dp[-1]\n",
        [(([[1, 3, 1], [1, 5, 1], [4, 2, 1]],), 7, None), (([[1, 2, 3], [4, 5, 6]],), 12, None)],
        [([[5]],), ([[1, 2]],), ([[1], [2]],), ([[0, 0], [0, 0]],), ([[(i * 7 + j * 3) % 10 for j in range(30)] for i in range(30)],), ([[200] * 40 for _ in range(40)],)],
        hints=["The cheapest way to reach a cell comes from the cell above or the cell to its left."], explanation="DP over the grid with a single row. O(m·n).")

    add("longest-common-subsequence", "Longest Common Subsequence", "Medium", ["String", "Dynamic Programming"],
        "Given two strings `text1` and `text2`, return the length of their longest common subsequence, or `0` if there is none.\n\n"
        "A subsequence keeps the relative order of characters but may skip some.",
        ["1 <= text1.length, text2.length <= 1000", "Both strings consist of lowercase English characters."],
        "longestCommonSubsequence", "text1: str, text2: str", "int",
        "class Solution:\n    def longestCommonSubsequence(self, text1, text2):\n        prev = [0] * (len(text2) + 1)\n        for a in text1:\n            cur = [0]\n            for j, b in enumerate(text2):\n"
        "                cur.append(prev[j] + 1 if a == b else max(prev[j + 1], cur[j]))\n            prev = cur\n        return prev[-1]\n",
        [(("abcde", "ace"), 3, "The longest common subsequence is \"ace\"."), (("abc", "abc"), 3, None), (("abc", "def"), 0, None)],
        [("a", "a"), ("a", "b"), ("oxcpqrsvwf", "shmtulqrypy"), ("abcba", "abcbcba"), ("ab" * 200, "ba" * 200), ("a" * 500, "a" * 500)],
        hints=["dp[i][j] compares the first i characters of one string with the first j of the other."], explanation="Classic LCS DP. O(m·n).")

    add("palindrome-number", "Palindrome Number", "Easy", ["Math"],
        "Given an integer `x`, return `true` if `x` is a palindrome, and `false` otherwise.",
        ["-2^31 <= x <= 2^31 - 1"],
        "isPalindrome", "x: int", "bool",
        "class Solution:\n    def isPalindrome(self, x):\n        if x < 0:\n            return False\n        s = str(x)\n        return s == s[::-1]\n",
        [((121,), True, None), ((-121,), False, "Read backwards it is 121-, which is not the same."), ((10,), False, None)],
        [(0,), (7,), (1221,), (12321,), (123456789,), (2147447412,)],
        hints=["A negative number is never a palindrome."], explanation="Compare the digits to their reverse. O(log x).")

    add("reverse-integer", "Reverse Integer", "Medium", ["Math"],
        "Given a signed 32-bit integer `x`, return `x` with its digits reversed. If reversing causes the value to go outside the signed 32-bit range `[-2^31, 2^31 - 1]`, return `0`.",
        ["-2^31 <= x <= 2^31 - 1"],
        "reverse", "x: int", "int",
        "class Solution:\n    def reverse(self, x):\n        sign = -1 if x < 0 else 1\n        r = sign * int(str(abs(x))[::-1])\n        return r if -2 ** 31 <= r <= 2 ** 31 - 1 else 0\n",
        [((123,), 321, None), ((-123,), -321, None), ((120,), 21, None)],
        [(0,), (1534236469,), (-2147483648,), (2147483647,), (1000000003,), (-1563847412,)],
        hints=["Reverse the digits as a string, then check the range."], explanation="Reverse and range-check. O(log x).")

    add("count-primes", "Count Primes", "Medium", ["Array", "Math", "Number Theory"],
        "Given an integer `n`, return the number of prime numbers that are **strictly less than** `n`.",
        ["0 <= n <= 5 * 10^6"],
        "countPrimes", "n: int", "int",
        "class Solution:\n    def countPrimes(self, n):\n        if n < 3:\n            return 0\n        sieve = bytearray([1]) * n\n        sieve[0:2] = b'\\x00\\x00'\n        for i in range(2, int(n ** 0.5) + 1):\n            if sieve[i]:\n                sieve[i * i::i] = bytearray(len(range(i * i, n, i)))\n        return sum(sieve)\n",
        [((10,), 4, "2, 3, 5 and 7."), ((0,), 0, None), ((1,), 0, None)],
        [(2,), (3,), (100,), (1000,), (100000,), (1000000,)],
        hints=["The Sieve of Eratosthenes marks multiples of each prime."], explanation="Sieve of Eratosthenes. O(n log log n).")

    add("sort-colors", "Sort Colors", "Medium", ["Array", "Two Pointers", "Sorting"],
        "Given an array `nums` with `n` objects coloured red, white or blue (represented by `0`, `1` and `2`), sort them so that objects of the same colour are adjacent, in the order red, white, blue. Return the sorted array.\n\n"
        "Try to do it in one pass without using the library's sort function.",
        ["1 <= nums.length <= 300", "nums[i] is 0, 1 or 2"],
        "sortColors", "nums: List[int]", "List[int]",
        "class Solution:\n    def sortColors(self, nums):\n        lo, mid, hi = 0, 0, len(nums) - 1\n        while mid <= hi:\n            if nums[mid] == 0:\n                nums[lo], nums[mid] = nums[mid], nums[lo]\n                lo += 1\n                mid += 1\n"
        "            elif nums[mid] == 1:\n                mid += 1\n            else:\n                nums[mid], nums[hi] = nums[hi], nums[mid]\n                hi -= 1\n        return nums\n",
        [(([2, 0, 2, 1, 1, 0],), [0, 0, 1, 1, 2, 2], None), (([2, 0, 1],), [0, 1, 2], None)],
        [([0],), ([1, 0],), ([2, 2, 2],), ([1, 1, 0, 0, 2, 2],), ([i % 3 for i in range(300)],), ([2, 1, 0] * 100,)],
        hints=["Keep three regions: zeros, ones and twos, with a pointer for each boundary."], explanation="Dutch national flag partition. O(n), one pass.")

    add("find-minimum-in-rotated-sorted-array", "Find Minimum in Rotated Sorted Array", "Medium", ["Array", "Binary Search"],
        "A sorted array of unique elements was rotated between 1 and n times. Given the rotated array `nums`, return its minimum element in O(log n) time.",
        ["n == nums.length", "1 <= n <= 5000", "-5000 <= nums[i] <= 5000", "All the integers of nums are unique."],
        "findMin", "nums: List[int]", "int",
        "class Solution:\n    def findMin(self, nums):\n        lo, hi = 0, len(nums) - 1\n        while lo < hi:\n            mid = (lo + hi) // 2\n            if nums[mid] > nums[hi]:\n                lo = mid + 1\n            else:\n                hi = mid\n        return nums[lo]\n",
        [(([3, 4, 5, 1, 2],), 1, None), (([4, 5, 6, 7, 0, 1, 2],), 0, None), (([11, 13, 15, 17],), 11, "The array was rotated n times, so it looks unchanged.")],
        [([1],), ([2, 1],), ([1, 2],), ([2, 3, 1],), (list(range(2500, 5000)) + list(range(0, 2500)),), (list(range(-2000, 2000)),)],
        hints=["Compare the middle element with the right end to decide which half holds the minimum."], explanation="Binary search on the rotation point. O(log n).")

    add("first-missing-positive", "First Missing Positive", "Hard", ["Array", "Hash Table"],
        "Given an unsorted integer array `nums`, return the smallest missing positive integer.\n\nImplement an algorithm that runs in O(n) time and uses O(1) auxiliary space.",
        ["1 <= nums.length <= 10^5", "-2^31 <= nums[i] <= 2^31 - 1"],
        "firstMissingPositive", "nums: List[int]", "int",
        "class Solution:\n    def firstMissingPositive(self, nums):\n        n = len(nums)\n        for i in range(n):\n            while 0 < nums[i] <= n and nums[nums[i] - 1] != nums[i]:\n                j = nums[i] - 1\n                nums[i], nums[j] = nums[j], nums[i]\n"
        "        for i in range(n):\n            if nums[i] != i + 1:\n                return i + 1\n        return n + 1\n",
        [(([1, 2, 0],), 3, None), (([3, 4, -1, 1],), 2, None), (([7, 8, 9, 11, 12],), 1, None)],
        [([1],), ([2],), ([1, 2, 3],), ([-5, -1],), (list(range(1, 3000)) + [3001],), ([1, 1, 1, 1],)],
        hints=["Place each value v in 1..n at index v-1 by swapping."], explanation="Cyclic sort into place, then scan. O(n) time, O(1) space.")

    add("sliding-window-maximum", "Sliding Window Maximum", "Hard", ["Array", "Queue", "Sliding Window", "Monotonic Queue"],
        "You are given an array of integers `nums` and a sliding window of size `k` moving from the very left to the very right. You can only see the `k` numbers in the window.\n\n"
        "Return the maximum of every window position.",
        ["1 <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4", "1 <= k <= nums.length"],
        "maxSlidingWindow", "nums: List[int], k: int", "List[int]",
        "class Solution:\n    def maxSlidingWindow(self, nums, k):\n        from collections import deque\n        window, out = deque(), []\n        for i, x in enumerate(nums):\n            while window and nums[window[-1]] <= x:\n                window.pop()\n"
        "            window.append(i)\n            if window[0] <= i - k:\n                window.popleft()\n            if i >= k - 1:\n                out.append(nums[window[0]])\n        return out\n",
        [(([1, 3, -1, -3, 5, 3, 6, 7], 3), [3, 3, 5, 5, 6, 7], None), (([1], 1), [1], None)],
        [([1, -1], 1), ([9, 11], 2), ([4, 3, 2, 1], 2), ([1, 2, 3, 4], 4), ([(i * 37) % 101 for i in range(3000)], 50), (list(range(2000, 0, -1)), 200)],
        hints=["Keep a deque of indices whose values are decreasing."], explanation="Monotonic deque. O(n).")
