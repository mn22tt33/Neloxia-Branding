import getpass
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parents[2]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

load_dotenv(APP_DIR / ".env")

from backend.account_auth import (  # noqa: E402
    AuthStoreError,
    PostgresAuthStore,
    hash_password,
)


def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required; set it in the environment or .env.", file=sys.stderr)
        return 2

    email = input("Administrator email: ").strip().lower()
    full_name = input("Administrator display name: ").strip() or email
    password = getpass.getpass("Administrator password: ")
    confirmation = getpass.getpass("Confirm administrator password: ")
    if password != confirmation:
        print("The passwords do not match.", file=sys.stderr)
        return 2

    try:
        password_hash = hash_password(password)
        store = PostgresAuthStore(database_url)
        store.initialize()
        user_id = store.provision_admin(email, full_name, password_hash)
    except (ValueError, AuthStoreError, RuntimeError) as error:
        print("Could not provision administrator: %s" % error, file=sys.stderr)
        return 1

    print("Administrator account saved in PostgreSQL (user id: %s)." % user_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
