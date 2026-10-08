"""
Clerk Backend Service
Integrates with Clerk REST API for B2B multi-tenant organization provisioning
and user invitations. Operates gracefully with fallback if CLERK_SECRET_KEY is unconfigured.
"""
import os
import requests
from typing import Optional, Dict, Any

CLERK_API_BASE = "https://api.clerk.com/v1"

def get_clerk_secret_key() -> Optional[str]:
    key = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not key or key.startswith("sk_test_PLACEHOLDER") or key == "YOUR_CLERK_SECRET_KEY":
        return None
    return key

def _get_headers() -> Dict[str, str]:
    secret_key = get_clerk_secret_key()
    return {
        "Authorization": f"Bearer {secret_key}",
        "Content-Type": "application/json"
    }

def create_clerk_organization(name: str, slug: str) -> Optional[Dict[str, Any]]:
    """
    Creates a new organization in Clerk.
    Returns organization data dictionary or None if key is absent or request fails.
    """
    if not get_clerk_secret_key():
        return None
    try:
        url = f"{CLERK_API_BASE}/organizations"
        payload = {
            "name": name,
            "slug": slug
        }
        resp = requests.post(url, json=payload, headers=_get_headers(), timeout=10)
        if resp.status_code in (200, 201):
            return resp.json()
        print(f"[Clerk API] Failed to create organization: {resp.status_code} - {resp.text}")
        return None
    except Exception as e:
        print(f"[Clerk API Error] create_clerk_organization: {e}")
        return None

def invite_to_clerk_organization(
    clerk_org_id: str,
    email_address: str,
    role: str = "org:member"
) -> Optional[Dict[str, Any]]:
    """
    Invites a user to a Clerk Organization by email.
    Roles: 'org:admin' or 'org:member'.
    """
    if not get_clerk_secret_key() or not clerk_org_id:
        return None
    try:
        url = f"{CLERK_API_BASE}/organizations/{clerk_org_id}/invitations"
        payload = {
            "email_address": email_address,
            "role": role
        }
        resp = requests.post(url, json=payload, headers=_get_headers(), timeout=10)
        if resp.status_code in (200, 201):
            return resp.json()
        print(f"[Clerk API] Failed to create org invitation: {resp.status_code} - {resp.text}")
        return None
    except Exception as e:
        print(f"[Clerk API Error] invite_to_clerk_organization: {e}")
        return None

def create_clerk_invitation(email_address: str) -> Optional[Dict[str, Any]]:
    """
    Sends a platform-level user invitation via Clerk.
    """
    if not get_clerk_secret_key():
        return None
    try:
        url = f"{CLERK_API_BASE}/invitations"
        payload = {
            "email_address": email_address,
            "notify": True,
            "ignore_existing": True
        }
        resp = requests.post(url, json=payload, headers=_get_headers(), timeout=10)
        if resp.status_code in (200, 201):
            return resp.json()
        print(f"[Clerk API] Failed to invite user: {resp.status_code} - {resp.text}")
        return None
    except Exception as e:
        print(f"[Clerk API Error] create_clerk_invitation: {e}")
        return None
