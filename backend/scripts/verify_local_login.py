"""
Smoke-verifies the local login of one account against a RUNNING PrepWin API (read-only for administrators: nothing is created).

  set PREPWIN_VERIFY_EMAIL=admin@thirdeyedata.ai
  set PREPWIN_VERIFY_PASSWORD=...            (read from the environment; never printed, never logged)
  python scripts/verify_local_login.py --base http://127.0.0.1:8765

Checks: login sets an HttpOnly cookie and no token in the body; /api/auth/me reports the stored role; a wrong password is refused;
for an ADMIN: the user list, the recruitment overview and the job-role list load, a state-changing call without the CSRF token is
refused; logout revokes the session. Exit code 0 only if every check passes.
"""
import argparse
import os
import sys

import requests


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, help="API base URL, e.g. http://127.0.0.1:8000")
    args = parser.parse_args()
    email = os.environ.get("PREPWIN_VERIFY_EMAIL", "").strip()
    password = os.environ.get("PREPWIN_VERIFY_PASSWORD", "")
    if not email or not password:
        print("Set PREPWIN_VERIFY_EMAIL and PREPWIN_VERIFY_PASSWORD in the environment.")
        return 2
    base = args.base.rstrip("/")
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))

    wrong = requests.post(f"{base}/api/auth/login/", json={"email": email, "password": password + "-wrong"}, timeout=30)
    check("wrong password is refused with a generic 401", wrong.status_code == 401 and wrong.json().get("detail") == "Invalid email or password.")

    s = requests.Session()
    res = s.post(f"{base}/api/auth/login/", json={"email": email, "password": password}, timeout=30)
    check("login succeeds", res.status_code == 200, f"HTTP {res.status_code}")
    if res.status_code != 200:
        print("detail:", res.json().get("detail") if res.headers.get("content-type", "").startswith("application/json") else "")
        return 1
    body = res.json()
    cookie = res.headers.get("set-cookie", "")
    check("session cookie is HttpOnly", "httponly" in cookie.lower() and cookie.startswith("prepwin_session="))
    check("no token or password hash in the response body", not any(k in body for k in ("access", "token", "hashed_password")) and password not in res.text)
    role = body.get("role")
    check("role and redirect come from the server", role in ("SUPER_ADMIN", "ADMIN", "STUDENT") and body.get("redirect") == {"SUPER_ADMIN": "/admin/dashboard", "ADMIN": "/admin/dashboard", "STUDENT": "/student/dashboard"}[role], f"role={role} redirect={body.get('redirect')}")
    csrf = {"X-CSRF-Token": body.get("csrf_token", "")}

    me = s.get(f"{base}/api/auth/me", timeout=30)
    check("/api/auth/me returns the stored account", me.status_code == 200 and me.json().get("email") == email and me.json().get("role") == role)

    if role in ("ADMIN", "SUPER_ADMIN"):
        users = s.get(f"{base}/api/admin/users/", params={"page_size": 100}, timeout=30)
        check("admin user list loads (User Management)", users.status_code == 200 and "hashed_password" not in users.text, f"{users.json().get('total') if users.status_code == 200 else users.status_code} accounts")
        overview = s.get(f"{base}/api/admin/recruitment/overview-stats", timeout=60)
        check("Admin Dashboard overview API loads", overview.status_code == 200, f"HTTP {overview.status_code}")
        roles = s.get(f"{base}/api/admin/job-roles/", timeout=60)
        check("Job Roles API loads", roles.status_code == 200, f"HTTP {roles.status_code}")
        forged = s.post(f"{base}/api/admin/users/0/deactivate", timeout=30)
        check("state-changing call without the CSRF token is refused", forged.status_code == 403)
        if role == "SUPER_ADMIN":
            plat = s.get(f"{base}/api/platform/organizations", timeout=30)
            check("Super Admin API (/api/platform/organizations) loads", plat.status_code == 200, f"HTTP {plat.status_code}")
        student_area = s.get(f"{base}/api/student/dashboard", timeout=30)
        check("admin session is not accepted by student-only APIs", student_area.status_code in (401, 403))

    old_cookie = s.cookies.get("prepwin_session", "")
    out = s.post(f"{base}/api/auth/logout/", timeout=30)
    replay = requests.get(f"{base}/api/auth/me", cookies={"prepwin_session": old_cookie}, timeout=30)
    check("logout succeeds and the previous cookie value is dead server-side", out.status_code == 200 and bool(old_cookie) and replay.status_code == 401)

    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
