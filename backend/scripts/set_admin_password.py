"""
Sets (or replaces) the password of an existing administrator account, from the command line. This is the break-glass
procedure for the platform administrator; day-to-day password changes use the app (Change password / User Management).

  python scripts/set_admin_password.py                       # prompts twice, no echo   (account: admin@thirdeyedata.ai)
  python scripts/set_admin_password.py --email other@x.com
  set PREPWIN_NEW_PASSWORD=...  &  python scripts/set_admin_password.py --from-env      # non-interactive

The password is validated against the platform policy, hashed (bcrypt), never printed and never logged. Every existing session of
the account is revoked. The account must already exist and have the ADMIN or SUPER_ADMIN role; this script never creates users or changes roles.
"""
import argparse
import getpass
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", default="admin@thirdeyedata.ai")
    parser.add_argument("--from-env", action="store_true", help="read the password from PREPWIN_NEW_PASSWORD instead of prompting")
    args = parser.parse_args(argv)

    import database, models, utils
    from services import local_auth
    from sqlalchemy.sql import func

    if args.from_env:
        password = os.environ.get("PREPWIN_NEW_PASSWORD", "")
    else:
        password = getpass.getpass("New password: ")
        if password != getpass.getpass("Repeat new password: "):
            print("The two entries differ; nothing changed.")
            return 2

    email = local_auth.normalize_email(args.email)
    problems = local_auth.password_policy_errors(password, email)
    if problems:
        print("Password rejected:")
        for problem in problems:
            print(" -", problem)
        return 2

    print("Database:", database.engine.url.render_as_string(hide_password=True))
    with database.SessionLocal() as db:
        user = db.query(models.User).filter(func.lower(models.User.email) == email).first()
        if user is None or not models.is_admin_role(user.role):
            print(f"No ADMIN or SUPER_ADMIN account with e-mail {email} exists; nothing changed.")
            return 1
        user.hashed_password = utils.get_password_hash(password)
        user.is_active = True
        revoked = local_auth.revoke_user_sessions(db, user.id)
        db.commit()
    print(f"Password updated for {email}; {revoked} existing session(s) signed out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
